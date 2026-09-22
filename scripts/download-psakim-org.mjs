#!/usr/bin/env node
/**
 * הורדת פסקי הדין מאתר פסקים (מכון פסקים)
 * ──────────────────────────────────────────────────────────
 * המקור: https://www.psakim.org — פסקי דין של בתי דין לממונות ושל בתי הדין
 * הרבניים, בטקסט מלא.
 *
 * למה דווקא כאן: זה **המקור היחיד שפורסם בו מפתח מקורות מובנה**. בסוף כל פסק
 * יושב עץ שבו הקורפוס, המסכת, הדף והעמוד הם צמתים נפרדים עם מזהים קבועים —
 * ותחתם שכבה חמישית: **הציטוט מן הפסק עצמו** שבו מובא אותו דף:
 *
 *     בבלי → בבא קמא → דף כו → עמוד א → "החיוב בנזק קיים בכל מקרה"
 *     רמב"ם → הלכות שכנים → פרק ב → הלכה ג → ...
 *     שולחן ערוך → חושן משפט → סימן קנד → סעיף ג → ...
 *
 * כלומר אין מה לפענח מהטקסט: התיוג ידני, מדויק ברמת עמוד, ונושא עמו את
 * ההקשר שבו בית הדין הביא את הדף.
 *
 * האתר מגיש API של JSON, שעדיף על גריפת ה-HTML בכל פרמטר — הוא מחזיר תאריך
 * ISO, מזהה בית דין, מזהי דיינים, ועצי מקורות ונושאים מובנים:
 *
 *     GET /PsakimData/File?id=N   פסק בודד: details, tags, subjects, sources
 *     GET /PsakimData/Betdins     טבלת בתי הדין
 *     GET /PsakimData/Dayanim     טבלת הדיינים
 *     GET /Psakim/TreeTagsPartial עץ התיוג המלא (כ-3.8 מ"ב)
 *
 * הערות על האתר (נבדקו בפועל):
 *  • robots.txt מוחזר עם הערות בלבד, בלי שום Disallow.
 *  • התקנון מתיר שימוש שאינו מסחרי, בתנאי ייחוס: "נלקח מתוך אתר פסקים".
 *  • עמודי ה-HTML מצהירים charset=windows-1255 אבל מגישים UTF-8. ה-API תקין.
 *  • המזהים אינם רצופים: טווח נמוך (כ-20–2,600) וטווח גבוה (כ-12,000–14,500).
 *
 * שלבים, כל אחד ממשיך מאיפה שנעצר:
 *   --lookups  טבלאות בתי הדין והדיינים (פעם אחת)
 *   --index    רשימת המזהים מדפי הרשימה ומהמפתח שכבר בריפו
 *   --tree     עץ התיוג המלא, לשמות המסכתות ולמזהי הדפים
 *   --fetch    מוריד כל פסק דרך ה-API ושומר JSON
 *
 * שימוש:
 *   node scripts/download-psakim-org.mjs --lookups --index
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
const LOOKUPS_FILE = join(DATA, 'psakim_org_lookups.json');
const TREE_FILE = join(DATA, 'psakim_org_tree.json');
const FAILED_FILE = join(DATA, 'psakim_org_failed.json');
const BASE = 'https://www.psakim.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', Infinity);
const DELAY = num('--delay', 1000);

mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** עמודי ה-HTML מצהירים windows-1255 ומגישים UTF-8 — הפענוח נעשה במפורש */
async function getUtf8(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, accept: 'text/html' } });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString('utf8');
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json();
}

const clean = (s) => String(s ?? '')
  // התוכן של script ו-style אינו טקסט של הפסק, והסרת התגיות לבדה משאירה אותו
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|h\d|li|tr)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// ── טבלאות עזר: בתי דין ודיינים ───────────────────────────────
async function buildLookups() {
  const [betdins, dayanim] = await Promise.all([
    getJson(`${BASE}/PsakimData/Betdins`),
    getJson(`${BASE}/PsakimData/Dayanim`),
  ]);
  const courts = {};
  // שמות באתר נשמרים עם רווחים נספחים; בלי ניקוי ייווצרו שני בתי דין באותו שם
  for (const b of betdins) if (b?.bd?.id) courts[b.bd.id] = clean(b.bd.name);
  const judges = {};
  for (const d of dayanim) {
    // השם מפוצל לשני שדות, ובעברית שם המשפחה מופיע ראשון באתר
    const name = clean([d.secondName, d.firstName].filter((x) => String(x || '').trim()).join(' '));
    if (d.id && name) judges[d.id] = name;
  }
  writeFileSync(LOOKUPS_FILE, JSON.stringify({ courts, judges }, null, 2), 'utf8');
  console.log(`✅ טבלאות עזר: ${Object.keys(courts).length} בתי דין, ${Object.keys(judges).length} דיינים`);
  return { courts, judges };
}

const loadLookups = () => existsSync(LOOKUPS_FILE)
  ? JSON.parse(readFileSync(LOOKUPS_FILE, 'utf8'))
  : { courts: {}, judges: {} };

// ── עץ התיוג המלא ─────────────────────────────────────────────
/**
 * העץ מוגש כ-HTML של jstree: `<li id='N' …> שם <ul> … </ul> </li>`.
 * הוא נשמר כדי שיהיה אפשר לבדוק את שמות המסכתות שהאתר משתמש בהם **לפני**
 * ההורדה הגדולה, ולא לגלות אחריה שמסכת שלמה לא מופתה.
 */
async function buildTree() {
  const html = await getUtf8(`${BASE}/Psakim/TreeTagsPartial`);
  const token = /<li[^>]*\sid='(\d+)'[^>]*>\s*([^<]*)|<ul>|<\/ul>|<\/li>/g;
  const nodes = {};
  const stack = [];
  let m;
  while ((m = token.exec(html)) !== null) {
    if (m[1]) {
      const node = { id: Number(m[1]), name: clean(m[2]), path: [] };
      node.path = [...stack.map((s) => s.name), node.name];
      nodes[node.id] = node;
      stack.push(node);
      continue;
    }
    if (m[0] === '</li>') stack.pop();
  }
  writeFileSync(TREE_FILE, JSON.stringify(nodes), 'utf8');
  const tractates = Object.values(nodes).filter((n) => n.path.length === 3 && n.path[1] === 'בבלי');
  console.log(`✅ עץ התיוג: ${Object.keys(nodes).length} צמתים | מסכתות בבבלי: ${tractates.length}`);
  console.log(`   ${tractates.map((t) => t.name).join(' · ')}`);
  return nodes;
}

// ── רשימת המזהים ──────────────────────────────────────────────
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

// ── פענוח פסק מן ה-API ────────────────────────────────────────

/**
 * הליכה על עץ המקורות. העומק קובע את המשמעות, והעלה האחרון אינו מקור אלא
 * **הציטוט מן הפסק** שבו מובא המקור — ולכן הוא נשמר בנפרד ולא כחלק מהנתיב.
 */
function flattenTree(root) {
  const out = [];
  const walk = (node, path, ids) => {
    const name = clean(node?.tag?.name);
    const nextPath = [...path, name];
    const nextIds = [...ids, node?.tag?.id];
    const sons = node?.sons;
    if (!sons || !sons.length) {
      // הצומת העמוק ביותר הוא ההקשר; המקור עצמו הוא מה שמעליו
      out.push({ path: nextPath.slice(1, -1), ids: nextIds.slice(1, -1), context: name });
      return;
    }
    for (const s of sons) walk(s, nextPath, nextIds);
  };
  if (root) walk(root, [], []);
  return out.filter((r) => r.path.length >= 2);
}

function parseFile(j, id, lookups) {
  const d = j?.details ?? {};
  const contentHtml = String(d.content || '');
  const text = clean(contentHtml);
  const judges = [d.dayan1ID, d.dayan2ID, d.dayan3ID]
    .filter((x) => Number.isFinite(x) && x > 0)
    .map((x) => lookups.judges[x] || `דיין ${x}`);
  // מספר התיק אינו בשדה נפרד אלא בראש גוף הפסק ("תיק 73120")
  const caseNumber = d.fileNumber
    || (text.slice(0, 400).match(/תיק(?:\s*מס['׳]?)?[:\s]+([\d\/\-]{3,20})/) || [])[1]
    || null;
  const date = d.date ? String(d.date).slice(0, 10) : null;

  return {
    id,
    url: `${BASE}/Psakim/File/${id}`,
    title: clean(d.title),
    court: lookups.courts[d.betDinID] || 'לא צוין',
    courtId: d.betDinID ?? null,
    judges,
    caseNumber,
    date,
    year: date ? Number(date.slice(0, 4)) : null,
    summary: clean(d.summary),
    verdict: clean(d.psak),
    // השאלות ההלכתיות שהפסק דן בהן, כל אחת עם אות הסימן שבגוף
    questions: clean(d.discussion).split('\n').map((s) => s.trim()).filter((s) => s.length > 8),
    text,
    sources: flattenTree(j?.sources),
    subjects: flattenTree(j?.subjects),
  };
}

async function fetchAll() {
  const index = existsSync(INDEX_FILE) ? JSON.parse(readFileSync(INDEX_FILE, 'utf8')) : await buildIndex();
  const lookups = existsSync(LOOKUPS_FILE) ? loadLookups() : await buildLookups();
  let saved = 0, cached = 0, withSources = 0, bavliLeaves = 0;
  // כשל שקט הוא הסכנה האמיתית: כל מזהה שנפל נרשם לקובץ, כדי שיהיה אפשר לדעת
  // מה לא נכנס ולנסות אותו שוב, ולא להסיק מ"0 שגיאות בפלט" שהכול ירד
  const failures = [];

  for (const id of index) {
    if (saved >= LIMIT) break;
    const out = join(CACHE, `${id}.json`);
    if (existsSync(out) && !has('--refresh')) { cached++; continue; }

    try {
      const ruling = parseFile(await getJson(`${BASE}/PsakimData/File?id=${id}`), id, lookups);
      if (ruling.text.length < 400) throw new Error(`טקסט קצר מדי (${ruling.text.length})`);
      writeFileSync(out, JSON.stringify(ruling, null, 2), 'utf8');
      saved++;
      const bavli = ruling.sources.filter((s) => s.path[0] === 'בבלי').length;
      if (ruling.sources.length) withSources++;
      bavliLeaves += bavli;
      if (saved % 100 === 0 || saved <= 5) {
        console.log(`  ✔ ${id} — ${ruling.text.length} תווים, ${ruling.sources.length} מקורות (${bavli} בבלי) — ${String(ruling.title).slice(0, 40)}`);
      }
    } catch (e) {
      failures.push({ id, error: e.message });
      if (failures.length <= 10) console.error(`  ❌ ${id}: ${e.message}`);
    }
    await sleep(DELAY);
  }
  writeFileSync(FAILED_FILE, JSON.stringify(failures, null, 2), 'utf8');
  console.log(`\n✅ ${saved} חדשים | ${cached} היו בקאש | ${failures.length} כשלונות`);
  if (failures.length) console.log(`   הכשלונות נרשמו ב-scripts/data/psakim_org_failed.json`);
  console.log(`   עם עץ מקורות: ${withSources} | עלי בבלי: ${bavliLeaves}`);
}

if (has('--lookups')) await buildLookups();
if (has('--tree')) await buildTree();
if (has('--index')) await buildIndex();
if (has('--fetch')) await fetchAll();
if (!has('--lookups') && !has('--tree') && !has('--index') && !has('--fetch')) {
  console.log('בחר שלב: --lookups | --index | --tree | --fetch   (אפשר לצרף --limit N --delay ms --refresh)');
}
