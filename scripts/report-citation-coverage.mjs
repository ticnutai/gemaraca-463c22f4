#!/usr/bin/env node
/**
 * כמה מהפסקים באמת מצטטים גמרא, וכמה מהם אנחנו תופסים
 * ──────────────────────────────────────────────────────────
 * 52% מהפסקים מקושרים לדף גמרא, והשאלה הנכונה היא לא "למה לא 100%" אלא
 * **כמה מהפסקים בכלל מצטטים גמרא**. פסק על הסדרי שהות או על שכר טרחת כונס
 * נכסים יכול להיות שלם בלי אף ציטוט.
 *
 * הבדיקה כאן גסה בכוונה ואינה מסתמכת על החילוץ: שם מסכת שבקרבתו (±40 תווים)
 * מופיע "דף", "עמוד" או ציון ע״א/ע״ב. אם אין אפילו את זה — אין מה לתפוס.
 *
 * שימוש: node scripts/report-citation-coverage.mjs [--examples 5]
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const EXAMPLES = (() => { const i = args.indexOf('--examples'); return i >= 0 ? Number(args[i + 1]) : 5; })();

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const NAMES = [...readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8')
  .matchAll(/hebrewName:\s*"([^"]+)"/g)].map((m) => m[1]);
const ABBR = ['ב"ק', 'ב״ק', 'ב"מ', 'ב״מ', 'ב"ב', 'ב״ב', 'ע"ז', 'ע״ז'];
const strip = (s) => String(s || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const withRefs = new Set();
for (let f = 0; ; f += 1000) {
  const { data } = await sb.from('talmud_references').select('psak_din_id').range(f, f + 999);
  data.forEach((r) => withRefs.add(r.psak_din_id));
  if (data.length < 1000) break;
}
const psakim = [];
for (let f = 0; ; f += 1000) {
  const { data } = await sb.from('psakei_din').select('id,title,source_key').range(f, f + 999);
  psakim.push(...data);
  if (data.length < 1000) break;
}
const missing = psakim.filter((p) => !withRefs.has(p.id));
console.log(`פסקים: ${psakim.length} | עם מראי מקומות: ${withRefs.size} | בלי: ${missing.length}`);

const nearCitation = (text) => {
  for (const n of [...NAMES, ...ABBR]) {
    let i = text.indexOf(n);
    while (i >= 0) {
      if (/דף|עמוד|ע["״'׳][אב]/.test(text.slice(Math.max(0, i - 40), i + 45))) return n;
      i = text.indexOf(n, i + 1);
    }
  }
  return null;
};

const stats = { 'בלי טקסט': 0, 'בלי סימן לציטוט': 0, 'יש סימן לציטוט': 0 };
const examples = [];
let next = 0;
async function worker() {
  while (next < missing.length) {
    const p = missing[next++];
    const { data } = await sb.from('psakei_din').select('original_text,full_text').eq('id', p.id).single();
    const t = strip(data?.original_text || data?.full_text || '');
    if (t.length < 400) { stats['בלי טקסט']++; continue; }
    const hit = nearCitation(t);
    if (!hit) { stats['בלי סימן לציטוט']++; continue; }
    stats['יש סימן לציטוט']++;
    if (examples.length < EXAMPLES) {
      const i = t.indexOf(hit);
      examples.push(`[${p.source_key}] ${String(p.title).slice(0, 40)} — «${t.slice(Math.max(0, i - 45), i + 55)}»`);
    }
    if ((stats['בלי סימן לציטוט'] + stats['יש סימן לציטוט']) % 500 === 0) {
      console.log(`  ${next}/${missing.length}...`);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

console.log('\nמבין הפסקים בלי מראי מקומות:');
for (const [k, v] of Object.entries(stats)) {
  console.log(`  ${k}: ${v} (${((v / missing.length) * 100).toFixed(1)}%)`);
}
if (examples.length) {
  console.log('\nדוגמאות שכדאי לבדוק — יש בהן סימן לציטוט שלא נתפס:');
  examples.forEach((e) => console.log('   ' + e));
}
const real = withRefs.size + stats['יש סימן לציטוט'];
console.log(`\nמתוך הפסקים שיש בהם סימן לציטוט (${real}), תפסנו ${withRefs.size} — ${((withRefs.size / real) * 100).toFixed(1)}%`);
