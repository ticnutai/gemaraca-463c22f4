#!/usr/bin/env node
/**
 * אימות מראי מקומות מול מאגר הש"ס המקומי
 * ──────────────────────────────────────────────────────────
 * עד היום האימות נעשה מול ספריא דרך הרשת: איטי, מוגבל בקצב, וכבר נכשל אצלנו
 * בשקט — כל הבקשות חזרו 429 בעוד הדוח אמר "0 נמצאו" (כלל 11 ב-CITATION_RULES).
 *
 * בפרויקט למען v2 יושב מאגר ש"ס מלא: 37 מסכתות, 5,375 עמודים, טקסט גמרא
 * ותשעה מפרשים, כל עמוד עם `sefaria_ref`. הצלבה הראתה שכל 37 טווחי הדפים
 * תואמים בדיוק לטבלה שלנו. ממנו אפשר לאמת מיידית, בלי רשת ובלי כשל שקט.
 *
 * מה נבדק לכל הפניה:
 *   1. העמוד קיים במאגר — ואם לא, ההפניה מצביעה לדף שאינו קיים.
 *   2. אם בפסק יש ציטוט בגרשיים סמוך להפניה — האם הוא נמצא בעמוד.
 *      וכאן ההבדל מספריא: המאגר מפריד בין לשון הגמרא ללשון המפרשים, ולכן
 *      אפשר לומר **היכן** נמצא הציטוט ולא רק שנמצא. זה כלל 12 — "לא כל
 *      'נמצא בדף' שווה": ציטוט שנמצא ברש"י אינו לשון הגמרא.
 *
 * מה נכתב: `validated_by` ו-`validated_at` בלבד. הפניה אינה נמחקת כאן —
 * דף שאינו קיים מדווח לבדיקה, כי מחיקה אוטומטית היא בדיוק מה שכבר כמעט
 * מחק אצלנו 672 שורות תקינות.
 *
 * שימוש:
 *   node scripts/validate-against-local-shas.mjs --dry-run
 *   node scripts/validate-against-local-shas.mjs [--limit 500]
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHAS = 'C:/Users/jj121/Desktop/lemaan-v2/public/shas';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();

if (!existsSync(SHAS)) {
  console.error(`❌ מאגר הש"ס אינו נמצא: ${SHAS}`);
  process.exit(1);
}

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

// שם עברי → שם הקובץ במאגר
const src = readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8');
const SLUG = Object.fromEntries([...src.matchAll(/hebrewName:\s*"([^"]+)",\s*englishName:\s*"[^"]+",\s*sefariaName:\s*"([^"]+)"/g)]
  .map((m) => [m[1], m[2]]));

/** המסכתות נטענות לפי דרישה; כל אחת כ-1 מ"ב דחוסה */
const cache = new Map();
function loadTractate(he) {
  if (cache.has(he)) return cache.get(he);
  const slug = SLUG[he];
  const file = slug ? join(SHAS, `${slug}.json.gz`) : null;
  let data = null;
  if (file && existsSync(file)) {
    try { data = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')).amudim ?? null; } catch { data = null; }
  }
  cache.set(he, data);
  return data;
}

/** ניקוי להשוואה: בלי ניקוד, בלי טעמים, בלי פיסוק ובלי רווחים */
const norm = (s) => String(s ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[\u0591-\u05C7]/g, '')          // ניקוד וטעמים
  .replace(/[^\u05d0-\u05ea]/g, '');        // רק אותיות עבריות

/** הטקסטים של עמוד, מופרדים: הגמרא עצמה מול כל מפרש */
function pageTexts(page) {
  const gemara = norm((page.gemara ?? []).join(' '));
  const byCommentary = {};
  for (const c of page.commentaries ?? []) {
    const key = c.key ?? c.name ?? 'מפרש';
    byCommentary[key] = norm((c.segments ?? []).join(' '));
  }
  return { gemara, byCommentary };
}

console.log('═══ אימות מול מאגר הש"ס המקומי ═══');
console.log(`   מאגר: ${SHAS} (${readdirSync(SHAS).filter((f) => f.endsWith('.gz')).length} מסכתות)`);

// ההפניות שלא אומתו
const refs = [];
for (let f = 0; ; f += 1000) {
  const { data, error } = await sb.from('talmud_references')
    .select('id,psak_din_id,tractate,daf,amud,raw_reference')
    .is('validated_by', null).range(f, f + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  refs.push(...data);
  if (data.length < 1000) break;
}
console.log(`   הפניות ללא אימות: ${refs.length}`);

const work = refs.slice(0, LIMIT === Infinity ? undefined : LIMIT);
const stats = { pageOk: 0, noPage: 0, noTractate: 0, noAmud: 0, quoteInGemara: 0, quoteInCommentary: 0, quoteMissing: 0 };
const updates = { 'local-shas': [], 'local-shas-gemara': [], 'local-shas-commentary': [] };
const problems = [];

// טקסט הפסקים, כדי לחלץ ציטוט בגרשיים סמוך להפניה
const psakIds = [...new Set(work.map((r) => r.psak_din_id))];
const textById = new Map();
for (let i = 0; i < psakIds.length; i += 100) {
  const { data } = await sb.from('psakei_din').select('id,original_text,full_text').in('id', psakIds.slice(i, i + 100));
  for (const p of data ?? []) textById.set(p.id, norm(p.original_text || p.full_text || ''));
  if (i % 1000 === 0) process.stdout.write(`\r   טוען טקסטים ${i}/${psakIds.length}…`);
}
process.stdout.write(`\r   נטענו ${textById.size} טקסטים            \n`);

for (const r of work) {
  const amudim = loadTractate(r.tractate);
  if (!amudim) { stats.noTractate++; continue; }
  if (!r.amud) { stats.noAmud++; }

  // בלי עמוד — בודקים את שני העמודים של הדף
  const keys = r.amud ? [`${r.daf}${r.amud}`] : [`${r.daf}a`, `${r.daf}b`];
  const pages = keys.map((k) => amudim[k]).filter(Boolean);
  if (!pages.length) {
    stats.noPage++;
    problems.push({ id: r.id, why: 'עמוד אינו קיים במאגר', ref: `${r.tractate} ${r.daf}${r.amud ?? ''}` });
    continue;
  }
  stats.pageOk++;

  // האם הציטוט שבפסק נמצא בעמוד, ואם כן — בגמרא או במפרש
  const psakText = textById.get(r.psak_din_id) ?? '';
  let where = null;
  if (psakText.length > 200) {
    for (const p of pages) {
      const { gemara, byCommentary } = pageTexts(p);
      // חיפוש דו-כיווני: רצף של 24 אותיות מן העמוד שנמצא גם בפסק
      const probe = (hay) => {
        for (let i = 0; i + 24 <= hay.length; i += 12) {
          if (psakText.includes(hay.slice(i, i + 24))) return true;
        }
        return false;
      };
      if (gemara && probe(gemara)) { where = 'gemara'; break; }
      for (const [k, txt] of Object.entries(byCommentary)) {
        if (txt && probe(txt)) { where = k; break; }
      }
      if (where) break;
    }
  }
  if (where === 'gemara') { stats.quoteInGemara++; updates['local-shas-gemara'].push(r.id); }
  else if (where) { stats.quoteInCommentary++; updates['local-shas-commentary'].push(r.id); }
  else { stats.quoteMissing++; updates['local-shas'].push(r.id); }
}

const tot = work.length;
const pc = (n) => `${String(n).padStart(6)}  ${(100 * n / (tot || 1)).toFixed(1)}%`;
console.log(`\n═══ תוצאות (${tot} הפניות) ═══`);
console.log(`  העמוד קיים במאגר:            ${pc(stats.pageOk)}`);
console.log(`  ✖ העמוד אינו קיים:           ${pc(stats.noPage)}`);
console.log(`  מסכת שאינה במאגר:            ${pc(stats.noTractate)}`);
console.log(`  (מהן בלי עמוד מוגדר:         ${stats.noAmud})`);
console.log('\n  איפה נמצא הציטוט שבפסק:');
console.log(`    בלשון הגמרא:               ${pc(stats.quoteInGemara)}   ← ראיה חזקה`);
console.log(`    בלשון מפרש:                ${pc(stats.quoteInCommentary)}   ← הדף נכון, הלשון של ראשון`);
console.log(`    לא נמצא ציטוט מילולי:      ${pc(stats.quoteMissing)}   ← הדף קיים, בלי ציטוט להשוות`);

if (problems.length) {
  console.log(`\n⚠ ${problems.length} מצביעות לעמוד שאינו קיים — לבדיקה ידנית, לא נמחקות:`);
  for (const p of problems.slice(0, 10)) console.log(`    ${p.ref}`);
}

if (DRY) { console.log('\n(--dry-run: לא נכתב כלום)'); process.exit(0); }

let done = 0;
for (const [label, ids] of Object.entries(updates)) {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await sb.from('talmud_references')
      .update({ validated_by: label, validated_at: new Date().toISOString() })
      .in('id', ids.slice(i, i + 100));
    if (error) { console.error(`❌ ${label} @${i}: ${error.message}`); continue; }
    done += Math.min(100, ids.length - i);
    if (done % 1000 === 0) process.stdout.write(`\r   נכתבו ${done}…`);
  }
}
console.log(`\n✅ ${done} הפניות סומנו`);
