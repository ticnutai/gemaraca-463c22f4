#!/usr/bin/env node
/**
 * החלת תיקוני דף שנמצאו בראיה
 * ──────────────────────────────────────────────────────────
 * `verify-refs-content.mjs` כותב קובץ תיקונים: מראי מקומות שהציטוט שלהם נמצא
 * בדף אחר — בעמוד הסמוך או דרך חיפוש הביטוי בוויקיטקסט. הקובץ **אינו מוחל
 * מעצמו**, כדי שאפשר יהיה לעבור עליו קודם.
 *
 * הסקריפט הזה מחיל אותו, ולפני כל תיקון מאמת שוב מול **ספריא** — מקור שונה
 * מזה שמצא את התיקון. תיקון שספריא אינה מאשרת נדחה ומדווח.
 *
 * שימוש:
 *   node scripts/apply-ref-corrections.mjs scripts/data/nearby-corrections-2026-09-21.json --dry-run
 *   node scripts/apply-ref-corrections.mjs scripts/data/nearby-corrections-2026-09-21.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const DRY = args.includes('--dry-run');
if (!file) { console.error('חסר נתיב לקובץ התיקונים'); process.exit(1); }

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const SEFARIA_NAME = Object.fromEntries(
  [...readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8')
    .matchAll(/hebrewName:\s*"([^"]+)",\s*englishName:\s*"([^"]+)",\s*sefariaName:\s*"([^"]+)"/g)]
    .map((m) => [m[1], m[3]]),
);
const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/[֑-ׇ]/g, '')
  .replace(/&#?\w+;/g, ' ').replace(/[״“”"׳‘’'(),.:;?!\[\]־–—]/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** נוסח הדף מספריא בלבד — מקור שונה מזה שמצא את התיקון */
async function sefariaDaf(tractate, daf, amud) {
  const name = SEFARIA_NAME[tractate];
  if (!name) return '';
  try {
    const r = await fetch(`https://www.sefaria.org/api/texts/${name}.${daf}${amud}?lang=he&context=0`, { headers: { accept: 'application/json' } });
    await sleep(200);
    if (!r.ok) return '';
    const j = await r.json();
    const flatten = (v) => Array.isArray(v) ? v.map(flatten).join(' ') : String(v ?? '');
    return clean(flatten(j.he || j.text || ''));
  } catch { return ''; }
}
const contains = (quote, text) => {
  const w = clean(quote).split(' ').filter((x) => x.length > 1);
  for (let i = 0; i + 4 <= w.length; i++) if (text.includes(w.slice(i, i + 4).join(' '))) return true;
  return false;
};

const heLetter = (n) => {
  const u = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const t = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const h = ['', 'ק', 'ר', 'ש', 'ת'];
  const hu = Math.floor(n / 100), te = Math.floor((n % 100) / 10), on = n % 10;
  let s = te === 1 && on === 5 ? h[hu] + 'ט״ו' : te === 1 && on === 6 ? h[hu] + 'ט״ז' : h[hu] + t[te] + u[on];
  if (!s.includes('״')) s = s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳';
  return s;
};

const corrections = JSON.parse(readFileSync(file, 'utf8'));
console.log(`תיקונים בקובץ: ${corrections.length}`);

const confirmed = [], rejected = [];
for (const c of corrections) {
  const m = String(c.to).match(/^(.+) (\d+)([ab])$/);
  if (!m) { rejected.push({ ...c, why: 'יעד לא מזוהה' }); continue; }
  const [, tractate, daf, amud] = m;
  const text = await sefariaDaf(tractate, Number(daf), amud);
  if (!text) { rejected.push({ ...c, why: 'אין נוסח בספריא' }); continue; }
  if (contains(c.quote, text)) confirmed.push({ ...c, tractate, daf: Number(daf), amud });
  else rejected.push({ ...c, why: 'ספריא אינה מאשרת את הדף החדש' });
}

console.log(`אושרו גם בספריא: ${confirmed.length} | נדחו: ${rejected.length}`);
confirmed.slice(0, 12).forEach((c) => console.log(`   ✔ ${c.from} → ${c.to}  «${String(c.quote).slice(0, 60)}»`));
rejected.slice(0, 8).forEach((c) => console.log(`   ✗ ${c.from} → ${c.to}  (${c.why})`));
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }
if (!confirmed.length) process.exit(0);

writeFileSync(join(ROOT, `scripts/data/applied-corrections-${new Date().toISOString().slice(0, 10)}.json`),
  JSON.stringify(confirmed, null, 2), 'utf8');

let done = 0;
for (const c of confirmed) {
  const normalized = `${c.tractate} ${heLetter(c.daf)}${c.amud === 'a' ? '.' : ':'}`;
  const { error } = await sb.from('talmud_references').update({
    daf: String(c.daf), amud: c.amud, normalized,
    validation_status: 'correct', validated_by: 'gemara-text', validated_at: new Date().toISOString(),
  }).eq('id', c.id);
  if (error) { console.error('❌', error.message); break; }
  done++;
}
console.log(`✅ תוקנו ${done} מראי מקומות לפי נוסח הגמרא`);
