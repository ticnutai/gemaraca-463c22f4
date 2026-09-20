#!/usr/bin/env node
/**
 * ניתוח מראי מקומות על כל אורך הפסק
 * ──────────────────────────────────────────────────────────
 * הבעיה: extract-references שולח ל-AI רק 6,000 תווים ראשונים,
 * ופסק ממוצע הוא כ-34,000 תווים — כלומר 80% מהפסק לא נבדק.
 * הפתרון כאן: הלקוח מחלק את הפסק לקטעים חופפים וקורא לפונקציה
 * לכל קטע, מאחד את התוצאות, מסנן מה שלא ייתכן, ושומר.
 *
 * שימוש:
 *   node scripts/reanalyze-refs.mjs --missing            # רק פסקים בלי מראי מקומות, regex בלבד (חינם)
 *   node scripts/reanalyze-refs.mjs --missing --ai       # כנ"ל, כולל AI
 *   node scripts/reanalyze-refs.mjs --all --ai --limit 50
 *   node scripts/reanalyze-refs.mjs --missing --ai --resume
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, 'scripts', 'data', 'reanalyze-state.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };

const USE_AI = has('--ai');
const ONLY_MISSING = has('--missing') || !has('--all');
const LIMIT = num('--limit', Infinity);
const CHUNK = num('--chunk', 6000);
const OVERLAP = num('--overlap', 600);
const CONCURRENCY = num('--concurrency', USE_AI ? 2 : 4);
const DELAY = num('--delay', USE_AI ? 700 : 150);
const RESUME = has('--resume');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);

// דפים מקסימליים לכל מסכת — כדי לפסול מראי מקומות בלתי אפשריים
const MAX_DAF = Object.fromEntries(
  [...readFileSync(join(ROOT, 'supabase/functions/_shared/masechtotData.ts'), 'utf8')
    .matchAll(/name:\s*"([^"]+)"[\s\S]{0,120}?maxDaf:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
);

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripHtml = (s) => s
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')   // קוד העיצוב אינו חלק מהפסק
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ').trim();

function chunks(text) {
  if (text.length <= CHUNK) return [text];
  const out = [];
  for (let i = 0; i < text.length; i += CHUNK - OVERLAP) out.push(text.slice(i, i + CHUNK));
  return out;
}

// ── אילו פסקים לעבד ─────────────────────────────────────────
async function loadTargets() {
  const withRefs = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('talmud_references').select('psak_din_id').range(from, from + 999);
    if (error) throw new Error(error.message);
    data.forEach((r) => withRefs.add(r.psak_din_id));
    if (data.length < 1000) break;
  }
  // רק מזהה וכותרת — משיכת הטקסט המלא של אלפי פסקים בבת אחת חורגת מזמן השאילתה
  const psakim = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('psakei_din').select('id,title').range(from, from + 999);
    if (error) throw new Error(error.message);
    psakim.push(...data);
    if (data.length < 1000) break;
  }
  return psakim
    .filter((p) => (ONLY_MISSING ? !withRefs.has(p.id) : true))
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);
}

// ── ניתוח פסק אחד ───────────────────────────────────────────
async function analyze(psak) {
  const { data: full, error: loadErr } = await sb.from('psakei_din').select('full_text,original_text').eq('id', psak.id).single();
  if (loadErr) throw new Error(loadErr.message);
  // original_text הוא הטקסט לפני העיצוב, ולכן נקי מ-CSS
  const text = stripHtml(full?.original_text || full?.full_text || '');
  if (text.length < 400) return { added: 0, found: 0, skipped: true };
  const parts = chunks(text);
  const byKey = new Map();

  for (const part of parts) {
    let refs = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await sb.functions.invoke('extract-references', {
        body: { text: part, documentId: psak.id, useAI: USE_AI },
      });
      if (!error && data?.references) { refs = data.references; break; }
      await sleep(1500 * (attempt + 1));
    }
    for (const r of refs) {
      const max = MAX_DAF[r.tractate];
      const daf = Number(r.daf);
      if (!max || !daf || daf < 2 || daf > max) continue; // הגמרא מתחילה בדף ב׳
      const key = `${r.tractate}|${daf}|${r.amud ?? ''}`;
      const prev = byKey.get(key);
      if (!prev || (r.confidence_score ?? 0) > (prev.confidence_score ?? 0)) byKey.set(key, r);
    }
    if (DELAY) await sleep(DELAY);
  }

  const refs = [...byKey.values()];
  if (!refs.length) return { added: 0, found: 0 };

  const { data: existing } = await sb.from('talmud_references')
    .select('tractate,daf,amud').eq('psak_din_id', psak.id);
  const have = new Set((existing ?? []).map((e) => `${e.tractate}|${e.daf}|${e.amud ?? ''}`));

  const rows = refs
    .filter((r) => !have.has(`${r.tractate}|${Number(r.daf)}|${r.amud ?? ''}`))
    .map((r) => ({
      psak_din_id: psak.id,
      tractate: r.tractate,
      daf: String(Number(r.daf)),
      amud: r.amud ?? null,
      raw_reference: (r.raw ?? r.normalized ?? '').slice(0, 500),
      normalized: r.normalized,
      confidence: r.confidence ?? 'medium',
      confidence_score: r.confidence_score ?? null,
      confidence_factors: r.confidence_factors ?? null,
      context_snippet: r.context_snippet ?? null,
      source: r.source ?? (USE_AI ? 'ai' : 'regex'),
      validation_status: 'pending',
    }));

  if (rows.length) {
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await sb.from('talmud_references').insert(rows.slice(i, i + 100));
      if (error) throw new Error(error.message);
    }
  }
  return { added: rows.length, found: refs.length };
}

// ── הרצה ────────────────────────────────────────────────────
const done = RESUME && existsSync(STATE) ? new Set(JSON.parse(readFileSync(STATE, 'utf8')).done) : new Set();
const targets = (await loadTargets()).filter((p) => !done.has(p.id));

console.log(`פסקים לעיבוד: ${targets.length} | AI: ${USE_AI ? 'כן' : 'לא'} | קטעים של ${CHUNK} תווים | במקביל: ${CONCURRENCY}`);

let processed = 0, added = 0, failed = 0, skipped = 0;
const t0 = Date.now();
let next = 0;

async function worker() {
  while (next < targets.length) {
    const psak = targets[next++];
    try {
      const r = await analyze(psak);
      added += r.added;
      if (r.skipped) skipped++;
      done.add(psak.id);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${psak.title?.slice(0, 40)}: ${e.message}`);
    }
    processed++;
    if (processed % 25 === 0 || processed === targets.length) {
      const secs = (Date.now() - t0) / 1000;
      const rate = processed / secs;
      console.log(`  ${processed}/${targets.length} | נוספו ${added} מראי מקומות | ${rate.toFixed(2)}/שנייה | נותרו כ-${Math.round((targets.length - processed) / rate / 60)} דקות`);
      writeFileSync(STATE, JSON.stringify({ done: [...done] }));
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
writeFileSync(STATE, JSON.stringify({ done: [...done] }));
console.log(`\n✅ הסתיים: ${processed} פסקים (${skipped} בלי טקסט), ${added} מראי מקומות חדשים, ${failed} כשלונות, ${((Date.now() - t0) / 60000).toFixed(1)} דקות`);
