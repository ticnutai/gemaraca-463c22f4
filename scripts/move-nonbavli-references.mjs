#!/usr/bin/env node
/**
 * ציטוטים שאינם בבלי, שנשמרו כדפי בבלי
 * ──────────────────────────────────────────────────────────
 * לתלמוד הירושלמי, למשנה ולתוספתא יש אותם שמות מסכתות כמו לבבלי, אבל הם
 * מחולקים לפרקים והלכות ולא לדפים. החילוץ לא הבחין, ולכן
 *
 *     "(ירושלמי ברכות פ״א ה״א)"   →  ברכות ב׳ ע״א
 *     "בירושלמי (סוכה ג,א)"        →  סוכה ג׳ ע״א
 *     "בבבא קמא (פ״י מ״א)"         →  בבא קמא קי״ג.
 *
 * וכך פסק שכל עניינו ירושלמי הופיע תחת דף בבלי שאינו קשור אליו.
 *
 * הסקריפט מזהה את השורות האלה לפי מה שכתוב **לפני** הציטוט (המילה הקרובה
 * ביותר: ירושלמי או גמרא/בבלי), מעביר אותן ל-`psak_sources` עם הפרק וההלכה
 * האמיתיים, ומוחק אותן מ-`talmud_references`. הכול נשמר לקובץ JSON לפני המחיקה.
 *
 * שימוש: node scripts/move-nonbavli-references.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'fs';
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

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** שם היחידה בתוך הפרק: משנה במשנה, הלכה בירושלמי ובתוספתא */
const unitName = (corpus) => (corpus === 'משנה' ? 'משנה' : 'הלכה');

/** המילה הקרובה ביותר לפני הציטוט קובעת: ירושלמי או בבלי */
/** איזה קורפוס הוזכר סמוך לציטוט: ירושלמי, תוספתא, או כלום */
function corpusBefore(before, raw) {
  const marks = [...`${before}`.matchAll(/ירושלמי|ירוש['׳]|תוספתא|תוספת['׳]|בבלי|גמרא|גמ['׳]/g)];
  const last = marks.length ? marks[marks.length - 1][0] : '';
  if (/תוספת/.test(last) || /תוספתא/.test(raw)) return 'תוספתא';
  if (/ירוש/.test(last) || /ירושלמי/.test(raw)) return 'ירושלמי';
  return null;
}

function precededByYerushalmi(before) {
  const marks = [...before.matchAll(/ירושלמי|ירוש['׳]|תוספתא|תוספת['׳]|בבלי|גמרא|גמ['׳]/g)];
  if (!marks.length) return false;
  return /ירוש|תוספת/.test(marks[marks.length - 1][0]);
}

// "פ״י מ״א" / "פ״ה ה״ו" — הגרשיים חובה, אחרת "מדפי הרי״ף" נקרא כפרק והלכה
const perekHalacha = /פ['׳"״]([א-ת]{1,2})['׳"״]?\s*[,;]?\s*([המ])['׳"״]([א-ת]{1,2})/;
/** "פרק ט הלכה יא", "פרק ב משנה ה" — הצורה המילולית, נפוצה בתוספתא ובמשנה */
const perekHalachaWords = /פרק\s+([א-ת'׳"״]{1,5})\s*[,;]?\s*(משנה|הלכה)\s+([א-ת'׳"״]{1,5})/;
/** ציטוט שיש בו "דף" או ציון עמוד הוא ציטוט בבלי, גם אם הוזכר ירושלמי לפניו */
const looksLikeDaf = (raw) => /דף|עמוד|ע['׳"״][אב]/.test(raw);
const GEMATRIA = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
/** מספר של אות אחת או שתיים: "י" → 10, "י״א" → 11 */
const heNum = (tok) => {
  let total = 0;
  for (const ch of String(tok).replace(/['׳"״]/g, '')) {
    if (GEMATRIA[ch] === undefined) return null;
    total += GEMATRIA[ch];
  }
  return total || null;
};

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('talmud_references')
    .select('id,psak_din_id,tractate,daf,amud,raw_reference,normalized,context_snippet,source,validation_status')
    .range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
console.log(`מראי מקומות: ${rows.length}`);

const found = [];
for (const r of rows) {
  const raw = flat(r.raw_reference);
  const ctx = flat(r.context_snippet);
  const at = ctx.indexOf(raw.slice(0, 12));
  // חלון צר: "ירושלמי" צמוד לציטוט, לא במשפט שלפניו
  const before = at > 0 ? ctx.slice(Math.max(0, at - 20), at) : '';

  const phWords = raw.match(perekHalachaWords);
  const ph = raw.match(perekHalacha) || (phWords ? [phWords[0], phWords[1], phWords[2] === 'משנה' ? 'מ' : 'ה', phWords[3]] : null);
  const isMishna = ph && ph[2] === 'מ';
  const named = corpusBefore(before, raw);
  const yeru = Boolean(named) && !looksLikeDaf(raw);
  if (!yeru && !ph) continue;

  // פרק והלכה: קודם ממה שכתוב בציטוט, ואם אין — מהמספרים שנשמרו
  const perek = ph ? heNum(ph[1]) : Number(r.daf);
  const halacha = ph ? heNum(ph[3]) : (r.amud === 'b' ? 2 : 1);
  // במסכת ירושלמי או משנה אין יותר מכ-16 פרקים. מספר גדול מזה אינו פרק, ולכן
  // ההמרה אינה בטוחה — ואז לא נוגעים בשורה.
  if (!perek || perek > 20) continue;
  found.push({
    row: r,
    corpus: named ?? (isMishna ? 'משנה' : 'ירושלמי'),
    perek,
    halacha,
    fromCitation: Boolean(ph),
    before,
  });
}

const byCorpus = {};
for (const f of found) byCorpus[f.corpus] = (byCorpus[f.corpus] || 0) + 1;
console.log(`ציטוטים שאינם בבלי: ${found.length} ${JSON.stringify(byCorpus)}`);
found.slice(0, 10).forEach((f) => console.log(
  `   ${f.row.tractate} ${f.row.daf}${f.row.amud ?? ''} (${f.row.source}) ← "${flat(f.row.raw_reference)}"  ⇒  ${f.corpus} ${f.row.tractate} פרק ${f.perek} ${unitName(f.corpus)} ${f.halacha}`,
));
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }
if (!found.length) process.exit(0);

const file = join(ROOT, `scripts/data/nonbavli-references-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(file, JSON.stringify(found, null, 2), 'utf8');
console.log(`📦 נשמר לפני המחיקה: ${file}`);

const label = (f) => `${f.corpus}, ${f.row.tractate}, פרק ${f.perek}, ${unitName(f.corpus)} ${f.halacha}`;
const inserts = found.filter((f) => f.perek).map((f) => ({
  psak_din_id: f.row.psak_din_id,
  corpus: f.corpus,
  book: f.row.tractate,
  section: `פרק ${f.perek}`,
  subsection: `${unitName(f.corpus)} ${f.halacha}`,
  display: label(f),
  raw_path: `${f.corpus} ← ${f.row.tractate} ← פרק ${f.perek} ← ${unitName(f.corpus)} ${f.halacha}`,
  source: f.row.source,
  confidence: f.fromCitation ? 'medium' : 'low',
  validation_status: 'pending',
}));

let added = 0;
for (let i = 0; i < inserts.length; i += 100) {
  const chunk = inserts.slice(i, i + 100);
  const { error } = await sb.from('psak_sources').upsert(chunk, { onConflict: 'psak_din_id,display', ignoreDuplicates: true });
  if (error) { console.error('❌ הוספה ל-psak_sources:', error.message); break; }
  added += chunk.length;
}
console.log(`↪️  הועברו ל-psak_sources: ${added}`);

for (let i = 0; i < found.length; i += 200) {
  const ids = found.slice(i, i + 200).map((f) => f.row.id);
  const { error } = await sb.from('talmud_references').delete().in('id', ids);
  if (error) { console.error('❌ מחיקה:', error.message); process.exit(1); }
}
console.log(`🗑️  נמחקו מ-talmud_references: ${found.length}`);
