#!/usr/bin/env node
/**
 * אימות מראי מקומות מול ספריא
 * ──────────────────────────────────────────────────────────
 * ספריא מפעילה מנוע זיהוי ציטוטים שמחזיר הפניה קנונית לכל ציטוט,
 * כולל קיצורים: "ב"מ כא ע"ב" → Bava Metzia 21b. זה זיהוי מוסמך,
 * בלי AI ובלי ניחוש, ולכן הוא הסמכות לאימות מה שחולץ אצלנו.
 *
 * איך זה חסכוני: במקום לשלוח כל פסק, נשלחות רק המחרוזות הייחודיות
 * של raw_reference, כמה עשרות בכל בקשה, ובחזרה מגיעה ההפניה לכל אחת.
 * כך כמה אלפי ציטוטים נבדקים במאות בקשות בודדות.
 *
 * מה נכתב למסד:
 *   • הפניה שספריא מאשרת, ותואמת למה שחילצנו  → validation_status='correct'
 *   • הפניה שספריא מזהה אחרת (מסכת/דף שונים)   → validation_status='incorrect'
 *   • הפניה שספריא לא הצליחה לזהות             → נשארת 'pending'
 *
 * שימוש:
 *   node scripts/sefaria-validate-refs.mjs --limit 200 --dry-run
 *   node scripts/sefaria-validate-refs.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', Infinity);
const BATCH = num('--batch', 40);      // כמה ציטוטים בכל בקשה
const DELAY = num('--delay', 1200);    // נימוס כלפי ספריא
const DRY = has('--dry-run');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

// ── מסכתות: שם אנגלי בספריא → שם עברי אצלנו ────────────────
const MASECHTOT = [...readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8')
  .matchAll(/hebrewName:\s*"([^"]+)",\s*englishName:\s*"([^"]+)",\s*sefariaName:\s*"([^"]+)"/g)]
  .map((m) => ({ he: m[1], en: m[2], sefaria: m[3] }));
const heByEn = new Map(MASECHTOT.flatMap((m) => [[m.en.toLowerCase(), m.he], [m.sefaria.replace(/_/g, ' ').toLowerCase(), m.he]]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** שולח טקסט למנוע הזיהוי ומחכה לתשובה (הממשק אסינכרוני: שליחה ואז איסוף) */
async function findRefs(body) {
  const post = await fetch('https://www.sefaria.org/api/find-refs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: { title: '', body } }),
  });
  if (!post.ok) throw new Error(`find-refs ${post.status}`);
  const { task_id: taskId } = await post.json();
  if (!taskId) throw new Error('לא התקבל מזהה משימה');

  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const r = await fetch(`https://www.sefaria.org/api/async/${taskId}`);
    if (!r.ok) continue;
    const j = await r.json();
    if (j.ready || j.state === 'SUCCESS') return j.result?.body?.results ?? [];
    if (j.state === 'FAILURE') throw new Error('המשימה נכשלה בספריא');
  }
  throw new Error('פג הזמן בהמתנה לספריא');
}

/** "Bava Metzia 21b" → { tractate: 'בבא מציעא', daf: '21', amud: 'b' } */
function parseTalmudRef(ref) {
  const m = String(ref).match(/^(.+?)\s+(\d+)([ab])?$/);
  if (!m) return null;
  const he = heByEn.get(m[1].toLowerCase());
  if (!he) return null;
  return { tractate: he, daf: m[2], amud: m[3] ?? null };
}

// ── שליפת הציטוטים הייחודיים שלנו ──────────────────────────
const refs = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('talmud_references')
    .select('id,raw_reference,tractate,daf,amud,validation_status')
    .neq('source', 'site-index')          // האינדקס הידני כבר מאומת
    .eq('validation_status', 'pending')
    .range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  refs.push(...data);
  if (data.length < 1000) break;
}

const byRaw = new Map();
for (const r of refs) {
  const raw = String(r.raw_reference || '').replace(/\s+/g, ' ').trim();
  if (raw.length < 4 || raw.length > 60) continue;      // מחרוזות ארוכות הן ציטוט טקסט, לא הפניה
  if (!byRaw.has(raw)) byRaw.set(raw, []);
  byRaw.get(raw).push(r);
}
const uniques = [...byRaw.keys()].slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`מראי מקומות ממתינים: ${refs.length} | מחרוזות ייחודיות לבדיקה: ${uniques.length}`);

// ── בדיקה מול ספריא, באצוות ────────────────────────────────
const SEP = '\n';
let confirmed = 0, contradicted = 0, unresolved = 0, failedBatches = 0;
const updates = { correct: [], incorrect: [] };
const examples = { contradicted: [], unresolved: [] };

for (let i = 0; i < uniques.length; i += BATCH) {
  const batch = uniques.slice(i, i + BATCH);
  // כל ציטוט בשורה משלו, וההתאמה חזרה נעשית לפי מיקום התו
  const body = batch.join(SEP);
  const offsets = [];
  let pos = 0;
  for (const c of batch) { offsets.push([pos, pos + c.length]); pos += c.length + SEP.length; }

  let results;
  try {
    results = await findRefs(body);
  } catch (e) {
    failedBatches++;
    console.error(`  ❌ אצווה ${i / BATCH + 1}: ${e.message}`);
    await sleep(DELAY * 2);
    continue;
  }

  const refByIndex = new Map();
  for (const res of results) {
    if (!res.refs?.length) continue;
    const idx = offsets.findIndex(([a, b]) => res.startChar >= a && res.startChar < b);
    if (idx >= 0 && !refByIndex.has(idx)) refByIndex.set(idx, res.refs[0]);
  }

  batch.forEach((raw, idx) => {
    const rows = byRaw.get(raw);
    const canonical = refByIndex.get(idx);
    if (!canonical) {
      unresolved += rows.length;
      if (examples.unresolved.length < 6) examples.unresolved.push(raw);
      return;
    }
    const parsed = parseTalmudRef(canonical);
    if (!parsed) { unresolved += rows.length; return; }
    for (const row of rows) {
      // ספריא לעיתים מחזירה דף בלי עמוד ("Ketubot 85") בעוד שאצלנו יש עמוד מהנקודה
      // שבסוף הציטוט ("כתובות פה."). במקרה כזה היא מאשרת את הדף ואינה סותרת את העמוד.
      const sameDaf = row.tractate === parsed.tractate && String(row.daf) === parsed.daf;
      const same = sameDaf && (parsed.amud === null || (row.amud ?? null) === parsed.amud);
      if (same) { confirmed++; updates.correct.push(row.id); }
      else {
        contradicted++;
        updates.incorrect.push(row.id);
        if (examples.contradicted.length < 8) {
          examples.contradicted.push(`"${raw}" → אצלנו ${row.tractate} ${row.daf}${row.amud ?? ''} | ספריא ${canonical}`);
        }
      }
    }
  });

  if ((i / BATCH) % 5 === 0 || i + BATCH >= uniques.length) {
    console.log(`  ${Math.min(i + BATCH, uniques.length)}/${uniques.length} | אושרו ${confirmed} | נסתרו ${contradicted} | לא זוהו ${unresolved}`);
  }
  await sleep(DELAY);
}

if (examples.contradicted.length) {
  console.log('\nדוגמאות לסתירות:');
  examples.contradicted.forEach((e) => console.log('  ' + e));
}
if (examples.unresolved.length) console.log('לא זוהו: ' + examples.unresolved.join(' | '));

console.log(`\nסיכום: אושרו ${confirmed} | נסתרו ${contradicted} | לא זוהו ${unresolved} | אצוות שנכשלו ${failedBatches}`);
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }

for (const [status, ids] of [['correct', updates.correct], ['incorrect', updates.incorrect]]) {
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await sb.from('talmud_references')
      .update({ validation_status: status, source: 'sefaria-verified' })
      .in('id', chunk);
    if (error) { console.error('❌', error.message); break; }
  }
}
console.log(`✅ עודכנו ${updates.correct.length + updates.incorrect.length} מראי מקומות`);
