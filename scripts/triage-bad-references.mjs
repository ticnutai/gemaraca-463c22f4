#!/usr/bin/env node
/**
 * מיון מראי המקומות שסומנו כשגויים
 * ──────────────────────────────────────────────────────────
 * שלוש סיבות שונות מסתתרות מאחורי validation_status='incorrect', ולכל אחת
 * טיפול אחר:
 *
 *   out-of-range   הדף אינו קיים במסכת (תמורה קט״ו, ובמסכת 34 דפים) → מחיקה
 *   word-gematria  ה"דף" הוא מילה רגילה שהומרה בסכימת אותיות ("קידושין בטלים."
 *                  → צ״א). הקוד המתוקן כבר אינו מייצר כאלה → מחיקה
 *   raw-junk       ב-raw נשמר שם קובץ או מזהה ולא ציטוט → מחיקה
 *   no-tractate    ה-raw אינו נוקב בשם מסכת ("נב,א"), כך שספריא ניחשה מסכת
 *                  משלה ואין בהכרעתה סתירה להפניה שלנו → חזרה ל-pending
 *   raw-corrupt    ה-raw שנשמר אינו תואם את הדף ("בבא בתרא דף ב" מול פ״ד),
 *                  כך שספריא שפטה מחרוזת משובשת ולא את ההפניה → חזרה ל-pending
 *   clean          הציטוט תקין ואין נגדו הכרעה → לא נוגעים
 *   disputed       ה-raw תקין וספריא בכל זאת קוראת אחרת → נשאר incorrect לתיקון ידני
 *
 * השורות שנמחקות נשמרות לקובץ JSON לפני המחיקה.
 *
 * שימוש: node scripts/triage-bad-references.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const MAX_DAF = Object.fromEntries(
  [...readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8')
    .matchAll(/hebrewName:\s*"([^"]+)"[\s\S]{0,200}?maxDaf:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
);

/** מספר עברי תקני: מאות יורדות, עשרה אחת, יחידה אחת, בלי תו עודף */
function strictHebrew(tok) {
  const s = String(tok).replace(/['"״׳]/g, '');
  if (!s) return null;
  const ones = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9 };
  const tens = { 'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90 };
  const hundreds = { 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
  let total = 0, i = 0, prev = Infinity;
  while (i < s.length && hundreds[s[i]] !== undefined) {
    if (hundreds[s[i]] > prev) return null;
    total += hundreds[s[i]]; prev = hundreds[s[i]]; i++;
    if (total > 900) return null;
  }
  const rest = s.slice(i);
  if (rest === 'טו') return total + 15;
  if (rest === 'טז') return total + 16;
  if (i < s.length && tens[s[i]] !== undefined) { total += tens[s[i]]; i++; }
  if (i < s.length && ones[s[i]] !== undefined) { total += ones[s[i]]; i++; }
  return i === s.length && total > 0 ? total : null;
}

/** סכימת אותיות בלי בדיקת צורה — הדרך שבה נוצרו הדפים המדומים */
function loosePartSum(tok) {
  const G = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
    'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90,
    'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400, 'ך': 20, 'ם': 40, 'ן': 50, 'ף': 80, 'ץ': 90 };
  let total = 0;
  for (const ch of String(tok).replace(/['"״׳]/g, '')) {
    if (G[ch] === undefined) return null;
    total += G[ch];
  }
  return total || null;
}

const words = (raw) => String(raw).split(/[^א-ת'"״׳]+/).filter(Boolean);

const TRACTATE_NAMES = [...readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8')
  .matchAll(/hebrewName:\s*"([^"]+)"/g)].map((m) => m[1]);
const ABBREVIATIONS = ['ב"ק', 'ב״ק', 'ב"מ', 'ב״מ', 'ב"ב', 'ב״ב', 'ר"ה', 'ר״ה', 'ע"ז', 'ע״ז', 'מו"ק', 'מו״ק'];
/** בלי שם מסכת ב-raw, ספריא ניחשה מסכת משלה וההכרעה שלה אינה על ההפניה שלנו */
const namesTractate = (raw) => TRACTATE_NAMES.some((n) => raw.includes(n)) || ABBREVIATIONS.some((a) => raw.includes(a));
/** שם קובץ או מזהה שהגיע בטעות כ-raw: "גירושין_-_939678-1" */
const looksLikeFilename = (raw) => /__|\d{4,}/.test(raw);

// כל מראי המקומות חוץ ממה שספריא אישרה וממה שהגיע מאינדקס רשמי של האתר:
// הזבל שנוצר מסכימת אותיות של מילה רגילה יושב גם בשורות שטרם נבדקו.
const all = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('talmud_references')
    .select('id,psak_din_id,tractate,daf,amud,raw_reference,normalized,source,validation_status,validated_by')
    .range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  all.push(...data);
  if (data.length < 1000) break;
}
const rows = all.filter((r) => r.validation_status !== 'correct' && r.source !== 'site-index');
console.log(`מראי מקומות: ${all.length} | לבדיקה (לא אושרו בספריא, לא אינדקס): ${rows.length}`);

const cls = { 'out-of-range': [], 'word-gematria': [], 'raw-junk': [], 'no-tractate': [], 'raw-corrupt': [], disputed: [], clean: [] };
for (const r of rows) {
  const daf = Number(r.daf);
  const max = MAX_DAF[r.tractate];
  if (!max || !Number.isFinite(daf) || daf < 2 || daf > max) { cls['out-of-range'].push(r); continue; }

  const raw = String(r.raw_reference);
  if (looksLikeFilename(raw)) { cls['raw-junk'].push(r); continue; }
  if (!namesTractate(raw)) { cls['no-tractate'].push(r); continue; }

  const toks = words(r.raw_reference);
  const strictHit = toks.some((t) => strictHebrew(t) === daf) || /\d/.test(String(r.raw_reference))
    && [...String(r.raw_reference).matchAll(/\d+/g)].some((m) => Number(m[0]) === daf);
  // ציטוט שנראה תקין: אם ספריא בכל זאת קראה אחרת — מחלוקת לתיקון ידני
  if (strictHit) { (r.validation_status === 'incorrect' ? cls.disputed : cls.clean).push(r); continue; }

  // הדף נובע מסכימת אותיות של מילה שאינה מספר תקני
  const junk = toks.some((t) => strictHebrew(t) === null && loosePartSum(t) === daf);
  if (junk) { cls['word-gematria'].push(r); continue; }

  cls['raw-corrupt'].push(r);
}

for (const [k, v] of Object.entries(cls)) {
  console.log(`  ${k}: ${v.length}`);
  v.slice(0, 4).forEach((r) => console.log(`      "${r.raw_reference}" → ${r.tractate} ${r.daf}${r.amud ?? ''} (${r.source})`));
}

const toDelete = [...cls['out-of-range'], ...cls['word-gematria'], ...cls['raw-junk']];
// החזרה ל-pending נוגעת רק למה שסומן כשגוי על בסיס הכרעה שאינה תקפה
const toPending = [...cls['raw-corrupt'], ...cls['no-tractate']].filter((r) => r.validation_status === 'incorrect');
console.log(`\nלמחיקה: ${toDelete.length} | חזרה ל-pending: ${toPending.length} | נשארים לתיקון ידני: ${cls.disputed.length}`);
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }

if (toDelete.length) {
  mkdirSync(join(ROOT, 'scripts/data'), { recursive: true });
  const file = join(ROOT, `scripts/data/deleted-references-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(file, JSON.stringify(toDelete, null, 2), 'utf8');
  console.log(`📦 נשמר לפני מחיקה: ${file}`);
  for (let i = 0; i < toDelete.length; i += 200) {
    const ids = toDelete.slice(i, i + 200).map((r) => r.id);
    const { error } = await sb.from('talmud_references').delete().in('id', ids);
    if (error) { console.error('❌', error.message); process.exit(1); }
  }
  console.log(`🗑️  נמחקו ${toDelete.length}`);
}

for (let i = 0; i < toPending.length; i += 200) {
  const ids = toPending.slice(i, i + 200).map((r) => r.id);
  const { error } = await sb.from('talmud_references')
    .update({ validation_status: 'pending', validated_by: null, validated_at: null })
    .in('id', ids);
  if (error) { console.error('❌', error.message); process.exit(1); }
}
console.log(`↩️  הוחזרו ל-pending: ${toPending.length}`);
