#!/usr/bin/env node
/**
 * העתקה ישירה של טבלה מהענן הישן לחדש, בלי לעבור דרך המראה.
 * נועד לטבלאות שהמראה פספסה. הכתובות בשדות המצביעים לאחסון הישן
 * מוסבות למזהה הפרויקט החדש.
 *
 *   node scripts/newdb/copy-table.mjs user_books server_diagnostics
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { ROOT, NEW_URL, NEW_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, readEnvFile } from './env.mjs';

const old = readEnvFile(join(ROOT, '.env'));
const OLD_REF = old.VITE_SUPABASE_PROJECT_ID;
const NEW_REF = readEnvFile(join(ROOT, '.env.new-supabase')).NEW_SUPABASE_PROJECT_ID;

const src = createClient(old.VITE_SUPABASE_URL, old.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const dst = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false, autoRefreshToken: true } });

/** הרשת כאן מקרטעת. כל קריאה מקבלת כמה ניסיונות לפני שהיא נחשבת כישלון. */
async function retry(label, fn, tries = 6) {
  let last;
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fn();
      if (!r?.error) return r;
      last = r.error.message;
      if (!/fetch failed|timeout|ECONNRESET|socket hang up|network|ETIMEDOUT|52[0-9]/i.test(last)) return r;
    } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
  }
  console.log(`⚠️ ${label}: ${last}`);
  return { error: { message: last } };
}

for (const [nm, c] of [['ישן', src], ['חדש', dst]]) {
  const { error } = await retry(`התחברות ל${nm}`, () =>
    c.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }));
  if (error) { console.error(`❌ התחברות ל${nm} נכשלה:`, error.message); process.exit(1); }
}

const swap = (v) => (typeof v === 'string' && v.includes(OLD_REF) ? v.split(OLD_REF).join(NEW_REF) : v);

for (const table of process.argv.slice(2)) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await retry(`${table} קריאה @${from}`, () => src.from(table).select('*').range(from, from + 499));
    if (error) { console.log(`❌ ${table}: קריאה נכשלה — ${error.message}`); break; }
    rows.push(...data);
    if (data.length < 500) break;
  }
  if (!rows.length) { console.log(`${table}: אין שורות`); continue; }

  let swapped = 0;
  const clean = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => {
    const n = swap(v);
    if (n !== v) swapped++;
    return [k, n];
  })));

  let done = 0, firstErr = '';
  for (let i = 0; i < clean.length; i += 200) {
    const { error } = await retry(`${table} כתיבה @${i}`, () => dst.from(table).upsert(clean.slice(i, i + 200), { onConflict: 'id' }));
    if (error) { firstErr ||= error.message; continue; }
    done += Math.min(200, clean.length - i);
  }
  console.log(`${table}: ${rows.length} בענן הישן → ${done} נכתבו${swapped ? `, ${swapped} כתובות הוסבו לפרויקט החדש` : ''}${firstErr ? ` ⚠️ ${firstErr}` : ''}`);
}
