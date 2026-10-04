#!/usr/bin/env node
/**
 * תיקון שנים מדומות באתר פסקים
 * ──────────────────────────────────────────────────────────
 * הייבוא כתב `year: j.year ?? new Date().getFullYear()` — כלומר כשלאתר
 * אין תאריך, נרשמה **שנת הייבוא**. התוצאה: 2,084 פסקים נושאים 2025 או
 * 2026 בלי קשר למציאות.
 *
 * שתי פגיעות:
 *   • המשתמש רואה שנה שקרית.
 *   • זיהוי הכפילויות דחה 222 קבוצות על "סתירת שנים" שכלל לא הייתה —
 *     אותו פסק יובא פעמיים בשנתיים שונות וקיבל שתי שנים שונות.
 *
 * התיקון: שנה אמיתית מן הקאש אם יש, ואם אין — NULL. **שדה ריק עדיף על
 * שדה שקרי**, כי ריק אפשר להשלים ושקר אי אפשר לזהות.
 *
 * שימוש:
 *   node scripts/fix-fake-years.mjs --dry-run
 *   node scripts/fix-fake-years.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', 'data', 'psakim_org');
const DRY = process.argv.includes('--dry-run');

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const titleKey = (t) => String(t ?? '').replace(/[^א-ת0-9]/g, '').slice(0, 45);

// מה הקאש יודע על כל פסק
const byUrl = new Map(), byTitle = new Map();
for (const f of readdirSync(CACHE).filter((x) => x.endsWith('.json'))) {
  let j; try { j = JSON.parse(readFileSync(join(CACHE, f), 'utf8')); } catch { continue; }
  const rec = { date: j.date ?? null, year: Number.isFinite(j.year) ? j.year : null };
  if (j.url) byUrl.set(j.url, rec);
  if (j.title) byTitle.set(titleKey(j.title), rec);
}
console.log(`בקאש: ${byUrl.size} לפי url, ${byTitle.size} לפי כותרת`);

// השורות החשודות: שנת הייבוא בלבד
const THIS_YEAR = new Date().getFullYear();
const SUSPECT = new Set([THIS_YEAR, THIS_YEAR - 1]);
const db = new DatabaseSync(join(ROOT, 'data', 'gemaraca-cloud.db'));
const rows = db.prepare(`SELECT id, title, source_url, year FROM psakei_din
  WHERE source_key = 'psakim.org' AND year IS NOT NULL`).all()
  .filter((r) => SUSPECT.has(r.year));
console.log(`פסקי אתר פסקים עם שנת ייבוא: ${rows.length}`);

const toReal = [], toNull = [], keep = [];
for (const r of rows) {
  const rec = (r.source_url && byUrl.get(r.source_url)) ?? byTitle.get(titleKey(r.title));
  if (!rec) { keep.push(r); continue; }           // אין מידע — לא נוגעים
  if (rec.year && rec.year !== r.year) toReal.push({ ...r, real: rec.year, date: rec.date });
  else if (!rec.year) toNull.push(r);             // האתר באמת לא פרסם תאריך
  else keep.push(r);                              // השנה נכונה במקרה
}
console.log(`  ← שנה אמיתית מן הקאש: ${toReal.length}`);
console.log(`  ← לרוקן (האתר לא פרסם תאריך): ${toNull.length}`);
console.log(`  ללא שינוי: ${keep.length}`);
toReal.slice(0, 5).forEach((r) => console.log(`     · ${String(r.title).slice(0, 44)}  ${r.year} → ${r.real}`));

if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }

let fixed = 0;
for (const r of toReal) {
  const patch = { year: r.real };
  const { error } = await sb.from('psakei_din').update(patch).eq('id', r.id);
  if (!error) fixed++;
  if (fixed % 100 === 0) process.stdout.write(`\r  ${fixed}/${toReal.length}   `);
}
let nulled = 0;
let nullFail = 0;
for (let i = 0; i < toNull.length; i += 100) {
  const { error } = await sb.from('psakei_din').update({ year: null })
    .in('id', toNull.slice(i, i + 100).map((r) => r.id));
  // הגרסה הקודמת בלעה את השגיאה ודיווחה "0 רוקנו" כאילו אין מה לרוקן
  if (error) { nullFail++; if (nullFail <= 2) console.error(`❌ ריקון @${i}: ${error.message}`); continue; }
  nulled += Math.min(100, toNull.length - i);
}
console.log(`\n✅ ${fixed} קיבלו שנה אמיתית | ${nulled} רוקנו`);
