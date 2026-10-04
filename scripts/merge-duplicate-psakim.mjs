#!/usr/bin/env node
/**
 * איחוד פסקים כפולים
 * ──────────────────────────────────────────────────────────
 * אותו פסק נכנס למסד כמה פעמים: פעם מ-gov.il, פעם מדעת, ופעמים אחדות
 * מהעלאה ידנית של אותו קובץ. כל אחד תמלל אחרת, ולכן טביעת אצבע של תוכן
 * מזהה רק חלק קטן מהם — המפתח הוא כותרת מנורמלת.
 *
 * המיזוג **מרוויח** מראי מקומות ואינו מוחק אותם: ההפניות והמקורות של כל
 * הכפילויות עוברים לשורה אחת, והמטא-דאטה החסרה מושלמת מן האחרות.
 *
 * מי נשאר: הטקסט הארוך ביותר. פסק מתומלל במלואו עדיף על גרסה חלקית.
 *
 * זהירות: כותרת גנרית כמו "חיוב גט וכתובה" חוזרת בפסקים שונים לגמרי, ולכן
 * נדרשת **גם** הסכמה על השנה או על מספר התיק. קבוצה שאין בה הסכמה כזו
 * מדווחת ואינה מאוחדת.
 *
 * שימוש:
 *   node scripts/merge-duplicate-psakim.mjs --dry-run
 *   node scripts/merge-duplicate-psakim.mjs --sample 10     עשר קבוצות לעיון
 *   node scripts/merge-duplicate-psakim.mjs [--limit 50]
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const num = (f) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : null; };
const SAMPLE = num('--sample');
const LIMIT = num('--limit') ?? Infinity;

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const db = new DatabaseSync(join(ROOT, 'data', 'gemaraca-cloud.db'));
const titleKey = (t) => String(t ?? '').replace(/[^א-ת0-9]/g, '');

const psakim = db.prepare(`SELECT id, title, court, case_number, year, source_key, source_url,
    LENGTH(TRIM(COALESCE(original_text, full_text, ''))) len
  FROM psakei_din`).all();
const refCount = Object.fromEntries(db.prepare(
  'SELECT psak_din_id p, COUNT(*) c FROM talmud_references GROUP BY p').all().map((r) => [r.p, r.c]));
const srcCount = Object.fromEntries(db.prepare(
  'SELECT psak_din_id p, COUNT(*) c FROM psak_sources GROUP BY p').all().map((r) => [r.p, r.c]));

// ── קיבוץ ───────────────────────────────────────────────────
const groups = new Map();
for (const p of psakim) {
  const k = titleKey(p.title);
  if (k.length < 15) continue;             // כותרת קצרה אינה מפתח אמין
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(p);
}

const merges = [], unsure = [];
for (const grp of groups.values()) {
  if (grp.length < 2) continue;
  // אישור שהקבוצה היא באמת אותו פסק. הגרסה הראשונה סמכה על `cases.size === 1`,
  // וזה היה פגם: מספר תיק שקיים **בשורה אחת בלבד** נתן קבוצה של אחד ונספר
  // כהסכמה. כך קבוצה שהשנים בה 2025 מול 2018 סומנה כמאושרת, והיא הייתה
  // ממזגת שני פסקים שונים. הסכמה דורשת לפחות שתי שורות שמסכימות ביניהן.
  const yearList = grp.map((p) => p.year).filter(Boolean);
  const caseList = grp.map((p) => String(p.case_number ?? '').replace(/\D/g, '')).filter((s) => s.length > 3);
  const years = new Set(yearList);
  const cases = new Set(caseList);
  const sources = new Set(grp.map((p) => p.source_key));

  // שנים סותרות פוסלות תמיד, גם אם מספר התיק מסכים
  const yearsAgree = years.size <= 1;
  // מספר תיק זהה בשתי שורות לפחות
  const casesAgree = caseList.length >= 2 && cases.size === 1;
  // אותו קובץ שהועלה שוב ושוב: כולם מ-upload, ואין שנים סותרות
  const sameUpload = sources.size === 1 && sources.has('upload') && yearsAgree;
  const confirmed = (yearsAgree && (caseList.length < 2 || casesAgree)) || casesAgree || sameUpload;
  const keep = grp.reduce((a, b) => (b.len > a.len ? b : a));
  const drop = grp.filter((p) => p.id !== keep.id);
  const entry = { keep, drop, years: [...years], cases: [...cases], sources: [...sources],
    refsMoved: drop.reduce((s, p) => s + (refCount[p.id] ?? 0), 0),
    srcsMoved: drop.reduce((s, p) => s + (srcCount[p.id] ?? 0), 0) };
  (confirmed ? merges : unsure).push(entry);
}

console.log(`קבוצות כפילות: ${merges.length + unsure.length}`);
console.log(`  ✔ מאושרות לאיחוד: ${merges.length} (${merges.reduce((s, m) => s + m.drop.length, 0)} שורות)`);
console.log(`  ⚠ ללא הסכמה על שנה/תיק: ${unsure.length} — אינן מאוחדות`);
console.log(`  מראי מקומות שיעברו: ${merges.reduce((s, m) => s + m.refsMoved, 0)}`);
console.log(`  מקורות שיעברו:      ${merges.reduce((s, m) => s + m.srcsMoved, 0)}`);

if (SAMPLE) {
  console.log(`\n═══ ${SAMPLE} קבוצות לעיון ═══`);
  for (const m of merges.slice(0, SAMPLE)) {
    console.log(`\n"${String(m.keep.title).slice(0, 58)}"`);
    console.log(`   נשאר: ${m.keep.source_key} | ${m.keep.len} תווים | שנה ${m.keep.year ?? '—'} | תיק ${m.keep.case_number ?? '—'} | ${refCount[m.keep.id] ?? 0} הפניות`);
    for (const d of m.drop)
      console.log(`   מוסר: ${d.source_key} | ${d.len} תווים | שנה ${d.year ?? '—'} | תיק ${d.case_number ?? '—'} | ${refCount[d.id] ?? 0} הפניות`);
  }
  process.exit(0);
}

if (unsure.length) {
  const out = join(ROOT, 'scripts', 'data', `duplicates-unsure-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(out, JSON.stringify(unsure.map((u) => ({
    title: u.keep.title, years: u.years, sources: u.sources,
    rows: [u.keep, ...u.drop].map((p) => ({ id: p.id, source: p.source_key, year: p.year, len: p.len })),
  })), null, 2), 'utf8');
  console.log(`  הלא-מאושרות נשמרו לעיון: ${out}`);
}

if (DRY) { console.log('\n(--dry-run: לא נכתב כלום)'); process.exit(0); }

let merged = 0, movedRefs = 0, movedSrcs = 0, failed = 0;
for (const m of merges.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
  const dropIds = m.drop.map((p) => p.id);
  try {
    // 1. העברת ההפניות, בלי ליצור כפילות על אותו צמד דף־עמוד
    const { data: existing } = await sb.from('talmud_references')
      .select('tractate,daf,amud').eq('psak_din_id', m.keep.id);
    const have = new Set((existing ?? []).map((r) => `${r.tractate}|${Number(r.daf)}|${r.amud ?? ''}`));
    const { data: incoming } = await sb.from('talmud_references').select('*').in('psak_din_id', dropIds);
    for (const r of incoming ?? []) {
      const k = `${r.tractate}|${Number(r.daf)}|${r.amud ?? ''}`;
      if (have.has(k)) continue;
      have.add(k);
      const { id, psak_din_id, ...rest } = r;
      const { error } = await sb.from('talmud_references').insert({ ...rest, psak_din_id: m.keep.id });
      if (!error) movedRefs++;
    }
    // 2. העברת המקורות
    const { data: exSrc } = await sb.from('psak_sources').select('display').eq('psak_din_id', m.keep.id);
    const haveSrc = new Set((exSrc ?? []).map((s) => s.display));
    const { data: inSrc } = await sb.from('psak_sources').select('*').in('psak_din_id', dropIds);
    for (const s of inSrc ?? []) {
      if (haveSrc.has(s.display)) continue;
      haveSrc.add(s.display);
      const { id, psak_din_id, ...rest } = s;
      const { error } = await sb.from('psak_sources').insert({ ...rest, psak_din_id: m.keep.id });
      if (!error) movedSrcs++;
    }
    // 3. השלמת מטא-דאטה חסרה בשורה שנשארת
    const patch = {};
    for (const d of m.drop) {
      if (!m.keep.case_number && d.case_number) patch.case_number = d.case_number;
      if (!m.keep.year && d.year) patch.year = d.year;
      if ((!m.keep.court || m.keep.court === 'לא צוין') && d.court && d.court !== 'לא צוין') patch.court = d.court;
    }
    if (Object.keys(patch).length) await sb.from('psakei_din').update(patch).eq('id', m.keep.id);

    // 4. מחיקת הכפילויות — אחרי שהכול עבר
    const { error: delErr } = await sb.from('psakei_din').delete().in('id', dropIds);
    if (delErr) { failed++; console.error(`❌ ${String(m.keep.title).slice(0, 40)}: ${delErr.message}`); continue; }
    merged += dropIds.length;
  } catch (e) {
    failed++;
    console.error(`❌ ${String(m.keep.title).slice(0, 40)}: ${e.message}`);
  }
  if ((merged + failed) % 25 === 0) console.log(`  ${merged} שורות אוחדו…`);
}
console.log(`\n✅ ${merged} שורות כפולות אוחדו | ${movedRefs} מראי מקומות ו-${movedSrcs} מקורות עברו | ${failed} כשלונות`);
