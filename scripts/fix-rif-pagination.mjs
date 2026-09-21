#!/usr/bin/env node
/**
 * ציטוטים לפי דפי הרי"ף — המרה לדף הבבלי הנכון
 * ──────────────────────────────────────────────────────────
 * הרי"ף, הר"ן, הנימוקי יוסף ושלטי הגיבורים מודפסים בעימוד משלהם, והמפנה אליהם
 * כותב "בעמוה״ר" (בעמוד הרי״ף) או "מדפי הרי״ף". המספר שם הוא **עמוד ברי״ף**,
 * לא דף בבבלי. החילוץ לא הבחין, ולכן:
 *
 *     "והרי״ף שם (ס,ב בעמוה״ר)"  →  נשמר כבבא בתרא ס׳ ע״ב
 *     אבל עמוד ס״ב ברי״ף על בבא בתרא הוא בבלי **קל״ג ע״א** — הפרש של 73 דפים.
 *
 * ספריא מפרסמת את הרי״ף עם סימוני הדף של הבבלי בתוכו ("(דף קלג.)"), ולכן אפשר
 * להמיר במדויק: מושכים את עמוד הרי״ף, מודדים איזה דף בבלי תופס בו את רוב
 * הטקסט, ומעדכנים לפיו.
 *
 * שימוש:
 *   node scripts/fix-rif-pagination.mjs --dry-run --limit 10
 *   node scripts/fix-rif-pagination.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const SEFARIA_NAME = Object.fromEntries(
  [...readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8')
    .matchAll(/hebrewName:\s*"([^"]+)",\s*englishName:\s*"([^"]+)",\s*sefariaName:\s*"([^"]+)"/g)]
    .map((m) => [m[1], m[3]]),
);
const MAX_DAF = Object.fromEntries(
  [...readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8')
    .matchAll(/hebrewName:\s*"([^"]+)"[\s\S]{0,200}?maxDaf:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
);

const ones = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9 };
const tens = { 'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90 };
const hundreds = { 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
function heNum(tok) {
  const s = String(tok).replace(/['"״׳]/g, '');
  let total = 0, i = 0, prev = Infinity;
  while (i < s.length && hundreds[s[i]] !== undefined) {
    if (hundreds[s[i]] > prev) return null;
    total += hundreds[s[i]]; prev = hundreds[s[i]]; i++;
  }
  const rest = s.slice(i);
  if (rest === 'טו') return total + 15;
  if (rest === 'טז') return total + 16;
  if (i < s.length && tens[s[i]] !== undefined) { total += tens[s[i]]; i++; }
  if (i < s.length && ones[s[i]] !== undefined) { total += ones[s[i]]; i++; }
  return i === s.length && total > 0 ? total : null;
}

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const norm = (s) => flat(s).replace(/[״“”"]/g, '"').replace(/[׳‘’']/g, "'");
/** הסימון של עימוד הרי"ף */
const RIF = /(?:מדפי|בדפי|דפי)\s+הרי"?ף|ב?מ?עמוה"?ר|עמוד\s+הרי"?ף/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pageCache = new Map();
/** עמוד ברי"ף → הדף בבבלי שתופס בו את רוב הטקסט */
async function rifToTalmud(tractate, daf, amud) {
  const name = SEFARIA_NAME[tractate];
  if (!name) return null;
  const key = `${name}.${daf}${amud}`;
  if (pageCache.has(key)) return pageCache.get(key);

  let result = null;
  try {
    const r = await fetch(`https://www.sefaria.org/api/texts/Rif_${key}?lang=he&context=0`, { headers: { accept: 'application/json' } });
    if (r.ok) {
      const j = await r.json();
      if (!j.error) {
        const flatten = (v) => Array.isArray(v) ? v.map(flatten).join(' ') : String(v ?? '');
        const text = flatten(j.he || j.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const marks = [...text.matchAll(/\(\s*דף\s+([א-ת'"״׳]{1,6})\s*([.:])?\s*\)/g)]
          .map((m) => ({ daf: heNum(m[1]), amud: m[2] === ':' ? 'b' : 'a', at: m.index }))
          .filter((m) => m.daf);
        if (marks.length) {
          // הסימון פותח קטע; הקטע שלפני הסימון הראשון שייך לדף הקודם.
          // נבחר את הדף שתופס את רוב אורך העמוד.
          const spans = [];
          for (let i = 0; i < marks.length; i++) {
            const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
            spans.push({ ...marks[i], len: end - marks[i].at });
          }
          if (marks[0].at > 0) {
            const prev = marks[0].amud === 'b'
              ? { daf: marks[0].daf, amud: 'a' }
              : { daf: marks[0].daf - 1, amud: 'b' };
            spans.push({ ...prev, len: marks[0].at });
          }
          spans.sort((a, b) => b.len - a.len);
          const best = spans[0];
          if (best.daf >= 2 && best.daf <= (MAX_DAF[tractate] ?? 200)) {
            result = { daf: best.daf, amud: best.amud, markers: marks.map((m) => `${m.daf}${m.amud}`) };
          }
        }
      }
    }
  } catch { /* רשת — מדווח כלא־מומר */ }
  pageCache.set(key, result);
  await sleep(250);   // נימוס כלפי ספריא
  return result;
}

// ── איתור ההפניות שמצטטות לפי הרי"ף ────────────────────────
const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('talmud_references')
    .select('id,psak_din_id,tractate,daf,amud,raw_reference,normalized,context_snippet,source,validation_status')
    .range(from, from + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}

const targets = [];
for (const r of rows) {
  const raw = norm(r.raw_reference);
  const ctx = norm(r.context_snippet);
  let marked = RIF.test(raw);
  if (!marked && ctx) {
    const at = ctx.indexOf(raw);
    if (at >= 0 && RIF.test(ctx.slice(at + raw.length, at + raw.length + 20))) marked = true;
  }
  if (marked) targets.push(r);
}
console.log(`הפניות שמצטטות לפי עימוד הרי"ף: ${targets.length} מתוך ${rows.length}`);

const work = targets.slice(0, LIMIT === Infinity ? undefined : LIMIT);
const updates = [], unresolved = [];
for (const r of work) {
  const mapped = await rifToTalmud(r.tractate, Number(r.daf), r.amud ?? 'a');
  if (!mapped) { unresolved.push(r); continue; }
  if (mapped.daf === Number(r.daf) && mapped.amud === (r.amud ?? 'a')) continue;
  updates.push({ row: r, mapped });
  if (updates.length <= 12) {
    console.log(`   ${r.tractate} ${r.daf}${r.amud ?? ''} → ${mapped.daf}${mapped.amud}   ← "${norm(r.raw_reference)}"`);
  }
}
console.log(`\nלהמרה: ${updates.length} | לא נמצא עימוד ברי"ף: ${unresolved.length}`);
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }
if (!updates.length) process.exit(0);

const file = join(ROOT, `scripts/data/rif-pagination-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(file, JSON.stringify(updates, null, 2), 'utf8');
console.log(`📦 נשמר לפני העדכון: ${file}`);

const heLetter = (n) => {
  const u = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const t = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const h = ['', 'ק', 'ר', 'ש', 'ת'];
  const hu = Math.floor(n / 100), te = Math.floor((n % 100) / 10), on = n % 10;
  let s = te === 1 && on === 5 ? h[hu] + 'ט״ו' : te === 1 && on === 6 ? h[hu] + 'ט״ז' : h[hu] + t[te] + u[on];
  if (!s.includes('״')) s = s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳';
  return s;
};

let done = 0;
for (const { row, mapped } of updates) {
  const normalized = `${row.tractate} ${heLetter(mapped.daf)}${mapped.amud === 'a' ? '.' : ':'}`;
  const { error } = await sb.from('talmud_references').update({
    daf: String(mapped.daf),
    amud: mapped.amud,
    normalized,
    validation_status: 'correct',
    validated_by: 'rif-pagination',
    validated_at: new Date().toISOString(),
  }).eq('id', row.id);
  if (error) { console.error('❌', error.message); break; }
  done++;
  if (done % 100 === 0) console.log(`  ${done}/${updates.length}`);
}
console.log(`✅ הומרו ${done} הפניות מעימוד הרי"ף לדף הבבלי`);
