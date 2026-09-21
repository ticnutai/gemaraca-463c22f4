import { MASECHTOT, Masechet } from './masechtotData';
import { fromHebrewNumeral } from './hebrewNumbers';

// Types for analysis results
export interface DetectedSource {
  type: 'gemara' | 'shulchan_aruch' | 'rambam' | 'tur' | 'mishna' | 'tosefta' | 'midrash' | 'other';
  text: string;
  masechet?: string;
  masechetSefaria?: string;
  daf?: string;
  dafNumber?: number;
  amud?: 'a' | 'b';
  section?: string;
  halacha?: string;
  confidence: 'high' | 'medium' | 'low';
  sugyaId?: string;
}

export interface DetectedTopic {
  topic: string;
  category: string;
  occurrences: number;
}

export interface AnalysisResult {
  id: string;
  title: string;
  sources: DetectedSource[];
  topics: DetectedTopic[];
  masechtot: string[];
  books: string[];
  wordCount: number;
  hasFullText: boolean;
}

// Extended Hebrew number patterns - more comprehensive
const HEBREW_NUMBERS: Record<string, number> = {};
const HEBREW_LETTERS = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const HEBREW_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HEBREW_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

// Build all Hebrew numbers 1-400
for (let i = 1; i <= 400; i++) {
  const hundreds = Math.floor(i / 100);
  const tens = Math.floor((i % 100) / 10);
  const ones = i % 10;
  
  let hebrew = '';
  
  // Handle hundreds
  if (hundreds > 0 && hundreds <= 4) {
    hebrew += HEBREW_HUNDREDS[hundreds];
  }
  
  // Handle special cases 15 and 16
  if (tens === 1 && ones === 5) {
    hebrew += 'טו';
  } else if (tens === 1 && ones === 6) {
    hebrew += 'טז';
  } else {
    if (tens > 0) hebrew += HEBREW_TENS[tens];
    if (ones > 0) hebrew += HEBREW_LETTERS[ones];
  }
  
  if (hebrew) {
    HEBREW_NUMBERS[hebrew] = i;
    // Also add with geresh for single letters
    if (hebrew.length === 1) {
      HEBREW_NUMBERS[hebrew + "'"] = i;
      HEBREW_NUMBERS[hebrew + "׳"] = i;
    }
    // Add with gershayim for double letters
    if (hebrew.length === 2) {
      HEBREW_NUMBERS[hebrew[0] + '"' + hebrew[1]] = i;
      HEBREW_NUMBERS[hebrew[0] + '״' + hebrew[1]] = i;
    }
  }
}

// Add common variations
const commonVariations: Record<string, number> = {
  "ע\"א": 71, "ע\"ב": 72, "ע״א": 71, "ע״ב": 72,
  "קי\"א": 111, "קי\"ב": 112, "קכ\"ב": 122,
};
Object.assign(HEBREW_NUMBERS, commonVariations);

// Parse Hebrew number to integer
export function parseHebrewNumber(hebrew: string): number | null {
  if (!hebrew) return null;
  
  // Clean the string
  const cleaned = hebrew.trim().replace(/['"״׳]/g, '');
  
  // Direct lookup from pre-built table (handles quote variations)
  if (HEBREW_NUMBERS[hebrew]) return HEBREW_NUMBERS[hebrew];
  if (HEBREW_NUMBERS[cleaned]) return HEBREW_NUMBERS[cleaned];
  
  // Fall back to canonical Hebrew numeral parser
  return fromHebrewNumeral(cleaned);
}

// Build enhanced regex patterns for masechtot
const masechetPatterns = MASECHTOT.map(m => {
  // Create variations of the name
  const nameVariations = [
    m.hebrewName,
    `מסכת\\s*${m.hebrewName}`,
    `מס'\\s*${m.hebrewName}`,
    `מס׳\\s*${m.hebrewName}`,
    `גמרא\\s*${m.hebrewName}`,
    `תלמוד\\s*${m.hebrewName}`,
    m.englishName,
    m.sefariaName.replace(/_/g, ' '),
  ].join('|');
  
  return {
    masechet: m,
    // אסימון הדף כולל גרשיים פנימיים ("פ״ד"), אחרת נקרא רק חלקו הראשון (פ׳)
    pattern: new RegExp(
      `(${nameVariations})\\s*(?:דף\\s*)?([א-ת]{1,3}(?:[\\"'״׳][א-ת]{1,2})?|\\d{1,3})\\s*(?:,\\s*)?(?:ע[\\"\\'״׳]?([אב])|עמוד\\s*([אב])|([אב])(?:\\s|$|,|\\.))?`,
      'gi'
    ),
    simplePattern: new RegExp(`(${m.hebrewName}|מסכת\\s*${m.hebrewName})`, 'gi')
  };
});

// Additional patterns for common Gemara citation formats
const additionalGemaraPatterns = [
  // Format: "ב"מ כא ע"א" or "ב״מ כא ע״א"
  { pattern: /ב["\״]מ\s*([א-ת]{1,3}|\d{1,3})\s*(?:ע["\״׳']?([אב]))?/gi, masechet: 'בבא מציעא', sefariaName: 'Bava_Metzia' },
  { pattern: /ב["\״]ק\s*([א-ת]{1,3}|\d{1,3})\s*(?:ע["\״׳']?([אב]))?/gi, masechet: 'בבא קמא', sefariaName: 'Bava_Kamma' },
  { pattern: /ב["\״]ב\s*([א-ת]{1,3}|\d{1,3})\s*(?:ע["\״׳']?([אב]))?/gi, masechet: 'בבא בתרא', sefariaName: 'Bava_Batra' },
  // Format: "סנהדרין צ"ד"
  { pattern: /סנה["\״]?\s*([א-ת]{1,3}|\d{1,3})\s*(?:ע["\״׳']?([אב]))?/gi, masechet: 'סנהדרין', sefariaName: 'Sanhedrin' },
  { pattern: /שבת\s*([א-ת]{1,3}|\d{1,3})\s*(?:ע["\״׳']?([אב]))?/gi, masechet: 'שבת', sefariaName: 'Shabbat' },
  { pattern: /כתובות\s*([א-ת]{1,3}|\d{1,3})\s*(?:ע["\״׳']?([אב]))?/gi, masechet: 'כתובות', sefariaName: 'Ketubot' },
  { pattern: /גיטין\s*([א-ת]{1,3}|\d{1,3})\s*(?:ע["\״׳']?([אב]))?/gi, masechet: 'גיטין', sefariaName: 'Gittin' },
  { pattern: /קידושין\s*([א-ת]{1,3}|\d{1,3})\s*(?:ע["\״׳']?([אב]))?/gi, masechet: 'קידושין', sefariaName: 'Kiddushin' },
];

// Shulchan Aruch patterns with enhanced detection
const SHULCHAN_ARUCH_SECTIONS = [
  { name: 'אורח חיים', aliases: ['או"ח', 'אורח החיים', 'או״ח', 'א"ח', 'א״ח', 'אוח"ח'] },
  { name: 'יורה דעה', aliases: ['יו"ד', 'יורה דיעה', 'יו״ד', 'י"ד', 'י״ד'] },
  { name: 'אבן העזר', aliases: ['אהע"ז', 'אה"ע', 'אבהע"ז', 'אהע״ז', 'אה״ע', 'אבן עזר'] },
  { name: 'חושן משפט', aliases: ['חו"מ', 'חושן המשפט', 'חו״מ', 'ח"מ', 'ח״מ'] }
];

// Rambam patterns - expanded
const RAMBAM_BOOKS = [
  'הלכות שבת', 'הלכות עירובין', 'הלכות יום טוב', 'הלכות חמץ ומצה', 'הלכות שופר',
  'הלכות סוכה', 'הלכות לולב', 'הלכות מגילה', 'הלכות חנוכה', 'הלכות תעניות',
  'הלכות קידוש החודש', 'הלכות תפילה', 'הלכות ברכות', 'הלכות מילה', 'הלכות ציצית',
  'הלכות תפילין', 'הלכות מזוזה', 'הלכות ספר תורה', 'הלכות עבודה זרה', 'הלכות דעות',
  'הלכות תלמוד תורה', 'הלכות יסודי התורה', 'הלכות אישות', 'הלכות גירושין', 'הלכות ייבום',
  'הלכות נערה בתולה', 'הלכות סוטה', 'הלכות נזירות', 'הלכות ערכין', 'הלכות שחיטה',
  'הלכות מאכלות אסורות', 'הלכות שבועות', 'הלכות נדרים', 'הלכות נזקי ממון', 'הלכות גנבה',
  'הלכות גזלה', 'הלכות נזקי גוף', 'הלכות רוצח', 'הלכות מכירה', 'הלכות זכייה', 'הלכות שכנים',
  'הלכות שלוחין', 'הלכות עבדים', 'הלכות שכירות', 'הלכות שאלה', 'הלכות מלוה', 'הלכות טוען',
  'הלכות נחלות', 'הלכות סנהדרין', 'הלכות עדות', 'הלכות ממרים', 'הלכות אבל', 'הלכות מלכים',
  'הלכות גזילה ואבידה', 'הלכות חובל ומזיק', 'הלכות מעשה הקרבנות', 'הלכות תמידים ומוספין'
];

// Topic categories with expanded keywords
const TOPIC_CATEGORIES: Record<string, string[]> = {
  'ממון ומסחר': [
    'מכר', 'קנין', 'קניין', 'כסף', 'ממון', 'מקח', 'שכירות', 'שכר', 'שטר', 'חוב', 'הלוואה',
    'ערבות', 'משכון', 'עסקה', 'מחיר', 'פיצוי', 'פיצויים', 'נזק', 'נזקי ממון', 'גזל', 'גנבה',
    'השבה', 'פיקדון', 'שותפות', 'ירושה', 'נחלה', 'צוואה', 'מתנה', 'הפקר', 'מציאה', 'אבידה',
    'חזקה', 'קרקע', 'מקרקעין', 'דירה', 'בית', 'שדה', 'נכסי', 'נכס', 'רכוש', 'עיזבון'
  ],
  'נזיקין': [
    'נזק', 'נזיקין', 'היזק', 'שור', 'בור', 'אש', 'מבעה', 'תשלומי נזק', 'נזקי גוף',
    'חבלה', 'רציחה', 'רוצח', 'שוגג', 'מזיד', 'גרמא', 'גרמי', 'דינא דגרמי', 'אדם המזיק',
    'שן', 'רגל', 'קרן', 'תם', 'מועד', 'כופר', 'צער', 'ריפוי', 'שבת', 'בושת'
  ],
  'דיני ראיות': [
    'עד', 'עדים', 'עדות', 'הודאה', 'הודאת בעל דין', 'מיגו', 'חזקה', 'מוחזק', 'ספק',
    'ראיה', 'הוכחה', 'שבועה', 'נאמנות', 'כשרות עדים', 'פסולי עדות', 'עד אחד', 'שני עדים',
    'הזמה', 'הכחשה', 'עדות שקר', 'עדי מסירה', 'עדי חתימה'
  ],
  'בתי דין': [
    'דין', 'דיין', 'דיינים', 'בית דין', 'בי"ד', 'סנהדרין', 'פסק', 'פסיקה', 'ערעור',
    'הוצאה לפועל', 'שליח בית דין', 'נידוי', 'חרם', 'כפייה', 'מורד', 'מורדת', 'תביעה',
    'נתבע', 'תובע', 'טענה', 'פשרה', 'דין תורה'
  ],
  'אישות ומשפחה': [
    'נישואין', 'אישות', 'קידושין', 'גירושין', 'גט', 'כתובה', 'תוספת כתובה', 'מזונות',
    'יבום', 'חליצה', 'אלמנה', 'גרושה', 'עגונה', 'ממזר', 'ייחוס', 'צניעות', 'נדה',
    'טהרת המשפחה', 'מקווה', 'חופה', 'שידוכין', 'אירוסין', 'נדוניה', 'בעל', 'אשה'
  ],
  'שבת ומועדים': [
    'שבת', 'מלאכה', 'מוקצה', 'עירוב', 'יום טוב', 'חג', 'פסח', 'חמץ', 'מצה', 'סוכות',
    'לולב', 'שופר', 'ראש השנה', 'יום כיפור', 'פורים', 'חנוכה', 'תענית', 'צום',
    'עומר', 'שבועות', 'חול המועד', 'מועד', 'קידוש', 'הבדלה', 'נר שבת'
  ],
  'איסור והיתר': [
    'כשרות', 'טריפה', 'נבלה', 'שחיטה', 'בשר', 'חלב', 'דם', 'גיד הנשה', 'חלק',
    'תערובת', 'ביטול', 'נותן טעם', 'בליעה', 'הכשר כלים', 'טבילת כלים', 'בשר בחלב',
    'תולעים', 'בדיקה', 'סימני טריפות', 'ריאה', 'כבד', 'לב'
  ],
  'תפילה וברכות': [
    'תפילה', 'ברכה', 'ברכות', 'קריאת שמע', 'שמונה עשרה', 'עמידה', 'קדיש', 'קדושה',
    'ברכת המזון', 'זימון', 'הלל', 'סליחות', 'תחנון', 'תפילין', 'ציצית', 'מזוזה',
    'קריאת התורה', 'הפטרה', 'עליה לתורה'
  ],
  'הלכות כלליות': [
    'מנהג', 'גזירה', 'תקנה', 'חומרא', 'קולא', 'לכתחילה', 'בדיעבד', 'מצווה', 'עבירה',
    'איסור', 'היתר', 'מותר', 'אסור', 'פטור', 'חייב', 'דאורייתא', 'דרבנן', 'ספיקא',
    'ודאי', 'רוב', 'מיעוט', 'קים ליה', 'פסיקא'
  ]
};

// Other important books
const OTHER_BOOKS = [
  { name: 'טור', pattern: /טור\s*(או"ח|יו"ד|אהע"ז|חו"מ|אורח חיים|יורה דעה|אבן העזר|חושן משפט)?/gi },
  { name: 'משנה ברורה', pattern: /משנה\s*ברורה|מ"ב|מ״ב|מש"ב|מש״ב/gi },
  { name: 'ביאור הלכה', pattern: /ביאור\s*הלכה|בה"ל|בה״ל/gi },
  { name: 'ערוך השולחן', pattern: /ערוך\s*השולחן|ערה"ש|ערה״ש/gi },
  { name: 'בית יוסף', pattern: /בית\s*יוסף|ב"י|ב״י/gi },
  { name: 'רמ"א', pattern: /רמ"א|רמ״א|הגהות\s*הרמ"א|הג"ה|הג״ה/gi },
  { name: 'ש"ך', pattern: /ש"ך|ש״ך|שפתי\s*כהן/gi },
  { name: 'ט"ז', pattern: /ט"ז|ט״ז|טורי\s*זהב/gi },
  { name: 'פתחי תשובה', pattern: /פתחי\s*תשובה|פ"ת|פ״ת/gi },
  { name: 'חתם סופר', pattern: /חתם\s*סופר|חת"ס|חת״ס/gi },
  { name: 'אגרות משה', pattern: /אגרות\s*משה|אג"מ|אג״מ/gi },
  { name: 'משנה הלכות', pattern: /משנה\s*הלכות/gi },
  { name: 'ציץ אליעזר', pattern: /ציץ\s*אליעזר/gi },
  { name: 'יביע אומר', pattern: /יביע\s*אומר/gi },
  { name: 'יחוה דעת', pattern: /יחוה\s*דעת/gi },
  { name: 'שמירת שבת כהלכתה', pattern: /שמירת\s*שבת\s*כהלכתה|שש"כ|שש״כ/gi },
  { name: 'פסקי תשובות', pattern: /פסקי\s*תשובות/gi },
  { name: 'כף החיים', pattern: /כף\s*החיים|כה"ח|כה״ח/gi },
  { name: 'בן איש חי', pattern: /בן\s*איש\s*חי|בא"ח|בא״ח/gi },
  { name: 'פרי מגדים', pattern: /פרי\s*מגדים|פמ"ג|פמ״ג/gi },
  { name: 'מגן אברהם', pattern: /מגן\s*אברהם|מג"א|מג״א/gi },
  { name: 'משנה תורה', pattern: /משנה\s*תורה|יד\s*החזקה/gi },
  { name: 'תוספות', pattern: /תוספות|תוס'|תוס׳|ד"ה|ד״ה/gi },
  { name: 'רש"י', pattern: /רש"י|רש״י|פירוש\s*רש"י/gi },
  { name: 'ריטב"א', pattern: /ריטב"א|ריטב״א/gi },
  { name: 'רשב"א', pattern: /רשב"א|רשב״א/gi },
  { name: 'רמב"ן', pattern: /רמב"ן|רמב״ן/gi },
  { name: 'ר"ן', pattern: /ר"ן|ר״ן|הר"ן|הר״ן/gi },
  { name: 'נמוקי יוסף', pattern: /נמוקי\s*יוסף|נמו"י|נמו״י/gi },
  { name: 'שלחן ערוך הרב', pattern: /שלחן\s*ערוך\s*הרב|שו"ע\s*הרב|שו״ע\s*הרב|אדה"ז|אדה״ז/gi }
];

// Pre-compiled Shulchan Aruch patterns (avoid re-creating in analyzeText loop)
const SHULCHAN_ARUCH_COMPILED = SHULCHAN_ARUCH_SECTIONS.flatMap(section => {
  const allNames = [section.name, ...section.aliases];
  return allNames.map(name => ({
    sectionName: section.name,
    regex: new RegExp(
      `(שולחן\\s*ערוך\\s*|שו"ע\\s*|שו״ע\\s*)?${escapeRegex(name)}\\s*(?:סימן\\s*|סי'\\s*|סי׳\\s*)?([א-ת]{1,3}|\\d{1,3})?(?:\\s*(?:סעיף|ס"ק|ס״ק)\\s*([א-ת]{1,3}|\\d{1,3}))?`,
      'gi'
    )
  }));
});

// Pre-compiled Rambam patterns
const RAMBAM_COMPILED = RAMBAM_BOOKS.map(book => ({
  book,
  regex: new RegExp(
    `(רמב"ם|רמב״ם|משנה\\s*תורה)?\\s*${escapeRegex(book)}\\s*(?:פרק\\s*|פ'\\s*|פ״\\s*)?([א-ת]{1,3}|\\d{1,3})?(?:\\s*(?:הלכה|הל')\\s*([א-ת]{1,3}|\\d{1,3}))?`,
    'gi'
  )
}));

// Pre-compiled topic patterns
const TOPIC_COMPILED = Object.entries(TOPIC_CATEGORIES).flatMap(([category, keywords]) =>
  keywords.map(keyword => ({
    keyword,
    category,
    regex: new RegExp(`(?:^|[\\s,.:;!?"'()\\[\\]{}])${escapeRegex(keyword)}(?:$|[\\s,.:;!?"'()\\[\\]{}])`, 'gi')
  }))
);

/**
 * Generate sugya_id from masechet and daf info
 */
export function generateSugyaId(source: DetectedSource): string | null {
  if (source.type !== 'gemara' || !source.masechetSefaria || !source.dafNumber) {
    return null;
  }
  
  const amud = source.amud || 'a';
  return `${source.masechetSefaria.toLowerCase()}_${source.dafNumber}${amud}`;
}

/**
 * Analyze a psak din text without AI
 */
export function analyzeText(text: string): { sources: DetectedSource[], topics: DetectedTopic[], books: string[] } {
  if (!text || text.trim().length === 0) {
    return { sources: [], topics: [], books: [] };
  }

  const sources: DetectedSource[] = [];
  const detectedBooks = new Set<string>();
  const topicCounts: Record<string, { category: string, count: number }> = {};
  const seenSources = new Set<string>();

  // 1. Detect Gemara sources with main patterns
  for (const { masechet, pattern } of masechetPatterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(text)) !== null) {
      const fullMatch = match[0];
      const dafPart = match[2];
      const amudPart = match[3] || match[4] || match[5];

      let dafNumber: number | undefined;
      let amud: 'a' | 'b' | undefined;

      // Parse daf number
      if (dafPart) {
        if (/^\d+$/.test(dafPart)) {
          dafNumber = parseInt(dafPart);
        } else {
          dafNumber = parseHebrewNumber(dafPart) || undefined;
        }
      }

      // Parse amud
      if (amudPart) {
        amud = amudPart === 'א' ? 'a' : 'b';
      }

      // Skip invalid daf numbers
      if (dafNumber && (dafNumber < 2 || dafNumber > masechet.maxDaf)) {
        continue;
      }

      // Create unique key to avoid duplicates
      const sourceKey = `${masechet.hebrewName}_${dafNumber || 'none'}_${amud || 'none'}`;
      if (seenSources.has(sourceKey)) continue;
      seenSources.add(sourceKey);

      const source: DetectedSource = {
        type: 'gemara',
        text: fullMatch,
        masechet: masechet.hebrewName,
        masechetSefaria: masechet.sefariaName,
        daf: dafNumber ? String(dafNumber) : undefined,
        dafNumber,
        amud,
        confidence: dafNumber ? (amud ? 'high' : 'medium') : 'low'
      };

      // Generate sugya_id
      source.sugyaId = generateSugyaId(source) || undefined;
      
      sources.push(source);
    }
  }

  // 2. Check additional Gemara patterns (abbreviations)
  for (const { pattern, masechet, sefariaName } of additionalGemaraPatterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(text)) !== null) {
      const dafPart = match[1];
      const amudPart = match[2];

      let dafNumber: number | undefined;
      let amud: 'a' | 'b' | undefined;

      if (dafPart) {
        if (/^\d+$/.test(dafPart)) {
          dafNumber = parseInt(dafPart);
        } else {
          dafNumber = parseHebrewNumber(dafPart) || undefined;
        }
      }

      if (amudPart) {
        amud = amudPart === 'א' ? 'a' : 'b';
      }

      const sourceKey = `${masechet}_${dafNumber || 'none'}_${amud || 'none'}`;
      if (seenSources.has(sourceKey)) continue;
      seenSources.add(sourceKey);

      const source: DetectedSource = {
        type: 'gemara',
        text: match[0],
        masechet,
        masechetSefaria: sefariaName,
        daf: dafNumber ? String(dafNumber) : undefined,
        dafNumber,
        amud,
        confidence: dafNumber ? (amud ? 'high' : 'medium') : 'low'
      };

      source.sugyaId = generateSugyaId(source) || undefined;
      sources.push(source);
    }
  }

  // 3. Detect Shulchan Aruch references (using pre-compiled patterns)
  for (const { sectionName, regex } of SHULCHAN_ARUCH_COMPILED) {
    const pattern = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = pattern.exec(text)) !== null) {
      sources.push({
        type: 'shulchan_aruch',
        text: match[0],
        section: sectionName,
        halacha: match[2] || undefined,
        confidence: match[2] ? 'high' : 'medium'
      });
      detectedBooks.add('שולחן ערוך');
    }
  }

  // 4. Detect Rambam references (using pre-compiled patterns)
  for (const { book, regex } of RAMBAM_COMPILED) {
    const pattern = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = pattern.exec(text)) !== null) {
      sources.push({
        type: 'rambam',
        text: match[0],
        section: book,
        halacha: match[2] || undefined,
        confidence: match[2] ? 'high' : 'medium'
      });
      detectedBooks.add('רמב"ם');
    }
  }

  // 5. Detect other books
  for (const book of OTHER_BOOKS) {
    const regex = new RegExp(book.pattern.source, book.pattern.flags);
    if (regex.test(text)) {
      detectedBooks.add(book.name);
    }
  }

  // 6. Detect topics (using pre-compiled patterns)
  for (const { keyword, category, regex } of TOPIC_COMPILED) {
    const pattern = new RegExp(regex.source, regex.flags);
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      if (!topicCounts[keyword]) {
        topicCounts[keyword] = { category, count: 0 };
      }
      topicCounts[keyword].count += matches.length;
    }
  }

  // Convert topic counts to array and sort by occurrences
  const topics: DetectedTopic[] = Object.entries(topicCounts)
    .map(([topic, { category, count }]) => ({ topic, category, occurrences: count }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 20);

  return {
    sources,
    topics,
    books: Array.from(detectedBooks)
  };
}

/**
 * Analyze a psak din document
 */
export function analyzePsakDin(psak: { 
  id: string; 
  title: string; 
  summary: string; 
  full_text?: string | null;
  tags?: string[] | null;
}): AnalysisResult {
  const textToAnalyze = [psak.title, psak.summary, psak.full_text || ''].join(' ');
  const { sources, topics, books } = analyzeText(textToAnalyze);

  // Extract unique masechtot
  const masechtot = [...new Set(
    sources
      .filter(s => s.type === 'gemara' && s.masechet)
      .map(s => s.masechet!)
  )];

  return {
    id: psak.id,
    title: psak.title,
    sources,
    topics,
    masechtot,
    books,
    wordCount: textToAnalyze.split(/\s+/).length,
    hasFullText: !!psak.full_text && psak.full_text.length > 100
  };
}

/**
 * Batch analyze multiple psakei din
 */
export function batchAnalyze(psakim: Array<{
  id: string;
  title: string;
  summary: string;
  full_text?: string | null;
  tags?: string[] | null;
}>): AnalysisResult[] {
  return psakim.map(analyzePsakDin);
}

/**
 * Generate index summary from analysis results
 */
export function generateIndexSummary(results: AnalysisResult[]): {
  totalAnalyzed: number;
  withSources: number;
  withGemaraLinks: number;
  withTopics: number;
  topMasechtot: { name: string; count: number }[];
  topBooks: { name: string; count: number }[];
  topCategories: { name: string; count: number }[];
  totalGemaraLinks: number;
} {
  const masechetCounts: Record<string, number> = {};
  const bookCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};

  let withSources = 0;
  let withTopics = 0;
  let withGemaraLinks = 0;
  let totalGemaraLinks = 0;

  for (const result of results) {
    if (result.sources.length > 0) withSources++;
    if (result.topics.length > 0) withTopics++;
    
    const gemaraSources = result.sources.filter(s => s.type === 'gemara' && s.sugyaId);
    if (gemaraSources.length > 0) {
      withGemaraLinks++;
      totalGemaraLinks += gemaraSources.length;
    }

    for (const m of result.masechtot) {
      masechetCounts[m] = (masechetCounts[m] || 0) + 1;
    }

    for (const b of result.books) {
      bookCounts[b] = (bookCounts[b] || 0) + 1;
    }

    for (const t of result.topics) {
      categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
    }
  }

  return {
    totalAnalyzed: results.length,
    withSources,
    withGemaraLinks,
    withTopics,
    topMasechtot: Object.entries(masechetCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    topBooks: Object.entries(bookCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    topCategories: Object.entries(categoryCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    totalGemaraLinks
  };
}

// Helper function to escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
