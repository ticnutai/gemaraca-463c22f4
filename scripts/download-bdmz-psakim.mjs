#!/usr/bin/env node
/**
 * הורדת פסקי דין של בית הדין לממונות "משפט צדק" (bdmz.co.il)
 * ──────────────────────────────────────────────────────────
 * המקור: https://www.bdmz.co.il/פסקי-דין/  (עמוד ארכיון, שני עמודים בלבד)
 * כ-28 פסקים. אתר וורדפרס/אלמנטור מוגש מהשרת — כל הטקסט העברי נמצא ב-HTML הגולמי,
 * אין צורך בדפדפן. robots.txt מתיר הכל חוץ מ-/wp-admin/.
 *
 * שני שלבים, כל אחד ממשיך מאיפה שנעצר:
 *   --index     בונה את רשימת הפסקים משני עמודי הרשימה (הם ה"אמת" לגבי מה פסק)
 *   --fetch     מוריד כל פסק לקובץ JSON נפרד ב-scripts/data/bdmz/<slug>.json
 *
 * שימוש:
 *   node scripts/download-bdmz-psakim.mjs --index
 *   node scripts/download-bdmz-psakim.mjs --fetch --limit 5
 *   node scripts/download-bdmz-psakim.mjs --fetch --delay 1200
 *
 * הערות על האתר (נבדקו בשטח):
 *  • לפסקים אין מספרי זיהוי — הכתובת היא slug עברי בשורש האתר,
 *    למשל https://www.bdmz.co.il/בניה-על-גגות-כופין-על-מידת-סדום-וחזקת-ת/
 *  • ב-post-sitemap.xml יש 51 רשומות, ובהן גם מאמרים ושו"ת וגם טיוטה כפולה
 *    שאינה מופיעה ברשימה. לכן הסייטמאפ משמש רק לבקרה, לא למקור.
 *  • הפרדת פסקים ממאמרים: בעמוד הרשימה כל כרטיס (upk-item) נושא את הקטגוריה שלו,
 *    ופסק הוא כרטיס שהקטגוריה שלו היא /category/פסקי-דין/ או תת-קטגוריה שלה.
 *  • בדפים האלה אין תאריך פסק, אין מספר תיק ואין שמות דיינים — השדות נשארים null.
 *    (יש article:published_time של וורדפרס ויש "מחבר" הפוסט, אבל אלו נתוני אתר
 *     ולא נתוני פסק, ולכן אינם נשמרים כדי לא להמציא מטא-דאטה.)
 *  • להערות השוליים יש עוגנים מייקרוסופטיים מסודרים (#_ftnref1 / #_ftn1),
 *    ולכן אפשר להפריד את גוף הפסק מרשימת ההערות בלי לנחש.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'scripts', 'data');
const CACHE = join(DATA, 'bdmz');
const INDEX_FILE = join(DATA, 'bdmz_index.json');

const SITE = 'https://www.bdmz.co.il';
const LIST_PATH = `/${encodeURIComponent('פסקי-דין')}/`;
const SITEMAP = `${SITE}/post-sitemap.xml`;
// הקטגוריה "פסקי דין" בכתובות מגיעה מקודדת באחוזים ובאותיות קטנות
const PSAK_CAT = `/category/${encodeURIComponent('פסקי-דין').toLowerCase()}/`;
const COURT = 'בית דין לממונות משפט צדק';
const MIN_TEXT = 300;            // פחות מזה אינו פסק אמיתי
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', Infinity);
const DELAY = num('--delay', 800);

mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** שליפת דף עם שלושה נסיונות; fetch של Node עובד כאן, אין Cloudflare חוסם */
async function getText(url) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml' } });
      if (!res.ok) throw new Error(`http ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ── פענוח ישויות HTML ───────────────────────────────────────
// באתר יש גרשיים "מסולסלים" של וורדפרס (&#8221; &#8216;) והם חלק מהטקסט האמיתי
// של מראי המקומות, למשל בב&#8221;ב יב: ← בב”ב יב:. לא מתקנים ולא מחליפים.
const NAMED = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#039': "'",
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', shy: '', laquo: '«', raquo: '»',
};
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => (NAMED[n.toLowerCase()] ?? m));
}

/** HTML → טקסט: מסלק תגים, שומר גבולות פסקאות ומשאיר את סימוני ההערות [1] בתוך השורה */
function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|ul|ol|table|section)>/gi, '\n')
      .replace(/<hr[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * חילוץ ה-HTML של גוף הפוסט: הווידג'ט theme-post-content של אלמנטור,
 * וספירת עומק של ה-div כדי למצוא את הסגירה הנכונה שלו.
 */
function extractContentHtml(html) {
  const w = html.indexOf('data-widget_type="theme-post-content.default"');
  if (w < 0) return null;
  const open = html.indexOf('<div class="elementor-widget-container">', w);
  if (open < 0) return null;
  let i = html.indexOf('>', open) + 1;
  const start = i;
  let depth = 1;
  const tag = /<(\/?)div\b/gi;
  tag.lastIndex = i;
  let m;
  while ((m = tag.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start);
}

/**
 * הפרדת הערות השוליים. הן מופיעות בסוף גוף הפוסט, כל אחת פותחת ב-
 * <a href="#_ftnrefN" id="_ftnN">[N]</a> ויכולה להימשך על כמה פסקאות.
 * מחזיר { bodyHtml, footnotes } — footnotes לפי סדר המספרים.
 */
function splitFootnotes(contentHtml) {
  const defRe = /<a\s+href="#_ftnref(\d+)"\s+id="_ftn\1"[^>]*>/gi;
  const defs = [];
  let m;
  while ((m = defRe.exec(contentHtml))) defs.push({ n: Number(m[1]), start: m.index, after: m.index + m[0].length });
  if (!defs.length) return { bodyHtml: contentHtml, footnotes: [] };

  let bodyHtml = contentHtml.slice(0, defs[0].start);
  // הקו המפריד שלפני ההערות אינו חלק מהפסק
  bodyHtml = bodyHtml.replace(/<hr[^>]*>\s*$/i, '').replace(/(<p>\s*(&nbsp;|\s)*<\/p>\s*)+$/i, '');

  const footnotes = defs
    .map((d, k) => {
      const end = k + 1 < defs.length ? defs[k + 1].start : contentHtml.length;
      // הסימון [N] עצמו בתוך ה-<a> נשמט, ומוחזר כתחילית קריאה
      const body = htmlToText(contentHtml.slice(d.after, end).replace(/^\s*\[\d+\]\s*/, ''));
      return { n: d.n, text: `[${d.n}] ${body}`.trim() };
    })
    .sort((a, b) => a.n - b.n)
    .map((f) => f.text);

  return { bodyHtml, footnotes };
}

/**
 * רשימת מקורות נפרדת בסוף הפסק, אם יש כזו.
 * בפסקים של האתר הזה המקורות משובצים בהערות השוליים, ולכן לרוב מוחזר null.
 */
function extractSourcesSection(text) {
  const headings = /(?:^|\n)\s*(מרא[יה] מקומות|רשימת מקורות|מקורות(?: והפניות)?|מפתח המקורות|ביבליוגרפיה)\s*[:\-–]?\s*\n/g;
  let last = null, m;
  while ((m = headings.exec(text))) last = m;
  if (!last) return null;
  const section = text.slice(last.index + last[0].length).trim();
  if (!section || section.length > 8000 || last.index < text.length * 0.4) return null;
  return section;
}

/** תקציר: הפסקה שאחרי הכותרת "תמצית העובדות", ואם אין — תחילת הפסק */
function buildSummary(text) {
  const m = text.match(/(?:^|\n)\s*תמצית(?: ה?עובדות| המקרה)?\s*:?\s*\n+([\s\S]{40,900}?)(?:\n\n|\n(?=[^\n]{0,40}:\s*\n))/);
  const raw = (m ? m[1] : text).replace(/\s+/g, ' ').trim();
  if (raw.length <= 600) return raw || null;
  return `${raw.slice(0, 600).replace(/\s+\S*$/, '')}…`;
}

const decodeSlug = (u) => decodeURIComponent(u.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, ''));

// ── שלב 1: אינדקס מעמודי הרשימה ─────────────────────────────
/** כל כרטיס בעמוד הרשימה הוא upk-item, ובתוכו הקטגוריה והכותרת */
function parseListPage(html) {
  const out = [];
  for (const block of html.split(/class="upk-item"/).slice(1)) {
    const cat = block.match(/class="upk-category">\s*<a href="([^"]+)"/);
    const title = block.match(/class="upk-title"><a href="([^"]+)"[^>]*?title="([^"]*)"/);
    if (!title) continue;
    const isPsak = cat && cat[1].toLowerCase().includes(PSAK_CAT);
    out.push({ url: title[1], title: decodeEntities(title[2]).replace(/\s+/g, ' ').trim(), category: cat ? decodeSlug(cat[1]) : null, isPsak: Boolean(isPsak) });
  }
  return out;
}

async function buildIndex() {
  const items = existsSync(INDEX_FILE) ? JSON.parse(readFileSync(INDEX_FILE, 'utf8')) : {};
  let skippedOther = 0;

  for (let page = 1; page <= 20; page++) {
    const url = page === 1 ? `${SITE}${LIST_PATH}` : `${SITE}${LIST_PATH}page/${page}/`;
    const html = await getText(url);
    const cards = parseListPage(html);
    // עמוד מעבר לאחרון מוחזר עם 200 אבל בלי כרטיסים — זה תנאי העצירה
    if (!cards.length) { console.log(`  עמוד ${page}: אין כרטיסים, עוצר`); break; }

    let added = 0;
    for (const c of cards) {
      if (!c.isPsak) { skippedOther++; continue; }
      const slug = decodeSlug(c.url);
      if (!items[slug]) added++;
      items[slug] = { slug, url: c.url, title: c.title, category: c.category };
    }
    console.log(`  עמוד ${page}: ${cards.length} כרטיסים, ${cards.filter((c) => c.isPsak).length} פסקים (${added} חדשים)`);
    await sleep(DELAY);
  }

  writeFileSync(INDEX_FILE, JSON.stringify(items, null, 1));
  console.log(`✅ אינדקס: ${Object.keys(items).length} פסקי דין, ${skippedOther} כרטיסים שאינם פסקים דולגו`);

  // בקרה מול הסייטמאפ: הוא מערבב פסקים, מאמרים ושו"ת, ולכן רק מאמת שלא פספסנו
  try {
    const xml = await getText(SITEMAP);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decodeSlug(m[1]));
    const missing = Object.keys(items).filter((s) => !locs.includes(s));
    console.log(`   סייטמאפ: ${locs.length} פוסטים סה"כ, ${locs.length - Object.keys(items).length} מהם אינם פסקי דין (מאמרים/שו"ת/כפולים)`);
    if (missing.length) console.log(`   ⚠️ בסייטמאפ חסרים ${missing.length} מהפסקים שברשימה: ${missing.join(', ')}`);
  } catch (e) {
    console.log(`   (בקרת סייטמאפ נכשלה: ${e.message})`);
  }
}

// ── שלב 2: הורדת הפסקים ─────────────────────────────────────
function parsePsak(html, item) {
  const contentHtml = extractContentHtml(html);
  if (!contentHtml) throw new Error('לא נמצא גוף הפוסט');
  const { bodyHtml, footnotes } = splitFootnotes(contentHtml);
  const body = htmlToText(bodyHtml);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = h1 ? htmlToText(h1[1]).replace(/\s+/g, ' ').trim() : item.title;
  // הטקסט השלם כולל את ההערות בסוף, כדי שהקורא יוכל להתאים את הסימונים שבשורה
  const text = footnotes.length ? `${body}\n\n${footnotes.join('\n')}` : body;

  return {
    slug: item.slug,
    url: item.url,
    title: title || item.title,
    court: COURT,
    caseNumber: null,   // אין באתר
    date: null,         // אין תאריך פסק באתר
    year: null,
    judges: null,       // אין שמות דיינים באתר
    summary: buildSummary(body),
    text,
    footnotes,
    sourcesSection: extractSourcesSection(body),
  };
}

async function fetchPsakim() {
  if (!existsSync(INDEX_FILE)) { console.error('❌ אין אינדקס. הרץ קודם --index'); process.exit(1); }
  const items = Object.values(JSON.parse(readFileSync(INDEX_FILE, 'utf8')));
  let cached = 0, saved = 0, failed = 0, tooShort = 0, withNotes = 0, withSources = 0;

  for (const item of items) {
    if (saved >= LIMIT) break;
    const out = join(CACHE, `${item.slug}.json`);
    if (existsSync(out)) { cached++; continue; }   // המשך אחרי עצירה: מדלגים על מה שכבר בקאש

    try {
      const html = await getText(`${SITE}/${encodeURIComponent(item.slug)}/`);
      const psak = parsePsak(html, item);
      if (psak.text.length < MIN_TEXT) {
        tooShort++;
        console.log(`  ⏭️  קצר מדי (${psak.text.length} תווים): ${item.title}`);
      } else {
        if (psak.footnotes.length) withNotes++;
        if (psak.sourcesSection) withSources++;
        writeFileSync(out, JSON.stringify(psak, null, 1));
        saved++;
        console.log(`  ✔ ${item.title} — ${psak.text.length} תווים, ${psak.footnotes.length} הערות שוליים`);
      }
    } catch (e) {
      failed++;
      console.error(`  ❌ ${item.slug}: ${e.message}`);
    }
    await sleep(DELAY);
  }

  const total = readdirSync(CACHE).filter((f) => f.endsWith('.json')).length;
  console.log(`✅ הורדה: ${saved} חדשים, ${cached} היו בקאש, ${tooShort} קצרים מ-${MIN_TEXT} תווים, ${failed} כשלונות`);
  console.log(`   מתוך החדשים: ${withNotes} עם הערות שוליים, ${withSources} עם רשימת מקורות נפרדת. בקאש כעת: ${total} קבצים.`);
}

// ── ריצה ────────────────────────────────────────────────────
if (has('--index')) await buildIndex();
if (has('--fetch')) await fetchPsakim();
if (!has('--index') && !has('--fetch')) {
  console.log('בחר שלב: --index | --fetch   (אפשר לצרף --limit N --delay ms)');
}
