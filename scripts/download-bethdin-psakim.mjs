#!/usr/bin/env node
/**
 * הורדת פסקי הדין המפורסמים של בית הדין דאמריקה (Beth Din of America)
 * ──────────────────────────────────────────────────────────
 * המקור: https://bethdin.org/decisions/ — 25 פסקים, כולם קובצי PDF.
 * הפסקים באנגלית, מאונימים (שמות הצדדים שונו), ועוסקים בדיני ממונות.
 *
 * הערות על האתר (נבדקו בפועל):
 *  • robots.txt מתיר את /decisions/ וקובע Crawl-delay: 10 — ברירת המחדל כאן
 *    היא אכן 10 שניות בין בקשות, בלי שום מקביליות.
 *  • הקבצים יושבים בשני שרתים: הישנים ב-s589827416.onlinehome.us והחדשים
 *    ב-bethdin.sfo3.digitaloceanspaces.com. אין מספור רציף — חייבים לקרוא
 *    את הקישורים מעמוד הרשימה.
 *  • ה-PDF הם פלט של Word ו-Google Docs, כלומר יש שכבת טקסט אמיתית ולא סריקה.
 *    אבל הגופנים מוטמעים בקידוד פנימי, ולכן חילוץ נאיבי מחזיר ג'יבריש —
 *    נדרשת ספריית PDF שמפענחת את מפות ה-ToUnicode. כאן משתמשים ב-pdfjs-dist.
 *  • הציטוטים יושבים בהערות שוליים ממוספרות, בתעתיק אנגלי שאינו אחיד
 *    ("Bava Mezia" מול "Bava Metzia"), ולכן הן נשמרות בנפרד.
 *
 * שני שלבים, כל אחד ממשיך מאיפה שנעצר:
 *   --index   קורא את עמוד הרשימה ושומר את רשימת הפסקים
 *   --fetch   מוריד כל PDF, מחלץ ממנו טקסט והערות שוליים, ושומר JSON
 *
 * שימוש:
 *   node scripts/download-bethdin-psakim.mjs --index
 *   node scripts/download-bethdin-psakim.mjs --fetch --limit 3
 *   node scripts/download-bethdin-psakim.mjs --fetch --delay 10000
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'scripts', 'data');
const CACHE = join(DATA, 'bethdin');
const INDEX_FILE = join(DATA, 'bethdin_index.json');
const LISTING = 'https://bethdin.org/decisions/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', Infinity);
const DELAY = num('--delay', 10_000);   // כיבוד ה-Crawl-delay שבקובץ robots

mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function curlText(url) {
  const out = join(tmpdir(), `bethdin-${Math.random().toString(36).slice(2)}.html`);
  try {
    execFileSync('curl', ['-s', '--max-time', '60', '-L', url, '-H', `User-Agent: ${UA}`, '-o', out]);
    return readFileSync(out, 'utf8');
  } finally {
    try { rmSync(out, { force: true }); } catch { /* ignore */ }
  }
}

function curlFile(url, dest) {
  const code = execFileSync('curl', [
    '-s', '--max-time', '120', '-L', url, '-H', `User-Agent: ${UA}`, '-o', dest, '-w', '%{http_code}',
  ]).toString().trim();
  if (code !== '200') throw new Error(`http ${code}`);
  return readFileSync(dest);
}

// ── שלב 1: רשימת הפסקים ─────────────────────────────────────
function buildIndex() {
  const html = curlText(LISTING);
  const items = [...html.matchAll(/<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]{0,200}?)<\/a>/gi)]
    .map((m) => ({
      pdfUrl: m[1].replace(/&amp;/g, '&'),
      title: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter((x) => x.pdfUrl);

  const byId = {};
  for (const it of items) {
    const id = decodeURIComponent(it.pdfUrl.split('/').pop()).replace(/\.pdf(\.pdf)?$/i, '');
    byId[id] = { id, title: it.title || id, pdfUrl: it.pdfUrl, url: LISTING };
  }
  writeFileSync(INDEX_FILE, JSON.stringify(byId, null, 2), 'utf8');
  console.log(`✅ אינדקס: ${Object.keys(byId).length} פסקים`);
  return byId;
}

// ── שלב 2: חילוץ טקסט מה-PDF ────────────────────────────────
async function pdfToText(buf) {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) { text += line.trimEnd() + '\n'; line = ''; }
    }
    if (line) text += line + '\n';
  }
  await doc.destroy();
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** הערות שוליים: שורה שמתחילה במספר ואחריו משפט. שם יושבים הציטוטים. */
function extractFootnotes(text) {
  const notes = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d{1,3})\s+([A-Z"'(][^\n]{15,})$/);
    if (m) notes.push(`${m[1]} ${m[2]}`.trim());
  }
  return notes;
}

const CITATION = /(Bava (?:Mezia|Metzia|Kamma|Basra|Batra)|Ketubot|Gittin|Kiddushin|Sanhedrin|Shevuot|Yevamot)\s+\d+[ab]?|Shulchan Arukh[^.;]{0,50}/g;

async function fetchAll() {
  const index = existsSync(INDEX_FILE) ? JSON.parse(readFileSync(INDEX_FILE, 'utf8')) : buildIndex();
  const list = Object.values(index);
  let saved = 0, cached = 0, failed = 0, withNotes = 0, withCitations = 0;

  for (const item of list) {
    if (saved >= LIMIT) break;
    const out = join(CACHE, `${item.id}.json`);
    if (existsSync(out)) { cached++; continue; }

    const tmp = join(tmpdir(), `bethdin-${item.id}.pdf`);
    try {
      const buf = curlFile(item.pdfUrl, tmp);
      const text = await pdfToText(buf);
      if (text.length < 300) throw new Error('לא חולץ טקסט');
      const footnotes = extractFootnotes(text);
      const citations = [...new Set(text.match(CITATION) || [])];
      if (footnotes.length) withNotes++;
      if (citations.length) withCitations++;

      writeFileSync(out, JSON.stringify({
        id: item.id,
        url: item.pdfUrl,
        pdfUrl: item.pdfUrl,
        title: item.title,
        court: 'בית הדין דאמריקה',
        caseNumber: null,
        date: null,
        year: null,
        judges: null,
        summary: text.slice(0, 500),
        text,
        footnotes,
        citations,
        sourcesSection: null,
        textExtractionFailed: false,
      }, null, 2), 'utf8');
      saved++;
      console.log(`  ✔ ${item.id} — ${text.length} תווים, ${footnotes.length} הערות שוליים, ${citations.length} ציטוטים`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${item.id}: ${e.message}`);
    } finally {
      try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    }
    await sleep(DELAY);
  }
  console.log(`✅ הורדה: ${saved} חדשים | ${cached} היו בקאש | ${failed} כשלונות`);
  console.log(`   מתוך החדשים: ${withNotes} עם הערות שוליים, ${withCitations} עם ציטוטים מזוהים`);
}

// ── ריצה ────────────────────────────────────────────────────
if (has('--index')) buildIndex();
if (has('--fetch')) await fetchAll();
if (!has('--index') && !has('--fetch')) {
  console.log('בחר שלב: --index | --fetch  (אפשר לצרף --limit N --delay ms)');
}
