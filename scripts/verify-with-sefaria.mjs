#!/usr/bin/env node
/**
 * הכרעה בין שתי קריאות של ציטוט, מול נוסח הגמרא עצמו
 * ──────────────────────────────────────────────────────────
 * כשאותו ציטוט יכול להיקרא בשתי דרכים — "דף ע״ב" כדף 72 או כדף ע׳ עמוד ב —
 * אי אפשר להכריע מהצורה. מה שכן מכריע הוא **התוכן**: מה שהפסק מצטט אמור
 * להימצא בדף שאליו הוא מפנה.
 *
 * הסקריפט מושך מספריא את נוסח הדף (גמרא, ובמידת הצורך גם תוספות), ובודק כמה
 * מצירופי המילים שבפסק מופיעים בו. הדף שמכיל יותר — הוא הדף הנכון.
 *
 * שימוש:
 *   node scripts/verify-with-sefaria.mjs --ref "כתובות 72a" --quote "וכן היא שנדרה שלא תשאל"
 *   node scripts/verify-with-sefaria.mjs --ref "כתובות 72a" --alt "כתובות 70b" --quote "..."
 *   node scripts/verify-with-sefaria.mjs --id <uuid של מראה מקום>   # שולף את ההקשר מהמסד
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const str = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const SEFARIA_NAME = Object.fromEntries(
  [...readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8')
    .matchAll(/hebrewName:\s*"([^"]+)",\s*englishName:\s*"([^"]+)",\s*sefariaName:\s*"([^"]+)"/g)]
    .map((m) => [m[1], m[3]]),
);

/** ניקוי לצורך השוואה: בלי ניקוד, בלי פיסוק, בלי גרשיים, ובלי אותיות סופיות שונות */
const clean = (s) => String(s || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[֑-ׇ]/g, '')            // טעמים וניקוד
  .replace(/["'״׳(),.:;?!\[\]־–—]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** "כתובות 72a" → "Ketubot.72a" */
function toSefariaRef(ref) {
  const m = String(ref).trim().match(/^(.+?)\s+(\d+)([ab])?$/);
  if (!m) return null;
  const he = m[1].trim();
  const name = SEFARIA_NAME[he] ?? he.replace(/ /g, '_');
  return `${name}.${m[2]}${m[3] ?? 'a'}`;
}

async function sefariaText(ref, { commentary = false } = {}) {
  const base = commentary ? `Tosafot_on_${ref}` : ref;
  const url = `https://www.sefaria.org/api/texts/${base}?lang=he&context=0&commentary=0`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) return '';
  const j = await r.json();
  const flat = (v) => Array.isArray(v) ? v.map(flat).join(' ') : String(v ?? '');
  return clean(flat(j.he || j.text || ''));
}

/** כמה צירופים של שלוש מילים מהציטוט מופיעים בנוסח הדף */
function overlap(quote, dafText) {
  const words = clean(quote).split(' ').filter((w) => w.length > 1);
  const shingles = [];
  for (let i = 0; i + 3 <= words.length; i++) shingles.push(words.slice(i, i + 3).join(' '));
  // ציטוט קצר משלוש מילים נבדק כמות שהוא
  if (!shingles.length) {
    const q = clean(quote);
    return q && dafText.includes(q)
      ? { hits: 1, total: 1, sample: q }
      : { hits: 0, total: q ? 1 : 0, sample: '' };
  }
  const found = shingles.filter((sh) => dafText.includes(sh));
  return { hits: found.length, total: shingles.length, sample: found[0] ?? '' };
}

// ── קלט ────────────────────────────────────────────────────
let refHe = str('--ref');
let quote = str('--quote');
const altHe = str('--alt');
const id = str('--id');

if (id) {
  const env = Object.fromEntries(
    readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
      .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
  );
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { data, error } = await sb.from('talmud_references')
    .select('tractate,daf,amud,raw_reference,context_snippet').eq('id', id).single();
  if (error) { console.error('❌', error.message); process.exit(1); }
  refHe = `${data.tractate} ${data.daf}${data.amud ?? 'a'}`;
  quote = data.context_snippet || data.raw_reference;
  console.log(`מראה מקום: ${refHe} | ציטוט: "${String(quote).slice(0, 80)}"`);
}

if (!refHe || !quote) {
  console.error('חסר --ref או --quote (או --id)');
  process.exit(1);
}

const candidates = [refHe, altHe].filter(Boolean);
console.log(`\nבודק ${candidates.length} אפשרויות מול נוסח הגמרא בספריא:\n`);
for (const c of candidates) {
  const ref = toSefariaRef(c);
  if (!ref) { console.log(`  ${c}: לא זוהה`); continue; }
  const gemara = await sefariaText(ref);
  const tosafot = await sefariaText(ref, { commentary: true });
  const g = overlap(quote, gemara);
  const t = overlap(quote, tosafot);
  console.log(`  ${c}  (${ref})`);
  console.log(`     גמרא: ${g.hits}/${g.total} צירופים${g.sample ? ` | לדוגמה: "${g.sample}"` : ''}${gemara ? '' : ' (לא נמצא נוסח)'}`);
  console.log(`     תוספות: ${t.hits}/${t.total}${t.sample ? ` | לדוגמה: "${t.sample}"` : ''}`);
}
