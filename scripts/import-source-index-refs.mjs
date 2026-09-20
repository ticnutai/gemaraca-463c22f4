#!/usr/bin/env node
/**
 * ייבוא מראי מקומות רשמיים מאינדקס המקורות של psakim.org
 * ──────────────────────────────────────────────────────────
 * האתר מתייג כל פסק בעץ מקורות: בבלי ← מסכת ← דף ← עמוד.
 * המיפוי הזה כבר הורד לקבצים:
 *   public/psakim_sources_index.json  — עץ המקורות (3,537 עלים)
 *   public/tag_psakim_map.json        — מזהה מקור → רשימת פסקים
 * הסקריפט מחבר אותם לפסקים שבמסד (לפי כותרת הקובץ המקומי ב-all-psakim/)
 * ומייצר SQL שמוסיף אותם ל-talmud_references בתור source='site-index'.
 *
 * למה: החילוץ האוטומטי (regex + AI) מפספס כ-45% מהמקורות המרכזיים,
 * ואילו האינדקס של האתר הוא תיוג ידני ומדויק ברמת עמוד.
 *
 * שימוש:
 *   node scripts/import-source-index-refs.mjs            # יוצר SQL ומדווח
 *   node scripts/import-source-index-refs.mjs --run      # יוצר ומריץ מיד
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_SQL = join(ROOT, 'scripts', 'data', 'DATA_site_index_refs.sql');
const RUN = process.argv.includes('--run');

const SUPABASE_URL = readFileSync(join(ROOT, '.env'), 'utf8').match(/VITE_SUPABASE_URL="?([^"\r\n]+)/)[1];
const SUPABASE_KEY = readFileSync(join(ROOT, '.env'), 'utf8').match(/VITE_SUPABASE_PUBLISHABLE_KEY="?([^"\r\n]+)/)[1];

// ── עברית: גימטריה ומספור דפים ──────────────────────────────
const GEMATRIA = { א:1,ב:2,ג:3,ד:4,ה:5,ו:6,ז:7,ח:8,ט:9,י:10,כ:20,ך:20,ל:30,מ:40,ם:40,נ:50,ן:50,
  ס:60,ע:70,פ:80,ף:80,צ:90,ץ:90,ק:100,ר:200,ש:300,ת:400 };

function gematriaToNumber(heb) {
  let sum = 0;
  for (const ch of heb.replace(/[^א-ת]/g, '')) sum += GEMATRIA[ch] || 0;
  return sum;
}

// זהה לפונקציה שב-supabase/functions/extract-references כדי שה-normalized יהיה אחיד
function numberToHebrewLetter(n) {
  const units = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const hundreds = ['', 'ק', 'ר', 'ש', 'ת'];
  if (n <= 0 || n > 500) return String(n);
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  if (t === 1 && u === 5) return hundreds[h] + 'ט״ו';
  if (t === 1 && u === 6) return hundreds[h] + 'ט״ז';
  let result = hundreds[h] + tens[t] + units[u];
  return result.length > 1 ? result.slice(0, -1) + '״' + result.slice(-1) : result + '׳';
}

const normalizedRef = (tractate, daf, amud) =>
  `${tractate} ${numberToHebrewLetter(Number(daf))}${amud === 'a' ? '.' : amud === 'b' ? ':' : ''}`;

// ── 1. עץ המקורות → נתיב מלא לכל מזהה תגית ─────────────────
const tree = JSON.parse(readFileSync(join(ROOT, 'public/psakim_sources_index.json'), 'utf8'));
const tagPath = {};
const walk = (node, path) => {
  const cur = [...path, node.text];
  tagPath[node.id] = cur;
  (node.children || []).forEach((c) => walk(c, cur));
};
(tree.children || []).forEach((r) => walk(r, []));

// ── 2. מזהה תגית → פסקים, מסונן לבבלי ברמת עמוד ────────────
const tagMap = JSON.parse(readFileSync(join(ROOT, 'public/tag_psakim_map.json'), 'utf8'));
const bySiteId = new Map(); // siteId -> Set("מסכת|דף|עמוד")
const otherCorpora = {};
for (const [tagId, list] of Object.entries(tagMap)) {
  const path = tagPath[tagId];
  if (!path) continue;
  if (path[0] !== 'בבלי') {
    otherCorpora[path[0]] = (otherCorpora[path[0]] || 0) + list.length;
    continue;
  }
  if (path.length < 4) continue;
  const tractate = path[1];
  const daf = gematriaToNumber(path[2].replace(/^דף\s*/, ''));
  const amud = path[3].replace(/^עמוד\s*/, '').trim() === 'ב' ? 'b' : 'a';
  if (!daf) continue;
  for (const [psakId] of list) {
    const key = String(psakId);
    if (!bySiteId.has(key)) bySiteId.set(key, new Set());
    bySiteId.get(key).add(`${tractate}|${daf}|${amud}`);
  }
}

// ── 3. מזהה באתר → כותרת, מתוך הקבצים שהורדו ───────────────
const dir = join(ROOT, 'all-psakim');
const titleBySiteId = new Map();
if (existsSync(dir)) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(join(dir, f), 'utf8');
    const id = (html.match(/File\/(\d+)"[^>]*target="_blank"/) || [])[1];
    if (!id) continue;
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
    if (title) titleBySiteId.set(id, title.replace(/ - אתר פסקי דין רבניים/, '').trim());
  }
}

// ── 4. כותרת → מזהה הפסק במסד ──────────────────────────────
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const psakim = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('psakei_din').select('id,title').range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  psakim.push(...data);
  if (data.length < 1000) break;
}
const norm = (s) => s.replace(/\s+/g, ' ').replace(/["״׳'`]/g, '').trim();
const idByTitle = new Map();
for (const p of psakim) {
  const k = norm(p.title || '');
  if (k && !idByTitle.has(k)) idByTitle.set(k, p.id);
}

// ── 5. בניית השורות ────────────────────────────────────────
const rows = [];
let unmatchedPsakim = 0;
for (const [siteId, refs] of bySiteId) {
  const title = titleBySiteId.get(siteId);
  const psakId = title ? idByTitle.get(norm(title)) : undefined;
  if (!psakId) { unmatchedPsakim++; continue; }
  for (const ref of refs) {
    const [tractate, daf, amud] = ref.split('|');
    rows.push({
      psakId,
      tractate,
      daf,
      amud,
      raw: `בבלי ← ${tractate} ← דף ${numberToHebrewLetter(Number(daf))} ← עמוד ${amud === 'b' ? 'ב' : 'א'}`,
      normalized: normalizedRef(tractate, daf, amud),
    });
  }
}

console.log(`עץ המקורות: ${Object.keys(tagPath).length} צמתים`);
console.log(`פסקים באינדקס עם מקור בבלי: ${bySiteId.size} | לא נמצאו במסד: ${unmatchedPsakim}`);
console.log(`מראי מקומות להוספה: ${rows.length} (${new Set(rows.map((r) => r.psakId)).size} פסקים)`);
console.log(`מקורות נוספים שלא מיובאים כרגע: ${JSON.stringify(otherCorpora)}`);

// ── 6. SQL ─────────────────────────────────────────────────
const esc = (s) => s.replace(/'/g, "''");
const values = rows
  .map((r) => `('${r.psakId}','${esc(r.tractate)}','${r.daf}','${r.amud}','${esc(r.raw)}','${esc(r.normalized)}')`)
  .join(',\n  ');

const sql = `-- נוצר על ידי scripts/import-source-index-refs.mjs — אפשר להריץ שוב בבטחה
BEGIN;

CREATE TEMP TABLE site_index_refs (psak_din_id uuid, tractate text, daf text, amud text, raw_reference text, normalized text) ON COMMIT DROP;

INSERT INTO site_index_refs VALUES
  ${values};

-- מראי מקומות שכבר קיימים מ-AI/regex ומאושרים על ידי האינדקס הרשמי
UPDATE public.talmud_references r
   SET validation_status = 'correct', confidence = 'high'
  FROM site_index_refs s
 WHERE r.psak_din_id = s.psak_din_id AND r.tractate = s.tractate AND r.daf = s.daf
   AND coalesce(r.amud,'') = s.amud AND r.validation_status = 'pending';

-- הוספת מה שחסר
INSERT INTO public.talmud_references
  (psak_din_id, tractate, daf, amud, raw_reference, normalized, source, confidence, validation_status)
SELECT s.psak_din_id, s.tractate, s.daf, s.amud, s.raw_reference, s.normalized, 'site-index', 'high', 'correct'
  FROM site_index_refs s
 WHERE NOT EXISTS (
   SELECT 1 FROM public.talmud_references r
    WHERE r.psak_din_id = s.psak_din_id AND r.tractate = s.tractate
      AND r.daf = s.daf AND coalesce(r.amud,'') = s.amud
 );

COMMIT;
`;

writeFileSync(OUT_SQL, sql, 'utf8');
console.log(`\n📄 נכתב: ${OUT_SQL}`);

if (RUN) {
  console.log('🚀 מריץ...');
  execFileSync('node', ['scripts/direct-run.mjs', 'file', OUT_SQL], { cwd: ROOT, stdio: 'inherit' });
}
