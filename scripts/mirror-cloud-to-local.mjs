#!/usr/bin/env node
/**
 * מראה מקומית מלאה של מסד הענן
 * ──────────────────────────────────────────────────────────
 * למה: ב-4 באוקטובר 2026 הפרויקט בסופהבייס נרדם, הכתובת שלו הפסיקה להיפתר
 * ב-DNS, והאתר החי הציג דף בלי פסקים. הגיבויים עצמם שמורים **בתוך** אותו
 * פרויקט, כלומר כשהוא אינו זמין — גם הם אינם. קובץ מקומי אחד פותר את זה:
 * אפשר להעתיק אותו, לגבות אותו, ולעבוד ממנו גם בלי רשת.
 *
 * ההבדל מ-`build-local-db.mjs`: שם בונים מאפס מן הקאשים הגולמיים, וזו הדרך
 * כשהענן באמת אבד. כאן מעתיקים את הענן כמו שהוא, עם כל מה שנצבר בו ואינו
 * בקאשים — הקבצים שהועלו ידנית, אימותי ספריא, התיקונים הידניים.
 *
 * מה נשמר: כל טבלה, כל שורה, בלי סינון. הסכימה נגזרת מן הנתונים עצמם, ולכן
 * טבלה חדשה בענן תיקלט בלי לשנות כאן דבר.
 *
 * שימוש:
 *   node scripts/mirror-cloud-to-local.mjs
 *   node scripts/mirror-cloud-to-local.mjs --tables psakei_din,talmud_references
 *   node scripts/mirror-cloud-to-local.mjs --verify     השוואת ספירות בסוף
 */

import { readFileSync, mkdirSync, existsSync, rmSync, statSync, renameSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_DIR = join(ROOT, 'data');
const DB_FILE = join(DB_DIR, 'gemaraca-cloud.db');
const TMP_FILE = `${DB_FILE}.building`;

const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const VERIFY = args.includes('--verify');
const ONLY = flag('--tables')?.split(',').map((s) => s.trim()).filter(Boolean);
const PAGE = 500;

/**
 * רשימת הטבלאות מתגלה מתוך מפרט ה-OpenAPI של PostgREST, ולא מרשימה
 * קשיחה. רשימה קשיחה החסירה טבלה (shas_download_progress) והדבר התגלה
 * רק כשהאפליקציה ביקשה אותה בפועל. הרשימה למטה היא גיבוי בלבד.
 */
async function discoverTables() {
  // נקודת ה-OpenAPI של PostgREST דורשת מפתח service_role שאין לנו, ולכן
  // רשימת הטבלאות נגזרת מן הקוד עצמו: כל `.from('x')` שהאפליקציה
  // קוראת לו. זה מדויק יותר מרשימה קשיחה, כי טבלה שנוספה לקוד
  // נקלטת מעצמה — וכך התגלתה gemara_pages שחסרה במראה הראשונה.
  const found = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|mjs|js)$/.test(e.name)) continue;
      const txt = readFileSync(full, 'utf8');
      for (const m of txt.matchAll(/\.from\(\s*['"`]([a-z][a-z0-9_]{2,})['"`]\s*\)/g)) found.add(m[1]);
    }
  };
  for (const d of ['src', 'scripts', 'supabase']) {
    try { walk(join(ROOT, d)); } catch { /* אין תיקייה */ }
  }
  // שמות שאינם טבלאות (דליי אחסון וכדומה) ייפלו מעצמם עם הודעת דילוג
  const names = [...found].sort();
  console.log(`   מן הקוד: ${names.length} שמות טבלאות`);
  return names.length ? names : null;
}

const FALLBACK_TABLES = [
  'psakei_din', 'talmud_references', 'psak_sources', 'sugyot', 'sugya_psak_links',
  'pattern_sugya_links', 'smart_index_results', 'folders', 'psak_folders',
  'text_annotations', 'user_books', 'user_preferences', 'user_pinned_items',
  'user_prompt_templates', 'user_roles', 'learning_history', 'flashcards',
  'daf_yomi_progress', 'glossary_terms', 'upload_sessions', 'data_backups',
  'shas_download_progress',
];

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

mkdirSync(DB_DIR, { recursive: true });
// בונים לקובץ זמני ומחליפים רק בסוף, כדי שמראה תקינה לא תידרס במראה חלקית
if (existsSync(TMP_FILE)) rmSync(TMP_FILE);
const db = new DatabaseSync(TMP_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF;');

/** טיפוס העמודה נקבע מן הערך הראשון שאינו ריק; אובייקטים נשמרים כ-JSON */
const sqlType = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? 'INTEGER' : 'REAL';
  if (typeof v === 'boolean') return 'INTEGER';
  return 'TEXT';
};
const encode = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
};

console.log('═══ מראה מקומית של הענן ═══');
console.log(`   מקור: ${env.VITE_SUPABASE_URL}`);
const TABLES = ONLY ?? (await discoverTables()) ?? FALLBACK_TABLES;
const summary = [];
const skipped = [];   // טבלאות שקיימות אך לא נקראו — מראה חלקית

for (const table of TABLES) {
  // שורה אחת כדי לדעת אם הטבלה קיימת ומה העמודות שלה
  // בדיקת קיום. כשל חולף כאן הפיל פעם אחת טבלה שלמה מן המראה בלי שאיש
  // ישים לב, ולכן שלושה נסיונות לפני ויתור, ורק "לא נמצאה" הוא ויתור אמיתי.
  let probe = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    probe = await sb.from(table).select('*').limit(1);
    if (!probe.error) break;
    if (/Could not find the table|does not exist/i.test(probe.error.message)) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (probe.error) {
    const missing = /Could not find the table|does not exist/i.test(probe.error.message);
    console.log(`  ${table.padEnd(22)} — ${missing ? 'אינה קיימת' : 'דילוג'} (${probe.error.message.slice(0, 40)})`);
    if (!missing) skipped.push(table);
    continue;
  }
  if (!probe.data?.length) { console.log(`  ${table.padEnd(22)} 0`); summary.push([table, 0, 0]); continue; }

  // search_vector הוא tsvector גדול שאינו משמש מקומית, והוא מה שמפיל את
  // השאילתה בחריגת זמן כשמושכים אותו יחד עם הטקסט המלא
  const SKIP = new Set(['search_vector']);
  const cols = Object.keys(probe.data[0]).filter((c) => !SKIP.has(c));
  const colList = cols.join(',');
  const types = Object.fromEntries(cols.map((c) => [c, sqlType(probe.data[0][c])]));
  db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${cols.map((c) => `"${c}" ${types[c]}`).join(', ')})`);
  const ins = db.prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(',')})
    VALUES (${cols.map(() => '?').join(',')})`);

  // עימוד מסתגל: טבלה שיש בה טקסט מלא חורגת מזמן במנות גדולות. במקום לוותר
  // ולהשאיר מראה חלקית — מחצים את המנה ומנסים שוב, עד מנה של 25.
  let from = 0, written = 0, page = PAGE;
  for (;;) {
    const { data, error } = await sb.from(table).select(colList).range(from, from + page - 1);
    if (error) {
      if (/timeout|canceling/i.test(error.message) && page > 25) {
        page = Math.max(25, Math.floor(page / 2));
        process.stdout.write(`\r  ${table.padEnd(22)} ${written}… (מנה ${page})      `);
        continue;
      }
      console.error(`\n  ❌ ${table} @${from}: ${error.message}`);
      break;
    }
    if (!data.length) break;
    db.exec('BEGIN');
    // node:sqlite מקבל ארגומנטים בודדים, לא מערך
    for (const row of data) ins.run(...cols.map((c) => encode(row[c])));
    db.exec('COMMIT');
    written += data.length;
    from += data.length;
    process.stdout.write(`\r  ${table.padEnd(22)} ${written}…        `);
    if (data.length < page) break;
  }
  // אינדקסים על מה שבאמת נשאלים עליו
  if (cols.includes('psak_din_id')) db.exec(`CREATE INDEX IF NOT EXISTS "ix_${table}_psak" ON "${table}" ("psak_din_id")`);
  if (cols.includes('tractate') && cols.includes('daf')) db.exec(`CREATE INDEX IF NOT EXISTS "ix_${table}_daf" ON "${table}" ("tractate","daf")`);
  if (cols.includes('id')) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "ix_${table}_id" ON "${table}" ("id")`);

  console.log(`\r  ${table.padEnd(22)} ${written}`);
  summary.push([table, written, null]);
}

db.exec('PRAGMA optimize');
db.close();

// שער בטיחות: מראה חלקית לעולם לא תחליף מראה שלמה.
// ריצה אחת הצהירה 11 טבלאות ודרסה מראה של 18, ו-talmud_references נעלמה
// לגמרי מבלי שדבר ייעצר. ההשוואה היא מול הקיימת, ו-–-force עוקף.
if (skipped.length) console.warn(`
⚠ ${skipped.length} טבלאות קיימות ולא נקראו: ${skipped.join(', ')}`);
if (existsSync(DB_FILE) && !args.includes('--force')) {
  try {
    const old = new DatabaseSync(DB_FILE, { readOnly: true });
    const oldTables = old.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c;
    old.close();
    const newTables = summary.filter(([, n]) => n > 0).length;
    if (newTables < oldTables - 1) {
      console.error(`
❌ המראה החדשה חלקית: ${newTables} טבלאות מול ${oldTables} בקיימת.`);
      console.error(`   הקיימת לא נדרסה. החדשה המתינה ב-${TMP_FILE}`);
      console.error('   אם הצמצום מכוון — הרץ שוב עם --force');
      process.exit(1);
    }
  } catch { /* הקיימת פגומה בלאו הכי — מחליפים */ }
}

// החלפה אטומית: המראה הישנה נדרסת רק אחרי שהחדשה הושלמה.
// אם השרת המקומי פועל הוא מחזיק את הקובץ פתוח ווינדוס חוסם החלפה,
// ולכן עדיף להסביר מה לעשות מלהפיל עקבת קריסה.
try {
  if (existsSync(DB_FILE)) rmSync(DB_FILE);
  renameSync(TMP_FILE, DB_FILE);
} catch (e) {
  if (e.code === 'EPERM' || e.code === 'EBUSY') {
    console.error(`
❌ לא ניתן להחליף את ${DB_FILE} — הקובץ פתוח.`);
    console.error('   כנראה השרת המקומי פועל. עצור אותו והרץ שוב.');
    console.error(`   המראה החדשה מוכנה וממתינה: ${TMP_FILE}`);
    process.exit(1);
  }
  throw e;
}
for (const ext of ['-wal', '-shm']) {
  if (existsSync(TMP_FILE + ext)) { if (existsSync(DB_FILE + ext)) rmSync(DB_FILE + ext); renameSync(TMP_FILE + ext, DB_FILE + ext); }
}

const total = summary.reduce((s, [, n]) => s + n, 0);
console.log(`\n✅ ${total.toLocaleString('he-IL')} שורות ב-${summary.filter(([, n]) => n > 0).length} טבלאות`);
console.log(`   ${DB_FILE} — ${(statSync(DB_FILE).size / 1048576).toFixed(1)} מ"ב`);

if (VERIFY) {
  console.log('\n═══ אימות מול הענן ═══');
  const check = new DatabaseSync(DB_FILE);
  let bad = 0;
  for (const [table, n] of summary) {
    if (!n) continue;
    const { count } = await sb.from(table).select('*', { count: 'exact', head: true });
    const local = Object.values(check.prepare(`SELECT COUNT(*) c FROM "${table}"`).get())[0];
    const ok = count === local;
    if (!ok) bad++;
    console.log(`  ${ok ? '✔' : '✖'} ${table.padEnd(22)} ענן ${count} | מקומי ${local}`);
  }
  console.log(bad ? `\n⚠ ${bad} טבלאות אינן תואמות` : '\n✅ כל הטבלאות תואמות');
}
