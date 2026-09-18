#!/usr/bin/env node
/**
 * ייבוא כל פסקי הדין מ-all-psakim/ אל Supabase psakei_din
 * ──────────────────────────────────────────────────────────
 * - מחלץ מטאדאטה (כותרת, בית דין, תאריך, גוף הטקסט) מ-HTML
 * - source_url = נתיב Vercel לקובץ (כך שאפשר לפתוח אותו ישירות)
 * - תג "psakim.org" לזיהוי פסקים מהסקריפט
 * - בדיקת כפילויות לפי title (skip אם כבר קיים)
 * - batched inserts — 50 בכל פעם
 *
 * שימוש:
 *   node scripts/import-psakim-to-db.mjs            # ייבוא מלא
 *   node scripts/import-psakim-to-db.mjs --dry-run  # רק ספירה, ללא כתיבה
 *   node scripts/import-psakim-to-db.mjs --limit 10 # רק 10 ראשונים
 */

import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

// ── Config ──────────────────────────────────────────────
const SUPABASE_URL = 'https://jaotdqumpcfhcbkgtfib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imphb3RkcXVtcGNmaGNia2d0ZmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyNDE0MTAsImV4cCI6MjA3NDgxNzQxMH0.t7kmGMKJvcjudbKxUPgQkqmycrCUPTvv5x4Q7byQcK0';
const APP_BASE_URL = 'https://gemaraca.lovable.app';
const ALL_PSAKIM_DIR = 'all-psakim';
const BATCH_SIZE = 50;
const ORIGIN_TAG = 'psakim.org';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;

// ── Supabase client ─────────────────────────────────────
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── HTML Metadata Extraction ────────────────────────────

function extractTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m ? m[1].trim() : null;
}

function extractMetaField(html, label) {
  // <span class="label">בית דין</span> ארץ חמדה גזית
  const re = new RegExp(`class=["']label["']>${escapeRegex(label)}<\\/span>\\s*([^<]*)`, 'i');
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function extractCaseNumber(html) {
  // subtitle contains "מס׳ סידורי 725"
  const m = html.match(/class=["']subtitle["']>([^<]*)/);
  if (m) {
    const num = m[1].match(/\d+/);
    return num ? num[0] : m[1].trim();
  }
  return null;
}

function extractBodyText(html) {
  // Get text inside psak-card (plain text for summary/search)
  const cardMatch = html.match(/class=["']psak-card["']>([\s\S]*?)(?:<\/article>|<footer)/);
  if (!cardMatch) return null;
  let text = cardMatch[1]
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 10 ? text : null;
}

function extractBodyHtml(html) {
  // Get inner HTML of psak-card for rich display in viewer
  const cardMatch = html.match(/class=["']psak-card["']>([\s\S]*?)(?:<\/article>|<footer)/);
  if (!cardMatch) return null;
  return cardMatch[1].trim();
}

function hebrewYearToGregorian(dateStr) {
  // Try to extract year from Hebrew date like "כ"ג אלול תשע"ד"
  // Map Hebrew year suffixes: תש = 5700, תשע = 5770, etc.
  if (!dateStr) return new Date().getFullYear();
  
  // Try numeric year
  const numMatch = dateStr.match(/\b(19|20)\d{2}\b/);
  if (numMatch) return Number(numMatch[0]);
  
  // Try Hebrew year pattern like תשפ"ו, תשע"ד
  const hebrewMatch = dateStr.match(/תש[א-ת]?"?[א-ת]/);
  if (hebrewMatch) {
    // Rough mapping: תש = ~1940, תשי = ~1950, תשכ = ~1960, תשל = ~1970
    // תשמ = ~1980, תשנ = ~1990, תשס = ~2000, תשע = ~2010, תשפ = ~2020
    const heb = dateStr;
    if (heb.includes('תשפ')) return 2020 + extractSmallGematria(heb, 'תשפ');
    if (heb.includes('תשע')) return 2010 + extractSmallGematria(heb, 'תשע');
    if (heb.includes('תשס')) return 2000 + extractSmallGematria(heb, 'תשס');
    if (heb.includes('תשנ')) return 1990 + extractSmallGematria(heb, 'תשנ');
    if (heb.includes('תשמ')) return 1980 + extractSmallGematria(heb, 'תשמ');
    if (heb.includes('תשל')) return 1970 + extractSmallGematria(heb, 'תשל');
    if (heb.includes('תשכ')) return 1960 + extractSmallGematria(heb, 'תשכ');
    if (heb.includes('תשי')) return 1950 + extractSmallGematria(heb, 'תשי');
    if (heb.includes('תש')) return 1940 + extractSmallGematria(heb, 'תש');
  }
  
  return new Date().getFullYear();
}

function extractSmallGematria(str, prefix) {
  // After prefix, find the units letter (e.g. תשע"ד → ד = 4)
  const after = str.substring(str.indexOf(prefix) + prefix.length).replace(/[""׳']/g, '');
  const VALS = { 'א':1,'ב':2,'ג':3,'ד':4,'ה':5,'ו':6,'ז':7,'ח':8,'ט':9 };
  if (after.length > 0 && VALS[after[0]]) return VALS[after[0]];
  return 0;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function extractPsakFile(filePath) {
  const html = readFileSync(filePath, 'utf8');
  const title = extractTitle(html);
  if (!title) return null;

  const court = extractMetaField(html, 'בית דין') || 'לא צוין';
  const dateStr = extractMetaField(html, 'תאריך');
  const year = hebrewYearToGregorian(dateStr);
  const caseNumber = extractCaseNumber(html);
  const bodyText = extractBodyText(html);
  const bodyHtml = extractBodyHtml(html);
  
  // Summary = first ~300 chars of plain text body
  const summary = bodyText
    ? bodyText.substring(0, 300) + (bodyText.length > 300 ? '...' : '')
    : `פסק דין: ${title}`;

  return {
    title,
    court,
    year,
    case_number: caseNumber,
    summary,
    full_text: bodyHtml || bodyText,
    source_url: null,
    tags: [ORIGIN_TAG],
    content_hash: sha256(html),
  };
}

// ── Main ────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  📥 ייבוא פסקי דין מ-all-psakim/ → Supabase');
  console.log('═══════════════════════════════════════════\n');

  // 1. Authenticate
  console.log('🔐 מתחבר...');
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (authErr) {
    console.error('❌ Auth failed:', authErr.message);
    process.exit(1);
  }
  console.log('✅ מחובר\n');

  // 2. Get list of HTML files
  const files = readdirSync(ALL_PSAKIM_DIR)
    .filter(f => f.endsWith('.html') && f !== 'index.html')
    .slice(0, LIMIT);
  console.log(`📂 ${files.length} קבצי HTML נמצאו\n`);

  // 3. Load existing titles from DB to skip duplicates
  console.log('🔍 בודק כפילויות...');
  const existingTitles = new Set();
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from('psakei_din')
      .select('title')
      .range(offset, offset + 999);
    if (error) { console.error('DB error:', error.message); break; }
    if (!data || data.length === 0) break;
    data.forEach(r => existingTitles.add(r.title));
    offset += 1000;
  }
  console.log(`  ${existingTitles.size} פסקים קיימים בדאטהבייס\n`);

  // 4. Extract metadata from HTML files
  console.log('🔄 מחלץ מטאדאטה...');
  const toInsert = [];
  let skippedDupe = 0;
  let skippedError = 0;

  for (const file of files) {
    const filePath = join(ALL_PSAKIM_DIR, file);
    try {
      const data = extractPsakFile(filePath);
      if (!data) { skippedError++; continue; }
      
      if (existingTitles.has(data.title)) {
        skippedDupe++;
        continue;
      }
      
      toInsert.push(data);
      existingTitles.add(data.title); // prevent dups within batch
    } catch (e) {
      skippedError++;
    }
  }

  console.log(`  ✅ ${toInsert.length} לייבוא`);
  console.log(`  ⏭️  ${skippedDupe} כפילויות דולגו`);
  console.log(`  ⚠️  ${skippedError} שגיאות\n`);

  if (DRY_RUN) {
    console.log('🏁 DRY RUN — לא מבצע כתיבה.');
    // Show sample
    if (toInsert.length > 0) {
      console.log('\nדוגמה:');
      const s = toInsert[0];
      console.log(`  title: ${s.title}`);
      console.log(`  court: ${s.court}`);
      console.log(`  year: ${s.year}`);
      console.log(`  source_url: ${s.source_url}`);
      console.log(`  tags: ${JSON.stringify(s.tags)}`);
      console.log(`  summary: ${s.summary.substring(0, 100)}...`);
    }
    process.exit(0);
  }

  if (toInsert.length === 0) {
    console.log('🎉 אין פסקים חדשים לייבוא — הכל כבר בדאטהבייס!');
    process.exit(0);
  }

  // 5. Batch insert
  console.log(`📤 מייבא ${toInsert.length} פסקים ב-${Math.ceil(toInsert.length / BATCH_SIZE)} batches...\n`);
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { error } = await sb.from('psakei_din').insert(batch);
    
    if (error) {
      console.error(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      // Fallback: insert one by one
      for (const row of batch) {
        const { error: singleErr } = await sb.from('psakei_din').insert(row);
        if (singleErr) {
          failed++;
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
    }

    const pct = Math.round(((i + batch.length) / toInsert.length) * 100);
    process.stdout.write(`\r  ⏳ ${pct}% — ${inserted} inserted, ${failed} failed`);
  }

  console.log(`\n\n${'═'.repeat(43)}`);
  console.log(`  🎉 ייבוא הושלם!`);
  console.log(`  ✅ ${inserted} פסקים יובאו בהצלחה`);
  if (failed > 0) console.log(`  ❌ ${failed} נכשלו`);
  if (skippedDupe > 0) console.log(`  ⏭️  ${skippedDupe} כפילויות דולגו`);
  console.log(`${'═'.repeat(43)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
