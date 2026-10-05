#!/usr/bin/env node
/**
 * טעינת כל נתוני האתר לפרויקט הסופאבייס החדש
 * ──────────────────────────────────────────────────────────────────────────
 * המקור: שתי המראות המקומיות שבתיקיית data/. הראשונה הושלמה אבל נלקחה
 * לפני שסיים קציר "עין משפט"; השנייה (.building) נקטעה באמצע פסקי הדין
 * אבל מחזיקה את עין משפט במלואו. לכן לכל טבלה נבחרת המראה שבה יש יותר
 * שורות — כך לא מאבדים כלום מאף אחת מהן.
 *
 * הכתיבה דרך ה-API הציבורי, מחוברים כמנהל. הטריגרים עדיין לא קיימים
 * בפרויקט החדש בכוונה: טריגר updated_at היה דורס את התאריכים המקוריים.
 *
 * שימוש:
 *   node scripts/newdb/load-data.mjs --dry-run
 *   node scripts/newdb/load-data.mjs
 *   node scripts/newdb/load-data.mjs --only psakei_din,talmud_references
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { ROOT, NEW_URL, NEW_KEY, ADMIN_EMAIL, ADMIN_PASSWORD } from './env.mjs';

const DRY = process.argv.includes('--dry-run');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(',')) : null;

// ── סדר הכתיבה: האב לפני הבנים, אחרת מפתח זר נשבר ──────────────────────────
const ORDER = [
  'psak_source_registry', 'folder_categories', 'gemara_pages', 'modern_examples',
  'shas_download_progress', 'shas_pdf_pages', 'schema_snapshots', 'server_diagnostics',
  'text_annotations', 'ein_mishpat',
  'psakei_din',
  'talmud_references', 'psak_sources', 'psak_sections', 'pattern_sugya_links',
  'smart_index_results', 'sugya_psak_links', 'faq_items',
  'migration_history', 'data_backups',
];

// טבלאות שלא עוברות: תלויות במשתמשים שלא קיימים בפרויקט החדש
const SKIP = new Set(['user_roles', 'user_preferences', 'upload_sessions',
  'page_typography_settings', 'user_pinned_items', 'user_prompt_templates',
  'gemara_edit_snapshots', 'function_logs', 'data_restores', 'psakim', 'sqlite_stat1']);

// עמודות שבמסד הן jsonb או מערך — ב-SQLite הן טקסט ויש להחזיר אותן לאובייקט
const JSONCOL = {
  data_backups: ['tables', 'buckets', 'topics'],
  gemara_pages: ['text_he', 'text_en', 'categories'],
  modern_examples: ['examples'],
  psakei_din: ['tags'],
  schema_snapshots: ['snapshot'],
  server_diagnostics: ['report'],
  shas_download_progress: ['errors'],
  smart_index_results: ['sources', 'topics', 'masechtot', 'books'],
  talmud_references: ['confidence_factors'],
  text_annotations: ['styles'],
};
const BOOLCOL = { psak_source_registry: ['enabled'], smart_index_results: ['has_full_text'] };
// עמודות מחושבות או כאלה שמצביעות על משתמש שלא קיים
const DROPCOL = {
  shas_pdf_pages: ['pdf_url'],
  data_backups: ['created_by'],
  migration_history: ['executed_by'],
};

// ── המראות ──────────────────────────────────────────────────────────────────
const SOURCES = ['data/gemaraca-cloud.db', 'data/gemaraca-cloud.db.building']
  .map((p) => join(ROOT, p)).filter(existsSync)
  .map((p) => ({ path: p, db: new DatabaseSync(p, { readOnly: true }) }));
if (!SOURCES.length) { console.error('❌ לא נמצאה מראה מקומית בתיקיית data/'); process.exit(1); }

function tablesOf(db) {
  return new Map(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    .map((r) => [r.name, db.prepare(`SELECT count(*) c FROM "${r.name}"`).get().c]));
}
const maps = SOURCES.map((s) => ({ ...s, tables: tablesOf(s.db) }));

/** המראה שבה הטבלה מלאה יותר */
function bestSource(table) {
  let best = null;
  for (const m of maps) {
    const n = m.tables.get(table);
    if (n === undefined) continue;
    if (!best || n > best.n) best = { db: m.db, n, path: m.path };
  }
  return best;
}

// ── חיבור ───────────────────────────────────────────────────────────────────
const sb = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false, autoRefreshToken: true } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

function convert(table, row) {
  const out = {};
  const js = new Set(JSONCOL[table] || []);
  const bo = new Set(BOOLCOL[table] || []);
  const drop = new Set(DROPCOL[table] || []);
  for (const [k, v] of Object.entries(row)) {
    if (drop.has(k)) continue;
    if (v === null || v === undefined) { out[k] = null; continue; }
    if (js.has(k)) { try { out[k] = JSON.parse(v); } catch { out[k] = v; } continue; }
    if (bo.has(k)) { out[k] = v === 1 || v === true || v === '1' || v === 'true'; continue; }
    out[k] = v;
  }
  return out;
}

const PK = { psak_source_registry: 'key', masechtot_daf_limits: 'name' };

async function existingKeys(table, key) {
  const seen = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(key).range(from, from + 999);
    if (error) throw new Error(error.message);
    data.forEach((r) => seen.add(String(r[key])));
    if (data.length < 1000) break;
  }
  return seen;
}

const report = [];
for (const table of ORDER) {
  if (SKIP.has(table) || (ONLY && !ONLY.has(table))) continue;
  const src = bestSource(table);
  if (!src) { report.push([table, 0, 0, 'אין במראה']); continue; }

  const key = PK[table] || 'id';
  let have;
  try { have = await existingKeys(table, key); }
  catch (e) { report.push([table, src.n, 0, `קריאה נכשלה: ${e.message}`]); continue; }

  const rows = src.db.prepare(`SELECT * FROM "${table}"`).all()
    .map((r) => convert(table, r))
    .filter((r) => !have.has(String(r[key])));

  process.stdout.write(`${table}: ${src.n} במקור, ${have.size} קיימות, ${rows.length} להוספה`);
  if (DRY || !rows.length) { console.log(DRY ? ' (יובש)' : ' ✓'); report.push([table, src.n, 0, 'דילוג']); continue; }

  let done = 0, failed = 0, firstErr = '';
  const BATCH = table === 'psakei_din' || table === 'gemara_pages' ? 100 : 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    let ok = false;
    for (let a = 0; a < 4 && !ok; a++) {
      const { error } = await sb.from(table).insert(chunk);
      if (!error) { ok = true; break; }
      if (/fetch failed|ECONNRESET|socket hang up|timeout|network|ETIMEDOUT/i.test(error.message)) {
        await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
        continue;
      }
      firstErr ||= error.message;
      break;
    }
    if (ok) done += chunk.length; else failed += chunk.length;
    process.stdout.write(`\r${table}: ${done}/${rows.length} נכתבו${failed ? `, ${failed} נכשלו` : ''}      `);
  }
  console.log('');
  if (firstErr) console.log(`   ⚠️ ${firstErr}`);
  report.push([table, src.n, done, failed ? `${failed} נכשלו: ${firstErr}` : 'הושלם']);
}

console.log('\n── סיכום ──────────────────────────────────');
for (const [t, src, done, note] of report) {
  console.log(`${t.padEnd(24)} מקור ${String(src).padStart(6)}  נכתבו ${String(done).padStart(6)}  ${note}`);
}
