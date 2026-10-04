#!/usr/bin/env node
/**
 * סימון הפניות שאינן לדף גמרא אלא לפוסק
 * ──────────────────────────────────────────────────────────
 * האימות המקומי מול מאגר הש"ס תפס שלוש הפניות לעמוד שאינו קיים, ושתיים מהן
 * חשפו מחלקה שלמה: שם המסכת מופיע בציטוט, אבל המספר שאחריו אינו דף.
 *
 *   "שו״ע אה״ע לח, כד"   → שולחן ערוך אבן העזר סימן לח סעיף כד
 *   "ביש״ש ב״ק י,מט"     → ים של שלמה, פרק י סימן מט
 *   "חזו״א ב״ק סי׳ י״ג"  → חזון איש, סימן יג
 *   "ב״מ ב,ו"            → בבא מציעא פרק ב משנה ו
 *
 * שני סימני היכר: קיצור של ספר פוסק בציטוט, או צמד "מספר,מספר" שהשני בו
 * גדול משתיים — עמוד יכול להיות רק א או ב.
 *
 * **אינן נמחקות.** הן מסומנות `validation_status='needs-review'` ומדווחות
 * לקובץ. מחיקה אוטומטית על סמך תבנית היא בדיוק מה שכמעט מחק אצלנו 672 שורות
 * תקינות, ובין ה-86 יש גם תקינות: "הר״ן בפ״ב דגיטין (ח,א" מפנה באמת לגיטין
 * ח ע״א, ו"דף ג' מדפי הרי״ף" כבר הומר נכון.
 *
 * שימוש:
 *   node scripts/flag-posek-refs.mjs --dry-run
 *   node scripts/flag-posek-refs.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const db = new DatabaseSync(join(ROOT, 'data', 'gemaraca-cloud.db'));
const rows = db.prepare('SELECT id, tractate, daf, amud, raw_reference, source FROM talmud_references WHERE raw_reference IS NOT NULL').all();

const POSKIM = ['חזו"א','חזו״א','יש"ש','יש״ש','קה"י','קה״י','נה"מ','נה״מ','קצה"ח','קצה״ח',
  'פנ"י','פנ״י','מהרש"א','מהרש״א','מהר"ם','מהר״ם','שו"ע','שו״ע','אה"ע','אה״ע','חו"מ','חו״מ'];
/** הרי״ף והר״ן מופיעים גם בהפניות תקינות, ולכן הם אינם ברשימה שלמעלה */
const G = { א:1,ב:2,ג:3,ד:4,ה:5,ו:6,ז:7,ח:8,ט:9,י:10,כ:20,ל:30,מ:40,נ:50,ס:60,ע:70,פ:80,צ:90,ק:100 };

const flag = [];
for (const r of rows) {
  const raw = String(r.raw_reference);
  let why = null;
  if (POSKIM.some((p) => raw.includes(p))) why = 'קיצור ספר פוסק';
  else {
    const m = raw.match(/[,.]\s*([א-ת]{1,3})\s*$/);
    if (m) {
      const v = [...m[1]].reduce((s, c) => s + (G[c] ?? 0), 0);
      if (v > 2) why = `המספר השני (${m[1]}=${v}) אינו עמוד`;
    }
  }
  if (why) flag.push({ ...r, why });
}

console.log(`הפניות לסימון: ${flag.length}`);
const by = {}; for (const f of flag) by[f.source] = (by[f.source] || 0) + 1;
console.log(`  לפי מקור: ${JSON.stringify(by)}`);
flag.slice(0, 8).forEach((f) => console.log(`   · ${f.tractate} ${f.daf}${f.amud ?? ''} ← ${JSON.stringify(String(f.raw_reference).slice(0, 40))}  [${f.why}]`));

const out = join(ROOT, 'scripts', 'data', `posek-refs-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(out, JSON.stringify(flag, null, 2), 'utf8');
console.log(`נשמר לעיון: ${out}`);

if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }

let done = 0;
for (let i = 0; i < flag.length; i += 100) {
  const { error } = await sb.from('talmud_references')
    .update({ validation_status: 'pending' })   // העמודה מוגבלת ל-pending/correct/incorrect/ignored
    .in('id', flag.slice(i, i + 100).map((f) => f.id));
  if (error) { console.error(`❌ @${i}: ${error.message}`); continue; }
  done += Math.min(100, flag.length - i);
}
console.log(`✅ ${done} סומנו כ-pending לבדיקה ידנית (לא נמחקו)`);

// התיקון הוודאי היחיד: ברכות מסתיימת בדף סד ע"א, ואין לה סד ע"ב
const { data: fixed, error: fixErr } = await sb.from('talmud_references')
  .update({ amud: 'a', normalized: 'ברכות ס״ד.', validation_status: 'correct' })
  .eq('tractate', 'ברכות').eq('daf', '64').eq('amud', 'b').select('id');
if (fixErr) console.error('❌ ברכות סד:', fixErr.message);
else if (fixed?.length) console.log(`✅ ברכות סד ע״ב → ע״א (${fixed.length} שורות) — המסכת נגמרת בסד ע״א`);
