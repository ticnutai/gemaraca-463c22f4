#!/usr/bin/env node
/**
 * נקודת שחזור מהטרמינל
 * ──────────────────────────────────────────────────────────
 * מריץ את **אותו** מנוע גיבוי של האפליקציה (`src/lib/backup/engine.ts`), ארוז
 * ב-esbuild, כדי שלא תהיה לוגיקת גיבוי שנייה שתיפרד מהראשונה. הגיבוי נשמר
 * בדלי `system-backups` ונרשם ב-`data_backups`, כך שהוא מופיע ברשימת הגיבויים
 * באפליקציה וניתן לשחזור משם.
 *
 * נכנסים כל הטבלאות וכל אינדקסי הדליים. תוכן הקבצים עצמם נכנס רק לגיבוי ZIP
 * מהדפדפן — כאן נשמר אינדקס הקבצים, כמו בגיבוי הענן של האפליקציה.
 *
 * שימוש:
 *   node scripts/create-cloud-backup.mjs "נקודת חזרה - לפני X" [--notes "..."] [--verify]
 */

import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const label = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--notes')
  ?? `נקודת חזרה ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const notes = flag('--notes') ?? '';
const VERIFY = args.includes('--verify');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);

// ── אריזת מנוע הגיבוי לריצה ב-Node ─────────────────────────
// לקוח ה-Supabase של האפליקציה קורא import.meta.env של Vite, ולכן esbuild
// ממפה אותו לקוח לגרסת Node שקוראת משתני סביבה. PROJECT_REF נקרא ישירות
// מ-import.meta.env במנוע, ולכן הוא מוגדר ב-define.
process.env.SB_URL = env.VITE_SUPABASE_URL;
process.env.SB_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const BUNDLE = join(ROOT, 'scripts/build/backupEngine.mjs');
mkdirSync(join(ROOT, 'scripts/build'), { recursive: true });
const ESBUILD = join(ROOT, 'node_modules/@esbuild/win32-x64/esbuild.exe');
const esbuildBin = existsSync(ESBUILD) ? ESBUILD : join(ROOT, 'node_modules/.bin/esbuild');
console.log('אורז את מנוע הגיבוי...');
execFileSync(esbuildBin, [
  'scripts/backup/entry.ts',
  '--bundle', '--format=esm', '--platform=node', `--outfile=${BUNDLE}`, '--log-level=warning',
  '--alias:@=./src',
  // חבילות שמסופקות כ-CJS עם require דינמי אינן נארזות ל-ESM; Node יטען אותן
  '--external:@supabase/supabase-js', '--external:@zip.js/zip.js',
  '--alias:@/integrations/supabase/client=./scripts/backup/client.node.ts',
  `--define:import.meta.env={"VITE_SUPABASE_PROJECT_ID":${JSON.stringify(env.VITE_SUPABASE_PROJECT_ID ?? '')}}`,
], { cwd: ROOT, stdio: 'inherit' });

const { createBackup, loadCatalog, verifyCloudBackup, supabase } =
  await import(`file://${BUNDLE.replace(/\\/g, '/')}`);

const { error: authErr } = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const catalog = await loadCatalog();
console.log(`קטלוג: ${catalog.tables.length} טבלאות, ${catalog.tables.reduce((s, t) => s + t.rows, 0)} שורות, ${catalog.buckets.length} דליים`);

let last = '';
const result = await createBackup({
  catalog,
  tables: catalog.tables.map((t) => t.name),
  buckets: catalog.buckets.map((b) => b.id),
  toCloud: true,
  zip: null,
  label,
  notes,
  kind: 'cloud',
  onProgress: (p) => {
    const line = `  ${p.stage}: ${p.message} | ${p.rowsDone}/${p.rowsTotal}`;
    if (line !== last) { console.log(line); last = line; }
  },
});
const totalRows = Object.values(result.manifest.tables).reduce((s, t) => s + t.rows, 0);
console.log(`✅ ${label} | מצב: ${result.status} | ${totalRows} שורות ב-${Object.keys(result.manifest.tables).length} טבלאות`);

if (VERIFY) {
  const { data: row, error } = await supabase.from('data_backups').select('*').eq('id', result.backupId).single();
  if (error) { console.error('❌', error.message); process.exit(1); }
  const v = await verifyCloudBackup(row);
  console.log(`בדיקת תקינות: ${v.ok ? '✅ תקין' : '❌ נמצאו בעיות'} | ${v.tables} טבלאות, ${v.rows} שורות`);
  if (!v.ok) v.problems.slice(0, 5).forEach((x) => console.log('   ' + x));
}
