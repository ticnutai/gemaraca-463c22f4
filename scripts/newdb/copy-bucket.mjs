#!/usr/bin/env node
/**
 * העתקת דלי אחסון מהענן הישן לחדש, קובץ אחרי קובץ, בלי לשמור בדיסק.
 * הדיסק המקומי כמעט מלא, ולכן הזרימה היא ישירות מהורדה להעלאה.
 * מה שכבר קיים בחדש מדולג, כך שאפשר להריץ שוב אחרי ניתוק.
 *
 *   node scripts/newdb/copy-bucket.mjs --list
 *   node scripts/newdb/copy-bucket.mjs user-books shas-pdf-pages
 */
import { join, extname } from 'path';
import { createClient } from '@supabase/supabase-js';
import { ROOT, NEW_URL, NEW_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, readEnvFile } from './env.mjs';

/**
 * דלי `psakei-din-files` מגביל את סוגי הקבצים המותרים. לחלק מן הקבצים
 * בענן הישן אין סוג רשום, וברירת המחדל `application/octet-stream` אינה
 * ברשימה — 2,021 קבצים נדחו בגללה. לכן הסוג נגזר מן הסיומת.
 */
const MIME = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.rtf': 'application/rtf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.zip': 'application/zip',
};
const mimeOf = (path, fromCloud) => {
  const byExt = MIME[extname(path).toLowerCase()];
  if (byExt) return byExt;
  if (fromCloud && fromCloud !== 'application/octet-stream') return fromCloud;
  return 'application/octet-stream';
};

const old = readEnvFile(join(ROOT, '.env'));
const src = createClient(old.VITE_SUPABASE_URL, old.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const dst = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false, autoRefreshToken: true } });

async function retry(label, fn, tries = 6) {
  let last;
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fn();
      if (!r?.error) return r;
      last = r.error.message;
      if (!/fetch failed|timeout|ECONNRESET|socket hang up|network|ETIMEDOUT|52[0-9]/i.test(last)) return r;
    } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 1200 * (a + 1)));
  }
  return { error: { message: last }, _label: label };
}

for (const [nm, c] of [['ישן', src], ['חדש', dst]]) {
  const { error } = await retry('', () => c.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }));
  if (error) { console.error(`❌ התחברות ל${nm} נכשלה: ${error.message}`); process.exit(1); }
}

/** רשימת כל הקבצים בדלי, כולל תיקיות משנה. ה-API מחזיר 1000 בכל פעם. */
async function listAll(client, bucket, prefix = '') {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await retry(`רשימה ${bucket}/${prefix}`, () =>
      client.storage.from(bucket).list(prefix, { limit: 1000, offset: off, sortBy: { column: 'name', order: 'asc' } }));
    if (error || !data) break;
    for (const e of data) {
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...await listAll(client, bucket, p));   // תיקייה
      else out.push({ path: p, size: e.metadata?.size ?? 0, type: e.metadata?.mimetype });
    }
    if (data.length < 1000) break;
  }
  return out;
}

const BUCKETS = ['psakei-din-files', 'user-books', 'shas-pdf-pages'];
const args = process.argv.slice(2);
const LIST_ONLY = args.includes('--list');
const targets = args.filter((a) => !a.startsWith('--'));

for (const bucket of (targets.length ? targets : BUCKETS)) {
  const from = await listAll(src, bucket);
  const have = new Set((await listAll(dst, bucket)).map((f) => f.path));
  const todo = from.filter((f) => !have.has(f.path));
  const mb = (n) => (n / 1048576).toFixed(0);
  console.log(`\n${bucket}: ${from.length} בישן (${mb(from.reduce((s, f) => s + f.size, 0))}MB), ${have.size} כבר בחדש, ${todo.length} להעתקה`);
  if (LIST_ONLY || !todo.length) continue;

  // קובץ אחרי קובץ לקח שעות: רוב הזמן הוא המתנה לרשת. שישה במקביל
  // מנצלים את ההמתנה בלי להעמיס על השרת.
  let ok = 0, fail = 0, firstErr = '', next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const f = todo[next++];
      const dl = await retry(`הורדה ${f.path}`, async () => await src.storage.from(bucket).download(f.path));
      if (dl.error || !dl.data) { fail++; firstErr ||= `${f.path}: ${dl.error?.message}`; continue; }
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const up = await retry(`העלאה ${f.path}`, () =>
        dst.storage.from(bucket).upload(f.path, buf, { contentType: mimeOf(f.path, f.type), upsert: true }));
      if (up.error) { fail++; firstErr ||= `${f.path}: ${up.error.message}`; continue; }
      ok++;
      if ((ok + fail) % 50 === 0) process.stdout.write(`\r   ${ok} הועתקו, ${fail} נכשלו   `);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`\r   ✅ ${ok} הועתקו, ${fail} נכשלו${firstErr ? ` — ראשון: ${firstErr}` : ''}      `);
}
