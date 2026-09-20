#!/usr/bin/env node
/**
 * איחוד פסקי דין כפולים
 * ──────────────────────────────────────────────────────────
 * שני פסקים נחשבים זהים אם הטקסט שלהם, אחרי הסרת תגיות ורווחים
 * כפולים, נותן את אותה חתימה. במקרה כזה נשמרת הרשומה העשירה ביותר
 * (הכי הרבה מראי מקומות, ואז הטקסט הארוך ביותר), וכל מה שמקושר
 * לשאר — מראי מקומות, מקורות, סעיפים, קישורי סוגיה — מועבר אליה
 * לפני המחיקה.
 *
 * שימוש:
 *   node scripts/dedupe-psakim.mjs             # דוח בלבד
 *   node scripts/dedupe-psakim.mjs --run       # מאחד באמת
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = process.argv.includes('--run');
const OUT_SQL = join(ROOT, 'scripts', 'data', 'DATA_dedupe_psakim.sql');

// טבלאות שמצביעות על פסק דין ושיש להעביר לפני מחיקה
// [טבלה, עמודה, עמודות נוספות באילוץ הייחודיות]
// כשיש אילוץ ייחודיות, שורה שתתנגש עם מה שכבר קיים אצל הפסק הנשמר נמחקת במקום לעבור
const CHILD_TABLES = [
  ['talmud_references', 'psak_din_id', []],
  ['psak_sources', 'psak_din_id', ['display']],
  ['psak_sections', 'psak_din_id', []],
  ['sugya_psak_links', 'psak_din_id', ['sugya_id']],
  ['pattern_sugya_links', 'psak_din_id', []],
  ['smart_index_results', 'psak_din_id', ['__row__']],
  ['faq_items', 'psak_din_id', []],
];

const sql = `
-- החתימה מתעלמת מתגיות HTML ומרווחים כפולים
WITH norm AS (
  SELECT id, title,
         md5(regexp_replace(regexp_replace(coalesce(full_text,''), '<[^>]+>', ' ', 'g'), '\\s+', ' ', 'g')) AS h,
         length(coalesce(full_text,'')) AS len,
         created_at
    FROM public.psakei_din
   WHERE length(coalesce(full_text,'')) > 200
), grouped AS (
  SELECT h, count(*) AS n FROM norm GROUP BY h HAVING count(*) > 1
), ranked AS (
  SELECT n.id, n.h, n.title, n.len,
         (SELECT count(*) FROM public.talmud_references r WHERE r.psak_din_id = n.id) AS refs,
         row_number() OVER (
           PARTITION BY n.h
           ORDER BY (SELECT count(*) FROM public.talmud_references r WHERE r.psak_din_id = n.id) DESC,
                    n.len DESC, n.created_at ASC
         ) AS rn
    FROM norm n JOIN grouped g ON g.h = n.h
)
SELECT json_agg(json_build_object('h', h, 'keep', keep_id, 'drop', drop_ids, 'title', title, 'n', n)) AS groups
  FROM (
    SELECT h,
           max(title) FILTER (WHERE rn = 1) AS title,
           max(id::text) FILTER (WHERE rn = 1) AS keep_id,
           array_agg(id::text) FILTER (WHERE rn > 1) AS drop_ids,
           count(*)::int AS n
      FROM ranked GROUP BY h
  ) x`;

function runSql(query) {
  const tmp = join(ROOT, 'scripts', 'data', '_query.sql');
  writeFileSync(tmp, query, 'utf8');
  const out = execFileSync('node', ['scripts/direct-run.mjs', 'sql', query], { cwd: ROOT }).toString();
  return out;
}

// שולפים את הקבוצות דרך ה-Edge Function של המיגרציות (מחזיר JSON)
const groupsJson = execFileSync('node', ['-e', `
  import('fs').then(async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('scripts/direct-run.mjs', 'utf8');
    const env = Object.fromEntries(readFileSync('.env','utf8').split(/\\r?\\n/)
      .map(l => l.match(/^([A-Z_]+)="?([^"\\r]*)"?$/)).filter(Boolean).map(m => [m[1], m[2]]));
    const local = Object.fromEntries(readFileSync('.env.migrations.local','utf8').split(/\\r?\\n/)
      .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
    const tok = await (await fetch(env.VITE_SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: local.MIGRATION_ADMIN_EMAIL, password: local.MIGRATION_ADMIN_PASSWORD }) })).json();
    const r = await fetch(env.VITE_SUPABASE_URL + '/functions/v1/run-migration', {
      method: 'POST', headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + tok.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'execute', name: 'dedupe-scan', sql: ${JSON.stringify(sql)} }) });
    const j = await r.json();
    if (!j.success) { console.error(j.error); process.exit(1); }
    process.stdout.write(JSON.stringify(j.result?.[0]?.groups ?? []));
  });
`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();

const groups = JSON.parse(groupsJson || '[]');
const dropCount = groups.reduce((s, g) => s + (g.drop?.length ?? 0), 0);
console.log(`קבוצות כפילות: ${groups.length} | רשומות למחיקה: ${dropCount}`);
groups.slice(0, 5).forEach((g) => console.log(`  ${g.n} עותקים: ${String(g.title).slice(0, 55)}`));

if (!dropCount) { console.log('אין מה לאחד.'); process.exit(0); }

// בונים SQL שמעביר את הילדים ואז מוחק
const parts = ['BEGIN;'];
for (const g of groups) {
  for (const dropId of g.drop ?? []) {
    for (const [table, col, uniqueWith] of CHILD_TABLES) {
      if (uniqueWith.length) {
        const match = uniqueWith[0] === '__row__'
          ? `` // ייחודיות על הפסק בלבד: מספיק שקיימת שורה אצל הנשמר
          : ` AND k.${uniqueWith[0]} = d.${uniqueWith[0]}`;
        parts.push(`DELETE FROM public.${table} d WHERE d.${col} = '${dropId}' AND EXISTS (SELECT 1 FROM public.${table} k WHERE k.${col} = '${g.keep}'${match});`);
      }
      parts.push(`UPDATE public.${table} SET ${col} = '${g.keep}' WHERE ${col} = '${dropId}';`);
    }
    parts.push(`DELETE FROM public.psakei_din WHERE id = '${dropId}';`);
  }
}
parts.push('COMMIT;');
writeFileSync(OUT_SQL, parts.join('\n'), 'utf8');
console.log(`📄 נכתב: ${OUT_SQL}`);

if (!RUN) { console.log('(הרץ עם --run כדי לאחד)'); process.exit(0); }
execFileSync('node', ['scripts/direct-run.mjs', 'file', OUT_SQL], { cwd: ROOT, stdio: 'inherit' });
