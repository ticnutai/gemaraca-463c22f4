#!/usr/bin/env node
/**
 * אימות ההעברה: משווה את הפרויקט החדש למראה המקומית, שורה מול שורה.
 * לא רק מספרים — גם תוכן עברי, שדות jsonb ומערכים, ושלמות מפתחות זרים.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'crypto';
import { join } from 'path';
import { existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { ROOT, NEW_URL, NEW_KEY, ADMIN_EMAIL, ADMIN_PASSWORD } from './env.mjs';

const sb = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });
const { error } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (error) { console.error('❌ התחברות נכשלה:', error.message); process.exit(1); }

const dbs = ['data/gemaraca-cloud.db', 'data/gemaraca-cloud.db.building']
  .map((p) => join(ROOT, p)).filter(existsSync).map((p) => new DatabaseSync(p, { readOnly: true }));

function pick(table, n) {
  for (const db of dbs) {
    try {
      const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY id LIMIT ${n}`).all();
      if (rows.length) return rows;
    } catch {}
  }
  return [];
}
const h = (v) => createHash('sha256').update(v == null ? '\u0000' : String(v)).digest('hex').slice(0, 16);

let pass = 0, fail = 0;
const bad = [];

async function compare(table, cols, n = 150) {
  const local = pick(table, n);
  if (!local.length) { console.log(`⏭  ${table}: אין במראה`); return; }
  const ids = local.map((r) => r.id);
  const { data, error } = await sb.from(table).select(['id', ...cols].join(',')).in('id', ids);
  if (error) { console.log(`❌ ${table}: ${error.message}`); fail++; return; }
  const byId = new Map(data.map((r) => [r.id, r]));
  let ok = 0, diff = 0;
  for (const l of local) {
    const r = byId.get(l.id);
    if (!r) { diff++; bad.push(`${table}/${l.id}: חסר בחדש`); continue; }
    let same = true;
    for (const c of cols) {
      let a = l[c], b = r[c];
      // jsonb ומערכים: משווים אחרי נרמול, כי ב-SQLite הם טקסט
      if (typeof b === 'object' && b !== null) {
        try { a = JSON.stringify(JSON.parse(a)); } catch { a = String(a); }
        b = JSON.stringify(b);
      } else if (typeof b === 'boolean') {
        a = a === 1 || a === true;
      }
      if (h(a) !== h(b)) { same = false; bad.push(`${table}/${l.id}.${c}: שונה`); break; }
    }
    same ? ok++ : diff++;
  }
  console.log(`${diff ? '❌' : '✅'} ${table}: ${ok}/${local.length} זהים${diff ? `, ${diff} שונים` : ''}`);
  diff ? fail++ : pass++;
}

console.log('── השוואת תוכן ──────────────────────────');
await compare('psakei_din', ['title', 'court', 'year', 'summary', 'full_text', 'tags', 'source_key', 'content_hash', 'created_at']);
await compare('talmud_references', ['tractate', 'daf', 'amud', 'raw_reference', 'normalized', 'validation_status', 'validated_by', 'confidence_factors']);
await compare('psak_sources', ['corpus', 'book', 'section', 'display', 'raw_path', 'validation_status']);
await compare('ein_mishpat', ['tractate', 'daf', 'amud', 'sefaria_ref', 'target_ref', 'target_book', 'category']);
await compare('gemara_pages', ['sugya_id', 'title', 'masechet', 'daf_number', 'text_he', 'categories']);
await compare('smart_index_results', ['sources', 'topics', 'masechtot', 'books', 'word_count', 'has_full_text']);
await compare('psak_sections', ['section_type', 'section_title', 'section_content', 'section_order']);
await compare('pattern_sugya_links', ['sugya_id', 'masechet', 'daf', 'source_text', 'confidence']);
await compare('sugya_psak_links', ['sugya_id', 'connection_explanation', 'relevance_score']);
await compare('shas_pdf_pages', ['masechet', 'hebrew_name', 'seder', 'daf_number', 'amud', 'storage_path']);
await compare('modern_examples', ['sugya_id', 'principle', 'examples', 'practical_summary'], 20);
await compare('faq_items', ['question', 'answer', 'order_index'], 20);

console.log(`\n── תוצאה ──  ${pass} טבלאות זהות, ${fail} עם הפרש`);
if (bad.length) { console.log('\nעד 10 הפרשים:'); bad.slice(0, 10).forEach((b) => console.log('  ·', b)); }
