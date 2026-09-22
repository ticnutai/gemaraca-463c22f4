#!/usr/bin/env node
/**
 * השלמת הערות השוליים לפסקי gov.il שכבר במסד
 * ──────────────────────────────────────────────────────────
 * הגרסה הראשונה של המחלץ קראה מן ה-docx רק את `word/document.xml` ודילגה על
 * `word/footnotes.xml`. בפסקי דין רבניים זה בדיוק המקום שבו מראי המקומות
 * יושבים — "כתבו הטוש״ע…", "יעויין בספר פתחי חושן פרק י", "[25] שבועות דף מד
 * ע״ב" — ולכן כל מי שיובא אז נשמר בלי הזנב החשוב ביותר שלו.
 *
 * ההורדה מחדש כבר בקאש. הסקריפט הזה מעדכן את השורות הקיימות, ורק אותן שבהן
 * יש באמת מה להוסיף. הוא **אינו** מוסיף פסקים — לזה יש `--import`.
 *
 * זהירות שתי:
 *   • מתאימים לפי טביעת אצבע של פתח הטקסט, שאינה משתנה כשמוסיפים זנב.
 *   • מעדכנים רק אם הטקסט החדש ארוך יותר ומכיל את הישן. אם הוא קצר יותר,
 *     סימן שההורדה החדשה פגומה, ואז עדיף לא לגעת.
 *
 * שימוש:
 *   node scripts/refresh-govil-footnotes.mjs --dry-run
 *   node scripts/refresh-govil-footnotes.mjs [--limit 50]
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts/data/govil');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

/** אותה טביעת אצבע שהייבוא משתמש בה — פתח הטקסט, שאינו משתנה כשמוסיפים זנב */
function fingerprint(text) {
  const core = String(text || '').replace(/<[^>]+>/g, ' ').replace(/[^א-ת0-9]/g, '').slice(0, 2000);
  return core.length < 200 ? null : createHash('md5').update(core).digest('hex');
}
const norm = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, '');

// ── מה במסד ─────────────────────────────────────────────────
const byPrint = new Map();
const byTitle = new Map();
// שתי שכבות: עמודות הטקסט המלא כבדות מדי לסריקה של שמונת אלפים שורות
// והשאילתה נקטעת בתום זמן. כאן נטענת רק המטא-דאטה, והטקסט נשלף
// בהמשך רק למועמדים המעטים.
for (let f = 0; ; f += 500) {
  const { data, error } = await sb.from('psakei_din')
    .select('id,title,content_print').range(f, f + 499);
  if (error) { console.error('❌', error.message); process.exit(1); }
  for (const p of data) {
    if (p.content_print) byPrint.set(p.content_print, p);
    byTitle.set(String(p.title || '').replace(/\s+/g, ' ').trim(), p);
  }
  if (data.length < 500) break;
}
console.log(`פסקים במסד: ${byPrint.size} לפי טביעת אצבע`);

// ── מה בקאש ─────────────────────────────────────────────────
const files = readdirSync(CACHE).filter((f) => f.endsWith('.json'));
const updates = [];
const candidates = [];
let noNotes = 0, notFound = 0, alreadyHas = 0, shorter = 0;

for (const f of files) {
  const j = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
  if (!j.notes) { noNotes++; continue; }          // אין מה להשלים

  const row = byPrint.get(fingerprint(j.text))
    ?? byTitle.get(String(j.title || '').replace(/\s+/g, ' ').trim());
  if (!row) { notFound++; continue; }

  candidates.push({ row, j });
}

// שכבה שנייה: הטקסט של המועמדים בלבד, במנות קטנות
for (let i = 0; i < candidates.length; i += 25) {
  const slice = candidates.slice(i, i + 25);
  const { data, error } = await sb.from('psakei_din')
    .select('id,full_text,original_text').in('id', slice.map((c) => c.row.id));
  if (error) { console.error('❌ טעינת טקסט:', error.message); break; }
  const texts = new Map((data ?? []).map((d) => [d.id, d]));
  for (const { row, j } of slice) {
    const t = texts.get(row.id);
    const current = String(t?.original_text || t?.full_text || '');
    if (norm(current).includes(norm(j.notes).slice(0, 80))) { alreadyHas++; continue; }
    if (norm(j.text).length <= norm(current).length) { shorter++; continue; }
    updates.push({ id: row.id, title: row.title, text: j.text, gain: j.notes.length });
  }
}

console.log(`בקאש: ${files.length} | עם הערות שוליים: ${files.length - noNotes}`);
console.log(`לעדכון: ${updates.length} | כבר מכילים: ${alreadyHas} | לא נמצאו במסד: ${notFound} | חדשים קצרים יותר: ${shorter}`);
if (updates.length) {
  const total = updates.reduce((s, u) => s + u.gain, 0);
  console.log(`סך התווים שיתווספו: ${total.toLocaleString('he-IL')}`);
  updates.slice(0, 5).forEach((u) => console.log(`   + ${String(u.title).slice(0, 55)} (+${u.gain})`));
}
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }

let done = 0;
for (const u of updates.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
  const { error } = await sb.from('psakei_din')
    .update({ original_text: u.text, full_text: u.text })
    .eq('id', u.id);
  if (error) { console.error(`❌ ${u.id}: ${error.message}`); continue; }
  done++;
  if (done % 50 === 0) console.log(`  ${done}/${updates.length}`);
}
console.log(`✅ עודכנו ${done} פסקים עם הערות השוליים שלהם`);
