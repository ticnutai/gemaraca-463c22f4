#!/usr/bin/env node
/**
 * עדכון הטקסט של פסקי בית הדין דאמריקה אחרי תיקון חילוץ ה-PDF
 * ──────────────────────────────────────────────────────────
 * ה-PDF של בית הדין אינו מכיל תווי רווח בעברית, והחילוץ המתוקן משלים אותם לפי
 * מיקום האותיות. הפסקים כבר במסד, ולכן **מעדכנים** את הטקסט במקום לייבא מחדש:
 * ייבוא חוזר היה יוצר כפילויות, כי טביעת האצבע של התוכן השתנתה.
 *
 * שימוש:
 *   node scripts/refresh-bethdin-text.mjs --dry-run
 *   node scripts/refresh-bethdin-text.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts/data/bethdin');
const DRY = process.argv.includes('--dry-run');
const require = createRequire(import.meta.url);
const { buildStyledHtml } = require(join(ROOT, 'scripts/style/build.cjs'));

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const fingerprint = (text) => String(text || '').replace(/<[^>]+>/g, ' ').replace(/[^א-ת0-9]/g, '').slice(0, 2000);

const { data: psakim } = await sb.from('psakei_din')
  .select('id,title,source_url,original_text').eq('source_key', 'bethdin');
const byTitle = new Map((psakim ?? []).map((p) => [p.title, p]));
const byUrl = new Map((psakim ?? []).map((p) => [p.source_url, p]));
console.log(`פסקים במסד: ${psakim?.length ?? 0}`);

let updated = 0, unchanged = 0, missing = 0;
for (const f of readdirSync(CACHE).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
  const j = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
  const psak = byUrl.get(j.url) ?? byUrl.get(j.pdfUrl) ?? byTitle.get(j.title);
  if (!psak) { missing++; continue; }

  const footnotes = Array.isArray(j.footnotes) && j.footnotes.length
    ? `\n\nהערות\n${j.footnotes.map((t, i) => `[${i + 1}] ${t}`).join('\n')}`
    : '';
  const fullRaw = String(j.text || '') + footnotes;
  if (String(psak.original_text || '').length === fullRaw.length) { unchanged++; continue; }

  const styled = buildStyledHtml(fullRaw, { title: j.title, court: j.court || null, sourceUrl: j.pdfUrl || null });
  const heWords = (fullRaw.match(/[א-ת]{2,}/g) || []).length;
  console.log(`  ${String(j.title).slice(0, 42)} | ${String(psak.original_text || '').length} → ${fullRaw.length} תווים | ${heWords} מילים עבריות`);
  if (!DRY) {
    const { error } = await sb.from('psakei_din')
      .update({ original_text: fullRaw, full_text: styled, content_print: fingerprint(fullRaw) })
      .eq('id', psak.id);
    if (error) { console.error('❌', error.message); break; }
  }
  updated++;
}
console.log(`\n${DRY ? '(--dry-run) ' : ''}עודכנו: ${updated} | ללא שינוי: ${unchanged} | בלי פסק תואם: ${missing}`);
if (!DRY && updated) console.log('כעת כדאי להריץ: node scripts/extract-refs-local.mjs');
