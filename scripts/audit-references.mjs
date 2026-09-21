#!/usr/bin/env node
/**
 * ביקורת מראי המקומות מול טקסט הפסק עצמו
 * ──────────────────────────────────────────────────────────
 * הבדיקה כאן אינה מסתמכת על שום שירות חיצוני: לכל מראה מקום נבדק שהציטוט
 * שנשמר (`raw_reference`) באמת נמצא בטקסט הפסק, ושהמספר והעמוד שבתוכו תואמים
 * את מה שנרשם בשדות. ככה מתגלה מה שאימות חיצוני עלול לפספס — ציטוט שהומצא,
 * מספר שנקטע, או עמוד שהתהפך.
 *
 * מחלקות הממצאים:
 *   missing-in-text   ה-raw אינו מופיע בטקסט הפסק
 *   daf-mismatch      המספר שבציטוט אינו הדף שנשמר
 *   amud-mismatch     סימון העמוד שבציטוט אינו העמוד שנשמר
 *   non-bavli         לפני הציטוט כתוב "ירושלמי", או שהוא פרק־והלכה
 *   out-of-range      הדף אינו קיים במסכת
 *   ok                הציטוט נמצא ותואם
 *
 * מה ש---fix מוחק: out-of-range, non-bavli, not-in-psak ו-daf-mismatch — ארבע
 * מחלקות שהטקסט עצמו מפריך. `reworded` נשאר: הציטוט נוסח אחרת אך המסכת בפסק,
 * ולרוב הוא הגיע מפסק כפול שאוחד.
 *
 * שימוש (מומלץ להתחיל בקטן ולבדוק ידנית):
 *   node scripts/audit-references.mjs --limit 10 --verbose
 *   node scripts/audit-references.mjs --limit 100
 *   node scripts/audit-references.mjs --csv audit.csv
 *   node scripts/audit-references.mjs --limit 100 --fix
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const str = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const LIMIT = num('--limit', Infinity);      // כמה פסקים לבדוק
const SAMPLE = num('--sample', 1);           // חלק מהפסקים, 0..1
const CSV = str('--csv');
const VERBOSE = args.includes('--verbose');   // מדפיס כל הפניה עם ההקשר שלה, לבדיקה ידנית
const FIX = args.includes('--fix');           // מוחק את מה שהביקורת הוכיחה כשגוי

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

const GEMATRIA = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
/** מספר עברי בצורה תקנית, כמו בקוד הייצור */
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

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** גרש וגרשיים מופיעים בכמה תווים שונים; להשוואה מול הטקסט מאחדים אותם */
const normQuotes = (s) => flat(s).replace(/[״“”"]/g, '"').replace(/[׳‘’']/g, "'");
const strip = (s) => String(s || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const precededByYerushalmi = (before) => {
  const marks = [...before.matchAll(/ירושלמי|ירוש['׳]|תוספתא|תוספת['׳]|בבלי|גמרא|גמ['׳]/g)];
  return marks.length ? /ירוש|תוספת/.test(marks[marks.length - 1][0]) : false;
};
/** ציטוט שיש בו "דף" או ציון עמוד הוא בבלי, גם אם הוזכר ירושלמי לפניו */
const citesDaf = (raw) => /דף|עמוד|ע['׳"״][אב]/.test(raw);
const isPerekHalacha = (raw) => /פ['׳"״]([א-ת]{1,2})['׳"״]?\s*[,;]?\s*([המ])['׳"״]([א-ת]{1,2})/.test(raw);

const TRACTATE_NAMES = [...readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8')
  .matchAll(/hebrewName:\s*"([^"]+)"/g)].map((m) => m[1]).sort((a, b) => b.length - a.length);
const ABBREVIATIONS = ['בב"ק', 'בב"מ', 'בב"ב', 'מו"ק', 'ב"ק', 'ב"מ', 'ב"ב', 'ר"ה', 'ע"ז'];
/** ראשי התיבות של כל מסכת, כדי לדעת אם היא מוזכרת בפסק בכלל */
const ABBREV_OF = {
  'בבא קמא': ['ב"ק', 'בב"ק'], 'בבא מציעא': ['ב"מ', 'בב"מ'], 'בבא בתרא': ['ב"ב', 'בב"ב'],
  'ראש השנה': ['ר"ה'], 'עבודה זרה': ['ע"ז'], 'מועד קטן': ['מו"ק'],
};

/**
 * הדף והעמוד שכתובים בציטוט עצמו.
 * שם המסכת ומילות הסימון מוסרים תחילה, אחרת האותיות שלהם נספרות כמספרים
 * ("סנהדרין נו, א" היה מחזיר גם 60, 50, 5, 4, 200, 10 — האותיות של "סנהדרין").
 */
function readCitation(raw) {
  let s = normQuotes(raw);
  // שם המסכת מוסר רק מתחילת הציטוט. הסרה בכל מקום מוחקת גם מספרים שנראים
  // כראשי תיבות: ע״ז הוא גם הדף 77, ואז "כתובות (דף ע״ז ע״א" נשאר בלי מספר.
  for (const n of [...TRACTATE_NAMES, ...ABBREVIATIONS.map(normQuotes)]) {
    const at = s.indexOf(n);
    if (at >= 0 && at <= 2) { s = s.slice(0, at) + ' ' + s.slice(at + n.length); break; }
  }
  // סימון העמוד: הסימן האחרון קובע, כי ב"דף ע״ב ע״א" הראשון הוא המספר (72)
  // והשני הוא העמוד. הגרשיים נדרשים, אחרת "דף עב" היה נקרא כעמוד ב.
  const amudMarks = [...s.matchAll(/ע"\s*([אב])(?![א-ת])|עמוד\s*([אב])(?![א-ת])|עמ'\s*([אב])(?![א-ת])|צד\s*([אב])(?![א-ת])|,\s*([אב])(?![א-ת])|([.:])\s*$/g)];
  let amud = null;
  if (amudMarks.length) {
    const last = amudMarks[amudMarks.length - 1];
    const mark = last.slice(1).find(Boolean);
    amud = mark === 'א' || mark === '.' ? 'a' : mark === 'ב' || mark === ':' ? 'b' : null;
  }
  // מסירים את מילות הסימון. "צד" מוסר רק כשהוא סימן עמוד ("צד א"), כי צ״ד
  // הוא גם דף 94 — בלי הסייג הזה כל ציטוט לדף צד נפסל.
  s = s.replace(/מסכת|מס'|דף|עמוד|עמ'|צד\s+[אב](?![א-ת])|ע"[אב]|מדפי|הרי"ף|ד"ה|בבלי/g, ' ')
       .replace(/[,;:().\[\]]/g, ' ');
  // ע״א/ע״ב יכולים להיות גם המספר עצמו (71 / 72) ולא רק סימון עמוד:
  // "קידושין (ע״א א)" הוא דף ע״א עמוד א
  const amudAsNumber = [...normQuotes(raw).matchAll(/ע"([אב])/g)].map((m) => (m[1] === 'א' ? 71 : 72));
  const digits = [...s.matchAll(/\d+/g)].map((m) => Number(m[0]));
  const letters = [...s.matchAll(/[א-ת]+(?:"[א-ת]+)?'?/g)]
    .map((m) => strictHebrew(m[0])).filter((n) => n !== null);
  return { numbers: [...digits, ...letters, ...amudAsNumber], amud };
}

const psakim = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('psakei_din').select('id').range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  psakim.push(...data.map((p) => p.id));
  if (data.length < 1000) break;
}

const refsByPsak = new Map();
let totalRefs = 0;
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('talmud_references')
    .select('id,psak_din_id,tractate,daf,amud,raw_reference,normalized,source,validation_status,validated_by')
    .range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  for (const r of data) {
    if (!refsByPsak.has(r.psak_din_id)) refsByPsak.set(r.psak_din_id, []);
    refsByPsak.get(r.psak_din_id).push(r);
    totalRefs++;
  }
  if (data.length < 1000) break;
}

let targets = psakim.filter((id) => refsByPsak.has(id));
if (SAMPLE < 1) targets = targets.filter(() => Math.random() < SAMPLE);
targets = targets.slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`פסקים עם מראי מקומות: ${refsByPsak.size} | סה"כ הפניות: ${totalRefs} | נבדקים: ${targets.length} פסקים`);

const counts = { ok: 0, 'reworded': 0, 'not-in-psak': 0, 'daf-mismatch': 0, 'amud-mismatch': 0, 'non-bavli': 0, 'out-of-range': 0, 'date-not-daf': 0, 'abbrev-in-word': 0 };
const findings = [];
const bySource = {};
let checked = 0;

let next = 0;
async function worker() {
  while (next < targets.length) {
    const id = targets[next++];
    const { data, error } = await sb.from('psakei_din').select('original_text,full_text').eq('id', id).single();
    if (error) continue;
    const text = strip(data?.original_text || data?.full_text || '');
    if (!text) continue;
    const ntext = normQuotes(text);

    for (const r of refsByPsak.get(id)) {
      checked++;
      const key = (k) => {
        counts[k]++;
        bySource[r.source] = bySource[r.source] || {};
        bySource[r.source][k] = (bySource[r.source][k] || 0) + 1;
      };
      const raw = flat(r.raw_reference);
      const daf = Number(r.daf);
      const max = MAX_DAF[r.tractate];

      if (!max || daf < 2 || daf > max) {
        key('out-of-range');
        findings.push({ ...r, why: 'out-of-range', raw });
        continue;
      }
      // האינדקס הרשמי אינו ציטוט מתוך הטקסט אלא נתיב, ולכן אינו נבדק מולו
      if (r.source === 'site-index') { key('ok'); continue; }

      const at = ntext.indexOf(normQuotes(raw));
      if (raw.length < 4 || at < 0) {
        // אם גם שם המסכת אינו מופיע בפסק, אין לציטוט שום עוגן בטקסט
        const abbr = ABBREV_OF[r.tractate];
        const named = ntext.includes(r.tractate) || (abbr && abbr.some((a) => ntext.includes(normQuotes(a))));
        const why = named ? 'reworded' : 'not-in-psak';
        key(why);
        if (VERBOSE) console.log(`  ✗ ${r.tractate} ${r.daf}${r.amud ?? ''} (${r.source}) ← "${raw}" — ${why === 'reworded' ? 'שם המסכת בפסק, הציטוט נוסח אחרת' : 'שם המסכת אינו מופיע בפסק כלל'}`);
        if (findings.length < 8000) findings.push({ ...r, why, raw });
        continue;
      }
      // "תשע״ז (10.5.17)" — תאריך עברי שסופו ע״ז, ומספר שהוא חלק מתאריך לועזי
      const after = ntext.slice(at + raw.length, at + raw.length + 2);
      if (/^\d/.test(after) || /\(\s*\d+\s*\.$/.test(raw)) {
        key('date-not-daf');
        findings.push({ ...r, why: 'date-not-daf', raw });
        continue;
      }
      // ראשי תיבות שנבלעו בתוך מילה ארוכה יותר
      if (/^[א-ת]["'][א-ת]/.test(raw) && /[א-ת]/.test(ntext[at - 1] || '') && /[א-ת]/.test(ntext[at - 2] || '')) {
        key('abbrev-in-word');
        findings.push({ ...r, why: 'abbrev-in-word', raw, before: ntext.slice(Math.max(0, at - 25), at) });
        continue;
      }

      const before = ntext.slice(Math.max(0, at - 40), at);
      if (isPerekHalacha(raw) || (!citesDaf(raw) && precededByYerushalmi(before))) {
        key('non-bavli');
        findings.push({ ...r, why: 'non-bavli', raw, before });
        continue;
      }
      // ציטוט לפי עימוד הרי״ף כבר הומר לדף הבבלי, ולכן המספר שבציטוט אינו
      // אמור להתאים למה ששמור — ההמרה עצמה היא המקור
      if (r.validated_by === 'rif-pagination') { key('ok'); continue; }

      const cited = readCitation(raw);
      if (cited.numbers.length && !cited.numbers.includes(daf)) {
        key('daf-mismatch');
        findings.push({ ...r, why: 'daf-mismatch', raw, cited: cited.numbers.join('/') });
        continue;
      }
      if (cited.amud && r.amud && cited.amud !== r.amud) {
        key('amud-mismatch');
        findings.push({ ...r, why: 'amud-mismatch', raw, cited: cited.amud });
        continue;
      }
      key('ok');
      if (VERBOSE) console.log(`  ✓ ${r.tractate} ${r.daf}${r.amud ?? ''} (${r.source}) ← "${raw}"
      ...${ntext.slice(Math.max(0, at - 60), at + raw.length + 40)}...`);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

console.log(`\nנבדקו ${checked} מראי מקומות`);
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k}: ${v}  (${((v / Math.max(checked, 1)) * 100).toFixed(1)}%)`);
}
console.log('\nלפי מקור החילוץ:');
for (const [src, c] of Object.entries(bySource)) {
  const tot = Object.values(c).reduce((a, b) => a + b, 0);
  console.log(`  ${src}: ${tot} | תקין ${(((c.ok || 0) / tot) * 100).toFixed(1)}% | ${JSON.stringify(c)}`);
}
console.log('\nדוגמאות:');
for (const why of ['date-not-daf', 'abbrev-in-word', 'out-of-range', 'non-bavli', 'daf-mismatch', 'amud-mismatch', 'not-in-psak', 'reworded']) {
  findings.filter((f) => f.why === why).slice(0, 4)
    .forEach((f) => console.log(`  [${why}] ${f.tractate} ${f.daf}${f.amud ?? ''} (${f.source}) ← "${f.raw}"${f.cited ? ` | בציטוט: ${f.cited}` : ''}`));
}

if (FIX) {
  // עמוד שגוי אינו נמחק אלא מתוקן למה שכתוב בציטוט
  const wrongAmud = findings.filter((f) => f.why === 'amud-mismatch' && (f.cited === 'a' || f.cited === 'b'));
  let fixedAmud = 0;
  for (const f of wrongAmud) {
    const normalized = String(f.normalized || '').replace(/[.:]\s*$/, '') + (f.cited === 'a' ? '.' : ':');
    const { error } = await sb.from('talmud_references')
      .update({ amud: f.cited, normalized, validation_status: 'pending', validated_by: null })
      .eq('id', f.id);
    if (!error) fixedAmud++;
  }
  if (fixedAmud) console.log(`🔧 תוקן העמוד ב-${fixedAmud} מראי מקומות, לפי מה שכתוב בציטוט`);

  const bad = findings.filter((f) => ['out-of-range', 'non-bavli', 'not-in-psak', 'daf-mismatch', 'date-not-daf', 'abbrev-in-word'].includes(f.why));
  if (!bad.length) console.log('אין מה למחוק');
  else {
    const file = join(ROOT, `scripts/data/unfounded-references-${new Date().toISOString().slice(0, 10)}.json`);
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    writeFileSync(file, JSON.stringify([...prev, ...bad], null, 2), 'utf8');
    console.log(`📦 נשמר לפני המחיקה: ${file} (${bad.length} שורות)`);
    let done = 0;
    for (let i = 0; i < bad.length; i += 200) {
      const ids = bad.slice(i, i + 200).map((f) => f.id);
      const { error } = await sb.from('talmud_references').delete().in('id', ids);
      if (error) { console.error('❌ מחיקה:', error.message); break; }
      done += ids.length;
    }
    console.log(`🗑️  נמחקו ${done} מראי מקומות שהטקסט מפריך`);
  }
}

if (CSV) {
  const rows = [['id', 'psak_din_id', 'tractate', 'daf', 'amud', 'source', 'validation_status', 'why', 'raw']];
  findings.forEach((f) => rows.push([f.id, f.psak_din_id, f.tractate, f.daf, f.amud ?? '', f.source, f.validation_status, f.why, f.raw.replace(/"/g, "'")]));
  writeFileSync(CSV, '﻿' + rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n'), 'utf8');
  console.log(`\n📄 נשמר: ${CSV}`);
}
