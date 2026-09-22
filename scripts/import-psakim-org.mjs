#!/usr/bin/env node
/**
 * ייבוא פסקי אתר פסקים, כולל מפתח המקורות שלו
 * ──────────────────────────────────────────────────────────
 * שני חלקים, וההבדל ביניהם הוא העיקר:
 *
 *   1. הפסק עצמו — נכנס ל-`psakei_din`, עם בדיקת כפילות לפי טביעת אצבע של
 *      התוכן ולפי הכותרת, כמו בכל מקור אחר.
 *
 *   2. **מפתח המקורות** — האתר מפרסם לכל פסק עץ שבו הקורפוס, הספר, הדף והעמוד
 *      הם צמתים נפרדים. זה תיוג ידני ומדויק, ולכן ההפניות ממנו נרשמות
 *      `source='site-index'` ו-`validated_by='psakim-index'`, בלי חילוץ ובלי AI:
 *
 *        בבלי → בבא בתרא → דף ב → עמוד א      → talmud_references
 *        רמב"ם → הלכות שכנים → פרק ב → הלכה ג  → psak_sources
 *        שולחן ערוך → חושן משפט → סימן קנד → סעיף ג → psak_sources
 *        ירושלמי → מגילה → פרק א → הלכה ט      → psak_sources
 *
 * ייחוס: התקנון של האתר מבקש לציין "נלקח מתוך אתר פסקים psakim.org", ולכן כל
 * פסק נשמר עם `source_url` לעמוד המקורי ועם `source_key='psakim.org'`.
 *
 * שימוש:
 *   node scripts/import-psakim-org.mjs --dry-run
 *   node scripts/import-psakim-org.mjs --limit 20
 *   node scripts/import-psakim-org.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';
import { normalizeForMatch, evidenceKind, VALIDATED_BY } from './lib/psakim-citation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts/data/psakim_org');
const require = createRequire(import.meta.url);
const { buildStyledHtml } = require(join(ROOT, 'scripts/style/build.cjs'));

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }
const userId = auth.user.id;

const masechtot = readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8');
const MAX_DAF = Object.fromEntries([...masechtot
  .matchAll(/hebrewName:\s*"([^"]+)"[\s\S]{0,200}?maxDaf:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
const TRACTATES = new Set(Object.keys(MAX_DAF));

const GEMATRIA = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
/** "דף קל״ג" → 133. המפתח כותב מספרים תקניים, ולכן סכימה פשוטה מספיקה כאן */
function heNum(text) {
  const s = String(text).replace(/^(דף|פרק|סימן|סעיף|הלכה|עמוד|משנה)\s*/, '').replace(/['"״׳]/g, '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  for (const ch of s) { if (GEMATRIA[ch] === undefined) return null; total += GEMATRIA[ch]; }
  return total || null;
}
const heLetter = (n) => {
  const u = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const t = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const h = ['', 'ק', 'ר', 'ש', 'ת'];
  const hu = Math.floor(n / 100), te = Math.floor((n % 100) / 10), on = n % 10;
  let s = te === 1 && on === 5 ? h[hu] + 'ט״ו' : te === 1 && on === 6 ? h[hu] + 'ט״ז' : h[hu] + t[te] + u[on];
  if (!s.includes('״')) s = s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳';
  return s;
};
const fingerprint = (text) => String(text || '').replace(/<[^>]+>/g, ' ').replace(/[^א-ת0-9]/g, '').slice(0, 2000);

// ── מה כבר במסד ─────────────────────────────────────────────
const known = { byUrl: new Map(), byPrint: new Map(), byTitle: new Map() };
for (let f = 0; ; f += 1000) {
  const { data, error } = await sb.from('psakei_din').select('id,title,source_url,content_print').range(f, f + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  for (const p of data) {
    if (p.source_url) known.byUrl.set(p.source_url, p.id);
    if (p.content_print) known.byPrint.set(String(p.content_print).slice(0, 400), p.id);
    known.byTitle.set(String(p.title).replace(/[^א-ת0-9]/g, '').slice(0, 40), p.id);
  }
  if (data.length < 1000) break;
}
console.log(`פסקים במסד: ${known.byTitle.size}`);

const files = readdirSync(CACHE).filter((f) => f.endsWith('.json'));
console.log(`קבצים בקאש: ${files.length}`);

const newRows = [];
const refPlans = [];   // { key, sources } — משויך אחרי ההוספה
let dup = 0, short = 0;

for (const f of files.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
  const j = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
  const text = String(j.text || '');
  if (text.replace(/\s+/g, '').length < 300) { short++; continue; }

  const print = fingerprint(text);
  const titleKey = String(j.title || '').replace(/[^א-ת0-9]/g, '').slice(0, 40);
  const existing = known.byUrl.get(j.url) ?? known.byPrint.get(print.slice(0, 400)) ?? known.byTitle.get(titleKey);
  if (existing) {
    dup++;
    refPlans.push({ psakId: existing, sources: j.sources ?? [], url: j.url, normText: normalizeForMatch(text) });
    continue;
  }

  const styled = buildStyledHtml(text, {
    title: j.title,
    court: j.court || null,
    year: j.year ?? null,
    caseNumber: j.caseNumber || null,
    summary: j.summary || null,
    sourceUrl: j.url,
  });
  newRows.push({
    row: {
      title: j.title || `פסק ${j.id}`,
      court: j.court || 'לא צוין',
      case_number: j.caseNumber || null,
      year: Number.isFinite(j.year) ? j.year : new Date().getFullYear(),
      summary: j.summary || text.slice(0, 500),
      full_text: styled,
      original_text: text,
      source_url: j.url,
      source_key: 'psakim.org',
      content_print: print,
      beautify_count: 1,
      tags: [
        'psakim.org',
        ...(j.sources?.length ? ['מפתח מקורות'] : []),
        // הנושאים שהאתר תייג — ניווט נושאי שאי אפשר לגזור מן הטקסט
        ...[...new Set((j.subjects ?? []).map((s) => s.path[1]).filter(Boolean))].slice(0, 6),
      ],
    },
    sources: j.sources ?? [],
    url: j.url,
    normText: normalizeForMatch(text),
  });
  known.byPrint.set(print.slice(0, 400), 'pending');
  known.byTitle.set(titleKey, 'pending');
}

console.log(`חדשים לייבוא: ${newRows.length} | כבר במסד: ${dup} | קצרים מדי: ${short}`);
const bavliLeaves = [...newRows, ...refPlans].reduce((s, x) => s + (x.sources ?? []).filter((y) => y.path[0] === 'בבלי').length, 0);
console.log(`עלי בבלי במפתח של הקבצים האלה: ${bavliLeaves}`);
if (DRY) {
  newRows.slice(0, 5).forEach((r) => console.log(`   + ${String(r.row.title).slice(0, 50)} | ${r.row.court} | ${r.sources.length} מקורות`));
  console.log('(--dry-run: לא נכתב כלום)');
  process.exit(0);
}

// ── הוספת הפסקים ────────────────────────────────────────────
let added = 0;
for (let i = 0; i < newRows.length; i += 50) {
  const chunk = newRows.slice(i, i + 50);
  const { data, error } = await sb.from('psakei_din').insert(chunk.map((c) => c.row)).select('id,source_url');
  if (error) { console.error('❌ הוספה:', error.message); break; }
  const byUrl = new Map((data ?? []).map((d) => [d.source_url, d.id]));
  for (const c of chunk) {
    const id = byUrl.get(c.url);
    if (id) refPlans.push({ psakId: id, sources: c.sources, url: c.url, normText: c.normText });
  }
  added += data?.length ?? 0;
  if (added % 200 === 0) console.log(`  נוספו ${added}/${newRows.length}`);
}
console.log(`✅ נוספו ${added} פסקים`);

// ── מפתח המקורות → הפניות ──────────────────────────────────
const talmudRows = [];
const sourceRows = [];
for (const plan of refPlans) {
  for (const s of plan.sources) {
    const corpus = s.path[0];
    const book = s.path[1];
    // אורך הנתיב משתנה: בבלי הוא ארבע רמות, ובשולחן ערוך יש גם קיבוץ סימנים
    // ("קנג-קנו - הלכות נזקי שכנים"), ולכן שתי הרמות האחרונות הן המדויקות.
    const section = s.path[s.path.length - 2] ?? null;
    const subsection = s.path[s.path.length - 1] ?? null;
    if (corpus === 'בבלי' && TRACTATES.has(book)) {
      const dafNode = s.path.find((x) => /^דף\s/.test(x)) ?? s.path[2];
      const amudNode = s.path.find((x) => /^עמוד\s/.test(x)) ?? '';
      const daf = heNum(dafNode || '');
      if (!daf || daf < 2 || daf > MAX_DAF[book]) continue;
      const amudLetter = String(amudNode).replace('עמוד', '').replace(/['"״׳]/g, '').trim();
      const amud = amudLetter === 'ב' ? 'b' : amudLetter === 'א' ? 'a' : null;
      // סוג הראיה נקבע כאן פעם אחת ונשמר, כדי שהאודיט לא ידרוש ציטוט מילולי
      // מהפניה שמקורה בזיהוי עריכתי — דרישה כזו הייתה מוחקת דווקא את הטובות.
      const dafLetters = String(dafNode).replace(/^דף\s*/, '').trim();
      const kind = evidenceKind(plan.normText ?? '', book, dafLetters);
      talmudRows.push({
        psak_din_id: plan.psakId,
        tractate: book,
        daf: String(daf),
        amud,
        // לשון בית הדין עצמו, כפי שהמפתח שמר אותה — עדיפה על שחזור הנתיב
        raw_reference: (s.context && String(s.context).trim().length > 3)
          ? String(s.context).trim().slice(0, 300)
          : s.path.join(' '),
        normalized: `${book} ${heLetter(daf)}${amud === 'a' ? '.' : amud === 'b' ? ':' : ''}`,
        confidence: 'high',
        confidence_score: kind === 'cited' ? 100 : 90,
        source: 'site-index',
        validation_status: 'correct',
        validated_by: VALIDATED_BY[kind],
        validated_at: new Date().toISOString(),
        user_id: userId,
      });
    } else if (corpus && book) {
      const display = s.path.join(', ');
      sourceRows.push({
        psak_din_id: plan.psakId,
        corpus,
        book,
        section,
        subsection,
        display,
        raw_path: s.path.join(' ← '),
        source: 'site-index',
        confidence: 'high',
        validation_status: 'correct',
      });
    }
  }
}
console.log(`מהמפתח: ${talmudRows.length} הפניות לבבלי | ${sourceRows.length} מקורות אחרים`);

// לא מוסיפים מה שכבר קיים לאותו פסק
const ids = [...new Set(talmudRows.map((r) => r.psak_din_id))];
const have = new Set();
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await sb.from('talmud_references').select('psak_din_id,tractate,daf,amud').in('psak_din_id', ids.slice(i, i + 200));
  (data ?? []).forEach((e) => have.add(`${e.psak_din_id}|${e.tractate}|${Number(e.daf)}|${e.amud ?? ''}`));
}
const freshTalmud = talmudRows.filter((r) => !have.has(`${r.psak_din_id}|${r.tractate}|${Number(r.daf)}|${r.amud ?? ''}`));

let refsAdded = 0;
for (let i = 0; i < freshTalmud.length; i += 200) {
  const { error } = await sb.from('talmud_references').insert(freshTalmud.slice(i, i + 200));
  if (error) { console.error('❌ הפניות:', error.message); break; }
  refsAdded += Math.min(200, freshTalmud.length - i);
}
let srcAdded = 0;
for (let i = 0; i < sourceRows.length; i += 200) {
  const { error } = await sb.from('psak_sources')
    .upsert(sourceRows.slice(i, i + 200), { onConflict: 'psak_din_id,display', ignoreDuplicates: true });
  if (error) { console.error('❌ מקורות:', error.message); break; }
  srcAdded += Math.min(200, sourceRows.length - i);
}
console.log(`✅ נוספו ${refsAdded} מראי מקומות מהמפתח ו-${srcAdded} מקורות נוספים`);
