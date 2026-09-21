// Shared masechet data for all edge functions
// Single source of truth — keep in sync with src/lib/masechtotData.ts

export interface SharedMasechet {
  name: string;
  english: string;
  sefaria: string;
  maxDaf: number;
}

export const MASECHTOT: SharedMasechet[] = [
  { name: "ברכות", english: "Berakhot", sefaria: "Berakhot", maxDaf: 64 },
  { name: "שבת", english: "Shabbat", sefaria: "Shabbat", maxDaf: 157 },
  { name: "עירובין", english: "Eruvin", sefaria: "Eruvin", maxDaf: 105 },
  { name: "פסחים", english: "Pesachim", sefaria: "Pesachim", maxDaf: 121 },
  { name: "שקלים", english: "Shekalim", sefaria: "Shekalim", maxDaf: 22 },
  { name: "יומא", english: "Yoma", sefaria: "Yoma", maxDaf: 88 },
  { name: "סוכה", english: "Sukkah", sefaria: "Sukkah", maxDaf: 56 },
  { name: "ביצה", english: "Beitza", sefaria: "Beitzah", maxDaf: 40 },
  { name: "ראש השנה", english: "Rosh Hashanah", sefaria: "Rosh_Hashanah", maxDaf: 35 },
  { name: "תענית", english: "Taanit", sefaria: "Taanit", maxDaf: 31 },
  { name: "מגילה", english: "Megillah", sefaria: "Megillah", maxDaf: 32 },
  { name: "מועד קטן", english: "Moed Katan", sefaria: "Moed_Katan", maxDaf: 29 },
  { name: "חגיגה", english: "Chagigah", sefaria: "Chagigah", maxDaf: 27 },
  { name: "יבמות", english: "Yevamot", sefaria: "Yevamot", maxDaf: 122 },
  { name: "כתובות", english: "Ketubot", sefaria: "Ketubot", maxDaf: 112 },
  { name: "נדרים", english: "Nedarim", sefaria: "Nedarim", maxDaf: 91 },
  { name: "נזיר", english: "Nazir", sefaria: "Nazir", maxDaf: 66 },
  { name: "סוטה", english: "Sotah", sefaria: "Sotah", maxDaf: 49 },
  { name: "גיטין", english: "Gittin", sefaria: "Gittin", maxDaf: 90 },
  { name: "קידושין", english: "Kiddushin", sefaria: "Kiddushin", maxDaf: 82 },
  { name: "בבא קמא", english: "Bava Kamma", sefaria: "Bava_Kamma", maxDaf: 119 },
  { name: "בבא מציעא", english: "Bava Metzia", sefaria: "Bava_Metzia", maxDaf: 119 },
  { name: "בבא בתרא", english: "Bava Batra", sefaria: "Bava_Batra", maxDaf: 176 },
  { name: "סנהדרין", english: "Sanhedrin", sefaria: "Sanhedrin", maxDaf: 113 },
  { name: "מכות", english: "Makkot", sefaria: "Makkot", maxDaf: 24 },
  { name: "שבועות", english: "Shevuot", sefaria: "Shevuot", maxDaf: 49 },
  { name: "עבודה זרה", english: "Avodah Zarah", sefaria: "Avodah_Zarah", maxDaf: 76 },
  { name: "הוריות", english: "Horayot", sefaria: "Horayot", maxDaf: 14 },
  { name: "זבחים", english: "Zevachim", sefaria: "Zevachim", maxDaf: 120 },
  { name: "מנחות", english: "Menachot", sefaria: "Menachot", maxDaf: 110 },
  { name: "חולין", english: "Chullin", sefaria: "Chullin", maxDaf: 142 },
  { name: "בכורות", english: "Bekhorot", sefaria: "Bekhorot", maxDaf: 61 },
  { name: "ערכין", english: "Arakhin", sefaria: "Arakhin", maxDaf: 34 },
  { name: "תמורה", english: "Temurah", sefaria: "Temurah", maxDaf: 34 },
  { name: "כריתות", english: "Keritot", sefaria: "Keritot", maxDaf: 28 },
  { name: "מעילה", english: "Meilah", sefaria: "Meilah", maxDaf: 22 },
  { name: "תמיד", english: "Tamid", sefaria: "Tamid", maxDaf: 33 },
  { name: "נידה", english: "Niddah", sefaria: "Niddah", maxDaf: 73 },
];

export const TRACTATE_NAMES = MASECHTOT.map(m => m.name);

export const MASECHTOT_MAP: Record<string, string> = Object.fromEntries(
  MASECHTOT.map(m => [m.name, m.sefaria])
);

// Alias for edge functions that need { hebrewName, sefariaName, maxDaf }
export const MASECHTOT_LIST = MASECHTOT.map(m => ({
  hebrewName: m.name,
  sefariaName: m.sefaria,
  englishName: m.english,
  maxDaf: m.maxDaf,
}));

export const ABBREVIATIONS: Record<string, string> = {
  'ב"ק': "בבא קמא", 'בב"ק': "בבא קמא", "ב״ק": "בבא קמא",
  'ב"מ': "בבא מציעא", 'בב"מ': "בבא מציעא", "ב״מ": "בבא מציעא",
  'ב"ב': "בבא בתרא", 'בב"ב': "בבא בתרא", "ב״ב": "בבא בתרא",
  'ר"ה': "ראש השנה", "ר״ה": "ראש השנה",
  'ע"ז': "עבודה זרה", "ע״ז": "עבודה זרה",
  'מו"ק': "מועד קטן", "מו״ק": "מועד קטן",
};

export const GEMATRIA: Record<string, number> = {
  "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
  "י": 10, "כ": 20, "ל": 30, "מ": 40, "נ": 50, "ס": 60, "ע": 70, "פ": 80, "צ": 90,
  "ק": 100, "ר": 200, "ש": 300, "ת": 400,
  "ך": 20, "ם": 40, "ן": 50, "ף": 80, "ץ": 90,
};

/**
 * ממיר מספר עברי למספר, בבדיקה קפדנית של צורת המספר.
 *
 * מספר עברי תקני נכתב בסדר יורד — מאות, עשרות, יחידות — כל מחלקה פעם אחת,
 * חוץ מהמאות שחוזרות (ת״ק=500 ... תת״ק=900), ו-15/16 שנכתבים ט״ו/ט״ז.
 * כל תו שנשאר בלי שימוש פוסל את המחרוזת.
 *
 * זה מה שמבדיל ציטוט ("פ״ד" → 84) ממילה רגילה שבאה אחרי שם מסכת:
 * "עליה", "אכיפה", "הדיינים", "שהד" — כולן מחזירות null ולא נספרות כדף.
 * לפני התיקון הן הומרו בסכימה פשוטה של אותיות והכניסו למסד דפים שאינם קיימים.
 */
export function parseHebrewNumber(s: string): number | null {
  const clean = s.replace(/['"״׳’”]/g, "").trim();
  if (!clean) return null;

  if (/^\d+$/.test(clean)) return parseInt(clean, 10);

  const ones: Record<string, number> = {
    "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5,
    "ו": 6, "ז": 7, "ח": 8, "ט": 9,
  };
  const tens: Record<string, number> = {
    "י": 10, "כ": 20, "ל": 30, "מ": 40, "נ": 50,
    "ס": 60, "ע": 70, "פ": 80, "צ": 90,
  };
  const hundreds: Record<string, number> = { "ק": 100, "ר": 200, "ש": 300, "ת": 400 };

  let total = 0;
  let i = 0;
  let prevHundred = Infinity;

  while (i < clean.length && hundreds[clean[i]] !== undefined) {
    const v = hundreds[clean[i]];
    if (v > prevHundred) return null;
    total += v;
    prevHundred = v;
    i++;
    if (total > 900) return null;
  }

  const rest = clean.slice(i);
  if (rest === "טו") return total + 15;
  if (rest === "טז") return total + 16;

  if (i < clean.length && tens[clean[i]] !== undefined) { total += tens[clean[i]]; i++; }
  if (i < clean.length && ones[clean[i]] !== undefined) { total += ones[clean[i]]; i++; }

  if (i !== clean.length) return null;
  return total > 0 ? total : null;
}

/** האם המספר יכול להיות דף במסכת הזו: הגמרא מתחילה בדף ב׳ ולכל מסכת דף אחרון */
export function isDafInRange(tractate: string, daf: number): boolean {
  const m = MASECHTOT.find((x) => x.name === tractate);
  if (!m) return false;
  return Number.isFinite(daf) && daf >= 2 && daf <= m.maxDaf;
}
