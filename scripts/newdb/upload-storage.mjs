#!/usr/bin/env node
/**
 * העלאת קבצי האחסון לפרויקט החדש
 * ──────────────────────────────────────────────────────────────────────────
 * המקור: export/03_storage/<דלי>/<נתיב הקובץ כפי שהיה בענן>.
 * ההעלאה היא upsert, כך שהרצה חוזרת לא יוצרת כפילויות ולא דורסת שגיאות.
 *
 * שימוש:
 *   node scripts/newdb/upload-storage.mjs --dry-run
 *   node scripts/newdb/upload-storage.mjs [--bucket psakei-din-files]
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, relative, posix, sep, extname } from 'path';
import { createClient } from '@supabase/supabase-js';
import { ROOT, NEW_URL, NEW_KEY, ADMIN_EMAIL, ADMIN_PASSWORD } from './env.mjs';

const DRY = process.argv.includes('--dry-run');
const bArg = process.argv.indexOf('--bucket');
const ONLY = bArg > -1 ? process.argv[bArg + 1] : null;

const SRC = join(ROOT, 'export', '03_storage');
if (!existsSync(SRC)) { console.error('❌ אין תיקיית export/03_storage'); process.exit(1); }

const MIME = {
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain', '.rtf': 'application/rtf', '.html': 'text/html',
  '.htm': 'text/html', '.zip': 'application/zip',
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const sb = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false, autoRefreshToken: true } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

for (const bucket of readdirSync(SRC)) {
  if (ONLY && bucket !== ONLY) continue;
  const base = join(SRC, bucket);
  if (!statSync(base).isDirectory()) continue;
  const files = walk(base);
  console.log(`\n${bucket}: ${files.length} קבצים מקומיים`);
  if (DRY) { files.slice(0, 3).forEach((f) => console.log('   ·', relative(base, f))); continue; }

  let ok = 0, skip = 0, fail = 0, firstErr = '';
  for (const f of files) {
    const key = relative(base, f).split(sep).join(posix.sep);
    const body = readFileSync(f);
    let done = false;
    for (let a = 0; a < 3 && !done; a++) {
      const { error } = await sb.storage.from(bucket).upload(key, body, {
        contentType: MIME[extname(key).toLowerCase()] || 'application/octet-stream',
        upsert: true,
      });
      if (!error) { done = true; break; }
      if (/already exists|duplicate/i.test(error.message)) { skip++; done = true; break; }
      if (/fetch failed|ECONNRESET|socket hang up|timeout|network/i.test(error.message)) {
        await new Promise((r) => setTimeout(r, 1200 * (a + 1)));
        continue;
      }
      firstErr ||= `${key}: ${error.message}`;
      break;
    }
    if (done) ok++; else fail++;
    if ((ok + skip + fail) % 100 === 0) process.stdout.write(`\r   ${ok} הועלו, ${fail} נכשלו   `);
  }
  console.log(`\r   ✅ ${ok} הועלו, ${fail} נכשלו${firstErr ? ` — ראשון: ${firstErr}` : ''}      `);
}
