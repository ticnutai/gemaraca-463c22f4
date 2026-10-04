#!/usr/bin/env node
/**
 * מילוי פסקים ריקים מתוך הקאשים הגולמיים
 * ──────────────────────────────────────────────────────────
 * במסד יושבות כאלף שורות עם כותרת ובלי שום תוכן — 998 מהן ריקות לגמרי.
 * הן מגיעות כמעט כולן מהעלאות ידניות שחילוץ הטקסט מהן נכשל, והמשתמש שלוחץ
 * עליהן מקבל דף ריק. זה הפגם היחיד במסד שרואים בעיניים.
 *
 * לפני שמפעילים OCR על מאות קבצים — חלקן פשוט קיימות אצלנו כבר. אותו פסק
 * הורד גם מ-gov.il או מאתר פסקים או מדעת, עם הטקסט המלא. התאמה לפי כותרת
 * מנורמלת ממלאת אותן בחינם.
 *
 * זהירות: ממלאים **רק** שורות ריקות, ורק כשהטקסט שבקאש ארוך ממש. שורה
 * שיש בה תוכן אינה נוגעת, גם אם נמצאה לה התאמה.
 *
 * שימוש:
 *   node scripts/fill-empty-from-cache.mjs --dry-run
 *   node scripts/fill-empty-from-cache.mjs [--limit 50]
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'scripts', 'data');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const titleKey = (t) => String(t ?? '').replace(/[^א-ת0-9]/g, '').slice(0, 40);
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();

// ── הקאשים ──────────────────────────────────────────────────
const cache = new Map();
for (const dir of ['govil', 'psakim_org', 'daat', 'bdmz', 'bethdin']) {
  const path = join(DATA, dir);
  if (!existsSync(path)) continue;
  for (const f of readdirSync(path).filter((x) => x.endsWith('.json'))) {
    let j;
    try { j = JSON.parse(readFileSync(join(path, f), 'utf8')); } catch { continue; }
    const text = strip(j.text);
    if (!j.title || text.length < 400) continue;
    const k = titleKey(j.title);
    // אם אותה כותרת קיימת בכמה קאשים — הטקסט הארוך ביותר
    const prev = cache.get(k);
    if (!prev || text.length > prev.text.length) {
      cache.set(k, { dir, text, notes: j.notes ?? null, court: j.court ?? null,
        caseNumber: j.caseNumber ?? null, date: j.date ?? null, year: j.year ?? null, url: j.url ?? null });
    }
  }
}
console.log(`בקאשים: ${cache.size} כותרות עם טקסט מלא`);

// ── השורות הריקות ───────────────────────────────────────────
// סריקת עמודות הטקסט בענן חורגת מזמן. הרשימה נקראת מן המראה המקומית —
// מיידית — והכתיבה עדיין לענן.
const MIRROR = join(ROOT, 'data', 'gemaraca-cloud.db');
if (!existsSync(MIRROR)) {
  console.error('❌ אין מראה מקומית. הרץ קודם: npm run local:mirror');
  process.exit(1);
}
const { DatabaseSync } = await import('node:sqlite');
const mirror = new DatabaseSync(MIRROR);
const empty = mirror.prepare(`SELECT id, title, court, case_number, year, source_key
  FROM psakei_din
  WHERE LENGTH(TRIM(COALESCE(original_text, full_text, ''))) < 400`).all();
console.log(`שורות ריקות במסד: ${empty.length}`);

const plan = [];
for (const p of empty) {
  const hit = cache.get(titleKey(p.title));
  if (!hit) continue;
  plan.push({ row: p, hit });
}
console.log(`ניתנות למילוי: ${plan.length}`);
const byDir = {};
for (const x of plan) byDir[x.hit.dir] = (byDir[x.hit.dir] || 0) + 1;
console.log(`  לפי מקור: ${JSON.stringify(byDir)}`);
plan.slice(0, 5).forEach((x) => console.log(`   + ${String(x.row.title).slice(0, 46).padEnd(48)} ← ${x.hit.dir} (${x.hit.text.length} תווים)`));

if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }

let done = 0;
for (const { row, hit } of plan.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
  const text = hit.notes ? `${hit.text}\n\n— הערות —\n${strip(hit.notes)}` : hit.text;
  const patch = { original_text: text, full_text: text };
  // משלימים גם מטא-דאטה חסרה, בלי לדרוס מה שקיים
  if (!row.court && hit.court) patch.court = hit.court;
  if (!row.case_number && hit.caseNumber) patch.case_number = hit.caseNumber;
  if (!row.year && hit.year) patch.year = hit.year;
  const { error } = await sb.from('psakei_din').update(patch).eq('id', row.id);
  if (error) { console.error(`❌ ${row.id}: ${error.message}`); continue; }
  done++;
  if (done % 50 === 0) console.log(`  ${done}/${plan.length}`);
}
console.log(`✅ מולאו ${done} פסקים`);
