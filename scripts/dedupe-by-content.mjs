#!/usr/bin/env node
/**
 * איחוד פסקים מאותו תיק בשני מקורות, לפי דמיון התוכן
 * ──────────────────────────────────────────────────────────
 * אותו פסק דין מתפרסם גם ב-gov.il וגם באתר דעת, לעיתים בכותרת אחרת לגמרי
 * ("יין ישן: חוב ומשכון" מול "חוב ומשכון"). מספר התיק זהה, אבל מספר תיק לבדו
 * אינו מספיק — באותו תיק יכולים להיות פסק דין, נימוקים וערעור.
 *
 * ההכרעה כאן היא לפי **התוכן**: שתי הרשומות נחשבות אותו מסמך רק אם רוב צירופי
 * חמש המילים של הקצרה מביניהן נמצאים בארוכה. זו בדיקה שאי אפשר לרמות אותה
 * בכותרת.
 *
 * הרשומה מ-gov.il נשמרת (המקור הרשמי, עם הדיינים והקישור), וכל מה שמקושר
 * לשנייה — מראי מקומות, מקורות, קישורי סוגיה — מועבר אליה לפני המחיקה.
 *
 * שימוש:
 *   node scripts/dedupe-by-content.mjs --dry-run
 *   node scripts/dedupe-by-content.mjs --threshold 0.8 --limit 20
 *   node scripts/dedupe-by-content.mjs --run
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const RUN = args.includes('--run');
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const THRESHOLD = num('--threshold', 0.75);
const LIMIT = num('--limit', Infinity);

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const CHILD_TABLES = [
  ['talmud_references', 'psak_din_id', null],
  ['psak_sources', 'psak_din_id', 'display'],
  ['psak_sections', 'psak_din_id', null],
  ['sugya_psak_links', 'psak_din_id', 'sugya_id'],
  ['pattern_sugya_links', 'psak_din_id', null],
  ['smart_index_results', 'psak_din_id', '__row__'],
  ['faq_items', 'psak_din_id', null],
];

const strip = (s) => String(s || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ')
  .replace(/[״“”"׳‘’']/g, '').replace(/[^א-ת0-9\s]/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** איזה חלק מצירופי חמש המילים של הטקסט הקצר נמצא בארוך */
function containment(shortText, longText) {
  const w = shortText.split(' ').filter(Boolean);
  if (w.length < 40) return 0;
  const shingles = [];
  for (let i = 0; i + 5 <= w.length; i += 3) shingles.push(w.slice(i, i + 5).join(' '));
  if (!shingles.length) return 0;
  let hit = 0;
  for (const sh of shingles) if (longText.includes(sh)) hit++;
  return hit / shingles.length;
}

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('psakei_din').select('id,title,case_number,source_key,year').range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}

const caseKey = (s) => String(s || '').replace(/[^0-9/]/g, '');
const byCase = new Map();
for (const r of rows) {
  const c = caseKey(r.case_number);
  if (c.length < 6) continue;
  if (!byCase.has(c)) byCase.set(c, []);
  byCase.get(c).push(r);
}

const candidates = [];
for (const [c, group] of byCase) {
  const gov = group.filter((r) => r.source_key === 'gov.il');
  const others = group.filter((r) => r.source_key !== 'gov.il');
  if (!gov.length || !others.length) continue;
  for (const o of others) for (const g of gov) candidates.push({ c, keep: g, drop: o });
}
console.log(`זוגות מועמדים (אותו תיק, מקורות שונים): ${candidates.length}`);

const textCache = new Map();
async function textOf(id) {
  if (textCache.has(id)) return textCache.get(id);
  const { data } = await sb.from('psakei_din').select('original_text,full_text').eq('id', id).single();
  const t = strip(data?.original_text || data?.full_text || '');
  textCache.set(id, t);
  return t;
}

const matches = [];
let checked = 0;
for (const cand of candidates.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
  const a = await textOf(cand.keep.id);
  const b = await textOf(cand.drop.id);
  checked++;
  if (a.length < 400 || b.length < 400) continue;
  const [shortT, longT] = a.length <= b.length ? [a, b] : [b, a];
  const score = containment(shortT, longT);
  if (score >= THRESHOLD) matches.push({ ...cand, score, lens: [a.length, b.length] });
  if (checked % 50 === 0) console.log(`  נבדקו ${checked}/${candidates.length} | מתאימים ${matches.length}`);
}

matches.sort((x, y) => y.score - x.score);
console.log(`\nזוגות שהתוכן שלהם זהה (סף ${THRESHOLD}): ${matches.length} מתוך ${checked} שנבדקו`);
matches.slice(0, 10).forEach((m) => console.log(
  `   ${(m.score * 100).toFixed(0)}% | תיק ${m.c} | "${String(m.keep.title).slice(0, 38)}" ← "${String(m.drop.title).slice(0, 38)}" (${m.drop.source_key})`,
));
const rejected = checked - matches.length;
console.log(`נדחו: ${rejected} (מסמכים שונים באותו תיק, או טקסט חסר)`);
if (!RUN) { console.log('\n(בלי --run לא נכתב כלום)'); process.exit(0); }
if (!matches.length) process.exit(0);

writeFileSync(join(ROOT, `scripts/data/merged-by-content-${new Date().toISOString().slice(0, 10)}.json`),
  JSON.stringify(matches.map((m) => ({ case: m.c, keep: m.keep, drop: m.drop, score: m.score })), null, 2), 'utf8');

const parts = ['BEGIN;'];
for (const m of matches) {
  for (const [table, col, uniq] of CHILD_TABLES) {
    if (uniq) {
      const match = uniq === '__row__' ? '' : ` AND k.${uniq} = d.${uniq}`;
      parts.push(`DELETE FROM public.${table} d WHERE d.${col} = '${m.drop.id}' AND EXISTS (SELECT 1 FROM public.${table} k WHERE k.${col} = '${m.keep.id}'${match});`);
    }
    parts.push(`UPDATE public.${table} SET ${col} = '${m.keep.id}' WHERE ${col} = '${m.drop.id}';`);
  }
  parts.push(`DELETE FROM public.psakei_din WHERE id = '${m.drop.id}';`);
}
parts.push('COMMIT;');
const sqlFile = join(ROOT, 'scripts/data/DATA_dedupe_by_content.sql');
writeFileSync(sqlFile, parts.join('\n'), 'utf8');
console.log(`📄 נכתב: ${sqlFile}`);
execFileSync('node', ['scripts/direct-run.mjs', 'file', 'scripts/data/DATA_dedupe_by_content.sql'], { cwd: ROOT, stdio: 'inherit' });
console.log(`✅ אוחדו ${matches.length} פסקים כפולים`);
