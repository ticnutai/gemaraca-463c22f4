#!/usr/bin/env node
/**
 * הורדת פסקי הדין מאתר פסקים (מכון פסקים)
 * ──────────────────────────────────────────────────────────
 * המקור: https://www.psakim.org — פסקי דין של בתי דין לממונות ושל בתי הדין
 * הרבניים, בטקסט מלא ב-HTML.
 *
 * למה דווקא כאן: זה **המקור היחיד שפורסם בו מפתח מקורות מובנה**. בסוף כל פסק
 * יושב עץ שבו הקורפוס, המסכת, הדף והעמוד הם צמתים נפרדים עם מזהים קבועים:
 *
 *     מקורות → בבלי → בבא בתרא → דף ב → עמוד א
 *              רמב"ם → הלכות שכנים → פרק ב → הלכה ג
 *              שולחן ערוך → חושן משפט → סימן קנד → סעיף ג
 *
 * כלומר אין מה לפענח מהטקסט — התיוג ידני ומדויק ברמת עמוד.
 *
 * הערות על האתר (נבדקו בפועל):
 *  • robots.txt מוחזר עם הערות בלבד, בלי שום Disallow.
 *  • התקנון מתיר שימוש שאינו מסחרי, בתנאי ייחוס: "נלקח מתוך אתר פסקים".
 *  • העמוד מצהיר charset=windows-1255 אבל **מגיש UTF-8** — חייבים לפענח כ-UTF-8.
 *  • המזהים אינם רצופים: יש טווח נמוך (כ-100–2,600) וטווח גבוה (כ-12,000–14,500).
 *
 * שני שלבים, כל אחד ממשיך מאיפה שנעצר:
 *   --index   בונה את רשימת המזהים מדפי הרשימה ומהמפתח שכבר בריפו
 *   --fetch   מוריד כל פסק, מפענח, ושומר JSON
 *
 * שימוש:
 *   node scripts/download-psakim-org.mjs --index
 *   node scripts/download-psakim-org.mjs --fetch --limit 20
 *   node scripts/download-psakim-org.mjs --fetch --delay 1200
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'scripts', 'data');
const CACHE = join(DATA, 'psakim_org');
const INDEX_FILE = join(DATA, 'psakim_org_index.json');
const BASE = 'https://www.psakim.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', Infinity);
const DELAY = num('--delay', 1000);

mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** העמוד מצהיר windows-1255 ומגיש UTF-8 — הפענוח נעשה במפורש */
async function getUtf8(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, accept: 'text/html' } });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString('utf8');
}

const clean = (s) => String(s ?? '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|h\d|li|tr)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// ── שלב 1: רשימת המזהים ─────────────────────────────────────
async function buildIndex() {
  const ids = new Set();

  // מה שהמפתח שכבר בריפו מצביע עליו — אלה הפסקים בעלי התיוג הידני
  const mapFile = join(ROOT, 'public', 'tag_psakim_map.json');
  if (existsSync(mapFile)) {
    const map = JSON.parse(readFileSync(mapFile, 'utf8'));
    for (const v of Object.values(map)) for (const [fid] of v) ids.add(Number(fid));
    console.log(`  מהמפתח שבריפו: ${ids.size} מזהים`);
  }

  // דפי הרשימה של האתר, עד שעמוד חוזר ריק
  let page = 1, empty = 0;
  while (empty < 2 && page < 400) {
    let html = '';
    try { html = await getUtf8(`${BASE}/Psakim/AllFiles?page=${page}`); }
    catch { empty++; page++; continue; }
    const found = [...html.matchAll(/\/Psakim\/File\/(\d+)/g)].map((m) => Number(m[1]));
    if (!found.length) empty++; else { empty = 0; found.forEach((i) => ids.add(i)); }
    if (page % 25 === 0) console.log(`  עמוד ${page}: ${ids.size} מזהים עד כה`);
    page++;
    await sleep(DELAY);
  }

  const list = [...ids].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  writeFileSync(INDEX_FILE, JSON.stringify(list, null, 2), 'utf8');
  console.log(`✅ אינדקס: ${list.length} מזהים (${list[0]}–${list[list.length - 1]})`);
  return list;
}

// ── שלב 2: פענוח עמוד פסק ───────────────────────────────────

/**
 * עץ המקורות. כל `<li>` נושא מזהה קבוע ושם, והעומק קובע את המשמעות:
 * קורפוס → ספר/מסכת → סימן/דף → סעיף/עמוד.
 */
function parseSourcesTree(html) {
  const start = html.indexOf('id="sourcesTree"');
  if (start < 0) return [];
  const end = html.indexOf('</div>', html.lastIndexOf('</ul>', html.indexOf('subjectsTree') > 0 ? html.indexOf('subjectsTree') : html.length));
  const section = html.slice(start, end > start ? end : start + 60000);

  const out = [];
  const stack = [];
  const token = /<li[^>]*\sid='(\d+)'[^>]*>|<a [^>]*>([^<]+)<\/a>|<ul>|<\/ul>|<\/li>/g;
  let pending = null;
  let m;
  while ((m = token.exec(section)) !== null) {
    if (m[1]) { pending = { id: Number(m[1]), name: null }; continue; }
    if (m[2] && pending) {
      pending.name = clean(m[2]);
      stack.push(pending);
      const path = stack.map((s) => s.name);
      // עלה בעומק 4 הוא ההפניה המלאה: קורפוס, ספר, סימן/דף, סעיף/עמוד
      if (path.length >= 2) out.push({ path: [...path], ids: stack.map((s) => s.id) });
      pending = null;
      continue;
    }
    if (m[0] === '</li>') stack.pop();
  }
  // רק הנתיבים העמוקים ביותר — הם המדויקים
  const deepest = out.filter((r) => !out.some((o) => o !== r && o.path.length > r.path.length
    && o.path.slice(0, r.path.length).join('|') === r.path.join('|')));
  return deepest;
}

function parseRuling(html, id) {
  const pick = (re) => { const m = html.match(re); return m ? clean(m[1]) : ''; };
  const title = pick(/class="file-title"[^>]*>([\s\S]*?)<\/h1>/) || pick(/<title>([^<]+)<\/title>/).replace(/\s*-\s*אתר פסקי דין רבניים\s*$/, '');
  const court = pick(/section-title">שם בית דין:<\/span>([\s\S]{0,200}?)<\/div>/);
  const judgesBlock = (html.match(/section-title">דיינים:<\/div>([\s\S]{0,600}?)<\/div>\s*<\/div>/) || [])[1] || '';
  const judges = clean(judgesBlock).split('\n').map((s) => s.trim()).filter(Boolean);
  const caseNumber = pick(/section-title">תיק מספר:?<\/span>([\s\S]{0,120}?)<\/div>/)
    || pick(/מס['׳]\s*סידורי:?<\/span>([\s\S]{0,120}?)<\/div>/);
  const date = pick(/section-title">תאריך:?<\/span>([\s\S]{0,120}?)<\/div>/);
  const year = Number((date.match(/(\d{4})/) || [])[1]) || null;
  const summary = pick(/section-title">תקציר:?<\/(?:span|div)>([\s\S]{0,1500}?)<\/div>/);

  // גוף הפסק: הכול חוץ מהתפריטים ומעצי התיוג
  let body = html;
  for (const marker of ['id="sourcesTreeHolder"', 'id="subjectsTreeHolder"', '<footer', 'var subjects']) {
    const i = body.indexOf(marker);
    if (i > 0) body = body.slice(0, i);
  }
  const startBody = body.indexOf('class="file-title"');
  const text = clean(startBody > 0 ? body.slice(startBody) : body);

  return {
    id,
    url: `${BASE}/Psakim/File/${id}`,
    title,
    court: court || 'לא צוין',
    judges,
    caseNumber: caseNumber || null,
    date: date || null,
    year,
    summary,
    text,
    sources: parseSourcesTree(html),
  };
}

async function fetchAll() {
  const index = existsSync(INDEX_FILE) ? JSON.parse(readFileSync(INDEX_FILE, 'utf8')) : await buildIndex();
  let saved = 0, cached = 0, failed = 0, withSources = 0, bavliLeaves = 0;

  for (const id of index) {
    if (saved >= LIMIT) break;
    const out = join(CACHE, `${id}.json`);
    if (existsSync(out) && !has('--refresh')) { cached++; continue; }

    try {
      const html = await getUtf8(`${BASE}/Psakim/File/${id}`);
      const ruling = parseRuling(html, id);
      if (ruling.text.length < 400) throw new Error(`טקסט קצר מדי (${ruling.text.length})`);
      writeFileSync(out, JSON.stringify(ruling, null, 2), 'utf8');
      saved++;
      const bavli = ruling.sources.filter((s) => s.path[0] === 'בבלי').length;
      if (ruling.sources.length) withSources++;
      bavliLeaves += bavli;
      if (saved % 25 === 0 || saved <= 5) {
        console.log(`  ✔ ${id} — ${ruling.text.length} תווים, ${ruling.sources.length} מקורות (${bavli} בבלי) — ${String(ruling.title).slice(0, 40)}`);
      }
    } catch (e) {
      failed++;
      if (failed <= 10) console.error(`  ❌ ${id}: ${e.message}`);
    }
    await sleep(DELAY);
  }
  console.log(`\n✅ ${saved} חדשים | ${cached} היו בקאש | ${failed} כשלונות`);
  console.log(`   עם עץ מקורות: ${withSources} | עלי בבלי: ${bavliLeaves}`);
}

if (has('--index')) await buildIndex();
else if (has('--fetch')) await fetchAll();
else console.log('בחר שלב: --index | --fetch   (אפשר לצרף --limit N --delay ms --refresh)');
