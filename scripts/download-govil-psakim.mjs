#!/usr/bin/env node
/**
 * הורדת פסקי דין של בתי הדין הרבניים מ-gov.il
 * ──────────────────────────────────────────────────────────
 * המקור: https://www.gov.il/he/Departments/DynamicCollectors/verdict_the_rabbinical_courts
 * 3,437 פסקים ומאמרים של בתי הדין האזוריים ובית הדין הגדול.
 * פסקי דין של גוף שיפוטי הם נחלת הכלל לפי סעיף 6 לחוק זכות יוצרים.
 *
 * שלושה שלבים, כל אחד עם המשך אחרי עצירה:
 *   --index     מושך את רשימת הפסקים (344 קריאות API)
 *   --fetch     מוריד את קובצי ה-docx ומחלץ מהם טקסט
 *   --import    מכניס למסד, עם זיהוי כפילויות
 *
 * שימוש:
 *   node scripts/download-govil-psakim.mjs --index
 *   node scripts/download-govil-psakim.mjs --fetch --limit 50
 *   node scripts/download-govil-psakim.mjs --import --dry-run
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BlobReader, ZipReader, TextWriter, configure } from '@zip.js/zip.js';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

configure({ useWebWorkers: false });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'scripts', 'data');
const CACHE = join(DATA, 'govil');
const INDEX_FILE = join(DATA, 'govil_index.json');
const TEMPLATE_ID = '2db26765-d11f-4272-bdd7-099b8cd287a3';
const COLLECTION = 'https://www.gov.il/he/Departments/DynamicCollectors/verdict_the_rabbinical_courts';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ORIGIN_TAG = 'gov.il';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', Infinity);
const DELAY = num('--delay', 400);
const DRY = has('--dry-run');

mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// gov.il נמצא מאחורי Cloudflare שחוסם את חתימת ה-TLS של Node אך לא של curl,
// ולכן כל בקשה עוברת דרך curl.
function curlJson(url, body) {
  const out = join(tmpdir(), `govil-${Math.random().toString(36).slice(2)}.json`);
  try {
    execFileSync('curl', [
      '-s', '--max-time', '60', '-X', 'POST', url,
      '-H', 'Content-Type: application/json',
      '-H', `User-Agent: ${UA}`,
      '-H', 'Accept: application/json',
      '-H', `Referer: ${COLLECTION}`,
      '-d', JSON.stringify(body), '-o', out,
    ]);
    const text = readFileSync(out, 'utf8');
    return JSON.parse(text);
  } finally {
    try { rmSync(out, { force: true }); } catch { /* ignore */ }
  }
}

function curlFile(url, dest) {
  const code = execFileSync('curl', [
    '-s', '--max-time', '120', '-L', url,
    '-H', `User-Agent: ${UA}`, '-H', `Referer: ${COLLECTION}`,
    '-o', dest, '-w', '%{http_code}',
  ]).toString().trim();
  if (code !== '200') throw new Error(`http ${code}`);
  return readFileSync(dest);
}

// ── שלב 1: רשימת הפסקים ─────────────────────────────────────
async function buildIndex() {
  const items = existsSync(INDEX_FILE) ? JSON.parse(readFileSync(INDEX_FILE, 'utf8')) : {};
  let total = Infinity;

  for (let from = 0; from < total; from += 10) {
    let page = null;
    for (let attempt = 0; attempt < 3 && !page; attempt++) {
      try {
        page = curlJson('https://www.gov.il/he/api/DynamicCollector', {
          DynamicTemplateID: TEMPLATE_ID, QueryFilters: { skip: { Query: 0 } }, From: from, ItemUrlName: null,
        });
      } catch { await sleep(2000 * (attempt + 1)); }
    }
    if (!page) { console.error(`❌ נכשל בעמוד ${from}`); break; }

    total = Math.min(page.TotalResults ?? 0, LIMIT === Infinity ? Infinity : LIMIT);
    for (const r of page.Results ?? []) {
      const d = r.Data ?? {};
      items[r.UrlName] = {
        urlName: r.UrlName,
        caseNumber: d.number ?? null,
        date: d.date ?? null,
        title: (d.namepsak ?? '').trim(),
        dayan: d.dayan ?? null,
        summary: (d.des?.DescriptionBlankTextString ?? '').trim() || null,
        files: (d.file ?? []).map((f) => ({ name: f.FileName, ext: f.Extension, size: f.FileSize })),
      };
    }
    if (from % 200 === 0 || from + 10 >= total) {
      writeFileSync(INDEX_FILE, JSON.stringify(items));
      console.log(`  ${Math.min(from + 10, total)}/${total} פסקים באינדקס`);
    }
    await sleep(DELAY);
  }
  writeFileSync(INDEX_FILE, JSON.stringify(items));
  console.log(`✅ אינדקס: ${Object.keys(items).length} פסקים`);
}

// ── שלב 2: הורדת המסמכים וחילוץ טקסט ────────────────────────
async function docxToText(blob) {
  const zip = new ZipReader(new BlobReader(blob));
  try {
    const entries = await zip.getEntries();
    const doc = entries.find((e) => e.filename === 'word/document.xml');
    if (!doc) return '';
    const xml = await doc.getData(new TextWriter());
    return xml
      .replace(/<w:p[ >]/g, '\n<w:p ')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } finally {
    await zip.close();
  }
}

/**
 * בפסקים רשמיים רשימת המקורות מופיעה לרוב בסוף הפסק.
 * מחזיר את הקטע הזה בנפרד כדי שחילוץ מראי המקומות יתייחס אליו.
 */
function extractSourcesSection(text) {
  const headings = /(?:^|\n)\s*(מרא[יה] מקומות|רשימת מקורות|מקורות(?: והפניות)?|מפתח המקורות|ביבליוגרפיה)\s*[:\-–]?\s*\n/g;
  let last = null, m;
  while ((m = headings.exec(text))) last = m;
  if (!last) return null;
  const section = text.slice(last.index + last[0].length).trim();
  // רשימת מקורות אמיתית היא קצרה יחסית ומופיעה בסוף
  if (!section || section.length > 8000 || last.index < text.length * 0.4) return null;
  return section;
}

async function fetchDocs() {
  const items = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  const list = Object.values(items).filter((i) => i.files.some((f) => f.ext === 'docx'));
  let done = 0, saved = 0, failed = 0, withSources = 0;

  for (const item of list) {
    if (saved >= LIMIT) break;
    const out = join(CACHE, `${item.urlName}.json`);
    if (existsSync(out)) { done++; continue; }

    const file = item.files.find((f) => f.ext === 'docx');
    const url = `https://www.gov.il/BlobFolder/dynamiccollectorresultitem/${item.urlName}/he/${encodeURIComponent(file.name)}`;
    const tmp = join(tmpdir(), `govil-${item.urlName}.docx`);
    try {
      const buf = curlFile(url, tmp);
      const text = await docxToText(new Blob([buf]));
      if (text.length < 200) throw new Error('טקסט ריק');
      const sources = extractSourcesSection(text);
      if (sources) withSources++;
      writeFileSync(out, JSON.stringify({ ...item, text, sourcesSection: sources }));
      saved++;
    } catch (e) {
      failed++;
      console.error(`  ❌ ${item.urlName}: ${e.message}`);
    } finally {
      try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    }
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${list.length} | נשמרו ${saved} | עם רשימת מקורות ${withSources} | כשלונות ${failed}`);
    await sleep(DELAY);
  }
  console.log(`✅ הורדה: ${saved} חדשים, ${withSources} מהם עם רשימת מקורות בסוף, ${failed} כשלונות`);
}

// ── שלב 3: ייבוא למסד ───────────────────────────────────────
const hebrewYear = (iso) => (iso ? new Date(iso).getFullYear() : null);

async function importToDb() {
  const env = Object.fromEntries(
    readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
      .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
  );
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

  const existing = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('psakei_din').select('title').range(from, from + 999);
    if (error) throw new Error(error.message);
    data.forEach((p) => existing.add((p.title || '').replace(/\s+/g, ' ').trim()));
    if (data.length < 1000) break;
  }

  const files = readdirSync(CACHE).filter((f) => f.endsWith('.json'));
  const rows = [];
  for (const f of files) {
    const item = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
    const title = (item.title || '').replace(/\s+/g, ' ').trim();
    if (!title || existing.has(title)) continue;
    existing.add(title);
    rows.push({
      title,
      court: item.dayan ? 'בתי הדין הרבניים' : 'בתי הדין הרבניים',
      case_number: item.caseNumber || null,
      year: hebrewYear(item.date),
      summary: item.summary,
      full_text: item.text,
      source_url: `${COLLECTION}?DCRI_UrlName=${item.urlName}`,
      tags: [ORIGIN_TAG, 'בתי הדין הרבניים', ...(item.sourcesSection ? ['רשימת מקורות'] : [])],
    });
    if (rows.length >= LIMIT) break;
  }

  console.log(`פסקים חדשים לייבוא: ${rows.length} (מתוך ${files.length} שהורדו)`);
  if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); return; }

  for (let i = 0; i < rows.length; i += 25) {
    const batch = rows.slice(i, i + 25);
    const { error } = await sb.from('psakei_din').insert(batch);
    if (error) { console.error('❌', error.message); break; }
    console.log(`  ${Math.min(i + 25, rows.length)}/${rows.length}`);
  }
  console.log('✅ הייבוא הסתיים');
}

// ── ריצה ────────────────────────────────────────────────────
if (has('--index')) await buildIndex();
if (has('--fetch')) await fetchDocs();
if (has('--import')) await importToDb();
if (!has('--index') && !has('--fetch') && !has('--import')) {
  console.log('בחר שלב: --index | --fetch | --import  (אפשר לצרף --limit N --delay ms --dry-run)');
}
