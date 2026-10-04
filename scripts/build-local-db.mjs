#!/usr/bin/env node
/**
 * בניית מסד הנתונים המקומי מן הקאשים הגולמיים
 * ──────────────────────────────────────────────────────────
 * למה זה קיים: מסד הענן נעלם — הכתובת שלו אינה נפתרת עוד ב-DNS, והגיבוי
 * האחרון נשמר **בתוך אותו פרויקט**, ולכן הלך איתו. מה שנשאר הם הקאשים
 * הגולמיים שבדיסק, 419 מ"ב, ומהם אפשר לבנות את הכול מחדש.
 *
 * זה לא רק שחזור. מכאן ואילך המסד המקומי הוא המקור, והענן — אם יחזור — הוא
 * יעד הסנכרון. קובץ אחד, `data/gemaraca.db`, שאפשר להעתיק, לגבות ולשחזר.
 *
 * הקאשים והמבנה המשותף שלהם (url, title, court, caseNumber, date, year,
 * judges, summary, text):
 *
 *   psakim_org  2,509  + עץ מקורות מתויג ביד, ברמת עמוד
 *   govil       3,323  + הערות שוליים, שם יושבים מראי המקומות
 *   daat        2,594
 *   bdmz           28
 *   bethdin        25
 *
 * שלושה דברים נעשים כאן נכון מן ההתחלה, במקום לתקן אחר כך:
 *
 *   1. **כפילויות** — אותו פסק הגיע משלושה אתרים, וכל אחד תמלל אחרת. לכן
 *      טביעת אצבע של תוכן אינה תופסת אותם. ההתאמה היא לפי כותרת מנורמלת
 *      ושנה, ושומרים את הטקסט הארוך ביותר ומאחדים את ההפניות.
 *
 *   2. **מפתח אתר פסקים** — העץ המתויג נכנס כהפניות, עם סיווג הראיה
 *      (ציטוט מפורש מול זיהוי עריכתי) מן המודול המשותף.
 *
 *   3. **חילוץ** — אותו `extractWithRegex` של הענן, מורץ מקומית על כל הטקסט.
 *
 * שימוש:
 *   node scripts/build-local-db.mjs            בנייה מלאה מאפס
 *   node scripts/build-local-db.mjs --stats    רק מה שיש כרגע במסד
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { normalizeForMatch, evidenceKind, VALIDATED_BY } from './lib/psakim-citation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'scripts', 'data');
const DB_DIR = join(ROOT, 'data');
const DB_FILE = join(DB_DIR, 'gemaraca.db');
const BUNDLE = join(ROOT, 'scripts/build/extractRegex.mjs');
const args = process.argv.slice(2);
const STATS_ONLY = args.includes('--stats');

mkdirSync(DB_DIR, { recursive: true });

// ── עזרי טקסט ───────────────────────────────────────────────
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
/** מפתח כפילות: אותיות וספרות מן הכותרת בלבד. סימני פיסוק משתנים בין אתרים */
const titleKey = (t) => String(t ?? '').replace(/[^א-ת0-9a-zA-Z]/g, '').slice(0, 45);
const fingerprint = (t) => {
  const core = strip(t).replace(/[^א-ת0-9]/g, '').slice(0, 2000);
  return core.length < 200 ? null : createHash('md5').update(core).digest('hex');
};
/** מזהה יציב: אותו מקור ואותו url נותנים תמיד את אותו מזהה */
const stableId = (sourceKey, key) => createHash('sha1').update(`${sourceKey}|${key}`).digest('hex').slice(0, 32);

const MAX_DAF = Object.fromEntries([...readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8')
  .matchAll(/hebrewName:\s*"([^"]+)"[\s\S]{0,200}?maxDaf:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
const TRACTATES = new Set(Object.keys(MAX_DAF));

const GEMATRIA = { א:1,ב:2,ג:3,ד:4,ה:5,ו:6,ז:7,ח:8,ט:9,י:10,כ:20,ך:20,ל:30,מ:40,ם:40,נ:50,ן:50,ס:60,ע:70,פ:80,ף:80,צ:90,ץ:90,ק:100,ר:200,ש:300,ת:400 };
function heNum(text) {
  const s = String(text).replace(/^(דף|פרק|סימן|סעיף|הלכה|עמוד|משנה)\s*/, '').replace(/['"״׳]/g, '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  for (const ch of s) { if (GEMATRIA[ch] === undefined) return null; total += GEMATRIA[ch]; }
  return total || null;
}
const heLetter = (n) => {
  const u = ['','א','ב','ג','ד','ה','ו','ז','ח','ט'], t = ['','י','כ','ל','מ','נ','ס','ע','פ','צ'], h = ['','ק','ר','ש','ת'];
  const hu = Math.floor(n / 100), te = Math.floor((n % 100) / 10), on = n % 10;
  let s = te === 1 && on === 5 ? h[hu] + 'ט״ו' : te === 1 && on === 6 ? h[hu] + 'ט״ז' : h[hu] + t[te] + u[on];
  if (!s.includes('״')) s = s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳';
  return s;
};

// ── סכימה ───────────────────────────────────────────────────
function openDb(fresh) {
  if (fresh && existsSync(DB_FILE)) rmSync(DB_FILE);
  const db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS psakei_din (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      court         TEXT,
      case_number   TEXT,
      year          INTEGER,
      date          TEXT,
      judges        TEXT,          -- JSON
      summary       TEXT,
      verdict       TEXT,
      questions     TEXT,          -- JSON
      original_text TEXT,
      notes         TEXT,          -- הערות שוליים, בנפרד מן הגוף
      source_url    TEXT,
      source_key    TEXT,
      content_print TEXT,
      tags          TEXT,          -- JSON
      merged_from   TEXT           -- JSON: המקורות שאוחדו לשורה הזו
    );

    CREATE TABLE IF NOT EXISTS talmud_references (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      psak_din_id   TEXT NOT NULL REFERENCES psakei_din(id) ON DELETE CASCADE,
      tractate      TEXT NOT NULL,
      daf           INTEGER NOT NULL,
      amud          TEXT,
      raw_reference TEXT,
      normalized    TEXT,
      source        TEXT,
      validated_by  TEXT,
      confidence    TEXT,
      UNIQUE (psak_din_id, tractate, daf, amud)
    );

    CREATE TABLE IF NOT EXISTS psak_sources (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      psak_din_id TEXT NOT NULL REFERENCES psakei_din(id) ON DELETE CASCADE,
      corpus      TEXT, book TEXT, section TEXT, subsection TEXT,
      display     TEXT, raw_path TEXT, context TEXT, source TEXT,
      UNIQUE (psak_din_id, display)
    );

    CREATE INDEX IF NOT EXISTS idx_ref_daf    ON talmud_references (tractate, daf, amud);
    CREATE INDEX IF NOT EXISTS idx_ref_psak   ON talmud_references (psak_din_id);
    CREATE INDEX IF NOT EXISTS idx_src_psak   ON psak_sources (psak_din_id);
    CREATE INDEX IF NOT EXISTS idx_psak_src   ON psakei_din (source_key);
    CREATE INDEX IF NOT EXISTS idx_psak_year  ON psakei_din (year);
  `);
  return db;
}

function printStats(db) {
  const one = (q) => db.prepare(q).get();
  const n = (q) => Object.values(one(q))[0];
  console.log('\n═══ המסד המקומי ═══');
  console.log(`  קובץ: ${DB_FILE}`);
  if (existsSync(DB_FILE)) console.log(`  גודל: ${(statSync(DB_FILE).size / 1048576).toFixed(1)} מ"ב`);
  console.log(`  פסקי דין:        ${n('SELECT COUNT(*) c FROM psakei_din')}`);
  console.log(`  מראי מקומות:     ${n('SELECT COUNT(*) c FROM talmud_references')}`);
  console.log(`  מקורות אחרים:    ${n('SELECT COUNT(*) c FROM psak_sources')}`);
  console.log(`  פסקים עם הפניות: ${n('SELECT COUNT(DISTINCT psak_din_id) c FROM talmud_references')}`);
  console.log(`  דפים ייחודיים:   ${n('SELECT COUNT(*) c FROM (SELECT DISTINCT tractate, daf FROM talmud_references)')}`);
  console.log('\n  לפי מקור:');
  for (const r of db.prepare('SELECT source_key, COUNT(*) c FROM psakei_din GROUP BY source_key ORDER BY c DESC').all())
    console.log(`    ${String(r.source_key).padEnd(14)} ${r.c}`);
  console.log('\n  לפי סוג ראיה:');
  for (const r of db.prepare('SELECT COALESCE(validated_by,\'ללא אימות\') v, COUNT(*) c FROM talmud_references GROUP BY v ORDER BY c DESC').all())
    console.log(`    ${String(r.v).padEnd(26)} ${r.c}`);
}

if (STATS_ONLY) {
  if (!existsSync(DB_FILE)) { console.log('המסד המקומי עדיין לא נבנה. הרץ בלי --stats.'); process.exit(0); }
  printStats(openDb(false));
  process.exit(0);
}

// ── שלב 1: קריאת כל הקאשים ──────────────────────────────────
const CACHES = [
  { dir: 'psakim_org', key: 'psakim.org' },
  { dir: 'govil', key: 'gov.il' },
  { dir: 'daat', key: 'daat.ac.il' },
  { dir: 'bdmz', key: 'bdmz' },
  { dir: 'bethdin', key: 'bethdin' },
];

console.log('═══ קריאת הקאשים ═══');
const records = [];
for (const { dir, key } of CACHES) {
  const path = join(DATA, dir);
  if (!existsSync(path)) { console.log(`  ${dir.padEnd(12)} — אין תיקייה`); continue; }
  let n = 0, tooShort = 0;
  for (const f of readdirSync(path).filter((x) => x.endsWith('.json'))) {
    let j;
    try { j = JSON.parse(readFileSync(join(path, f), 'utf8')); } catch { continue; }
    const text = strip(j.text);
    if (text.replace(/\s/g, '').length < 300) { tooShort++; continue; }
    records.push({
      sourceKey: key,
      url: j.url ?? null,
      title: strip(j.title) || `פסק ${j.id ?? f}`,
      court: strip(j.court) || null,
      caseNumber: j.caseNumber ?? null,
      date: j.date ? String(j.date).slice(0, 10) : null,
      year: Number.isFinite(j.year) ? j.year : (j.date ? Number(String(j.date).slice(0, 4)) : null),
      judges: Array.isArray(j.judges) ? j.judges : [],
      summary: strip(j.summary) || null,
      verdict: strip(j.verdict) || null,
      questions: Array.isArray(j.questions) ? j.questions : [],
      text,
      notes: j.notes ? strip(j.notes) : null,
      sources: Array.isArray(j.sources) ? j.sources : [],
      subjects: Array.isArray(j.subjects) ? j.subjects : [],
      fileKey: j.url ?? j.id ?? j.slug ?? f,
    });
    n++;
  }
  console.log(`  ${dir.padEnd(12)} ${String(n).padStart(5)} פסקים${tooShort ? ` (${tooShort} קצרים מדי)` : ''}`);
}
console.log(`  ─────────────────────────\n  סך הכול: ${records.length}`);

// ── שלב 2: איחוד כפילויות ───────────────────────────────────
/**
 * אותו פסק מופיע בשלושה אתרים, וכל אחד תמלל אחרת — לכן טביעת אצבע של תוכן
 * מזהה רק 3% מהם. המפתח הוא כותרת מנורמלת, והשנה מאשרת. כששתיהן חסרות שנה,
 * מאחדים בכל זאת, כי כותרת ארוכה וזהה בפסקי דין היא כמעט תמיד אותו פסק.
 */
console.log('\n═══ איחוד כפילויות ═══');
// המקורות מדורגים: מי שמביא עץ מקורות מתויג עדיף כבסיס
const RANK = { 'psakim.org': 0, 'gov.il': 1, 'daat.ac.il': 2, bdmz: 3, bethdin: 4 };
records.sort((a, b) => (RANK[a.sourceKey] ?? 9) - (RANK[b.sourceKey] ?? 9));

const groups = new Map();
for (const r of records) {
  const tk = titleKey(r.title);
  const fp = fingerprint(r.text);
  // כותרת קצרה מדי אינה מפתח אמין — נופלים לטביעת אצבע, ואם גם היא אין, לבד
  const key = tk.length >= 14 ? `t|${tk}|${r.year ?? ''}` : (fp ? `f|${fp}` : `u|${r.sourceKey}|${r.fileKey}`);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const merged = [];
let mergedAway = 0;
for (const grp of groups.values()) {
  // הבסיס: הטקסט הארוך ביותר. פסק מתומלל מלא עדיף על תקציר
  const base = grp.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  const row = { ...base, mergedFrom: grp.map((g) => ({ source: g.sourceKey, url: g.url })) };
  // מה שחסר בבסיס ויש באחר — משלימים
  for (const g of grp) {
    if (g === base) continue;
    mergedAway++;
    row.caseNumber ??= g.caseNumber;
    row.date ??= g.date;
    row.year ??= g.year;
    row.court ??= g.court;
    row.summary ??= g.summary;
    row.verdict ??= g.verdict;
    row.notes ??= g.notes;
    if (!row.judges.length) row.judges = g.judges;
    if (!row.questions.length) row.questions = g.questions;
    // עצי המקורות מתאחדים — זה בדיוק הרווח שבמיזוג
    if (g.sources.length) row.sources = [...row.sources, ...g.sources];
    if (g.subjects.length) row.subjects = [...row.subjects, ...g.subjects];
  }
  merged.push(row);
}
console.log(`  קבוצות: ${groups.size} | שורות שאוחדו פנימה: ${mergedAway}`);
console.log(`  פסקים ייחודיים: ${merged.length}`);

// ── שלב 3: כתיבת הפסקים ─────────────────────────────────────
console.log('\n═══ כתיבה למסד ═══');
const db = openDb(true);
const insPsak = db.prepare(`INSERT INTO psakei_din
  (id,title,court,case_number,year,date,judges,summary,verdict,questions,original_text,notes,source_url,source_key,content_print,tags,merged_from)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

db.exec('BEGIN');
for (const r of merged) {
  r.id = stableId(r.sourceKey, r.fileKey);
  const tags = [
    r.sourceKey,
    ...(r.sources.length ? ['מפתח מקורות'] : []),
    ...[...new Set(r.subjects.map((s) => s.path?.[1]).filter(Boolean))].slice(0, 6),
  ];
  insPsak.run(r.id, r.title, r.court, r.caseNumber, r.year, r.date,
    JSON.stringify(r.judges), r.summary, r.verdict, JSON.stringify(r.questions),
    r.text, r.notes, r.url, r.sourceKey, fingerprint(r.text),
    JSON.stringify(tags), JSON.stringify(r.mergedFrom));
}
db.exec('COMMIT');
console.log(`  ✔ ${merged.length} פסקים`);

// ── שלב 4: מפתח המקורות של אתר פסקים ────────────────────────
const insRef = db.prepare(`INSERT OR IGNORE INTO talmud_references
  (psak_din_id,tractate,daf,amud,raw_reference,normalized,source,validated_by,confidence)
  VALUES (?,?,?,?,?,?,?,?,?)`);
const insSrc = db.prepare(`INSERT OR IGNORE INTO psak_sources
  (psak_din_id,corpus,book,section,subsection,display,raw_path,context,source) VALUES (?,?,?,?,?,?,?,?,?)`);

let idxRefs = 0, idxSrcs = 0, rejected = 0;
const kinds = { cited: 0, editorial: 0 };
db.exec('BEGIN');
for (const r of merged) {
  if (!r.sources.length) continue;
  const normText = normalizeForMatch(r.text);
  for (const s of r.sources) {
    const path = s.path ?? [];
    const corpus = path[0], book = path[1];
    if (!corpus || !book) continue;
    if (corpus === 'בבלי' && TRACTATES.has(book)) {
      const dafNode = path.find((x) => /^דף\s/.test(x)) ?? path[2] ?? '';
      const amudNode = path.find((x) => /^עמוד\s/.test(x)) ?? '';
      const daf = heNum(dafNode);
      // שלוש שגיאות עימוד של האתר עצמו נופלות כאן (ב"ב קעז, כתובות קיד, תמורה עז)
      if (!daf || daf < 2 || daf > MAX_DAF[book]) { rejected++; continue; }
      const letter = String(amudNode).replace('עמוד', '').replace(/['"״׳]/g, '').trim();
      const amud = letter === 'ב' ? 'b' : letter === 'א' ? 'a' : null;
      const kind = evidenceKind(normText, book, String(dafNode).replace(/^דף\s*/, '').trim());
      kinds[kind]++;
      const raw = (s.context && String(s.context).trim().length > 3)
        ? String(s.context).trim().slice(0, 300) : path.join(' ← ');
      insRef.run(r.id, book, daf, amud, raw,
        `${book} ${heLetter(daf)}${amud === 'a' ? '.' : amud === 'b' ? ':' : ''}`,
        'site-index', VALIDATED_BY[kind], 'high');
      idxRefs++;
    } else {
      const display = path.join(', ');
      insSrc.run(r.id, corpus, book, path[path.length - 2] ?? null, path[path.length - 1] ?? null,
        display, path.join(' ← '), s.context ?? null, 'site-index');
      idxSrcs++;
    }
  }
}
db.exec('COMMIT');
console.log(`  ✔ ממפתח אתר פסקים: ${idxRefs} מראי מקומות (${kinds.cited} ציטוט מפורש, ${kinds.editorial} עריכתי)`);
console.log(`    ${idxSrcs} מקורות אחרים | ${rejected} נפסלו על טווח המסכת`);

// ── שלב 5: חילוץ מן הטקסט ───────────────────────────────────
if (!existsSync(BUNDLE)) {
  mkdirSync(dirname(BUNDLE), { recursive: true });
  execFileSync('npx', ['esbuild', 'supabase/functions/_shared/extractRegex.ts',
    '--bundle', '--format=esm', '--platform=node', `--outfile=${BUNDLE}`, '--log-level=warning'],
    { cwd: ROOT, stdio: 'inherit', shell: true });
}
const { extractWithRegex } = await import(`file://${BUNDLE.replace(/\\/g, '/')}`);

let extracted = 0, scanned = 0;
db.exec('BEGIN');
for (const r of merged) {
  scanned++;
  let hits = [];
  try { hits = extractWithRegex(r.text) ?? []; } catch { continue; }
  for (const h of hits) {
    const tractate = h.tractate ?? h.masechet;
    const daf = Number(h.daf);
    if (!TRACTATES.has(tractate) || !daf || daf < 2 || daf > MAX_DAF[tractate]) continue;
    const amud = h.amud === 'b' || h.amud === 'ב' ? 'b' : h.amud === 'a' || h.amud === 'א' ? 'a' : null;
    const info = insRef.run(r.id, tractate, daf, amud, h.raw_reference ?? h.raw ?? null,
      `${tractate} ${heLetter(daf)}${amud === 'a' ? '.' : amud === 'b' ? ':' : ''}`,
      'regex', null, h.confidence ?? 'medium');
    if (info.changes) extracted++;
  }
  if (scanned % 2000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); console.log(`    ${scanned}/${merged.length}…`); }
}
db.exec('COMMIT');
console.log(`  ✔ מן הטקסט: ${extracted} מראי מקומות נוספים`);

db.exec('PRAGMA optimize; VACUUM;');
printStats(db);
console.log('\n✅ המסד המקומי מוכן.');
