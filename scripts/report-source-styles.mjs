#!/usr/bin/env node
/**
 * סגנון הציטוט של כל מקור, ומה הוא אומר על החילוץ
 * ──────────────────────────────────────────────────────────
 * כל אתר כותב מראי מקומות אחרת: אחד כותב "בבא קמא דף כ עמוד א", אחר "ב״ק כ,א",
 * ושלישי "(כ.)" בלבד. השאלה המעשית היא האם כדאי חילוץ נפרד לכל מקור, או שכלל
 * אחד טוב מספיק — והדרך לענות היא למדוד.
 *
 * לכל מקור: כמה פסקים, כמה הפניות לפסק, באילו צורות הוא כותב, ומה אחוז ההפניות
 * שעברו את הביקורת מול טקסט הפסק.
 *
 * שימוש: node scripts/report-source-styles.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** צורת הכתיבה של הציטוט */
function styleOf(raw) {
  const s = flat(raw);
  if (/דף\s+\S+\s+עמוד\s+[אב]/.test(s)) return 'דף X עמוד א';
  if (/דף\s+\S+\s+ע["״'׳][אב]/.test(s)) return 'דף X ע״א';
  if (/דף\s+\S+\s+עמ['׳]/.test(s)) return "דף X עמ׳ א";
  if (/דף\s/.test(s)) return 'דף X (בלי עמוד)';
  if (/,\s*[אב](?![א-ת])/.test(s)) return 'X כ,א (פסיק)';
  if (/[.:]\s*$/.test(s)) return 'X כ. / כ: (נקודה)';
  if (/ע["״'׳][אב]/.test(s)) return 'X כ ע״א (בלי "דף")';
  if (/["״]/.test(s)) return 'מספר עם גרשיים';
  return 'אחר';
}

const psakim = new Map();
for (let f = 0; ; f += 1000) {
  const { data } = await sb.from('psakei_din').select('id,source_key').range(f, f + 999);
  data.forEach((p) => psakim.set(p.id, p.source_key || '—'));
  if (data.length < 1000) break;
}
const refs = [];
for (let f = 0; ; f += 1000) {
  const { data } = await sb.from('talmud_references')
    .select('psak_din_id,raw_reference,source,validation_status,validated_by').range(f, f + 999);
  refs.push(...data);
  if (data.length < 1000) break;
}

const bySource = new Map();
for (const r of refs) {
  const key = psakim.get(r.psak_din_id) ?? '—';
  if (!bySource.has(key)) bySource.set(key, { refs: 0, psakim: new Set(), styles: {}, validated: 0, byLayer: {} });
  const e = bySource.get(key);
  e.refs++;
  e.psakim.add(r.psak_din_id);
  const st = styleOf(r.raw_reference);
  e.styles[st] = (e.styles[st] || 0) + 1;
  if (r.validation_status === 'correct') e.validated++;
  e.byLayer[r.source] = (e.byLayer[r.source] || 0) + 1;
}

const total = new Map();
for (const [id, src] of psakim) total.set(src, (total.get(src) || 0) + 1);

console.log('מקור | פסקים | עם הפניות | הפניות | ממוצע לפסק | אומתו');
for (const [src, e] of [...bySource.entries()].sort((a, b) => b[1].refs - a[1].refs)) {
  const all = total.get(src) ?? 0;
  console.log(`${src} | ${all} | ${e.psakim.size} | ${e.refs} | ${(e.refs / e.psakim.size).toFixed(1)} | ${((e.validated / e.refs) * 100).toFixed(0)}%`);
}

console.log('\nצורות הכתיבה, לפי מקור:');
for (const [src, e] of [...bySource.entries()].sort((a, b) => b[1].refs - a[1].refs)) {
  const styles = Object.entries(e.styles).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${((v / e.refs) * 100).toFixed(0)}%`).slice(0, 5);
  console.log(`  ${src}: ${styles.join(' | ')}`);
}

console.log('\nשכבת החילוץ שתפסה, לפי מקור:');
for (const [src, e] of [...bySource.entries()].sort((a, b) => b[1].refs - a[1].refs)) {
  const layers = Object.entries(e.byLayer).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${((v / e.refs) * 100).toFixed(0)}%`);
  console.log(`  ${src}: ${layers.join(' | ')}`);
}
