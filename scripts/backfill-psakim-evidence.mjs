#!/usr/bin/env node
/**
 * השלמת סוג הראיה להפניות שהגיעו ממפתח אתר פסקים
 * ──────────────────────────────────────────────────────────
 * הייבוא הראשון כתב את ההפניות מן המפתח בלי `validated_by`, ולכן 1,288 שורות
 * יושבות במסד בלי לומר מה הראיה שמאחוריהן. ההבחנה אינה קוסמטית: היא קובעת
 * איך האודיט מתייחס אליהן.
 *
 *   psakim-index-cited     — הדף כתוב בפסק במפורש
 *   psakim-index-editorial — האתר זיהה את הסוגיה מתוך תוכן הדברים
 *
 * ההגדרה נלקחת מ-`lib/psakim-citation.mjs`, אותו מודול שהייבוא משתמש בו, כדי
 * שלא תיווצר הגדרה שנייה שתיפרד מן הראשונה.
 *
 * שימוש:
 *   node scripts/backfill-psakim-evidence.mjs --dry-run
 *   node scripts/backfill-psakim-evidence.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';
import { normalizeForMatch, evidenceKind, VALIDATED_BY } from './lib/psakim-citation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts/data/psakim_org');
const DRY = process.argv.includes('--dry-run');

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

// טקסט הפסק לפי url — מן הקאש, שאינו עובר דרך המסד ולכן מהיר
const textByUrl = new Map();
// הייבוא המוקדם לא שמר source_url, ולכן דרושה גם התאמה לפי כותרת
const textByTitle = new Map();
const titleKey = (t) => String(t || '').replace(/[^א-ת0-9]/g, '').slice(0, 40);
for (const f of readdirSync(CACHE).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
  if (!j.text) continue;
  const norm = normalizeForMatch(j.text);
  if (j.url) textByUrl.set(j.url, norm);
  if (j.title) textByTitle.set(titleKey(j.title), norm);
}
console.log(`טקסטים בקאש: ${textByUrl.size} לפי url, ${textByTitle.size} לפי כותרת`);

// ההפניות חסרות הסיווג
const rows = [];
for (let f = 0; ; f += 1000) {
  const { data, error } = await sb.from('talmud_references')
    .select('id,psak_din_id,tractate,daf,raw_reference')
    .eq('source', 'site-index').is('validated_by', null).range(f, f + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
console.log(`הפניות ללא סיווג: ${rows.length}`);
if (!rows.length) process.exit(0);

// ה-url של כל פסק, כדי להגיע לטקסט שבקאש
const textById = new Map();
const ids = [...new Set(rows.map((r) => r.psak_din_id))];
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await sb.from('psakei_din').select('id,source_url,title').in('id', ids.slice(i, i + 200));
  for (const p of data ?? []) {
    const t = (p.source_url && textByUrl.get(p.source_url)) ?? textByTitle.get(titleKey(p.title));
    if (t) textById.set(p.id, t);
  }
}

/** המרת מספר הדף חזרה לאותיות, כפי שהמפתח כותב אותן */
const GEM = [[400,'ת'],[300,'ש'],[200,'ר'],[100,'ק'],[90,'צ'],[80,'פ'],[70,'ע'],[60,'ס'],[50,'נ'],[40,'מ'],[30,'ל'],[20,'כ'],[10,'י'],[9,'ט'],[8,'ח'],[7,'ז'],[6,'ו'],[5,'ה'],[4,'ד'],[3,'ג'],[2,'ב'],[1,'א']];
function toLetters(n) {
  let v = Number(n), out = '';
  if (!Number.isFinite(v)) return '';
  // ט״ו וט״ז אינם נכתבים י״ה וי״ו
  while (v > 0) {
    if (v === 15) { out += 'טו'; break; }
    if (v === 16) { out += 'טז'; break; }
    const hit = GEM.find(([x]) => x <= v);
    if (!hit) break;
    out += hit[1]; v -= hit[0];
  }
  return out;
}

const plan = { cited: [], editorial: [], noText: 0 };
for (const r of rows) {
  const text = textById.get(r.psak_din_id);
  if (!text) { plan.noText++; continue; }
  const kind = evidenceKind(text, r.tractate, toLetters(r.daf));
  plan[kind].push(r.id);
}
console.log(`  ציטוט מפורש: ${plan.cited.length} | זיהוי עריכתי: ${plan.editorial.length} | בלי טקסט בקאש: ${plan.noText}`);
if (DRY) { console.log('(--dry-run: לא נכתב כלום)'); process.exit(0); }

let done = 0;
for (const kind of ['cited', 'editorial']) {
  for (let i = 0; i < plan[kind].length; i += 100) {
    const { error } = await sb.from('talmud_references')
      .update({ validated_by: VALIDATED_BY[kind], validated_at: new Date().toISOString() })
      .in('id', plan[kind].slice(i, i + 100));
    if (error) { console.error(`❌ ${kind} ${i}: ${error.message}`); continue; }
    done += Math.min(100, plan[kind].length - i);
  }
}
console.log(`✅ סווגו ${done} הפניות`);
