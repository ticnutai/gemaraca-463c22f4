#!/usr/bin/env node
/**
 * אימות מראי מקומות מול נוסח הגמרא, משני מקורות עצמאיים
 * ──────────────────────────────────────────────────────────
 * עד כאן נבדק שהציטוט **קיים בפסק**. כאן נבדק הדבר החשוב יותר: שמה שהפסק
 * מצטט **נמצא בדף שאליו הוא מפנה**. זו הראיה החזקה ביותר, והיא אינה תלויה
 * בצורת הכתיבה של הציטוט.
 *
 * שני מקורות, כדי שלא להיתלות באחד:
 *   ספריא     https://www.sefaria.org/api/texts/<Tractate>.<daf><amud>
 *   ויקיטקסט  https://he.wikisource.org/w/api.php?action=parse&page=<מסכת דף עמוד>
 *
 * כשהציטוט אינו נמצא בדף — מחפשים בדפים הסמוכים (עד ±3 עמודים). אם הוא נמצא
 * שם, יש לנו **ראיה** לדף הנכון, ולא ניחוש. הסקריפט מדווח ואינו מתקן מעצמו
 * אלא עם --fix.
 *
 * שימוש:
 *   node scripts/verify-refs-content.mjs --limit 50
 *   node scripts/verify-refs-content.mjs --limit 500 --fix
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts/data/daf-cache');
mkdirSync(CACHE, { recursive: true });

const args = process.argv.slice(2);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', 200);
const NEIGHBOURS = num('--neighbours', 3);
const FIX = args.includes('--fix');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const masechtot = readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8');
const SEFARIA_NAME = Object.fromEntries([...masechtot
  .matchAll(/hebrewName:\s*"([^"]+)",\s*englishName:\s*"([^"]+)",\s*sefariaName:\s*"([^"]+)"/g)].map((m) => [m[1], m[3]]));
const MAX_DAF = Object.fromEntries([...masechtot
  .matchAll(/hebrewName:\s*"([^"]+)"[\s\S]{0,200}?maxDaf:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));

/** ניקוי אחיד: בלי ניקוד, בלי פיסוק, בלי גרשיים */
const clean = (s) => String(s || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[֑-ׇ]/g, '')
  .replace(/&#?\w+;/g, ' ')
  .replace(/[״“”"׳‘’'(),.:;?!\[\]־–—]/g, ' ')
  .replace(/\s+/g, ' ').trim();

const toHebrewDaf = (n) => {
  const u = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const t = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const h = ['', 'ק', 'ר', 'ש', 'ת'];
  const hu = Math.floor(n / 100), te = Math.floor((n % 100) / 10), on = n % 10;
  if (te === 1 && on === 5) return h[hu] + 'טו';
  if (te === 1 && on === 6) return h[hu] + 'טז';
  return h[hu] + t[te] + u[on];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** נוסח הדף משני המקורות, עם קאש על הדיסק */
async function dafText(tractate, daf, amud) {
  const key = `${tractate}_${daf}${amud}`.replace(/[^\wא-ת]/g, '_');
  const file = join(CACHE, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));

  const out = { sefaria: '', wikisource: '' };
  const name = SEFARIA_NAME[tractate];
  if (name) {
    try {
      const r = await fetch(`https://www.sefaria.org/api/texts/${name}.${daf}${amud}?lang=he&context=0`, { headers: { accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        const flatten = (v) => Array.isArray(v) ? v.map(flatten).join(' ') : String(v ?? '');
        out.sefaria = clean(flatten(j.he || j.text || ''));
      }
    } catch { /* נרשם כריק */ }
    await sleep(120);
  }
  try {
    const page = encodeURIComponent(`${tractate} ${toHebrewDaf(daf)} ${amud === 'a' ? 'א' : 'ב'}`);
    const r = await fetch(`https://he.wikisource.org/w/api.php?action=parse&page=${page}&prop=text&format=json&redirects=1`);
    if (r.ok) {
      const j = await r.json();
      out.wikisource = clean(j.parse?.text?.['*'] || '');
    }
  } catch { /* נרשם כריק */ }
  await sleep(120);

  writeFileSync(file, JSON.stringify(out), 'utf8');
  return out;
}

/**
 * הציטוט שהפסק מביא מהגמרא — רק מה שנמצא בתוך מרכאות אחרי ההפניה.
 *
 * המילים שאחרי ההפניה בלי מרכאות הן בדרך כלל לשון הפסק עצמו ולא לשון הגמרא,
 * ולכן חיפוש שלהן בדף מחזיר "לא נמצא" חסר משמעות. בלי מרכאות אין מה לבדוק.
 */
function quotedFrom(context, raw) {
  const ctx = String(context || '');
  const at = ctx.indexOf(raw);
  const tail = at >= 0 ? ctx.slice(at + raw.length) : ctx;
  const quoted = tail.match(/["״”]([^"״”]{25,400})["״”]/)
    || ctx.match(/["״”]([^"״”]{25,400})["״”]/);
  return quoted ? clean(quoted[1]) : '';
}

/** כמה מצירופי ארבע המילים של הציטוט נמצאים בנוסח הדף */
function hits(quote, text) {
  const w = quote.split(' ').filter((x) => x.length > 1);
  const sh = [];
  for (let i = 0; i + 4 <= w.length; i++) sh.push(w.slice(i, i + 4).join(' '));
  if (!sh.length || !text) return { hit: 0, total: sh.length, sample: '' };
  const found = sh.filter((s) => text.includes(s));
  return { hit: found.length, total: sh.length, sample: found[0] ?? '' };
}

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('talmud_references')
    .select('id,psak_din_id,tractate,daf,amud,raw_reference,context_snippet,source,validation_status,validated_by')
    .not('context_snippet', 'is', null).range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
// מתחילים במה שעוד לא אומת מול נוסח הגמרא, ובעל ציטוט ארוך מספיק
const hasQuote = (r) => /["״”][^"״”]{25,400}["״”]/.test(String(r.context_snippet));
const work = rows
  .filter((r) => r.validated_by !== 'gemara-text' && String(r.context_snippet).length > 60 && hasQuote(r))
  .sort(() => Math.random() - 0.5)
  .slice(0, LIMIT);
console.log(`מראי מקומות עם הקשר: ${rows.length} | נבדקים כעת: ${work.length}`);

const stats = { confirmed: 0, 'found-nearby': 0, 'not-found': 0, 'no-quote': 0, 'no-text': 0 };
const corrections = [];
let n = 0;
for (const r of work) {
  n++;
  const quote = quotedFrom(r.context_snippet, r.raw_reference);
  if (quote.split(' ').filter(Boolean).length < 6) { stats['no-quote']++; continue; }

  const amud = r.amud ?? 'a';
  const daf = Number(r.daf);
  const text = await dafText(r.tractate, daf, amud);
  const both = `${text.sefaria} ${text.wikisource}`;
  if (!both.trim()) { stats['no-text']++; continue; }

  const h = hits(quote, both);
  if (h.hit > 0) {
    stats.confirmed++;
    if (FIX) await sb.from('talmud_references').update({
      validation_status: 'correct', validated_by: 'gemara-text', validated_at: new Date().toISOString(),
    }).eq('id', r.id);
    continue;
  }

  // לא נמצא — מחפשים ראיה בדפים הסמוכים
  let found = null;
  for (let step = 1; step <= NEIGHBOURS && !found; step++) {
    for (const dir of [1, -1]) {
      const idx = (daf * 2 + (amud === 'b' ? 1 : 0)) + dir * step;
      const nd = Math.floor(idx / 2), na = idx % 2 === 0 ? 'a' : 'b';
      if (nd < 2 || nd > (MAX_DAF[r.tractate] ?? 200)) continue;
      const t2 = await dafText(r.tractate, nd, na);
      const h2 = hits(quote, `${t2.sefaria} ${t2.wikisource}`);
      if (h2.hit > 0) { found = { daf: nd, amud: na, ...h2 }; break; }
    }
  }
  if (found) {
    stats['found-nearby']++;
    corrections.push({ id: r.id, from: `${r.tractate} ${daf}${amud}`, to: `${r.tractate} ${found.daf}${found.amud}`, quote: quote.slice(0, 70), sample: found.sample, source: r.source });
  } else {
    stats['not-found']++;
  }
  if (n % 25 === 0) console.log(`  ${n}/${work.length} | ${JSON.stringify(stats)}`);
}

console.log(`\nתוצאה על ${work.length}:`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
if (corrections.length) {
  console.log('\nהציטוט נמצא בדף סמוך — ראיה לדף הנכון:');
  corrections.slice(0, 12).forEach((c) => console.log(`   ${c.from} → ${c.to} (${c.source})  «${c.quote}»  | נמצא: "${c.sample}"`));
  writeFileSync(join(ROOT, `scripts/data/nearby-corrections-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify(corrections, null, 2), 'utf8');
}
