// חילוץ מראי מקומות בביטויים רגולריים, וחישוב מידת הביטחון
//
// הלוגיקה יושבת כאן ולא בתוך ה-Edge Function כדי שתהיה ניתנת לבדיקה מקומית:
// src/test/extractRegex.test.ts מריץ אותה על ציטוטים אמיתיים ועל המילים
// שנקראו בעבר בטעות כדפים.

import { TRACTATE_NAMES as TRACTATES, ABBREVIATIONS, parseHebrewNumber, isDafInRange, MASECHTOT } from "./masechtotData.ts";

const MAX_DAF: Record<string, number> = Object.fromEntries(MASECHTOT.map(m => [m.name, m.maxDaf]));

export function numberToHebrewLetter(n: number): string {
  const units = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const hundreds = ["", "ק", "ר", "ש", "ת"];
  if (n <= 0 || n > 500) return String(n);
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  if (t === 1 && u === 5) return hundreds[h] + "ט״ו";
  if (t === 1 && u === 6) return hundreds[h] + "ט״ז";
  let result = hundreds[h] + tens[t] + units[u];
  if (result.length > 1) {
    result = result.slice(0, -1) + "״" + result.slice(-1);
  } else {
    result += "׳";
  }
  return result;
}

export interface ConfidenceFactors {
  base_specificity: number;
  frequency_boost: number;
  context_type: string;
  context_boost: number;
  source_agreement: boolean;
  agreement_boost: number;
  proximity_boost: number;
  daf_range_valid: boolean;
  range_boost: number;
  total: number;
  capped: number;
}

export interface Reference {
  tractate: string;
  daf: string;
  amud: string | null;
  raw: string;
  normalized: string;
  confidence: string;
  confidence_score: number;
  confidence_factors: ConfidenceFactors;
  context_snippet?: string;
  source: string;
}

// ── Context keywords for scoring ──
const GEMARA_DIRECT_KEYWORDS = [
  "אמר רב", "אמר רבא", "אמר רבי", "אמר רבה", "אמר אביי",
  "תנן", "תנו רבנן", "תנא", "במתניתין", "בגמרא", "גרסינן",
  "איתמר", "דאמרינן", "כדאיתא", "דאמר", "דתנן", "דתניא",
  "אמרינן", "מתני", "שנאמר", "דכתיב", "אמר שמואל", "דגרסינן",
  "סוגיית", "הסוגיא", "הגמרא", "בסוגיא",
];

const MEFARESH_KEYWORDS = [
  'רש"י', 'רש״י', "רשי", "תוספות", "תוס'", "תוס׳",
  "הרמב\"ם", "הרמב״ם", "רמב\"ם", "רמב״ם",
  "הרשב\"א", "הרשב״א", "הרא\"ש", "הרא״ש",
  "ר\"ן", "ר״ן", "הר\"ן", "רבינו חננאל", "ר\"ח",
  "מהרש\"א", "מהרש״א", "ריטב\"א", "ריטב״א",
  "הרי\"ף", "הרי״ף", "רי\"ף", "רי״ף",
  "הרמב\"ן", "הרמב״ן", "המאירי", "נימוקי יוסף",
];

const DIRECT_QUOTE_PATTERNS = [
  /דאמר\s+[א-ת]/,
  /[""][^""]{5,60}[""]/, // text in quotes nearby
  /אמר\s+.{2,20}\s+דאמר/,
];

interface RawMatch {
  tractate: string;
  daf: number;
  amud: string | null;
  raw: string;
  normalized: string;
  matchIndex: number;
  contextSnippet: string;
  hasAmud: boolean;
}

/**
 * ציטוט שאינו תלמוד בבלי, למרות ששם המסכת זהה.
 *
 * "ירושלמי ברכות פ״א ה״א" הוא פרק והלכה בתלמוד הירושלמי, לא דף בבלי, ובכל זאת
 * נשמר במסד כ"ברכות ב׳ ע״א" — הדף הראשון של המסכת. הבדיקה מסתכלת רק על מה
 * שלפני הציטוט, ורק על המילה הקרובה ביותר: ב"גמרא בקידושין כט ע״א, ירושלמי..."
 * הציטוט הוא בבלי, והירושלמי בא אחריו.
 */
export function precededByYerushalmi(before: string): boolean {
  const marks = [...before.matchAll(/ירושלמי|ירוש['׳]|בבלי|גמרא|גמ['׳]/g)];
  if (!marks.length) return false;
  return /ירוש/.test(marks[marks.length - 1][0]);
}

/**
 * ציטוט שיש בו "דף" או ציון עמוד הוא ציטוט בבלי, גם כשהוזכר ירושלמי לפניו:
 * "מהירושלמי סוטה פ״ה ה״א והביאו תוספות בסוטה דף כ״ז ע״ב" — הראשון ירושלמי
 * והשני בבלי.
 */
export const citesDaf = (raw: string) => /דף|עמוד|ע['׳"״][אב]/.test(raw);

/** "פ״י מ״א" או "פ״ה ה״ו" — פרק ומשנה או פרק והלכה, ולעולם לא דף */
export const isPerekHalacha = (raw: string) =>
  /פ['׳"״][א-ת]['׳"״]?\s*[,;]?\s*[המ]['׳"״][א-ת]/.test(raw);

/**
 * ראשי תיבות של מסכת שנבלעו בתוך מילה אחרת.
 *
 * "תשע״ז" מסתיים ב-ע״ז, ולכן כל תאריך עברי נקרא כמסכת עבודה זרה, והמספר
 * שאחריו — 10.5.17 — נקרא כדף י׳. אות אחת לפני ראשי התיבות היא תחילית
 * לגיטימית ("בע״ז", "וב״ק") רק כשלפניה אין עוד אות.
 */
export function abbreviationInsideWord(text: string, at: number): boolean {
  const prev = text[at - 1];
  if (!prev || !/[א-ת]/.test(prev)) return false;
  const before = text[at - 2];
  return Boolean(before && /[א-ת]/.test(before));
}

/** "דף ע״ז ע״א" — מה שאחרי "דף" הוא מספר הדף, לא שם מסכת */
export const afterDafMarker = (text: string, at: number) =>
  /דף\s*$/.test(text.slice(Math.max(0, at - 6), at));

/** "(10.5.17)" הוא תאריך, לא דף ועמוד */
export const looksLikeDate = (text: string, endAt: number) => /^\d/.test(text.slice(endAt, endAt + 1));

export function extractWithRegex(text: string): Reference[] {
  const rawMatches: RawMatch[] = [];
  // Track all occurrences (including duplicates) for frequency counting
  const frequencyMap = new Map<string, number>(); // normalized -> count of all matches
  const matchPositions = new Map<string, number[]>(); // normalized -> character positions

  const allNames = [...TRACTATES, ...Object.keys(ABBREVIATIONS)];
  allNames.sort((a, b) => b.length - a.length);
  const escapedNames = allNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const tractatePattern = escapedNames.join("|");

  // אסימון הדף: אותיות עבריות עם גרשיים בתוך המספר ("פ״ד", "קט״ו") או ספרות.
  // בלי הגרשיים הפנימיים "כתובות דף פ״ד ע״ב" נקרא כדף פ׳ בלבד, והעמוד אבד.
  const dafToken = `[א-תך-ץ]+(?:['׳"״][א-תך-ץ]+)*['׳"״]?|\\d+`;

  // המפריד בין שם המסכת למספר: רווח, או סוגריים שנפתחים
  const sep = `(?:\\s+|\\s*[(\[]\\s*)`;

  // strict: התבנית כוללת "דף" או סימון עמוד מפורש, ולכן המספר בה הוא ציטוט.
  // loose: אין סימון כזה, והמספר הוא כל מילה עברית שבאה אחרי שם מסכת — שם
  // נדרשת גם צורת מספר (ספרות, אות בודדת, או גרש/גרשיים), אחרת "קידושין בטלים."
  // היה נקרא כדף צ״א.
  const patterns: { re: RegExp; loose?: boolean; reversed?: boolean }[] = [
    // מסכת/מס' X דף Y עמוד א/ב
    { re: new RegExp(`(?:מסכת|מס['׳"])\\s*(${tractatePattern})${sep}דף\\s+(${dafToken})${sep}עמוד\\s+([אב])['׳]?`, "g") },
    // X דף Y ע"א / ע"ב (double-quote, smart-quote, gershayim, geresh variants)
    { re: new RegExp(`(${tractatePattern})${sep}דף\\s+(${dafToken})${sep}ע[""״'׳]([אב])`, "g") },
    // X דף Y עמוד א/ב
    { re: new RegExp(`(${tractatePattern})${sep}דף\\s+(${dafToken})${sep}עמוד\\s+([אב])['׳]?`, "g") },
    // X דף Y עמ' א/ב (abbreviated עמוד)
    { re: new RegExp(`(${tractatePattern})${sep}דף\\s+(${dafToken})${sep}עמ['׳]\\s*([אב])['׳]?`, "g") },
    // X דף Y צד א/ב ("side" notation)
    { re: new RegExp(`(${tractatePattern})${sep}דף\\s+(${dafToken})${sep}צד\\s+([אב])['׳]?`, "g") },
    // X דף Y (no amud) — negative lookahead excludes all amud indicators
    // וגבול אחרי המספר, כדי שלא ייקרא רק החלק הראשון שלו: "דף פ״ד" אינו דף פ׳
    { re: new RegExp(`(${tractatePattern})${sep}דף\\s+(${dafToken})(?![א-תך-ץ'׳"״])(?!\\s*(?:עמוד|עמ['׳]|ע[""״'׳]|צד))`, "g") },
    // X Y. / Y: (dot=amud a, colon=amud b)
    { re: new RegExp(`(${tractatePattern})${sep}(${dafToken})\\s*([.:])`, "g"), loose: true },
    // X Y ע"א/ע"ב (without דף)
    { re: new RegExp(`(${tractatePattern})${sep}(${dafToken})\\s+ע[""״'׳]([אב])`, "g") },
    // X Y עמ' א/ב (without דף, abbreviated)
    { re: new RegExp(`(${tractatePattern})${sep}(${dafToken})\\s+עמ['׳]\\s*([אב])['׳]?`, "g") },
    // X Y צד א/ב (without דף)
    { re: new RegExp(`(${tractatePattern})${sep}(${dafToken})\\s+צד\\s+([אב])['׳]?`, "g") },
    // X Y, א/ב
    { re: new RegExp(`(${tractatePattern})${sep}(${dafToken})\\s*,\\s*([אב])`, "g"), loose: true },
    // X Y א/ב (direct letter, no Hebrew letter after)
    { re: new RegExp(`(${tractatePattern})${sep}(${dafToken})\\s+([אב])(?![א-ת])`, "g"), loose: true },
    // X Y״Z — מסכת ומספר עם גרשיים בלי ציון עמוד ("מסנהדרין כ״ט"), הצורה
    // הנפוצה בכתיבה רבנית. הגרשיים נדרשים כדי שמילה רגילה לא תיקרא כדף,
    // והמבט קדימה מונע כפילות עם התבניות שיש בהן ציון עמוד.
    { re: new RegExp(`(${tractatePattern})${sep}([א-תך-ץ]+['׳"״][א-תך-ץ]+)(?![א-תך-ץ'׳"״])(?!\\s*(?:עמוד|עמ['׳]|ע[""״'׳]|צד|[.:,]))`, "g"), loose: true },
    // דף Y עמוד א/ב במסכת X — סדר הפוך, כמו בכותרות שיעורים
    { re: new RegExp(`\u05d3\u05e3\\s+(${dafToken})\\s+\u05e2\u05de\u05d5\u05d3\\s+([\u05d0\u05d1])['׳]?\\s+\u05d1?\u05de\u05e1\u05db\u05ea\\s+(${tractatePattern})`, "g"), reversed: true },
  ];

  /**
   * בתבנית רופפת (בלי "דף" ובלי סימון עמוד) האסימון הוא כל מילה שבאה אחרי שם
   * מסכת, ולכן נדרש שייראה כמספר: עד ארבע אותיות. את הפסילה האמיתית עושה
   * parseHebrewNumber, שבודק את צורת המספר ודוחה "בטלים", "עליה" ו-"דף".
   */
  const plausibleDafToken = (tok: string) => {
    const bare = tok.replace(/['׳"״]/g, "");
    return /^\d+$/.test(bare) || bare.length <= 4;
  };

  const seen = new Set<string>();

  for (const { re: regex, loose, reversed } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      // בתבנית הפוכה שם המסכת בא אחרי הדף ("דף יט עמוד א במסכת בבא בתרא")
      let tractName = (reversed ? m[3] : m[1]).trim();
      const dafRaw = reversed ? m[1] : m[2];
      const amudIndicator = (reversed ? m[2] : m[3]) || null;

      if (ABBREVIATIONS[tractName]) {
        // ראשי תיבות בתוך מילה ("תשע״ז") או אחרי "דף" ("דף ע״ז ע״א") אינם מסכת
        if (abbreviationInsideWord(text, m.index)) continue;
        if (afterDafMarker(text, m.index)) continue;
        tractName = ABBREVIATIONS[tractName];
      }
      if (!TRACTATES.includes(tractName)) continue;

      if (loose && !plausibleDafToken(dafRaw)) continue;
      // "(10.5.17)" — הנקודה היא מפריד תאריך ולא סימון עמוד
      if (looksLikeDate(text, m.index + m[0].length)) continue;

      // ציטוט ירושלמי או פרק-והלכה אינו דף בבבלי, גם כששם המסכת זהה
      if (!citesDaf(m[0]) && precededByYerushalmi(text.slice(Math.max(0, m.index - 40), m.index))) continue;
      if (isPerekHalacha(text.slice(m.index, m.index + m[0].length + 12))) continue;

      const dafNum = parseHebrewNumber(dafRaw);
      // טווח הדפים של המסכת עצמה, לא תקרה גלובלית: "תמורה קט״ו" אינו קיים
      if (!dafNum || !isDafInRange(tractName, dafNum)) continue;

      let amud: string | null = null;
      if (amudIndicator === "א" || amudIndicator === "a" || amudIndicator === ".") {
        amud = "a";
      } else if (amudIndicator === "ב" || amudIndicator === "b" || amudIndicator === ":") {
        amud = "b";
      }

      const dafHeb = numberToHebrewLetter(dafNum);
      const normalized = `${tractName} ${dafHeb}${amud === "a" ? "." : amud === "b" ? ":" : ""}`;

      // Count ALL occurrences for frequency (even duplicates)
      frequencyMap.set(normalized, (frequencyMap.get(normalized) || 0) + 1);
      if (!matchPositions.has(normalized)) matchPositions.set(normalized, []);
      matchPositions.get(normalized)!.push(m.index);

      // Only create one reference per normalized
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      // Extract context snippet
      let contextSnippet = '';
      const matchStart = m.index;
      const matchEnd = m.index + m[0].length;
      const lineStart = text.lastIndexOf('\n', matchStart);
      const lineEnd = text.indexOf('\n', matchEnd);

      if (lineStart !== -1 || lineEnd !== -1) {
        const start = lineStart === -1 ? 0 : lineStart + 1;
        const end = lineEnd === -1 ? text.length : lineEnd;
        contextSnippet = text.slice(start, end).trim();
      } else {
        const before = text.slice(Math.max(0, matchStart - 200), matchStart);
        const sentenceStart = Math.max(
          before.lastIndexOf('.'),
          before.lastIndexOf(':'),
          before.lastIndexOf(';'),
        );
        const ctxStart = sentenceStart !== -1
          ? Math.max(0, matchStart - 200) + sentenceStart + 1
          : Math.max(0, matchStart - 80);

        const after = text.slice(matchEnd, Math.min(text.length, matchEnd + 200));
        const sentenceEnd = Math.min(
          ...[after.indexOf('.'), after.indexOf(':'), after.indexOf(';')]
            .filter(i => i !== -1)
            .concat([80])
        );
        const ctxEnd = Math.min(text.length, matchEnd + sentenceEnd + 1);
        contextSnippet = text.slice(ctxStart, ctxEnd).trim();
      }

      if (contextSnippet.length > 300) {
        const refInCtx = contextSnippet.indexOf(m[0].trim());
        if (refInCtx !== -1) {
          const start = Math.max(0, refInCtx - 120);
          const end = Math.min(contextSnippet.length, refInCtx + m[0].length + 120);
          contextSnippet = (start > 0 ? '...' : '') + contextSnippet.slice(start, end).trim() + (end < contextSnippet.length ? '...' : '');
        } else {
          contextSnippet = contextSnippet.slice(0, 300) + '...';
        }
      }

      rawMatches.push({
        tractate: tractName,
        daf: dafNum,
        amud,
        raw: m[0].trim(),
        normalized,
        matchIndex: m.index,
        contextSnippet,
        hasAmud: amud !== null,
      });
    }
  }

  // Also count tractate-level frequency
  const tractateFreq = new Map<string, number>();
  for (const rm of rawMatches) {
    tractateFreq.set(rm.tractate, (tractateFreq.get(rm.tractate) || 0) + 1);
  }

  // Now compute scores for each unique reference
  const refs: Reference[] = rawMatches.map(rm => {
    const factors = computeConfidenceScore(rm, text, frequencyMap, matchPositions, tractateFreq);
    return {
      tractate: rm.tractate,
      daf: String(rm.daf),
      amud: rm.amud,
      raw: rm.raw,
      normalized: rm.normalized,
      confidence: scoreToLevel(factors.capped),
      confidence_score: factors.capped,
      confidence_factors: factors,
      context_snippet: rm.contextSnippet,
      source: "regex",
    };
  });

  return refs;
}

function computeConfidenceScore(
  rm: RawMatch,
  text: string,
  frequencyMap: Map<string, number>,
  matchPositions: Map<string, number[]>,
  tractateFreq: Map<string, number>,
): ConfidenceFactors {
  // 1. Base specificity
  const base_specificity = rm.hasAmud ? 60 : 45;

  // 2. Frequency boost
  const occurrences = frequencyMap.get(rm.normalized) || 1;
  let frequency_boost = 0;
  if (occurrences >= 4) frequency_boost = 20;
  else if (occurrences >= 2) frequency_boost = 10;
  // Tractate-level frequency bonus
  const tractCount = tractateFreq.get(rm.tractate) || 0;
  if (tractCount >= 3 && occurrences < 2) frequency_boost += 5;

  // 3. Context analysis - check ~200 chars around the match
  const pos = rm.matchIndex;
  const contextWindow = text.slice(Math.max(0, pos - 200), Math.min(text.length, pos + rm.raw.length + 200));

  let context_type = "none";
  let context_boost = 0;

  // Check for direct quote patterns first (highest value)
  const hasDirectQuote = DIRECT_QUOTE_PATTERNS.some(p => p.test(contextWindow));
  if (hasDirectQuote) {
    context_type = "direct_quote";
    context_boost = 20;
  } else {
    // Check gemara direct keywords
    const hasGemara = GEMARA_DIRECT_KEYWORDS.some(kw => contextWindow.includes(kw));
    if (hasGemara) {
      context_type = "gemara_direct";
      context_boost = 15;
    } else {
      // Check mefaresh keywords
      const hasMefaresh = MEFARESH_KEYWORDS.some(kw => contextWindow.includes(kw));
      if (hasMefaresh) {
        context_type = "mefaresh";
        context_boost = 5;
      }
    }
  }

  // 4. Source agreement — will be updated post-AI, default false
  const source_agreement = false;
  const agreement_boost = 0;

  // 5. Proximity cluster — other refs from same tractate within 500 chars
  let proximity_boost = 0;
  const allPositions = matchPositions.get(rm.normalized) || [];
  // Check if any OTHER normalized ref from same tractate is nearby
  for (const [norm, positions] of matchPositions.entries()) {
    if (norm === rm.normalized) continue;
    // Check if this is same tractate
    if (!norm.startsWith(rm.tractate + " ")) continue;
    for (const otherPos of positions) {
      if (Math.abs(otherPos - pos) <= 500) {
        proximity_boost = 10;
        break;
      }
    }
    if (proximity_boost > 0) break;
  }

  // 6. Daf range validation
  const maxDaf = MAX_DAF[rm.tractate];
  const daf_range_valid = maxDaf ? (rm.daf >= 2 && rm.daf <= maxDaf) : true;
  const range_boost = daf_range_valid ? 5 : -20;

  const total = base_specificity + frequency_boost + context_boost + agreement_boost + proximity_boost + range_boost;
  const capped = Math.max(0, Math.min(100, total));

  return {
    base_specificity,
    frequency_boost,
    context_type,
    context_boost,
    source_agreement,
    agreement_boost,
    proximity_boost,
    daf_range_valid,
    range_boost,
    total,
    capped,
  };
}

export function scoreToLevel(score: number): string {
  if (score >= 80) return "high";
  if (score >= 55) return "medium";
  if (score >= 30) return "low";
  return "very_low";
}

