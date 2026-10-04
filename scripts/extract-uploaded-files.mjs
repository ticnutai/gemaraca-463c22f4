#!/usr/bin/env node
/**
 * חילוץ הטקסט מן הקבצים שהועלו ושדה הטקסט שלהם נשאר ריק
 * ──────────────────────────────────────────────────────────
 * 612 שורות במסד נושאות כותרת ו-`source_url` תקין, אבל עמודת הטקסט ריקה:
 * הקובץ עלה לאחסון בהצלחה, וחילוץ הטקסט ממנו נכשל בזמן ההעלאה. מי שלוחץ
 * עליהן באפליקציה מקבל דף לבן.
 *
 * אין כאן אף PDF סרוק, ולכן אין צורך ב-OCR:
 *   300 docx · 197 doc · 80 html · 31 בלי סיומת · 4 אחר
 *
 * הזיהוי נעשה **לפי חתימת הקובץ ולא לפי הסיומת**, כי לשלושים ואחד מהם אין
 * סיומת כלל, וגם סיומת קיימת יכולה לשקר:
 *   50 4b 03 04  → zip, כלומר docx
 *   d0 cf 11 e0  → OLE2, כלומר Word 97
 *   3c           → '<', כלומר HTML
 *
 * שני המחלצים כבר אומתו בהורדת gov.il: `docxToText` קורא גם את הערות
 * השוליים, ששם יושבים מראי המקומות, ו-antiword הושווה מול Word עצמו
 * ונתן תו שגוי אחד ב-48,340 אותיות עבריות.
 *
 * שימוש:
 *   node scripts/extract-uploaded-files.mjs --dry-run
 *   node scripts/extract-uploaded-files.mjs [--limit 10] [--delay 300]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { BlobReader, ZipReader, TextWriter, configure } from '@zip.js/zip.js';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

configure({ useWebWorkers: false });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', Infinity);
const DELAY = num('--delay', 250);

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_]+)="?([^"\r]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('❌ התחברות נכשלה:', authErr.message); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tidy = (s) => String(s ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/** XML של Word → טקסט. גבול פסקה הוא `<w:p>` */
const xmlToText = (xml) => tidy(String(xml || '')
  .replace(/<w:p[ >]/g, '\n<w:p ')
  .replace(/<w:tab\/>/g, '\t')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

/** docx — כולל הערות השוליים, ששם יושבים מראי המקומות */
async function fromDocx(buf) {
  const zip = new ZipReader(new BlobReader(new Blob([buf])));
  try {
    const entries = await zip.getEntries();
    const part = async (name) => {
      const e = entries.find((x) => x.filename === name);
      return e ? xmlToText(await e.getData(new TextWriter())) : '';
    };
    const body = await part('word/document.xml');
    const notes = [await part('word/footnotes.xml'), await part('word/endnotes.xml')]
      .filter((s) => s.length > 20).join('\n');
    return { body, notes };
  } finally { await zip.close(); }
}

/** doc בינארי של Word 97, דרך antiword */
function fromDoc(path) {
  const out = execFileSync('antiword', ['-m', 'UTF-8.txt', '-w', '0', path],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // סימני פסקה בלי מיפוי יוצאים כ-U+FFFD בשורה לעצמם ואינם נוגעים במילים
  return { body: tidy(out.replace(/^[�\s]*�[�\s]*$/gm, '')), notes: '' };
}

const fromHtml = (buf) => ({
  body: tidy(buf.toString('utf8')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')),
  notes: '',
});

/** החתימה קובעת, לא הסיומת */
function sniff(buf) {
  if (buf.length < 4) return null;
  const b = buf.subarray(0, 4);
  if (b[0] === 0x50 && b[1] === 0x4b) return 'docx';            // PK — zip
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11) return 'doc';  // OLE2
  if (b[0] === 0x25 && b[1] === 0x50) return 'pdf';             // %PDF
  if (b[0] === 0x3c) return 'html';                              // '<'
  // RTF ולפעמים HTML שמתחיל ברווחים
  const head = buf.subarray(0, 200).toString('latin1').trimStart();
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (/^<!?[a-zA-Z]/.test(head)) return 'html';
  return null;
}

// ── מי ריק ──────────────────────────────────────────────────
const MIRROR = join(ROOT, 'data', 'gemaraca-cloud.db');
if (!existsSync(MIRROR)) { console.error('❌ אין מראה מקומית. הרץ: npm run local:mirror'); process.exit(1); }
const mirror = new DatabaseSync(MIRROR);
const empty = mirror.prepare(`SELECT id, title, source_url FROM psakei_din
  WHERE LENGTH(TRIM(COALESCE(original_text, full_text, ''))) < 400
    AND source_url IS NOT NULL AND source_url != ''`).all();
console.log(`שורות עם שדה טקסט ריק וקובץ מקור: ${empty.length}`);

if (DRY) {
  const byExt = {};
  for (const r of empty) {
    const m = decodeURIComponent(r.source_url).match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
    const k = m ? m[1].toLowerCase() : '(בלי סיומת)';
    byExt[k] = (byExt[k] || 0) + 1;
  }
  console.log(`לפי סיומת: ${JSON.stringify(byExt)}`);
  console.log('(--dry-run: לא הורד ולא נכתב כלום)');
  process.exit(0);
}

const tmp = join(tmpdir(), 'gemaraca-uploads');
mkdirSync(tmp, { recursive: true });

const stats = { filled: 0, short: 0, unknown: 0, httpFail: 0, extractFail: 0, pdf: 0 };
const failures = [];
let n = 0;

for (const r of empty.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
  n++;
  let buf;
  try {
    const resp = await fetch(r.source_url);
    if (!resp.ok) throw new Error(`http ${resp.status}`);
    buf = Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    stats.httpFail++;
    failures.push({ id: r.id, title: r.title, why: `הורדה: ${e.message}` });
    continue;
  }

  const kind = sniff(buf);
  if (!kind) { stats.unknown++; failures.push({ id: r.id, title: r.title, why: 'חתימה לא מוכרת' }); continue; }
  if (kind === 'pdf') { stats.pdf++; failures.push({ id: r.id, title: r.title, why: 'PDF — ייתכן שדרוש OCR' }); continue; }

  let got;
  const path = join(tmp, `${r.id}.${kind}`);
  try {
    if (kind === 'docx') got = await fromDocx(buf);
    else if (kind === 'doc') { writeFileSync(path, buf); got = fromDoc(path); }
    else got = fromHtml(buf);
  } catch (e) {
    stats.extractFail++;
    failures.push({ id: r.id, title: r.title, why: `חילוץ ${kind}: ${e.message}` });
    continue;
  } finally {
    try { if (existsSync(path)) rmSync(path, { force: true }); } catch { /* זמני */ }
  }

  if (!got?.body || got.body.replace(/\s/g, '').length < 300) {
    stats.short++;
    failures.push({ id: r.id, title: r.title, why: `טקסט קצר מדי (${got?.body?.length ?? 0}, ${kind})` });
    continue;
  }

  const text = got.notes ? `${got.body}\n\n— הערות —\n${got.notes}` : got.body;
  const { error } = await sb.from('psakei_din')
    .update({ original_text: text, full_text: text }).eq('id', r.id);
  if (error) { stats.extractFail++; failures.push({ id: r.id, title: r.title, why: `כתיבה: ${error.message}` }); continue; }
  stats.filled++;
  if (stats.filled <= 5 || stats.filled % 50 === 0) {
    console.log(`  ✔ ${String(stats.filled).padStart(4)} [${kind}] ${text.length} תווים — ${String(r.title).slice(0, 42)}`);
  }
  await sleep(DELAY);
}

const out = join(ROOT, 'scripts', 'data', `uploads-not-extracted-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(out, JSON.stringify(failures, null, 2), 'utf8');
console.log(`\n✅ מולאו ${stats.filled} מתוך ${n}`);
console.log(`   קצרים מדי ${stats.short} | חתימה לא מוכרת ${stats.unknown} | PDF ${stats.pdf} | הורדה נכשלה ${stats.httpFail} | חילוץ נכשל ${stats.extractFail}`);
if (failures.length) console.log(`   מה שלא נכנס נרשם ב-${out}`);
