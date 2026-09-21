#!/usr/bin/env node
/**
 * חילוץ מראי מקומות מקומית, בלי AI ובלי Edge Function
 * ──────────────────────────────────────────────────────────
 * הביטויים הרגולריים של החילוץ יושבים ב-supabase/functions/_shared/extractRegex.ts,
 * והסקריפט הזה מריץ אותם מקומית על כל אורך הפסק. שלושה יתרונות על הקריאה
 * ל-Edge Function: אין הגבלת 6,000 תווים, אין עלות, ואין תלות בגרסה שמותקנת
 * בענן — התיקונים בקוד תופסים מיד.
 *
 * מה נכתב:
 *   • כל מראה מקום שהחילוץ מצא ואינו קיים בפסק → נוסף (source='regex')
 *   • שורת regex שהחילוץ המתוקן אינו מייצר עוד → נמחקת, היא תוצר של הבאג
 *   • שורה שה-raw שלה נגמר בגרשיים, כלומר המספר נקטע באמצע, → נמחקת בכל
 *     מקור, כי הדף שנרשם בה אינו הדף שכתוב בפסק
 *
 * מה לא נוגעים בו: אינדקס רשמי (site-index), ומראי מקומות של ה-AI שהחילוץ
 * אינו מכיר — הם שכבה נוספת ולא תחליף.
 *
 * שימוש:
 *   node scripts/extract-refs-local.mjs --dry-run
 *   node scripts/extract-refs-local.mjs [--limit 200] [--concurrency 6] [--rebuild]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const DRY = has('--dry-run');
const LIMIT = num('--limit', Infinity);
const CONCURRENCY = num('--concurrency', 6);

// ── בניית מודול החילוץ המשותף לריצה ב-Node ─────────────────
const BUNDLE = join(ROOT, 'scripts/build/extractRegex.mjs');
mkdirSync(join(ROOT, 'scripts/build'), { recursive: true });
if (has('--rebuild') || !existsSync(BUNDLE)) {
  console.log('בונה את מודול החילוץ...');
  execFileSync('npx', [
    'esbuild', 'supabase/functions/_shared/extractRegex.ts',
    '--bundle', '--format=esm', '--platform=node', `--outfile=${BUNDLE}`, '--log-level=warning',
  ], { cwd: ROOT, stdio: 'inherit', shell: true });
}
const { extractWithRegex } = await import(`file://${BUNDLE.replace(/\\/g, '/')}`);

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }
const userId = auth.user.id;

const stripHtml = (s) => String(s)
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * raw שנגמר בגרשיים = מספר שנקטע באמצע: גרשיים יושבים בין שתי אותיות
 * ("פ״ד"), ולכן "דף ס״" הוא תחילתו של מספר ולא מספר.
 * גרש בודד לא — הוא הסימון התקני למספר של אות אחת ("דף ע׳" = 70).
 */
const truncatedRaw = (raw) => /["״]\s*$/.test(String(raw || ''));

// ── מראי המקומות הקיימים, לפי פסק ──────────────────────────
const existing = new Map();
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('talmud_references')
    .select('id,psak_din_id,tractate,daf,amud,raw_reference,normalized,source,validation_status')
    .range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  for (const r of data) {
    if (!existing.has(r.psak_din_id)) existing.set(r.psak_din_id, []);
    existing.get(r.psak_din_id).push(r);
  }
  if (data.length < 1000) break;
}

const psakim = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('psakei_din').select('id').range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  psakim.push(...data.map((p) => p.id));
  if (data.length < 1000) break;
}
const targets = psakim.slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`פסקים: ${targets.length} | מראי מקומות קיימים: ${[...existing.values()].reduce((s, v) => s + v.length, 0)}`);

const key = (t, d, a) => `${t}|${Number(d)}|${a ?? ''}`;
const toInsert = [];
const toDelete = [];
let scanned = 0, noText = 0, failed = 0;
const t0 = Date.now();

let next = 0;
async function worker() {
  while (next < targets.length) {
    const id = targets[next++];
    let text = '';
    try {
      const { data, error } = await sb.from('psakei_din')
        .select('full_text,original_text').eq('id', id).single();
      if (error) throw new Error(error.message);
      // original_text הוא הטקסט לפני העיצוב, ולכן נקי מ-CSS
      text = stripHtml(data?.original_text || data?.full_text || '');
    } catch {
      failed++;
      continue;
    }
    scanned++;
    if (text.length < 400) { noText++; continue; }

    let found = [];
    try { found = extractWithRegex(text); } catch { failed++; continue; }

    const have = existing.get(id) ?? [];
    const haveKeys = new Set(have.map((r) => key(r.tractate, r.daf, r.amud)));
    const foundKeys = new Set(found.map((r) => key(r.tractate, r.daf, r.amud)));

    for (const r of found) {
      if (haveKeys.has(key(r.tractate, r.daf, r.amud))) continue;
      toInsert.push({
        psak_din_id: id,
        tractate: r.tractate,
        daf: String(Number(r.daf)),
        amud: r.amud ?? null,
        raw_reference: r.raw ?? r.normalized,
        normalized: r.normalized,
        confidence: r.confidence,
        confidence_score: r.confidence_score ?? null,
        confidence_factors: r.confidence_factors ?? null,
        source: 'regex',
        context_snippet: r.context_snippet || null,
        user_id: userId,
      });
    }

    // מוחקים רק כשיש קריאה שלמה יותר של אותו מקום בטקסט: ה-raw הישן הוא
    // תחילתו של ה-raw החדש ("בבא מציעא דף ע" מול "בבא מציעא דף ע״ב"), או
    // שה-raw נקטע בגרשיים. הפניה שהחילוץ החדש פשוט אינו מכיר נשארת.
    const foundRaws = found.map((r) => flat(r.raw ?? ''));
    for (const r of have) {
      if (r.source === 'site-index') continue;
      const raw = flat(r.raw_reference);
      const superseded = r.source === 'regex'
        && !foundKeys.has(key(r.tractate, r.daf, r.amud))
        && foundRaws.some((f) => f.length > raw.length && f.startsWith(raw));
      if (superseded || truncatedRaw(r.raw_reference)) toDelete.push(r);
    }

    if (scanned % 500 === 0) {
      const rate = scanned / ((Date.now() - t0) / 1000);
      console.log(`  ${scanned}/${targets.length} | להוספה ${toInsert.length} | למחיקה ${toDelete.length} | ${rate.toFixed(1)}/שנייה`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

console.log(`\nנסרקו ${scanned} פסקים (${noText} בלי טקסט, ${failed} כשלונות)`);
console.log(`להוספה: ${toInsert.length} | למחיקה: ${toDelete.length}`);
const delBySource = {};
for (const r of toDelete) delBySource[`${r.source}/${r.validation_status}`] = (delBySource[`${r.source}/${r.validation_status}`] || 0) + 1;
console.log('מחיקה לפי מקור:', JSON.stringify(delBySource));
toInsert.slice(0, 5).forEach((r) => console.log(`   + ${r.tractate} ${r.daf}${r.amud ?? ''} ← "${r.raw_reference}"`));
toDelete.slice(0, 5).forEach((r) => console.log(`   - ${r.tractate} ${r.daf}${r.amud ?? ''} ← "${r.raw_reference}" (${r.source})`));
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }

if (toDelete.length) {
  const file = join(ROOT, `scripts/data/replaced-references-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(file, JSON.stringify(toDelete, null, 2), 'utf8');
  console.log(`📦 נשמר לפני מחיקה: ${file}`);
  for (let i = 0; i < toDelete.length; i += 200) {
    const ids = toDelete.slice(i, i + 200).map((r) => r.id);
    const { error } = await sb.from('talmud_references').delete().in('id', ids);
    if (error) { console.error('❌ מחיקה:', error.message); process.exit(1); }
  }
  console.log(`🗑️  נמחקו ${toDelete.length}`);
}

let added = 0;
for (let i = 0; i < toInsert.length; i += 200) {
  const chunk = toInsert.slice(i, i + 200);
  const { error } = await sb.from('talmud_references').insert(chunk);
  if (error) { console.error('❌ הוספה:', error.message); break; }
  added += chunk.length;
  if (added % 2000 === 0) console.log(`  נוספו ${added}/${toInsert.length}`);
}
console.log(`✅ נוספו ${added} מראי מקומות | נמחקו ${toDelete.length}`);
