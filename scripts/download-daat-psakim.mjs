#!/usr/bin/env node
/**
 * הורדת פסקי דין רבניים מאתר "דעת" (מכלול המידע היהודי)
 * ──────────────────────────────────────────────────────────
 * המקור: https://www.daat.ac.il/daat/psk/index.htm
 * 2,597 פסקי דין של בתי הדין הרבניים האזוריים ובית הדין הגדול,
 * בטווח מזהים 22–5727 (הטווח דליל: יש חורים גדולים, ראה הערה למטה).
 * פסקי דין של גוף שיפוטי הם נחלת הכלל לפי סעיף 6 לחוק זכות יוצרים.
 *
 * שני שלבים, כל אחד עם המשך אחרי עצירה:
 *   --index     בונה את רשימת הפסקים מדפי העיון (2 סוגי דפים, 16 קריאות)
 *   --fetch     מוריד את דפי הפסקים, מפרק אותם ושומר JSON לכל פסק
 *
 * שימוש:
 *   node scripts/download-daat-psakim.mjs --index
 *   node scripts/download-daat-psakim.mjs --fetch --limit 50
 *   node scripts/download-daat-psakim.mjs --fetch            # הכול, עם המשך אוטומטי
 *
 * הערות על האתר (נבדקו בפועל):
 *   • הקידוד הוא windows-1255 ולא UTF-8, וה-meta אף מצהיר "text-html" שגוי.
 *     חייבים לפענח במפורש עם TextDecoder('windows-1255') אחרת העברית נהרסת.
 *   • מזהה שאינו קיים מחזיר HTTP 500 (לא 404), ולכן 500 = "אין פסק כזה".
 *   • robots.txt מחזיר 200 עם גוף ריק — שום דבר אינו חסום. בכל זאת
 *     ברירת המחדל היא השהיה של 800ms ובקשה אחת בכל פעם, בלי מקביליות.
 *   • fetch של Node עובד מול האתר ללא חסימה (בשונה מ-gov.il), ולכן הוא
 *     המנגנון הראשי, ו-curl נשאר כגיבוי בלבד אם בכל זאת ייחסם.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'scripts', 'data');
const CACHE = join(DATA, 'daat');
const INDEX_FILE = join(DATA, 'daat_index.json');
const SHORT_FILE = join(DATA, 'daat_short.json');   // מזהים שדולגו בגלל טקסט קצר
const BASE = 'https://www.daat.ac.il/daat/psk/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MIN_TEXT = 300;   // פחות מזה — לא פסק אמיתי אלא החלטת ביניים קצרה או דף שבור

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', Infinity);
const DELAY = num('--delay', 800);

mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── שליפה ופענוח windows-1255 ────────────────────────────────
/**
 * גיבוי דרך curl. האתר אינו חוסם את fetch של Node, אבל אם ייחסם
 * בעתיד (כמו gov.il מאחורי Cloudflare) זה המסלול החלופי.
 */
function curlText(url) {
  const out = join(tmpdir(), `daat-${Math.random().toString(36).slice(2)}.html`);
  try {
    const code = execFileSync('curl', [
      '-s', '--max-time', '60', '-L', url,
      '-H', `User-Agent: ${UA}`, '-H', `Referer: ${BASE}index.htm`,
      '-o', out, '-w', '%{http_code}',
    ]).toString().trim();
    return { status: Number(code), html: new TextDecoder('windows-1255').decode(readFileSync(out)) };
  } finally {
    try { rmSync(out, { force: true }); } catch { /* ignore */ }
  }
}

/** מחזיר { status, html } כשה-html מפוענח כ-windows-1255 */
async function getPage(url, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: `${BASE}index.htm` } });
      const buf = Buffer.from(await r.arrayBuffer());
      return { status: r.status, html: new TextDecoder('windows-1255').decode(buf) };
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  // fetch נכשל ברמת הרשת — ננסה דרך curl
  try { return curlText(url); } catch { throw lastErr ?? new Error('שליפה נכשלה'); }
}

// ── פירוק HTML לטקסט ────────────────────────────────────────
const ENTITIES = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', laquo: '«', raquo: '»', shy: '' };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m));
}

/** הסרת תגיות תוך שמירה על מעברי שורה במקומות שבהם ה-HTML מסמן פסקה */
function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, '\n')
      .replace(/<(p|div|tr|li|h[1-6]|blockquote)\b[^>]*>/gi, '\n')
      .replace(/<t[dh]\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** טקסט של תא טבלה, בשורה אחת */
const cellText = (html) => htmlToText(html).replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();

// ── פירוק דף פסק ────────────────────────────────────────────
/**
 * מבנה הדף קבוע לכל 2,597 הפסקים: טבלת כותרת עם תאי תווית
 * ("תיק מספר:", "תאריך:"), אחריה תמונת הינשוף owlpas*.gif שמסמנת את
 * תחילת גוף הפסק, ובסוף back.gif / <hr> שמסמנים את הכותרת התחתונה.
 */
function splitPage(html) {
  const owl = html.search(/<img[^>]*owlpas\d*\.gif/i);
  const head = owl >= 0 ? html.slice(0, owl) : html;
  let rest = owl >= 0 ? html.slice(owl) : html;
  const foot = rest.search(/<a[^>]*href=[^>]*index\.htm[^>]*>\s*<img[^>]*back\.gif|<hr\s+size="1"/i);
  if (foot > 0) rest = rest.slice(0, foot);
  return { head, body: rest.replace(/<img[^>]*owlpas\d*\.gif[^>]*>/i, '') };
}

/** מחזיר את התא שאחרי התא שתוויתו תואמת ל-label */
function labelledCell(headHtml, labels) {
  const cells = headHtml.split(/<t[dh]\b[^>]*>/i).slice(1).map((c) => cellText(c.split(/<\/t[dh]>/i)[0]));
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i].replace(/[:\s]+$/, '');
    if (!labels.some((l) => c === l || c.startsWith(l))) continue;
    // התווית והערך לפעמים באותו תא ("תיק מספר: 1127602/5"), לפעמים בתא הבא
    const inline = cells[i].replace(/^[^:]*:\s*/, '');
    if (inline && inline !== cells[i]) return inline;
    for (let j = i + 1; j < cells.length; j++) if (cells[j]) return cells[j];
  }
  return null;
}

/** שמות הדיינים: התא שאחרי "בפני כבוד הדיינים", מופרד ב-<br> */
function parseJudges(headHtml) {
  const m = headHtml.match(/בפני\s+כבוד\s+הדיינ?ים?\s*:?[\s\S]*?<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/i);
  if (!m) return [];
  return htmlToText(m[1])
    .split('\n')
    .map((s) => s.replace(/[,\s]+$/, '').trim())
    .filter((s) => s && s.length > 2 && !/^(דיין|אב"?ד|יו"?ר)$/.test(s));
}

/** שם בית הדין מופיע בכותרת המודגשת הראשונה, מעל שמות הדיינים */
function parseCourt(headHtml) {
  const m = headHtml.match(/<font[^>]*size=\+2[^>]*>\s*<b>([\s\S]*?)<\/b>/i);
  return m ? cellText(m[1]) || null : null;
}

/**
 * בפסקים רשמיים רשימת המקורות מופיעה לעתים בסוף הפסק.
 * באתר "דעת" לא נמצאה אף רשימה כזאת (נבדקו 30 פסקים לרוחב כל הטווח):
 * הפסקים נחתמים בחתימות הדיינים, והמקורות מצוטטים בגוף הטקסט.
 * הפונקציה נשמרת למקרה שיש פסקים חריגים, ומחזירה null כברירת מחדל.
 */
function extractSourcesSection(text) {
  const headings = /(?:^|\n)\s*(מרא[יה] מקומות|רשימת מקורות|רשימת מראי מקומות|מקורות(?: והפניות)?|מפתח המקורות|ביבליוגרפיה)\s*[:\-–]?\s*\n/g;
  let last = null, m;
  while ((m = headings.exec(text))) last = m;
  if (!last) return null;
  const section = text.slice(last.index + last[0].length).trim();
  // רשימת מקורות אמיתית היא קצרה יחסית ומופיעה בסוף
  if (!section || section.length > 8000 || last.index < text.length * 0.4) return null;
  return section;
}

function parsePsak(id, html) {
  const { head, body } = splitPage(html);
  const titleTag = html.match(/<title>([\s\S]*?)<\/title>/i);
  const subject = labelledCell(head, ['נושא הדיון']);
  const nadon = labelledCell(head, ['הנדון']);
  const title = cellText(titleTag ? titleTag[1] : '') || nadon || subject || `פסק דין ${id}`;
  const dateCell = labelledCell(head, ['תאריך']) || '';
  const greg = dateCell.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  const text = htmlToText(body);

  return {
    id: String(id),
    url: `${BASE}psk.asp?id=${id}`,
    title,
    court: parseCourt(head),
    caseNumber: labelledCell(head, ['תיק מספר', 'תיק מס']) || null,
    date: greg ? `${greg[3]}-${String(greg[2]).padStart(2, '0')}-${String(greg[1]).padStart(2, '0')}` : (dateCell || null),
    year: greg ? Number(greg[3]) : null,
    judges: parseJudges(head),
    // באתר אין שדה תקציר; "נושא הדיון" נשמר רק כשהוא שונה מהכותרת
    summary: subject && subject !== title ? subject : null,
    text,
    sourcesSection: extractSourcesSection(text),
  };
}

// ── שלב 1: בניית האינדקס מדפי העיון ─────────────────────────
/**
 * למה אינדקס ולא סריקת טווח: הטווח 22–5727 דליל מאוד — 2,597 פסקים
 * בלבד מתוך ~5,700 מזהים, וכל מזהה חסר עולה בקריאה שמחזירה 500.
 * לעומת זאת nosim.asp בלי פרמטרים מחזיר את *כל* הרשימה בעמוד אחד
 * (2,597 קישורים + כותרות), ולכן האינדקס כולו הוא קריאה אחת.
 * דפי baitdin.asp מוסיפים את שם בית הדין לכל פסק ב-15 קריאות נוספות.
 */
async function buildIndex() {
  const items = existsSync(INDEX_FILE) ? JSON.parse(readFileSync(INDEX_FILE, 'utf8')) : {};

  const master = await getPage(`${BASE}nosim.asp`);
  if (master.status !== 200) throw new Error(`nosim.asp החזיר ${master.status}`);
  for (const m of master.html.matchAll(/<a\s+href=["']?psk\.asp\?id=(\d+)["']?\s*>([\s\S]*?)<\/a>/gi)) {
    const id = m[1];
    if (LIMIT !== Infinity && !items[id] && Object.keys(items).length >= LIMIT) break;
    items[id] = { ...(items[id] ?? {}), id, url: `${BASE}psk.asp?id=${id}`, title: cellText(m[2]) };
  }
  console.log(`  ${Object.keys(items).length} פסקים ברשימה הראשית (nosim.asp)`);

  // העשרה: שם בית הדין לכל פסק, מתוך דפי בתי הדין
  await sleep(DELAY);
  const bdPage = await getPage(`${BASE}baitdin.asp`);
  const courts = [...bdPage.html.matchAll(/<a\s+href=["']?nosim\.asp\?bd=(\d+)["']?\s*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ bd: m[1], name: cellText(m[2]) }));
  let tagged = 0;
  for (const c of courts) {
    await sleep(DELAY);
    const p = await getPage(`${BASE}nosim.asp?bd=${c.bd}`);
    if (p.status !== 200) { console.error(`  ❌ בית דין ${c.bd}: ${p.status}`); continue; }
    for (const m of p.html.matchAll(/psk\.asp\?id=(\d+)/gi)) {
      if (items[m[1]] && !items[m[1]].courtIndex) { items[m[1]].courtIndex = c.name; tagged++; }
    }
  }
  console.log(`  ${courts.length} בתי דין, שויכו ${tagged} פסקים`);

  writeFileSync(INDEX_FILE, JSON.stringify(items));
  const ids = Object.keys(items).map(Number);
  console.log(`✅ אינדקס: ${ids.length} פסקים, מזהים ${Math.min(...ids)}–${Math.max(...ids)}`);
}

// ── שלב 2: הורדת הפסקים ופירוקם ─────────────────────────────
async function fetchPsakim() {
  if (!existsSync(INDEX_FILE)) { console.error('❌ אין אינדקס. הרץ קודם --index'); process.exit(1); }
  const items = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  const short = new Set(existsSync(SHORT_FILE) ? JSON.parse(readFileSync(SHORT_FILE, 'utf8')) : []);
  const list = Object.values(items).sort((a, b) => Number(a.id) - Number(b.id));

  let done = 0, saved = 0, cached = 0, tooShort = 0, missing = 0, failed = 0, withSources = 0;

  for (const item of list) {
    if (saved >= LIMIT) break;
    const out = join(CACHE, `${item.id}.json`);
    // המשך אחרי עצירה: מדלגים על מה שכבר בקאש וגם על מה שנפסל כקצר מדי
    if (existsSync(out)) { cached++; continue; }
    if (short.has(item.id)) { tooShort++; continue; }

    try {
      const { status, html } = await getPage(item.url);
      if (status === 500 || status === 404) { missing++; short.add(item.id); }
      else if (status !== 200) throw new Error(`http ${status}`);
      else {
        const psak = parsePsak(item.id, html);
        if (!psak.court && item.courtIndex) psak.court = item.courtIndex;
        if (!psak.title && item.title) psak.title = item.title;
        if (psak.text.length < MIN_TEXT) {
          tooShort++;
          short.add(item.id);
        } else {
          if (psak.sourcesSection) withSources++;
          writeFileSync(out, JSON.stringify(psak));
          saved++;
        }
      }
    } catch (e) {
      failed++;
      console.error(`  ❌ ${item.id}: ${e.message}`);
    }

    done++;
    if (done % 25 === 0) {
      writeFileSync(SHORT_FILE, JSON.stringify([...short]));
      console.log(`  ${done} נבדקו | נשמרו ${saved} | קצרים מדי ${tooShort} | חסרים ${missing} | כשלונות ${failed}`);
    }
    await sleep(DELAY);
  }

  writeFileSync(SHORT_FILE, JSON.stringify([...short]));
  console.log(`✅ הורדה: ${saved} חדשים | ${cached} היו בקאש | ${tooShort} דולגו (טקסט מתחת ל-${MIN_TEXT} תווים) | ${missing} מזהים חסרים | ${withSources} עם רשימת מקורות בסוף | ${failed} כשלונות`);
}

// ── ריצה ────────────────────────────────────────────────────
if (has('--index')) await buildIndex();
if (has('--fetch')) await fetchPsakim();
if (!has('--index') && !has('--fetch')) {
  console.log('בחר שלב: --index | --fetch  (אפשר לצרף --limit N --delay ms)');
}
