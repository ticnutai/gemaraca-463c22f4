#!/usr/bin/env node
/**
 * שחזור ייחוס החילוץ של מראי המקומות
 * ──────────────────────────────────────────────────────────
 * ריצת האימות מול ספריא כתבה source='sefaria-verified' על כל שורה שנבדקה,
 * ובכך מחקה את מי שחילץ אותה (regex / ai / site-index). כאן הערך המקורי
 * נשלף מהגיבויים לפי מזהה השורה, והאימות עובר לעמודות validated_by/validated_at.
 *
 * שורות שנוצרו אחרי הגיבוי האחרון אינן מכוסות, והן מסומנות 'extracted' —
 * חילוץ אוטומטי שלא ידוע אם הגיע מהביטוי הרגולרי או מה-AI. עדיף סימון כזה
 * על פני ניחוש.
 *
 * שימוש: node scripts/restore-reference-provenance.mjs [--dry-run]
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const CLOBBERED = 'sefaria-verified';

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

// ── מזהה → מקור מקורי, מכל הגיבויים, מהחדש לעתיק ──────────
const { data: backups } = await sb.from('data_backups')
  .select('label,storage_path,created_at').eq('status', 'completed')
  .order('created_at', { ascending: false });

const originalSource = new Map();
for (const b of backups) {
  const man = JSON.parse(await (await sb.storage.from('system-backups')
    .download(`${b.storage_path}/manifest.json`)).data.text());
  const info = man.tables?.talmud_references;
  if (!info) continue;
  for (let n = 1; n <= info.chunks; n++) {
    const { data } = await sb.storage.from('system-backups')
      .download(`${b.storage_path}/data/talmud_references/${String(n).padStart(5, '0')}.json.gz`);
    const rows = JSON.parse(zlib.gunzipSync(Buffer.from(await data.arrayBuffer())).toString('utf8'));
    for (const r of rows) if (!originalSource.has(r.id)) originalSource.set(r.id, r.source);
  }
  console.log(`גיבוי ${b.created_at.slice(0, 10)} — ${b.label}: ${info.rows} שורות`);
}
console.log(`ייחוס מקורי לכל ${originalSource.size} שורות מהגיבויים`);

// ── השורות שנדרסו ──────────────────────────────────────────
const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('talmud_references')
    .select('id,validation_status').eq('source', CLOBBERED).range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}

const byTarget = new Map();   // source חדש → מזהים
for (const r of rows) {
  const src = originalSource.get(r.id) ?? 'extracted';
  if (!byTarget.has(src)) byTarget.set(src, []);
  byTarget.get(src).push(r.id);
}
console.log(`שורות שנדרסו: ${rows.length}`);
for (const [src, ids] of byTarget) console.log(`  → ${src}: ${ids.length}`);
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }

const validatedAt = new Date().toISOString();
let done = 0;
for (const [src, ids] of byTarget) {
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await sb.from('talmud_references')
      .update({ source: src, validated_by: 'sefaria', validated_at: validatedAt })
      .in('id', chunk);
    if (error) { console.error('❌', error.message); process.exit(1); }
    done += chunk.length;
    if (done % 2000 === 0) console.log(`  ${done}/${rows.length}`);
  }
}
console.log(`✅ שוחזר הייחוס של ${done} מראי מקומות, והאימות נרשם בנפרד`);
