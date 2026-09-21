#!/usr/bin/env node
/**
 * ייבוא פסקים שהורדו לקאש מקומי אל המסד
 * ──────────────────────────────────────────────────────────
 * עובד עם כל מוריד שכותב קובצי JSON לתיקייה תחת scripts/data/,
 * בשדות: { title, court, caseNumber, date, year, summary, text,
 *          sourcesSection, footnotes, url }
 *
 * מה הוא עושה לכל פסק:
 *   • מדלג על כפילות — לפי כותרת ולפי טביעת אצבע של התוכן (content_print),
 *     אותו חישוב שנעשה במסד, כך שפסק שכבר הועלה בעבר לא ייכנס שוב
 *   • מעצב אותו בתבנית הבית (אותה פונקציה שהאפליקציה משתמשת בה)
 *   • שומר את הטקסט המקורי ב-original_text
 *   • מסמן source_key ורושם את המקור במרשם המקורות
 *
 * שימוש:
 *   node scripts/import-cached-psakim.mjs --source daat.ac.il --dry-run
 *   node scripts/import-cached-psakim.mjs --source daat.ac.il
 *   node scripts/import-cached-psakim.mjs --source bdmz --limit 10
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildStyledHtml } = require('./style/build.cjs');

// מקורות מוכרים: תיקיית הקאש ופרטי הרישוי שיירשמו במרשם
const SOURCES = {
  'daat.ac.il': {
    dir: 'daat',
    label: 'אתר דעת',
    site_url: 'https://www.daat.ac.il/daat/psk/index.htm',
    license: 'לא צוין רישוי — שימוש לימודי',
    attribution: 'אתר דעת, מכללת הרצוג',
    sort_order: 40,
  },
  bdmz: {
    dir: 'bdmz',
    label: 'בית דין לממונות משפט צדק',
    site_url: 'https://www.bdmz.co.il',
    license: 'כל הזכויות שמורות לבית הדין',
    attribution: 'בית דין לממונות משפט צדק, bdmz.co.il',
    sort_order: 50,
  },
  bethdin: {
    dir: 'bethdin',
    label: 'בית הדין דאמריקה',
    site_url: 'https://bethdin.org/decisions/',
    license: 'כל הזכויות שמורות, פסקים מאונימים',
    attribution: 'Beth Din of America',
    sort_order: 60,
  },
};

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };

const SOURCE_KEY = val('--source', null);
const LIMIT = num('--limit', Infinity);
const DRY = has('--dry-run');

if (!SOURCE_KEY || !SOURCES[SOURCE_KEY]) {
  console.error(`בחר מקור: ${Object.keys(SOURCES).join(' | ')}`);
  process.exit(1);
}
const SOURCE = SOURCES[SOURCE_KEY];
const CACHE = join(ROOT, 'scripts', 'data', SOURCE.dir);
if (!existsSync(CACHE)) { console.error(`אין קאש ב-${CACHE} — הרץ קודם את המוריד`); process.exit(1); }

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

/** אותו חישוב שנעשה במסד: 2,000 התווים הראשונים, אותיות וספרות בלבד */
function fingerprint(text) {
  const core = String(text || '').replace(/<[^>]+>/g, ' ').replace(/[^א-ת0-9]/g, '').slice(0, 2000);
  return core.length < 200 ? null : createHash('md5').update(core).digest('hex');
}

const normTitle = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ── מה כבר קיים במסד ───────────────────────────────────────
const titles = new Set();
const prints = new Set();
for (let from = 0; ; from += 500) {
  const { data, error } = await sb.from('psakei_din').select('title,content_print').range(from, from + 499);
  if (error) { console.error('❌', error.message); process.exit(1); }
  data.forEach((p) => {
    titles.add(normTitle(p.title));
    if (p.content_print) prints.add(p.content_print);
  });
  if (data.length < 500) break;
}
console.log(`במסד: ${titles.size} כותרות, ${prints.size} טביעות אצבע`);

// ── בניית השורות מהקאש ─────────────────────────────────────
const files = readdirSync(CACHE).filter((f) => f.endsWith('.json'));
const rows = [];
let duplicates = 0, tooShort = 0;

for (const f of files) {
  if (rows.length >= LIMIT) break;
  const item = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
  const text = String(item.text || '');
  if (text.replace(/\s+/g, '').length < 300) { tooShort++; continue; }

  const title = normTitle(item.title) || `פסק דין ${item.id ?? item.slug ?? ''}`.trim();
  const print = fingerprint(text);
  if (titles.has(title) || (print && prints.has(print))) { duplicates++; continue; }
  titles.add(title);
  if (print) prints.add(print);

  const year = item.year
    ?? (item.date ? new Date(item.date).getFullYear() : null)
    ?? new Date().getFullYear();

  // הערות השוליים הן חלק מהפסק, ושם נמצאים רוב הציטוטים
  const footnotes = Array.isArray(item.footnotes) && item.footnotes.length
    ? `\n\nהערות\n${item.footnotes.map((t, i) => `[${i + 1}] ${t}`).join('\n')}`
    : '';
  const fullRaw = text + footnotes + (item.sourcesSection ? `\n\nמראי מקומות\n${item.sourcesSection}` : '');

  const styled = buildStyledHtml(fullRaw, {
    title,
    court: item.court || null,
    year: Number.isFinite(year) ? year : null,
    caseNumber: item.caseNumber || null,
    summary: item.summary || null,
    sourceUrl: item.url || null,
  });

  rows.push({
    title,
    court: item.court || 'לא צוין',
    case_number: item.caseNumber || null,
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    summary: item.summary || text.slice(0, 500),
    full_text: styled,
    original_text: fullRaw,
    source_url: item.url || null,
    source_key: SOURCE_KEY,
    content_print: print,
    beautify_count: 1,
    tags: [SOURCE_KEY, ...(item.sourcesSection ? ['רשימת מקורות'] : [])],
  });
}

console.log(`בקאש: ${files.length} | חדשים לייבוא: ${rows.length} | כפילויות: ${duplicates} | קצרים מדי: ${tooShort}`);
if (!rows.length) process.exit(0);
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }

// ── רישום המקור במרשם ──────────────────────────────────────
const { error: regErr } = await sb.from('psak_source_registry').upsert({
  key: SOURCE_KEY, label: SOURCE.label, site_url: SOURCE.site_url,
  license: SOURCE.license, attribution: SOURCE.attribution, sort_order: SOURCE.sort_order,
}, { onConflict: 'key' });
if (regErr) console.error('⚠️ רישום המקור נכשל:', regErr.message);

// ── כתיבה ──────────────────────────────────────────────────
let inserted = 0;
for (let i = 0; i < rows.length; i += 25) {
  const batch = rows.slice(i, i + 25);
  const { error } = await sb.from('psakei_din').insert(batch);
  if (error) { console.error('❌', error.message); break; }
  inserted += batch.length;
  if (inserted % 100 === 0 || inserted === rows.length) console.log(`  ${inserted}/${rows.length}`);
}
console.log(`✅ יובאו ${inserted} פסקים מ-${SOURCE.label}`);
