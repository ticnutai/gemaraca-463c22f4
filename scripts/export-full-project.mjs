#!/usr/bin/env node
/**
 * ייצוא מלא: להקים את הפרויקט מאפס בסופהבייס אחר
 * ──────────────────────────────────────────────────────────
 * מה שנוצר תחת `export/`:
 *
 *   01_schema.sql     טבלאות, אילוצים, אינדקסים, טיפוסים, פונקציות,
 *                     טריגרים ומדיניות RLS — מה שבשרת עכשיו, לא מה
 *                     שכתוב בקובצי המיגרציה
 *   02_data/*.sql     כל השורות, טבלה לקובץ, כ-INSERT של פוסטגרס
 *   03_storage/       הקבצים מן הדליים
 *   README.md         סדר השחזור, ומה לעשות אם משהו נופל
 *
 * למה לא קובצי המיגרציה: הם נצברו לאורך הזמן, חלקם הורצו ידנית ולא כולם
 * משקפים את המצב. **מה שבשרת הוא האמת.** הסכימה נשלפת מ-information_schema
 * ומ-pg_catalog דרך `dump_schema.sql`, והנתונים מן המראה המקומית.
 *
 * שימוש:
 *   node scripts/export-full-project.mjs            הכול
 *   node scripts/export-full-project.mjs --no-storage   בלי הקבצים
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'export');
const MIRROR = join(ROOT, 'data', 'gemaraca-cloud.db');
const args = process.argv.slice(2);
const SKIP_STORAGE = args.includes('--no-storage');

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

// הורדת אלפי קבצים אורכת זמן ועלולה להיקטע. מחיקת התיקייה בכל הרצה הייתה
// מאלצת להתחיל מאפס ולאבד אלפים שכבר ירדו. עכשיו הסכימה והנתונים נכתבים
// מחדש בכל פעם (הם מהירים), והקבצים נמשכים מאיפה שהפסיקו. להתחלה נקייה — --fresh
if (args.includes('--fresh') && existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
if (existsSync(join(OUT, '02_data'))) rmSync(join(OUT, '02_data'), { recursive: true, force: true });
mkdirSync(join(OUT, '02_data'), { recursive: true });

// ── 1. הסכימה ───────────────────────────────────────────────
console.log('═══ הסכימה ═══');
const { data: snap, error: snapErr } = await sb.from('schema_snapshots')
  .select('snapshot,taken_at').order('taken_at', { ascending: false }).limit(1);
if (snapErr || !snap?.length) {
  console.error('❌ אין תמונת סכימה. הרץ קודם:');
  console.error('   node scripts/direct-run.mjs file "supabase/migrations/dump_schema.sql"');
  process.exit(1);
}
const S = snap[0].snapshot;

/** ציטוט מזהה. שם טבלה או עמודה יכול להתנגש במילה שמורה */
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** טיפוס העמודה כפי שכותבים אותו ב-CREATE TABLE */
function colType(c) {
  const t = c.data_type;
  if (t === 'USER-DEFINED') return q(c.udt_name);
  if (t === 'ARRAY') return `${c.udt_name.replace(/^_/, '')}[]`;
  if (t === 'character varying' && c.max_length) return `varchar(${c.max_length})`;
  if (t === 'numeric' && c.numeric_precision) return `numeric(${c.numeric_precision},${c.numeric_scale ?? 0})`;
  return t;
}

const byTable = new Map();
for (const c of S.columns ?? []) {
  if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
  byTable.get(c.table_name).push(c);
}

const lines = [];
lines.push('-- סכימת גמרא להלכה — נשלפה מן השרת החי');
lines.push(`-- ${snap[0].taken_at}`);
lines.push('--');
lines.push('-- הרצה על פרויקט סופהבייס חדש, לפי הסדר:');
lines.push('--   1. הקובץ הזה');
lines.push('--   2. קובצי 02_data לפי סדר אלפביתי');
lines.push('--   3. העלאת 03_storage לדליים');
lines.push('');
lines.push('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
lines.push('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
lines.push('');

// טיפוסים מותאמים — לפני הטבלאות שמשתמשות בהם
for (const e of S.enums ?? []) {
  lines.push(`DO $$ BEGIN
  CREATE TYPE public.${q(e.name)} AS ENUM (${(e.values ?? []).map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ')});
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
}
if (S.enums?.length) lines.push('');

// טבלאות
const pkByTable = new Map();
for (const c of S.constraints ?? []) {
  if (c.type === 'PRIMARY KEY') pkByTable.set(c.table_name, c);
}
for (const [table, cols] of [...byTable].sort()) {
  lines.push(`CREATE TABLE IF NOT EXISTS public.${q(table)} (`);
  const defs = cols.map((c) => {
    let d = `  ${q(c.column_name)} ${colType(c)}`;
    if (c.column_default !== null) d += ` DEFAULT ${c.column_default}`;
    if (c.is_nullable === 'NO') d += ' NOT NULL';
    return d;
  });
  lines.push(defs.join(',\n'));
  lines.push(');');
  lines.push('');
}

// אילוצים. מפתחות זרים אחרונים, כי הם דורשים שכל הטבלאות כבר קיימות
const order = { 'PRIMARY KEY': 0, UNIQUE: 1, CHECK: 2, 'FOREIGN KEY': 3 };
lines.push('-- אילוצים');
for (const c of [...(S.constraints ?? [])].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))) {
  // NOT NULL כבר נכתב בהגדרת העמודה
  if (/^CHECK \(\(.* IS NOT NULL\)\)$/.test(c.definition)) continue;
  lines.push(`ALTER TABLE public.${q(c.table_name)} ADD CONSTRAINT ${q(c.name)} ${c.definition};`);
}
lines.push('');

lines.push('-- אינדקסים');
for (const i of S.indexes ?? []) lines.push(`${i.definition};`);
lines.push('');

lines.push('-- פונקציות');
for (const f of S.functions ?? []) lines.push(`${f.definition};\n`);

lines.push('-- טריגרים');
for (const t of S.triggers ?? []) lines.push(`${t.definition};`);
lines.push('');

lines.push('-- אבטחת שורות. בלעדיה המסד החדש ייראה ריק לכל מי שאינו service_role');
for (const r of S.rls ?? []) {
  if (r.enabled) lines.push(`ALTER TABLE public.${q(r.table_name)} ENABLE ROW LEVEL SECURITY;`);
}
lines.push('');
for (const p of S.policies ?? []) {
  const roles = Array.isArray(p.roles) ? p.roles.join(', ') : String(p.roles ?? 'public').replace(/[{}]/g, '');
  let s = `CREATE POLICY ${q(p.name)} ON public.${q(p.table_name)}`;
  s += ` AS ${p.permissive === 'PERMISSIVE' ? 'PERMISSIVE' : 'RESTRICTIVE'}`;
  s += ` FOR ${p.command}`;
  s += ` TO ${roles}`;
  if (p.using) s += ` USING (${p.using})`;
  if (p.with_check) s += ` WITH CHECK (${p.with_check})`;
  lines.push(`${s};`);
}
lines.push('');
lines.push("NOTIFY pgrst, 'reload schema';");

writeFileSync(join(OUT, '01_schema.sql'), lines.join('\n'), 'utf8');
console.log(`  ✔ 01_schema.sql — ${byTable.size} טבלאות, ${S.constraints?.length ?? 0} אילוצים, ${S.policies?.length ?? 0} מדיניות`);

// ── 2. הנתונים ──────────────────────────────────────────────
console.log('\n═══ הנתונים ═══');
if (!existsSync(MIRROR)) {
  console.error('❌ אין מראה מקומית. הרץ: npm run local:mirror');
  process.exit(1);
}
const db = new DatabaseSync(MIRROR);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);

/** ערך לפוסטגרס. המראה שומרת JSON כמחרוזת ו-boolean כמספר */
function lit(v, col, table) {
  if (v === null || v === undefined) return 'NULL';
  const type = colTypeOf(table, col);
  if (typeof v === 'number') {
    if (type === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }
  const s = String(v);
  if (type === 'boolean') return /^(1|true|t)$/i.test(s) ? 'TRUE' : 'FALSE';
  // json/jsonb ומערכים נשמרו כמחרוזת JSON ועוברים כמחרוזת מצוטטת
  return `'${s.replace(/'/g, "''")}'`;
}
const typeCache = new Map();
function colTypeOf(table, col) {
  const k = `${table}.${col}`;
  if (typeCache.has(k)) return typeCache.get(k);
  const c = (S.columns ?? []).find((x) => x.table_name === table && x.column_name === col);
  const t = c ? (c.data_type === 'ARRAY' ? 'array' : c.data_type) : 'text';
  typeCache.set(k, t);
  return t;
}

let totalRows = 0;
const manifest = [];
for (const table of tables) {
  const count = Object.values(db.prepare(`SELECT COUNT(*) c FROM "${table}"`).get())[0];
  if (!count) continue;
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
  const file = join(OUT, '02_data', `${table}.sql`);
  const out = createWriteStream(file, { encoding: 'utf8' });
  out.write(`-- ${table} — ${count} שורות\n`);
  out.write('BEGIN;\n');
  const colList = cols.map(q).join(', ');
  const PAGE = 200;
  for (let off = 0; off < count; off += PAGE) {
    const rows = db.prepare(`SELECT * FROM "${table}" LIMIT ${PAGE} OFFSET ${off}`).all();
    const values = rows.map((r) => `(${cols.map((c) => lit(r[c], c, table)).join(', ')})`);
    // ON CONFLICT DO NOTHING — כדי שהרצה חוזרת לא תיפול
    out.write(`INSERT INTO public.${q(table)} (${colList}) VALUES\n${values.join(',\n')}\nON CONFLICT DO NOTHING;\n`);
  }
  out.write('COMMIT;\n');
  out.end();
  totalRows += count;
  manifest.push({ table, rows: count });
  console.log(`  ✔ ${table.padEnd(26)} ${count}`);
}
console.log(`  ─────\n  ${totalRows.toLocaleString('he-IL')} שורות ב-${manifest.length} טבלאות`);

// ── 3. הקבצים מן האחסון ─────────────────────────────────────
const buckets = [];
if (!SKIP_STORAGE) {
  console.log('\n═══ האחסון ═══');
  // `listBuckets` דורש מפתח service_role שאין לנו ומחזיר רשימה ריקה,
  // אבל גישה ישירה לדלי לפי שם כן עובדת. השמות נגזרים מן
  // הכתובות שבמסד — אלה הדליים שהאפליקציה באמת משתמשת בהם.
  // ארבעת הדליים של הפרויקט. הרשימה מפורשת כי `listBuckets` דורש
  // service_role ומחזיר ריק בלי שגיאה, וגזירה מן הכתובות שבמסד
  // מחזירה את psakei-din-files בלבד — שלושה האחרים אינם מופיעים שם.
  // system-backups אינו ציבורי והוא דווקא החשוב — שם יושבים גיבויי הענן.
  const names = new Set(['psakei-din-files', 'user-books', 'shas-pdf-pages', 'system-backups']);
  const { data: bks } = await sb.storage.listBuckets();
  for (const b of bks ?? []) names.add(b.name);
  for (const r of db.prepare("SELECT DISTINCT source_url u FROM psakei_din WHERE source_url LIKE '%storage/v1%'").all()) {
    const m = String(r.u).match(/storage\/v1\/object\/(?:public\/)?([^/]+)\//);
    if (m) names.add(m[1]);
  }
  if (!names.size) console.warn('  ⚠ לא זוהה אף דלי');
  for (const b of [...names].map((name) => ({ name, public: true }))) {
    const dir = join(OUT, '03_storage', b.name);
    mkdirSync(dir, { recursive: true });
    let got = 0, failed = 0;
    // שני מקורות לרשימת הקבצים, והאיחוד ביניהם:
    //
    //   1. `list()` — מחזיר לכל היותר אלף פריטים לכל קריאה, ולכן חייב עימוד.
    //      בלעדיו ירדו 1,767 קבצים מתוך כ-2,800 **בלי שום שגיאה**.
    //   2. הכתובות שבמסד — אלה הקבצים שהאפליקציה באמת מצביעה אליהם, וזו
    //      הרשימה שחייבת לרדת במלואה גם אם הסריקה מפספסת.
    const paths = new Set();

    const walk = async (prefix) => {
      for (let offset = 0; ; offset += 1000) {
        const { data: items, error } = await sb.storage.from(b.name)
          .list(prefix, { limit: 1000, offset });
        if (error || !items?.length) break;
        for (const it of items) {
          const path = prefix ? `${prefix}/${it.name}` : it.name;
          if (!it.id) await walk(path);        // תיקייה
          else paths.add(path);
        }
        if (items.length < 1000) break;
      }
    };
    try { await walk(''); } catch (e) { console.warn(`  ⚠ סריקת ${b.name}: ${e.message}`); }
    const listed = paths.size;

    for (const r of db.prepare("SELECT DISTINCT source_url u FROM psakei_din WHERE source_url LIKE '%storage/v1%'").all()) {
      const m = decodeURIComponent(String(r.u)).match(/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/);
      if (m && m[1] === b.name) paths.add(m[2]);
    }
    console.log(`  … ${b.name}: ${listed} מסריקה, ${paths.size} אחרי איחוד עם המסד`);

    // הנתיב נשמר בדיוק כפי שהוא בענן, כולל תיקיות משנה. שיטוח השמות
    // ל-`a__b` שבר את הקישורים: הכתובות במסד מצביעות על `a/b`, ובהעלאה
    // חזרה הקובץ לא נמצא. מה שכבר ירד בהרצה קודמת אינו יורד שוב.
    let skipped = 0;
    for (const path of paths) {
      const target = join(dir, ...path.split('/'));
      if (existsSync(target)) { skipped++; got++; continue; }
      const { data: blob, error } = await sb.storage.from(b.name).download(path);
      if (error || !blob) { failed++; continue; }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(await blob.arrayBuffer()));
      got++;
      if (got % 250 === 0) process.stdout.write(`\r  … ${got}/${paths.size} קבצים     `);
    }
    if (skipped) console.log(`  … ${b.name}: ${skipped} כבר היו            `);
    buckets.push({ name: b.name, public: b.public, files: got, failed });
    console.log(`  ✔ ${b.name.padEnd(22)} ${got} קבצים${failed ? ` (${failed} נכשלו)` : ''}`);
  }
}

// ── 4. הוראות ───────────────────────────────────────────────
const readme = `# ייצוא מלא — גמרא להלכה

נוצר: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}
מקור: ${env.VITE_SUPABASE_URL}

## מה יש כאן

| | |
|---|---|
| \`01_schema.sql\` | ${byTable.size} טבלאות · ${S.constraints?.length ?? 0} אילוצים · ${S.indexes?.length ?? 0} אינדקסים · ${S.policies?.length ?? 0} מדיניות RLS · ${S.functions?.length ?? 0} פונקציות · ${S.triggers?.length ?? 0} טריגרים |
| \`02_data/\` | ${totalRows.toLocaleString('he-IL')} שורות ב-${manifest.length} קבצים |
| \`03_storage/\` | ${buckets.reduce((s, b) => s + b.files, 0)} קבצים ב-${buckets.length} דליים |

הסכימה נשלפה **מן השרת החי** ולא מקובצי המיגרציה. הם נצברו לאורך הזמן,
חלקם הורצו ידנית, ולא כולם משקפים את המצב בפועל.

## שחזור בפרויקט סופהבייס חדש

### 1. הסכימה
ב-SQL Editor של הפרויקט החדש, הרץ את \`01_schema.sql\` במלואו.
אם אילוץ מפתח זר נופל — הרץ אותו שוב; הטבלאות נוצרות לפי סדר אלפביתי
ולא לפי סדר התלות, והריצה השנייה משלימה.

### 2. הנתונים
קובץ לכל טבלה, ואפשר להריץ בכל סדר: כל ה-INSERT נושאים
\`ON CONFLICT DO NOTHING\`, כך שהרצה חוזרת אינה מכפילה ואינה נופלת.

הגדולים הם \`psakei_din\` ו-\`talmud_references\`, וייתכן שיהיה צורך לפצל
אותם אם עורך ה-SQL מגביל את גודל ההדבקה. לחלופין דרך psql:

\`\`\`bash
for f in 02_data/*.sql; do psql "$DATABASE_URL" -f "$f"; done
\`\`\`

### 3. האחסון
${buckets.map((b) => `- דלי \`${b.name}\`${b.public ? ' (ציבורי)' : ''} — ${b.files} קבצים`).join('\n') || '- אין'}

הנתיבים נשמרים בדיוק כמו בענן, כולל תיקיות משנה, כדי שה-\`source_url\`
שבמסד יתאים לקובץ בהעלאה חזרה.

### 4. חיבור האפליקציה
ב-\`.env\`:
\`\`\`
VITE_SUPABASE_URL=https://<הפרויקט החדש>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<המפתח הציבורי>
\`\`\`

### 5. אימות
\`\`\`sql
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;
\`\`\`
הספירות המקוריות:

${manifest.sort((a, b) => b.rows - a.rows).slice(0, 15).map((m) => `| ${m.table} | ${m.rows.toLocaleString('he-IL')} |`).join('\n')}

## מה **אינו** כאן

- **משתמשים וסיסמאות** (\`auth.users\`) — אינם נגישים במפתח הציבורי.
  יש ליצור את משתמש המנהל מחדש ולעדכן את \`.env.migrations.local\`.
- **פונקציות הקצה** — הן בקוד, תחת \`supabase/functions/\`, ונפרסות בנפרד.
- **סודות** — יש להגדיר מחדש בפרויקט החדש.

## הקוד

כל הקוד בגיט, בשני מרוחקים:
- https://github.com/ticnutai/gemaraca-463c22f4
- https://github.com/ticnutai/gemaraca-f1e59e63

והנתונים הגולמיים שמהם אפשר לבנות הכול מחדש — \`scripts/data/\`,
כ-419 מ"ב, **אינם בגיט**.
`;
writeFileSync(join(OUT, 'README.md'), readme, 'utf8');
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  created: new Date().toISOString(), source: env.VITE_SUPABASE_URL,
  tables: manifest, buckets, schema: {
    tables: byTable.size, constraints: S.constraints?.length ?? 0,
    indexes: S.indexes?.length ?? 0, policies: S.policies?.length ?? 0,
    functions: S.functions?.length ?? 0, triggers: S.triggers?.length ?? 0,
  },
}, null, 2), 'utf8');

console.log(`\n✅ הייצוא מוכן: ${OUT}`);
console.log(`   ${byTable.size} טבלאות · ${totalRows.toLocaleString('he-IL')} שורות · ${buckets.reduce((s, b) => s + b.files, 0)} קבצים`);
