#!/usr/bin/env node
/**
 * הרצת האפליקציה במצב מקומי מלא
 * ──────────────────────────────────────────────────────────
 * מפעיל את שרת המסד המקומי ואת Vite יחד, ומוודא שהמסד קיים לפני כן.
 * שני התהליכים נעצרים יחד — אם אחד נופל, השני אינו נשאר תלוי באוויר.
 *
 * שימוש:  npm run local
 */

import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = join(ROOT, 'data', 'gemaraca-cloud.db');
const BUILT = join(ROOT, 'data', 'gemaraca.db');

const db = existsSync(MIRROR) ? MIRROR : existsSync(BUILT) ? BUILT : null;
if (!db) {
  console.error('❌ אין מסד מקומי.');
  console.error('   מהענן:    npm run local:mirror');
  console.error('   מהקאשים:  npm run local:rebuild');
  process.exit(1);
}
console.log(`📁 מסד מקומי: ${db} — ${(statSync(db).size / 1048576).toFixed(0)} מ"ב`);
if (!existsSync(join(ROOT, '.env.local'))) {
  console.warn('⚠ אין .env.local — האפליקציה עלולה לפנות לענן במקום למסד המקומי');
}

const children = [];
const start = (name, cmd, cmdArgs) => {
  const c = spawn(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: true });
  c.on('exit', (code) => {
    console.log(`\n${name} הסתיים (${code})`);
    stopAll();
  });
  children.push(c);
  return c;
};
let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) { try { c.kill(); } catch { /* כבר מת */ } }
  process.exit(0);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

start('שרת המסד', process.execPath, [join(ROOT, 'scripts', 'local-api.mjs')]);
// שהייה קצרה כדי שהשרת יספיק להאזין לפני שהאפליקציה פונה אליו
setTimeout(() => start('Vite', 'npx', ['vite']), 1500);
