#!/usr/bin/env node
/**
 * Upload Shas PDF pages to Supabase Storage
 * 
 * Reads PDFs from local שס/ folder structure and uploads them to
 * the 'shas-pdf-pages' Supabase Storage bucket.
 * 
 * Usage:
 *   node scripts/upload-shas-pdfs.mjs                     # Upload all
 *   node scripts/upload-shas-pdfs.mjs --masechet ברכות     # Upload specific masechet
 *   node scripts/upload-shas-pdfs.mjs --verify             # Check what's uploaded
 *   node scripts/upload-shas-pdfs.mjs --dry-run            # Show what would be uploaded
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHAS_DIR = path.join(ROOT, 'שס_נקי');
const BUCKET = 'shas-pdf-pages';

// Supabase config
const SUPABASE_URL = 'https://jaotdqumpcfhcbkgtfib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imphb3RkcXVtcGNmaGNia2d0ZmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyNDE0MTAsImV4cCI6MjA3NDgxNzQxMH0.t7kmGMKJvcjudbKxUPgQkqmycrCUPTvv5x4Q7byQcK0';

// ─── Hebrew ↔ Sefaria Masechet Mapping ──────────────────
const MASECHET_MAP = {
  'ברכות':     { sefaria: 'Berakhot', seder: 'זרעים' },
  'שבת':       { sefaria: 'Shabbat', seder: 'מועד' },
  'עירובין':   { sefaria: 'Eruvin', seder: 'מועד' },
  'פסחים':     { sefaria: 'Pesachim', seder: 'מועד' },
  'שקלים':     { sefaria: 'Shekalim', seder: 'מועד' },
  'יומא':      { sefaria: 'Yoma', seder: 'מועד' },
  'סוכה':      { sefaria: 'Sukkah', seder: 'מועד' },
  'ביצה':      { sefaria: 'Beitzah', seder: 'מועד' },
  'ראש השנה':  { sefaria: 'Rosh_Hashanah', seder: 'מועד' },
  'תענית':     { sefaria: 'Taanit', seder: 'מועד' },
  'מגילה':     { sefaria: 'Megillah', seder: 'מועד' },
  'מועד קטן':  { sefaria: 'Moed_Katan', seder: 'מועד' },
  'חגיגה':     { sefaria: 'Chagigah', seder: 'מועד' },
  'יבמות':     { sefaria: 'Yevamot', seder: 'נשים' },
  'כתובות':    { sefaria: 'Ketubot', seder: 'נשים' },
  'נדרים':     { sefaria: 'Nedarim', seder: 'נשים' },
  'נזיר':      { sefaria: 'Nazir', seder: 'נשים' },
  'סוטה':      { sefaria: 'Sotah', seder: 'נשים' },
  'גיטין':     { sefaria: 'Gittin', seder: 'נשים' },
  'קידושין':   { sefaria: 'Kiddushin', seder: 'נשים' },
  'בבא קמא':   { sefaria: 'Bava_Kamma', seder: 'נזיקין' },
  'בבא מציעא':  { sefaria: 'Bava_Metzia', seder: 'נזיקין' },
  'בבא בתרא':   { sefaria: 'Bava_Batra', seder: 'נזיקין' },
  'סנהדרין':   { sefaria: 'Sanhedrin', seder: 'נזיקין' },
  'מכות':      { sefaria: 'Makkot', seder: 'נזיקין' },
  'שבועות':    { sefaria: 'Shevuot', seder: 'נזיקין' },
  'עבודה זרה': { sefaria: 'Avodah_Zarah', seder: 'נזיקין' },
  'הוריות':    { sefaria: 'Horayot', seder: 'נזיקין' },
  'זבחים':     { sefaria: 'Zevachim', seder: 'קדשים' },
  'מנחות':     { sefaria: 'Menachot', seder: 'קדשים' },
  'חולין':     { sefaria: 'Chullin', seder: 'קדשים' },
  'בכורות':    { sefaria: 'Bekhorot', seder: 'קדשים' },
  'ערכין':     { sefaria: 'Arakhin', seder: 'קדשים' },
  'תמורה':     { sefaria: 'Temurah', seder: 'קדשים' },
  'כריתות':    { sefaria: 'Keritot', seder: 'קדשים' },
  'מעילה':     { sefaria: 'Meilah', seder: 'קדשים' },
  'תמיד':      { sefaria: 'Tamid', seder: 'קדשים' },
  'נידה':      { sefaria: 'Niddah', seder: 'טהרות' },
};

// ─── Hebrew Gematria Parser ─────────────────────────────
const GEMATRIA = {
  'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
  'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90,
  'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400,
};

function parseGematria(heb) {
  // Handle special cases: טו=15, טז=16
  if (heb === 'טו') return 15;
  if (heb === 'טז') return 16;
  let sum = 0;
  for (const ch of heb) {
    sum += GEMATRIA[ch] || 0;
  }
  return sum;
}

/**
 * Parse filename like "דף_ב_עמוד_א.pdf" or "2a.pdf" → { daf: 2, amud: 'a' }
 */
function parseFileName(name) {
  // Sefaria-style: 2a.pdf, 10b.pdf, etc.
  const sefariaMatch = name.match(/^(\d+)(a|b)\.pdf$/);
  if (sefariaMatch) {
    return { daf: parseInt(sefariaMatch[1], 10), amud: sefariaMatch[2] };
  }
  // Hebrew-style: דף_XXX_עמוד_Y.pdf
  const match = name.match(/^דף_(.+)_עמוד_(א|ב)\.pdf$/);
  if (!match) return null;
  const daf = parseGematria(match[1]);
  const amud = match[2] === 'א' ? 'a' : 'b';
  return { daf, amud };
}

// ─── Main ───────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verifyOnly = args.includes('--verify');
  const masechetIdx = args.indexOf('--masechet');
  const filterMasechet = masechetIdx >= 0 ? args[masechetIdx + 1] : null;

  console.log('\n══════════════════════════════════════════════════');
  console.log('   📤 Upload Shas PDFs to Supabase Storage');
  console.log('══════════════════════════════════════════════════\n');

  if (!fs.existsSync(SHAS_DIR)) {
    console.error(`❌ תיקיית שס לא נמצאה: ${SHAS_DIR}`);
    process.exit(1);
  }

  // Login to Supabase
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('🔐 מתחבר...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (authError) {
    console.error('❌ התחברות נכשלה:', authError.message);
    process.exit(1);
  }
  console.log(`✅ מחובר כ: ${authData.user.email}\n`);

  // Scan local שס/ folder structure
  const sedarim = fs.readdirSync(SHAS_DIR).filter(d =>
    fs.statSync(path.join(SHAS_DIR, d)).isDirectory()
  );

  let totalFiles = 0;
  let uploaded = 0;
  let skipped = 0;
  let errors = 0;

  for (const seder of sedarim) {
    const sederDir = path.join(SHAS_DIR, seder);
    const masechtot = fs.readdirSync(sederDir).filter(d =>
      fs.statSync(path.join(sederDir, d)).isDirectory()
    );

    for (const masechetHeb of masechtot) {
      if (filterMasechet && masechetHeb !== filterMasechet) continue;

      const info = MASECHET_MAP[masechetHeb];
      if (!info) {
        console.log(`⚠️  מסכת לא מוכרת: ${masechetHeb} - מדלג`);
        continue;
      }

      const masechetDir = path.join(sederDir, masechetHeb);
      const pdfFiles = fs.readdirSync(masechetDir).filter(f => f.endsWith('.pdf'));

      console.log(`\n📖 ${masechetHeb} (${info.sefaria}) - ${pdfFiles.length} קבצים`);

      for (const pdfFile of pdfFiles) {
        const parsed = parseFileName(pdfFile);
        if (!parsed) {
          console.log(`  ⚠️  שם קובץ לא תקין: ${pdfFile}`);
          continue;
        }

        totalFiles++;
        const storagePath = `${info.sefaria}/${parsed.daf}${parsed.amud}.pdf`;
        const localPath = path.join(masechetDir, pdfFile);
        const fileSize = fs.statSync(localPath).size;

        if (fileSize < 1000) {
          console.log(`  ⚠️  קובץ קטן מדי (${fileSize}b): ${pdfFile}`);
          skipped++;
          continue;
        }

        if (dryRun) {
          console.log(`  [DRY] ${pdfFile} → ${storagePath} (${(fileSize / 1024).toFixed(0)}KB)`);
          continue;
        }

        if (verifyOnly) {
          // Check if exists in storage
          const { data } = await supabase.storage.from(BUCKET).list(info.sefaria, {
            search: `${parsed.daf}${parsed.amud}.pdf`
          });
          const exists = data && data.some(f => f.name === `${parsed.daf}${parsed.amud}.pdf`);
          if (exists) {
            skipped++;
          } else {
            console.log(`  ❌ חסר: ${storagePath}`);
            errors++;
          }
          continue;
        }

        // Upload to Supabase Storage
        try {
          const fileBuffer = fs.readFileSync(localPath);
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, fileBuffer, {
              contentType: 'application/pdf',
              upsert: true,
            });

          if (uploadError) {
            console.error(`  ❌ שגיאה בהעלאת ${pdfFile}: ${uploadError.message}`);
            errors++;
            continue;
          }

          // Insert metadata into tracking table
          const { error: dbError } = await supabase
            .from('shas_pdf_pages')
            .upsert({
              masechet: info.sefaria,
              hebrew_name: masechetHeb,
              seder: info.seder,
              daf_number: parsed.daf,
              amud: parsed.amud,
              storage_path: storagePath,
              file_size: fileSize,
            }, { onConflict: 'masechet,daf_number,amud' });

          if (dbError) {
            console.error(`  ⚠️  DB error for ${pdfFile}: ${dbError.message}`);
          }

          uploaded++;
          if (uploaded % 10 === 0 || uploaded === 1) {
            console.log(`  ✅ [${uploaded}] ${pdfFile} → ${storagePath} (${(fileSize / 1024).toFixed(0)}KB)`);
          }
        } catch (err) {
          console.error(`  ❌ שגיאה: ${err.message}`);
          errors++;
        }
      }
    }
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  סה"כ: ${totalFiles} קבצים`);
  if (!dryRun && !verifyOnly) {
    console.log(`  ✅ הועלו: ${uploaded}`);
  }
  if (verifyOnly) {
    console.log(`  ✅ קיימים: ${skipped}`);
    console.log(`  ❌ חסרים: ${errors}`);
  } else {
    console.log(`  ⏭️  דולגו: ${skipped}`);
    console.log(`  ❌ שגיאות: ${errors}`);
  }
  console.log('══════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
