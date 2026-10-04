#!/usr/bin/env node
/**
 * ייבוא עין משפט נר מצוה מן הקאש אל המסד
 * ──────────────────────────────────────────────────────────
 * הקוצר (`harvest-ein-mishpat.mjs`) שומר קובץ לכל עמוד. כאן הם נכנסים
 * לטבלה `ein_mishpat`, שאינה תלויה בפסקי דין: היא מתארת את הש"ס עצמו.
 *
 * העוגן בספריא הוא "Kiddushin 2a:1" — מסכת, דף, עמוד וקטע. הקטע אינו
 * מעניין אותנו: ההפניה היא לעמוד. שם המסכת מתורגם לעברית מן הטבלה
 * הקנונית, ומה שאין לו תרגום מדולג ומדווח — עדיף לאבד קישור מאשר לכתוב
 * מסכת שאינה קיימת אצלנו.
 *
 * שימוש:
 *   node scripts/import-ein-mishpat.mjs --dry-run
 *   node scripts/import-ein-mishpat.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', 'data', 'ein_mishpat');
const DRY = process.argv.includes('--dry-run');

if (!existsSync(CACHE)) { console.error('❌ אין קאש. הרץ קודם: node scripts/harvest-ein-mishpat.mjs'); process.exit(1); }

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

// שם ספריא → שם עברי
const src = readFileSync(join(ROOT, 'src/lib/masechtotData.ts'), 'utf8');
const HE = Object.fromEntries([...src.matchAll(/hebrewName:\s*"([^"]+)",\s*englishName:\s*"[^"]+",\s*sefariaName:\s*"([^"]+)"/g)]
  .map((m) => [m[2].replace(/_/g, ' '), m[1]]));

/** "Shulchan Arukh, Even HaEzer 26:4" → "Shulchan Arukh" */
const bookOf = (ref) => String(ref).split(',')[0].replace(/\s+\d.*$/, '').trim();

const rows = [];
const unknown = new Set();
let pages = 0, empty = 0;

for (const f of readdirSync(CACHE).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
  pages++;
  if (!j.links?.length) { empty++; continue; }
  // "Kiddushin.2a" → המסכת והעמוד
  const m = String(j.ref).match(/^(.+)\.(\d+)([ab])$/);
  if (!m) continue;
  const he = HE[m[1]] ?? j.he;
  if (!he) { unknown.add(m[1]); continue; }
  const seen = new Set();
  for (const l of j.links) {
    if (!l.ref || seen.has(l.ref)) continue;
    seen.add(l.ref);
    rows.push({
      tractate: he, daf: Number(m[2]), amud: m[3],
      sefaria_ref: `${m[1]} ${m[2]}${m[3]}`,
      target_ref: l.ref, target_book: bookOf(l.ref), category: l.category ?? null,
    });
  }
}

console.log(`עמודים בקאש: ${pages} | בלי עין משפט: ${empty}`);
console.log(`קישורים לייבוא: ${rows.length}`);
if (unknown.size) console.log(`⚠ מסכתות בלי תרגום (דולגו): ${[...unknown].join(', ')}`);
const byBook = {};
for (const r of rows) byBook[r.target_book] = (byBook[r.target_book] || 0) + 1;
console.log('לפי ספר:');
Object.entries(byBook).sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([k, v]) => console.log(`  ${String(v).padStart(6)}  ${k}`));
rows.slice(0, 4).forEach((r) => console.log(`   · ${r.tractate} ${r.daf}${r.amud} → ${r.target_ref}`));

if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }

let added = 0, failed = 0;
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await sb.from('ein_mishpat')
    .upsert(rows.slice(i, i + 500), { onConflict: 'tractate,daf,amud,target_ref', ignoreDuplicates: true });
  if (error) { failed++; console.error(`❌ @${i}: ${error.message}`); continue; }
  added += Math.min(500, rows.length - i);
  if (added % 5000 === 0) console.log(`  ${added}/${rows.length}`);
}
console.log(`✅ ${added} קישורי עין משפט נכנסו${failed ? ` | ${failed} מקטעים נכשלו` : ''}`);
