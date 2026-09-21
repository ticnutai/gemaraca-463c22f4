#!/usr/bin/env node
/**
 * ניקוי קישורי הסוגיות שנוצרו ממילים ולא מציטוטים
 * ──────────────────────────────────────────────────────────
 * `pattern_sugya_links` נבנה ב-textAnalyzer, שסכם כל אות עברית שבאה אחרי שם
 * מסכת. כך "סנהדרין במי" הפך לסנהדרין נ״ב, "שבת אבי" לשבת י״ג, ו-"ב״מ סי"
 * לבבא מציעא ע׳ — קישורים שמופיעים בדף הגמרא ואין להם שום קשר אליו.
 *
 * הבדיקה: מה שנשמר ב-`source_text` חייב להכיל מספר בצורה תקנית ששווה לדף.
 * אם המספר מתקבל רק מסכימה עיוורת של אותיות — זו מילה, והשורה נמחקת.
 *
 * הכול נשמר לקובץ JSON לפני המחיקה.
 *
 * שימוש:
 *   node scripts/clean-pattern-links.mjs --dry-run
 *   node scripts/clean-pattern-links.mjs --limit 10      # בדיקה בקטן
 *   node scripts/clean-pattern-links.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();

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

const ones = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9 };
const tens = { 'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90 };
const hundreds = { 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
const GEMATRIA = { ...ones, ...tens, ...hundreds, 'ך': 20, 'ם': 40, 'ן': 50, 'ף': 80, 'ץ': 90 };

/** מספר עברי בצורה תקנית; מילה רגילה מחזירה null */
function strictHebrew(tok) {
  const s = String(tok).replace(/['"״׳]/g, '');
  if (!s) return null;
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
/** הסכימה העיוורת שיצרה את הזבל */
function looseSum(tok) {
  let total = 0;
  for (const ch of String(tok).replace(/['"״׳]/g, '')) {
    if (GEMATRIA[ch] === undefined) return null;
    total += GEMATRIA[ch];
  }
  return total || null;
}
const words = (s) => String(s || '').split(/[^א-ת'"״׳]+/).filter(Boolean);

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('pattern_sugya_links')
    .select('id,psak_din_id,sugya_id,masechet,daf,amud,source_text,confidence').range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
const targets = rows.slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`קישורי סוגיות: ${rows.length} | נבדקים: ${targets.length}`);

const bad = [];
let ok = 0;
for (const r of targets) {
  const daf = Number(r.daf);
  const max = MAX_DAF[r.masechet];
  const st = String(r.source_text || '');
  const digits = [...st.matchAll(/\d+/g)].map((m) => Number(m[0]));
  const toks = words(st);
  const supported = digits.includes(daf) || toks.some((t) => strictHebrew(t) === daf);
  if (supported) { ok++; continue; }
  // מחוץ לטווח, או מספר שנובע רק מסכימת אותיות של מילה
  const why = !max || daf < 2 || daf > max ? 'out-of-range'
    : toks.some((t) => strictHebrew(t) === null && looseSum(t) === daf) ? 'word-gematria'
    : 'unsupported';
  bad.push({ ...r, why });
}
const byWhy = {};
for (const b of bad) byWhy[b.why] = (byWhy[b.why] || 0) + 1;
console.log(`תקין: ${ok} | לניקוי: ${bad.length} ${JSON.stringify(byWhy)}`);
bad.slice(0, 10).forEach((b) => console.log(`   [${b.why}] ${b.masechet} ${b.daf}${b.amud ?? ''} ← "${String(b.source_text).replace(/\s+/g, ' ').slice(0, 55)}"`));
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }
if (!bad.length) process.exit(0);

const file = join(ROOT, `scripts/data/pattern-links-removed-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(file, JSON.stringify(bad, null, 2), 'utf8');
console.log(`📦 נשמר לפני המחיקה: ${file}`);
let done = 0;
for (let i = 0; i < bad.length; i += 200) {
  const ids = bad.slice(i, i + 200).map((b) => b.id);
  const { error } = await sb.from('pattern_sugya_links').delete().in('id', ids);
  if (error) { console.error('❌ מחיקה:', error.message); process.exit(1); }
  done += ids.length;
}
console.log(`🗑️  נמחקו ${done} קישורי סוגיות`);
