#!/usr/bin/env node
/**
 * אימות מראי מקומות מול נוסח הגמרא, משני מקורות עצמאיים
 * ──────────────────────────────────────────────────────────
 * עד כאן נבדק שהציטוט **קיים בפסק**. כאן נבדק הדבר החשוב יותר: שמה שהפסק
 * מצטט **נמצא בדף שאליו הוא מפנה**. זו הראיה החזקה ביותר, והיא אינה תלויה
 * בצורת הכתיבה של הציטוט.
 *
 * שני מקורות, כדי שלא להיתלות באחד:
 *   ספריא     https://www.sefaria.org/api/texts/<Tractate>.<daf><amud>
 *   ויקיטקסט  https://he.wikisource.org/w/api.php?action=parse&page=<מסכת דף עמוד>
 *
 * כשהציטוט אינו נמצא בדף — מחפשים בדפים הסמוכים (עד ±3 עמודים). אם הוא נמצא
 * שם, יש לנו **ראיה** לדף הנכון, ולא ניחוש. הסקריפט מדווח ואינו מתקן מעצמו
 * אלא עם --fix.
 *
 * שימוש:
 *   node scripts/verify-refs-content.mjs --limit 50
 *   node scripts/verify-refs-content.mjs --limit 500 --fix
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts/data/daf-cache');
mkdirSync(CACHE, { recursive: true });

const args = process.argv.slice(2);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', 200);
const NEIGHBOURS = num('--neighbours', 3);
const FIX = args.includes('--fix');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const masechtot = readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8');
const SEFARIA_NAME = Object.fromEntries([...masechtot
  .matchAll(/hebrewName:\s*"([^"]+)",\s*englishName:\s*"([^"]+)",\s*sefariaName:\s*"([^"]+)"/g)].map((m) => [m[1], m[3]]));
const MAX_DAF = Object.fromEntries([...masechtot
  .matchAll(/hebrewName:\s*"([^"]+)"[\s\S]{0,200}?maxDaf:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));

/** ניקוי אחיד: בלי ניקוד, בלי פיסוק, בלי גרשיים */
const clean = (s) => String(s || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[֑-ׇ]/g, '')
  .replace(/&#?\w+;/g, ' ')
  .replace(/[״“”"׳‘’'(),.:;?!\[\]־–—]/g, ' ')
  .replace(/\s+/g, ' ').trim();

const toHebrewDaf = (n) => {
  const u = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const t = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const h = ['', 'ק', 'ר', 'ש', 'ת'];
  const hu = Math.floor(n / 100), te = Math.floor((n % 100) / 10), on = n % 10;
  if (te === 1 && on === 5) return h[hu] + 'טו';
  if (te === 1 && on === 6) return h[hu] + 'טז';
  return h[hu] + t[te] + u[on];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** נוסח הדף משני המקורות, עם קאש על הדיסק */
async function dafText(tractate, daf, amud) {
  const key = `${tractate}_${daf}${amud}`.replace(/[^\wא-ת]/g, '_');
  const file = join(CACHE, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));

  const out = { sefaria: '', wikisource: '' };
  const name = SEFARIA_NAME[tractate];
  if (name) {
    try {
      const r = await fetch(`https://www.sefaria.org/api/texts/${name}.${daf}${amud}?lang=he&context=0`, { headers: { accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        const flatten = (v) => Array.isArray(v) ? v.map(flatten).join(' ') : String(v ?? '');
        out.sefaria = clean(flatten(j.he || j.text || ''));
      }
    } catch { /* נרשם כריק */ }
    await sleep(120);
  }
  try {
    const page = encodeURIComponent(`${tractate} ${toHebrewDaf(daf)} ${amud === 'a' ? 'א' : 'ב'}`);
    const r = await fetch(`https://he.wikisource.org/w/api.php?action=parse&page=${page}&prop=text&format=json&redirects=1`);
    if (r.ok) {
      const j = await r.json();
      out.wikisource = clean(j.parse?.text?.['*'] || '');
    }
  } catch { /* נרשם כריק */ }
  await sleep(120);

  writeFileSync(file, JSON.stringify(out), 'utf8');
  return out;
}

/**
 * הציטוט שהפסק מביא מהגמרא.
 *
 * שתי מלכודות:
 *   1. `context_snippet` הוא כ-165 תווים ולרוב נחתך באמצע הציטוט, ולכן הבדיקה
 *      נעשית על **הטקסט המלא של הפסק**, בחלון שאחרי ההפניה.
 *   2. גרשיים בעברית משמשים גם לראשי תיבות (ר״ן, נמוק״י, ד״ה) וגם למרכאות.
 *      ההבדל: בראשי תיבות הגרשיים יושבים **בין שתי אותיות**. מרכאות פותחות
 *      באות אחרי רווח או פיסוק.
 */
function quotedAfter(text, at, rawLen) {
  const window = text.slice(at + rawLen, at + rawLen + 600);
  // מרכאה שאינה בין שתי אותיות
  const isQuoteMark = (str, i) => {
    const prev = str[i - 1] || ' ';
    const next = str[i + 1] || ' ';
    return !(/[א-ת]/.test(prev) && /[א-ת]/.test(next));
  };
  const marks = [];
  for (let i = 0; i < window.length; i++) {
    if (/["״“”]/.test(window[i]) && isQuoteMark(window, i)) marks.push(i);
  }
  for (let i = 0; i + 1 < marks.length; i++) {
    const body = window.slice(marks[i] + 1, marks[i + 1]);
    if (body.length >= 25 && body.length <= 500) return clean(body);
  }
  return '';
}

/** כמה מצירופי ארבע המילים של הציטוט נמצאים בנוסח הדף */
function hits(quote, text) {
  const w = quote.split(' ').filter((x) => x.length > 1);
  const sh = [];
  for (let i = 0; i + 4 <= w.length; i++) sh.push(w.slice(i, i + 4).join(' '));
  if (!sh.length || !text) return { hit: 0, total: sh.length, sample: '' };
  const found = sh.filter((s) => text.includes(s));
  return { hit: found.length, total: sh.length, sample: found[0] ?? '' };
}

/** הטקסט המלא של הפסק, בלי תגיות, עם קאש בזיכרון */
const psakCache = new Map();
async function psakTextOf(id) {
  if (psakCache.has(id)) return psakCache.get(id);
  const { data } = await sb.from('psakei_din').select('original_text,full_text').eq('id', id).single();
  const t = String(data?.original_text || data?.full_text || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
  psakCache.set(id, t);
  return t;
}

/** מספר עברי → מספר, לקריאת שמות הדפים בוויקיטקסט */
const heToNum = (tok) => {
  const ones = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9 };
  const tens = { 'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90 };
  const hund = { 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
  const str = String(tok);
  let total = 0, i = 0;
  while (i < str.length && hund[str[i]] !== undefined) { total += hund[str[i]]; i++; }
  const rest = str.slice(i);
  if (rest === 'טו') return total + 15;
  if (rest === 'טז') return total + 16;
  if (i < str.length && tens[str[i]] !== undefined) { total += tens[str[i]]; i++; }
  if (i < str.length && ones[str[i]] !== undefined) { total += ones[str[i]]; i++; }
  return i === str.length && total > 0 ? total : null;
};

/**
 * איתור הציטוט בכל הש"ס דרך החיפוש של ויקיטקסט.
 *
 * זו הראיה החזקה ביותר כשהציטוט אינו בדף שאליו הפסק מפנה ולא בסמוכים לו:
 * מחפשים את הביטוי המדויק ומקבלים את שם הדף. "נכנס לחצר בעל הבית שלא ברשות"
 * מחזיר "בבא קמא מח א", בעוד שאצלנו נשמר דף מ׳ — כי הציטוט בפסק נקטע.
 */
async function searchQuote(quote) {
  const phrase = quote.split(' ').filter(Boolean).slice(0, 8).join(' ');
  if (phrase.split(' ').length < 5) return null;
  try {
    const url = `https://he.wikisource.org/w/api.php?action=query&list=search&format=json&srlimit=6&srsearch=${encodeURIComponent(`"${phrase}"`)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'gemaraca-reference-audit/1.0 (torah study index)' } });
    await sleep(700);
    if (!r.ok) return null;
    const j = await r.json();
    for (const hit of j.query?.search ?? []) {
      const m = String(hit.title).match(/^(.+?) ([א-ת]{1,4}) ([אב])$/);
      if (!m) continue;
      const daf = heToNum(m[2]);
      if (!daf || !MAX_DAF[m[1]]) continue;
      return { tractate: m[1], daf, amud: m[3] === 'א' ? 'a' : 'b', title: hit.title };
    }
  } catch { /* רשת */ }
  return null;
}

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('talmud_references')
    .select('id,psak_din_id,tractate,daf,amud,raw_reference,context_snippet,source,validation_status,validated_by')
    .not('context_snippet', 'is', null).range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
// מתחילים במה שעוד לא אומת מול נוסח הגמרא, ובעל ציטוט ארוך מספיק
const work = rows
  .filter((r) => r.validated_by !== 'gemara-text' && String(r.context_snippet).length > 60)
  .sort(() => Math.random() - 0.5)
  .slice(0, LIMIT);
console.log(`מראי מקומות עם הקשר: ${rows.length} | נבדקים כעת: ${work.length}`);

const stats = { confirmed: 0, 'found-nearby': 0, 'found-by-search': 0, 'other-tractate': 0, 'not-found': 0, 'no-quote': 0, 'no-text': 0 };
const corrections = [];
const notFound = [];
let n = 0;
for (const r of work) {
  n++;
  const psakText = await psakTextOf(r.psak_din_id);
  const at = psakText.indexOf(String(r.raw_reference).replace(/\s+/g, ' ').trim());
  const quote = at >= 0 ? quotedAfter(psakText, at, String(r.raw_reference).length) : '';
  if (quote.split(' ').filter(Boolean).length < 6) { stats['no-quote']++; continue; }

  const amud = r.amud ?? 'a';
  const daf = Number(r.daf);
  const text = await dafText(r.tractate, daf, amud);
  const both = `${text.sefaria} ${text.wikisource}`;
  if (!both.trim()) { stats['no-text']++; continue; }

  const h = hits(quote, both);
  if (h.hit > 0) {
    stats.confirmed++;
    if (FIX) await sb.from('talmud_references').update({
      validation_status: 'correct', validated_by: 'gemara-text', validated_at: new Date().toISOString(),
    }).eq('id', r.id);
    continue;
  }

  // לא נמצא — מחפשים ראיה בדפים הסמוכים
  let found = null;
  for (let step = 1; step <= NEIGHBOURS && !found; step++) {
    for (const dir of [1, -1]) {
      const idx = (daf * 2 + (amud === 'b' ? 1 : 0)) + dir * step;
      const nd = Math.floor(idx / 2), na = idx % 2 === 0 ? 'a' : 'b';
      if (nd < 2 || nd > (MAX_DAF[r.tractate] ?? 200)) continue;
      const t2 = await dafText(r.tractate, nd, na);
      const h2 = hits(quote, `${t2.sefaria} ${t2.wikisource}`);
      if (h2.hit > 0) { found = { daf: nd, amud: na, ...h2 }; break; }
    }
  }
  if (found) {
    stats['found-nearby']++;
    corrections.push({ id: r.id, from: `${r.tractate} ${daf}${amud}`, to: `${r.tractate} ${found.daf}${found.amud}`, quote: quote.slice(0, 70), sample: found.sample, source: r.source });
  } else {
    // הראיה האחרונה: איתור הציטוט בכל הש"ס דרך ויקיטקסט
    const located = await searchQuote(quote);
    if (located && located.tractate === r.tractate) {
      stats['found-by-search']++;
      corrections.push({ id: r.id, from: `${r.tractate} ${daf}${amud}`, to: `${located.tractate} ${located.daf}${located.amud}`,
        quote: quote.slice(0, 70), sample: `ויקיטקסט: ${located.title}`, source: r.source, evidence: 'wikisource-search' });
    } else if (located) {
      stats['other-tractate']++;
      notFound.push({ ref: `${r.tractate} ${daf}${amud}`, raw: r.raw_reference, quote: quote.slice(0, 70), source: r.source,
        note: `הציטוט נמצא ב-${located.title}` });
    } else {
      stats['not-found']++;
      notFound.push({ ref: `${r.tractate} ${daf}${amud}`, raw: r.raw_reference, quote: quote.slice(0, 90), source: r.source, note: '' });
    }
  }
  if (n % 25 === 0) console.log(`  ${n}/${work.length} | ${JSON.stringify(stats)}`);
}

console.log(`\nתוצאה על ${work.length}:`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
if (notFound.length) {
  console.log('ציטוט שלא נמצא בדף ולא בסמוכים — לבדיקה ידנית:');
  notFound.slice(0, 10).forEach((x) => console.log(`   ${x.ref} (${x.source}) ← "${x.raw}"  «${x.quote}»${x.note ? '  ⇒ ' + x.note : ''}`));
}
if (corrections.length) {
  console.log('\nהציטוט נמצא בדף סמוך — ראיה לדף הנכון:');
  corrections.slice(0, 12).forEach((c) => console.log(`   ${c.from} → ${c.to} (${c.source})  «${c.quote}»  | נמצא: "${c.sample}"`));
  writeFileSync(join(ROOT, `scripts/data/nearby-corrections-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify(corrections, null, 2), 'utf8');
}
