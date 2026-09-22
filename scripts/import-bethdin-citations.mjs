#!/usr/bin/env node
/**
 * ייבוא רשימת המקורות של בית הדין דאמריקה
 * ──────────────────────────────────────────────────────────
 * ה-PDF של בית הדין דאמריקה מביא את המקורות בשדה נפרד ובאנגלית — "Gittin 90a",
 * "Ketubot 63b" — כלומר **תיוג של בית הדין עצמו**, לא ניחוש של חילוץ. זה המקור
 * המדויק ביותר שאפשר לבקש, והוא היה מונח בקאש בלי שימוש.
 *
 * למה זה נחוץ דווקא כאן: חילוץ הטקסט מה-PDF איבד את הרווחים בין המילים בעברית
 * ("לאיגרשאדםאשתוראשונה"), ולכן הביטויים הרגולריים אינם מוצאים בו דבר. ברשימת
 * המקורות אין את הבעיה הזו.
 *
 * מה שאינו תלמוד (שולחן ערוך, רמב״ם) נרשם ב-`psak_sources`.
 *
 * שימוש:
 *   node scripts/import-bethdin-citations.mjs --dry-run
 *   node scripts/import-bethdin-citations.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const CACHE = join(ROOT, 'scripts/data/bethdin');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const masechtot = readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8');
const BY_EN = new Map();
const MAX_DAF = {};
for (const m of masechtot.matchAll(/hebrewName:\s*"([^"]+)",\s*englishName:\s*"([^"]+)",\s*sefariaName:\s*"([^"]+)"/g)) {
  BY_EN.set(m[2].toLowerCase(), m[1]);
  BY_EN.set(m[3].replace(/_/g, ' ').toLowerCase(), m[1]);
}
for (const m of masechtot.matchAll(/hebrewName:\s*"([^"]+)"[\s\S]{0,200}?maxDaf:\s*(\d+)/g)) MAX_DAF[m[1]] = Number(m[2]);

const heLetter = (n) => {
  const u = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const t = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const h = ['', 'ק', 'ר', 'ש', 'ת'];
  const hu = Math.floor(n / 100), te = Math.floor((n % 100) / 10), on = n % 10;
  let s = te === 1 && on === 5 ? h[hu] + 'ט״ו' : te === 1 && on === 6 ? h[hu] + 'ט״ז' : h[hu] + t[te] + u[on];
  if (!s.includes('״')) s = s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳';
  return s;
};

// כתיבים חלופיים נפוצים בספרות הרבנית באנגלית, שאינם בטבלת המסכתות
const ALT_SPELLINGS = {
  'bava mezia': 'בבא מציעא', 'baba metzia': 'בבא מציעא', 'baba mezia': 'בבא מציעא',
  'bava kama': 'בבא קמא', 'baba kamma': 'בבא קמא', 'baba kama': 'בבא קמא',
  'bava basra': 'בבא בתרא', 'baba basra': 'בבא בתרא', 'baba batra': 'בבא בתרא',
  'kesubos': 'כתובות', 'ketubos': 'כתובות', 'kesuvos': 'כתובות',
  'shevuos': 'שבועות', 'yevamos': 'יבמות', 'kiddushin': 'קידושין',
};

/** "Gittin 90a" → { tractate: 'גיטין', daf: 90, amud: 'b' } */
function parseCitation(text) {
  const line = String(text).split('\n')[0].trim();
  const m = line.match(/^([A-Z][A-Za-z' ]*?)\s+(\d{1,3})([ab])?\b/);
  if (!m) return null;
  const key = m[1].trim().toLowerCase();
  const he = BY_EN.get(key) ?? ALT_SPELLINGS[key];
  if (!he) return null;
  const daf = Number(m[2]);
  // "Ketubot 236" — מעבר לסוף המסכת, כלומר אינו דף
  if (!(daf >= 2 && daf <= (MAX_DAF[he] ?? 0))) return { rejected: `${m[1]} ${daf}` };
  return { tractate: he, daf, amud: m[3] ?? null, raw: line };
}

const EN_NAMES = [...new Set([...BY_EN.keys(), ...Object.keys(ALT_SPELLINGS)])]
  .sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const { data: psakim } = await sb.from('psakei_din').select('id,title,source_url').eq('source_key', 'bethdin');
const byUrl = new Map((psakim ?? []).map((p) => [p.source_url, p]));
const byTitle = new Map((psakim ?? []).map((p) => [p.title, p]));
console.log(`פסקים מבית הדין דאמריקה במסד: ${psakim?.length ?? 0}`);

const rows = [];
const seen = new Set();
const rejected = [];
let files = 0, noPsak = 0;
for (const f of readdirSync(CACHE).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
  const j = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
  // גם פסק בלי השדה המובנה נסרק — הציטוטים באנגלית מופיעים בגוף הטקסט
  files++;
  const psak = byUrl.get(j.url) ?? byUrl.get(j.pdfUrl) ?? byTitle.get(j.title);
  if (!psak) { noPsak++; continue; }
  // הציטוטים מופיעים גם בגוף הפסק ובהערות השוליים, לא רק בשדה המובנה.
  // בתוך הטקסט הם באנגלית ("Ketubot 63b"), ולכן החילוץ העברי אינו רואה אותם.
  const inline = [...`${j.text || ''} ${(j.footnotes || []).join(' ')}`
    .matchAll(new RegExp(`\\b(${EN_NAMES})\\s+(\\d{1,3})\\s*([ab])?\\b`, 'g'))].map((m) => m[0]);

  for (const c of [...(j.citations ?? []), ...inline]) {
    const parsed = parseCitation(c);
    if (!parsed) continue;
    if (parsed.rejected) { rejected.push(parsed.rejected); continue; }
    const key = `${psak.id}|${parsed.tractate}|${parsed.daf}|${parsed.amud ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      psak_din_id: psak.id,
      tractate: parsed.tractate,
      daf: String(parsed.daf),
      amud: parsed.amud,
      raw_reference: parsed.raw,
      normalized: `${parsed.tractate} ${heLetter(parsed.daf)}${parsed.amud === 'a' ? '.' : parsed.amud === 'b' ? ':' : ''}`,
      confidence: 'high',
      confidence_score: 100,
      source: 'site-index',
      context_snippet: null,
      validation_status: 'correct',
      validated_by: 'court-citation-list',
      validated_at: new Date().toISOString(),
      user_id: auth.user.id,
    });
  }
}
console.log(`קבצים עם רשימת מקורות: ${files} | בלי פסק תואם: ${noPsak}`);
console.log(`הפניות לתלמוד: ${rows.length} | נדחו (דף שאינו קיים): ${rejected.length} ${rejected.slice(0, 4).join(', ')}`);
rows.slice(0, 8).forEach((r) => console.log(`   ${r.tractate} ${r.daf}${r.amud ?? ''} ← "${r.raw_reference}"`));
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }
if (!rows.length) process.exit(0);

// לא מוסיפים מה שכבר קיים לאותו פסק
const ids = [...new Set(rows.map((r) => r.psak_din_id))];
const { data: existing } = await sb.from('talmud_references').select('psak_din_id,tractate,daf,amud').in('psak_din_id', ids);
const have = new Set((existing ?? []).map((e) => `${e.psak_din_id}|${e.tractate}|${Number(e.daf)}|${e.amud ?? ''}`));
const fresh = rows.filter((r) => !have.has(`${r.psak_din_id}|${r.tractate}|${Number(r.daf)}|${r.amud ?? ''}`));
console.log(`חדשים להוספה: ${fresh.length}`);
if (!fresh.length) process.exit(0);

const { error } = await sb.from('talmud_references').insert(fresh);
if (error) { console.error('❌', error.message); process.exit(1); }
console.log(`✅ נוספו ${fresh.length} מראי מקומות מרשימת המקורות של בית הדין`);
