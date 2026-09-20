#!/usr/bin/env node
/**
 * החלת קו העיצוב של המערכת על כל פסקי הדין
 * ──────────────────────────────────────────────────────────
 * משתמש בדיוק באותה תבנית שהאפליקציה מייצרת בלשונית "עיצוב"
 * (src/lib/psakDinParser + src/lib/psakDinHtmlTemplate), כך שהתוצאה
 * זהה לפסקים שכבר עוצבו — אותה מסגרת, אותו נייבי וזהב, אותה טבלת
 * פרטי תיק, אותן כותרות סעיפים וחתימה.
 *
 * בטיחות:
 *   • פסק שכבר מעוצב (beautify_count>0 או full_text שהוא מסמך HTML) לא נגעים בו
 *   • הטקסט המקורי נשמר ב-original_text לפני ההחלפה
 *   • --revert מחזיר את המקור לכל מה שעוצב בסקריפט הזה
 *
 * שימוש:
 *   node scripts/style-all-psakim.mjs --limit 3 --preview   # שומר דוגמאות לקובץ, בלי לכתוב למסד
 *   node scripts/style-all-psakim.mjs --limit 50            # מעצב 50 ושומר
 *   node scripts/style-all-psakim.mjs                       # הכל
 *   node scripts/style-all-psakim.mjs --revert              # החזרת המקור
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildStyledHtml } = require('./style/build.cjs');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', Infinity);
const PREVIEW = has('--preview');
const REVERT = has('--revert');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

/** מסמך HTML שלם = כבר מעוצב */
const isStyled = (t) => !t || /<!DOCTYPE html>|<html[\s>]/i.test(t) || t.includes('class="container"');

// ── החזרה למצב הקודם ───────────────────────────────────────
if (REVERT) {
  const { data, error } = await sb.from('psakei_din').select('id').not('original_text', 'is', null).limit(10000);
  if (error) { console.error('❌', error.message); process.exit(1); }
  console.log(`מחזיר ${data.length} פסקים לטקסט המקורי...`);
  let done = 0;
  for (const row of data) {
    const { data: full } = await sb.from('psakei_din').select('original_text').eq('id', row.id).single();
    if (!full?.original_text) continue;
    await sb.from('psakei_din').update({ full_text: full.original_text, original_text: null, beautify_count: 0 }).eq('id', row.id);
    if (++done % 50 === 0) console.log(`  ${done}/${data.length}`);
  }
  console.log(`✅ הוחזרו ${done} פסקים`);
  process.exit(0);
}

// ── מי צריך עיצוב ──────────────────────────────────────────
const candidates = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from('psakei_din')
    .select('id,title,court,year,case_number,summary,source_url,beautify_count')
    .range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  candidates.push(...data.filter((p) => !p.beautify_count));
  if (data.length < 1000) break;
}

console.log(`מועמדים לעיצוב (לפני בדיקת תוכן): ${candidates.length}`);

const previews = [];
let styled = 0, skipped = 0, failed = 0, tooShort = 0;

for (const p of candidates) {
  if (styled >= LIMIT) break;
  const { data: full, error } = await sb.from('psakei_din').select('full_text,original_text').eq('id', p.id).single();
  if (error) { failed++; continue; }

  const raw = full.original_text || full.full_text || '';
  if (isStyled(raw) && !full.original_text) { skipped++; continue; }
  if (raw.replace(/<[^>]+>/g, ' ').trim().length < 300) { tooShort++; continue; }

  try {
    const html = buildStyledHtml(raw, {
      title: p.title, court: p.court, year: p.year,
      caseNumber: p.case_number, summary: p.summary, sourceUrl: p.source_url,
    });
    if (!html || html.length < 1000) throw new Error('פלט ריק');

    if (PREVIEW) {
      previews.push({ id: p.id, title: p.title, html });
    } else {
      const { error: upErr } = await sb.from('psakei_din').update({
        full_text: html,
        original_text: full.original_text ?? raw,
        beautify_count: 1,
      }).eq('id', p.id);
      if (upErr) throw new Error(upErr.message);
    }
    styled++;
    if (styled % 50 === 0) console.log(`  ${styled} עוצבו`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${String(p.title).slice(0, 40)}: ${e.message}`);
  }
}

if (PREVIEW && previews.length) {
  const dir = join(ROOT, 'scripts', 'data', 'style-preview');
  mkdirSync(dir, { recursive: true });
  previews.forEach((p, i) => writeFileSync(join(dir, `preview-${i + 1}.html`), p.html, 'utf8'));
  console.log(`📄 נשמרו ${previews.length} דוגמאות ב-${dir}`);
}

console.log(`✅ ${PREVIEW ? 'הוכנו' : 'עוצבו'} ${styled} | כבר מעוצבים: ${skipped} | קצרים מדי: ${tooShort} | כשלונות: ${failed}`);
