#!/usr/bin/env node
/**
 * קציר שכבת "עין משפט נר מצוה" מספריא
 * ──────────────────────────────────────────────────────────
 * כל מה שבנינו עד כה הולך בכיוון אחד: מפסק דין אל דף הגמרא. עין משפט הולך
 * בכיוון ההפוך — מדף הגמרא אל ההלכה שנפסקה ממנו ברמב"ם, בסמ"ג, בטור
 * ובשולחן ערוך. זהו מפתח מסורתי בן מאות שנים, והוא מתויג ביד:
 *
 *   קידושין ב ע"א → רמב"ם אישות א,ב · סמ"ג עשין מח · טור אה"ע כו ·
 *                   שולחן ערוך אה"ע כו,ד
 *
 * הטקסטים שאליהם הוא מפנה הם נחלת הכלל, והקישורים עצמם מתפרסמים בספריא
 * ברישיון חופשי. הקציר שומר לקאש מקומי, כדי שאפשר יהיה להריץ אותו שוב
 * בלי לטעון מחדש את מה שכבר ירד — ובלי להעמיס על ספריא.
 *
 * קצב: בקשה אחת לעמוד, 5,375 עמודים. בהשהיה של 700 מילישניות זה כשעה.
 * כישלון נרשם ואינו עוצר את הריצה, והרצה חוזרת מנסה רק את מה שנפל.
 *
 * שימוש:
 *   node scripts/harvest-ein-mishpat.mjs --limit 20
 *   node scripts/harvest-ein-mishpat.mjs [--delay 700] [--retry]
 *   node scripts/harvest-ein-mishpat.mjs --stats
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHAS = join(ROOT, 'public', 'shas');
const CACHE = join(ROOT, 'scripts', 'data', 'ein_mishpat');
const FAILED = join(ROOT, 'scripts', 'data', 'ein_mishpat_failed.json');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const LIMIT = num('--limit', Infinity);
const DELAY = num('--delay', 700);

mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** כל העמודים שיש לנו, מתוך מאגר הש"ס המקומי */
function allAmudim() {
  const out = [];
  for (const f of readdirSync(SHAS).filter((x) => x.endsWith('.json.gz'))) {
    const j = JSON.parse(gunzipSync(readFileSync(join(SHAS, f))).toString('utf8'));
    const slug = (j.slug ?? f.replace('.json.gz', '')).replace(/_/g, ' ');
    for (const [key, page] of Object.entries(j.amudim ?? {})) {
      out.push({ file: `${j.slug ?? f.replace('.json.gz', '')}_${key}`, ref: `${slug}.${key}`, he: page.masechet, key });
    }
  }
  return out;
}

if (has('--stats')) {
  const files = existsSync(CACHE) ? readdirSync(CACHE).filter((f) => f.endsWith('.json')) : [];
  let links = 0; const byBook = {};
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
    links += j.links.length;
    for (const l of j.links) {
      const book = String(l.ref).split(/,|\s\d/)[0].trim();
      byBook[book] = (byBook[book] || 0) + 1;
    }
  }
  console.log(`עמודים בקאש: ${files.length} | קישורי עין משפט: ${links}`);
  console.log('לפי ספר:');
  Object.entries(byBook).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(6)}  ${k}`));
  process.exit(0);
}

const pages = allAmudim();
console.log(`עמודים במאגר: ${pages.length}`);

const prevFailed = existsSync(FAILED) ? JSON.parse(readFileSync(FAILED, 'utf8')) : [];
const retryOnly = has('--retry') ? new Set(prevFailed.map((f) => f.file)) : null;

let done = 0, cached = 0, withLinks = 0, totalLinks = 0;
const failures = [];

for (const p of pages) {
  if (done >= LIMIT) break;
  const out = join(CACHE, `${p.file}.json`);
  if (existsSync(out) && !retryOnly) { cached++; continue; }
  if (retryOnly && !retryOnly.has(p.file)) { cached++; continue; }

  try {
    const r = await fetch(`https://www.sefaria.org/api/links/${encodeURIComponent(p.ref)}?with_text=0`, {
      headers: { accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`http ${r.status}`);
    const all = await r.json();
    if (!Array.isArray(all)) throw new Error('תשובה שאינה מערך');
    // הסוג הוא המפתח. `category` מתאר את הספר שאליו מפנים ולא את סוג הקשר —
    // בלבול בין השניים כבר עלה לנו ביוקר פעם אחת.
    const links = all
      .filter((l) => String(l.type ?? '').toLowerCase().includes('ein mishpat'))
      .map((l) => ({ ref: l.ref, anchor: l.anchorRef ?? l.anchorRefExpanded?.[0] ?? p.ref, category: l.category }));
    writeFileSync(out, JSON.stringify({ ref: p.ref, he: p.he, amud: p.key, links }), 'utf8');
    done++;
    if (links.length) { withLinks++; totalLinks += links.length; }
    if (done % 100 === 0) console.log(`  ${done} עמודים | ${totalLinks} קישורים | ${failures.length} כשלונות`);
  } catch (e) {
    failures.push({ file: p.file, ref: p.ref, error: e.message });
    if (failures.length <= 5) console.error(`  ❌ ${p.ref}: ${e.message}`);
  }
  await sleep(DELAY);
}

writeFileSync(FAILED, JSON.stringify(failures, null, 2), 'utf8');
console.log(`\n✅ ${done} עמודים חדשים | ${cached} היו בקאש | ${withLinks} עם עין משפט | ${totalLinks} קישורים | ${failures.length} כשלונות`);
if (failures.length) console.log(`   הכשלונות ב-${FAILED} — הרצה עם --retry תנסה רק אותם`);
