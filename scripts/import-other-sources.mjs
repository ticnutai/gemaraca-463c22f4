#!/usr/bin/env node
/**
 * ייבוא מראי מקומות שאינם בבלי מאינדקס המקורות של psakim.org
 * ──────────────────────────────────────────────────────────
 * שולחן ערוך (סימן/סעיף), רמב"ם (פרק/הלכה) וירושלמי (פרק/הלכה).
 * אלה תיוגים ידניים של האתר — מדויקים, ובלי שום צורך ב-AI.
 * הבבלי מיובא בנפרד ל-talmud_references על ידי import-source-index-refs.mjs
 *
 * שימוש:
 *   node scripts/import-other-sources.mjs             # מדווח בלבד
 *   node scripts/import-other-sources.mjs --run       # מייבא למסד
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = process.argv.includes('--run');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);

// ── עץ המקורות ─────────────────────────────────────────────
const tree = JSON.parse(readFileSync(join(ROOT, 'public/psakim_sources_index.json'), 'utf8'));
const tagPath = {};
const walk = (node, path) => {
  const cur = [...path, node.text];
  tagPath[node.id] = cur;
  (node.children || []).forEach((c) => walk(c, cur));
};
(tree.children || []).forEach((r) => walk(r, []));

const tagMap = JSON.parse(readFileSync(join(ROOT, 'public/tag_psakim_map.json'), 'utf8'));

// שולחן ערוך: קורפוס ← חלק ← קבוצת סימנים ← סימן ← סעיף  (לעיתים בלי הסעיף)
// רמב"ם וירושלמי: קורפוס ← ספר ← פרק ← הלכה
function toSource(path) {
  const corpus = path[0];
  if (corpus === 'שולחן ערוך') {
    const [, book, group, section, subsection] = path;
    return { corpus, book, section_group: group ?? null, section: section ?? null, subsection: subsection ?? null };
  }
  const [, book, section, subsection] = path;
  return { corpus, book, section_group: null, section: section ?? null, subsection: subsection ?? null };
}

const display = (s) => [s.corpus, s.book, s.section, s.subsection].filter(Boolean).join(', ');

const bySiteId = new Map();
for (const [tagId, list] of Object.entries(tagMap)) {
  const path = tagPath[tagId];
  if (!path || path[0] === 'בבלי' || path.length < 3) continue;
  const src = toSource(path);
  for (const [psakId] of list) {
    const key = String(psakId);
    if (!bySiteId.has(key)) bySiteId.set(key, new Map());
    bySiteId.get(key).set(display(src), { ...src, raw_path: path.join(' ← ') });
  }
}

// ── מזהה באתר → כותרת → מזהה במסד ──────────────────────────
const dir = join(ROOT, 'all-psakim');
const titleBySiteId = new Map();
if (existsSync(dir)) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(join(dir, f), 'utf8');
    const id = (html.match(/File\/(\d+)"[^>]*target="_blank"/) || [])[1];
    if (!id) continue;
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
    if (title) titleBySiteId.set(id, title.replace(/ - אתר פסקי דין רבניים/, '').trim());
  }
}

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const psakim = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('psakei_din').select('id,title').range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  psakim.push(...data);
  if (data.length < 1000) break;
}
const norm = (s) => s.replace(/\s+/g, ' ').replace(/["״׳'`]/g, '').trim();
const idByTitle = new Map();
for (const p of psakim) {
  const k = norm(p.title || '');
  if (k && !idByTitle.has(k)) idByTitle.set(k, p.id);
}

// ── בניית השורות ───────────────────────────────────────────
const rows = [];
let unmatched = 0;
for (const [siteId, sources] of bySiteId) {
  const title = titleBySiteId.get(siteId);
  const psakId = title ? idByTitle.get(norm(title)) : undefined;
  if (!psakId) { unmatched++; continue; }
  for (const [disp, s] of sources) {
    rows.push({ psak_din_id: psakId, corpus: s.corpus, book: s.book ?? null, section_group: s.section_group,
      section: s.section, subsection: s.subsection, display: disp, raw_path: s.raw_path });
  }
}

const byCorpus = {};
rows.forEach((r) => { byCorpus[r.corpus] = (byCorpus[r.corpus] || 0) + 1; });
console.log(`פסקים באינדקס עם מקור שאינו בבלי: ${bySiteId.size} | לא נמצאו במסד: ${unmatched}`);
console.log(`שורות לייבוא: ${rows.length} (${new Set(rows.map((r) => r.psak_din_id)).size} פסקים)`);
console.log(`לפי קורפוס: ${JSON.stringify(byCorpus)}`);

if (!RUN) { console.log('\n(הרץ עם --run כדי לכתוב למסד)'); process.exit(0); }

let inserted = 0;
for (let i = 0; i < rows.length; i += 200) {
  const batch = rows.slice(i, i + 200);
  const { error } = await sb.from('psak_sources').upsert(batch, {
    onConflict: 'psak_din_id,display', ignoreDuplicates: true,
  });
  if (error) { console.error('❌', error.message); break; }
  inserted += batch.length;
  if (i % 1000 === 0) console.log(`  ${Math.min(i + 200, rows.length)}/${rows.length}`);
}
console.log(`✅ הוכנסו ${inserted} שורות`);
