/**
 * סיווג הראיה להפניה שמגיעה ממפתח מקורות של מוציא לאור (אתר פסקים).
 *
 * למה זה במודול אחד: אותה הגדרה בדיוק נדרשת בשלושה מקומות — בייבוא (כדי לקבוע
 * `validated_by`), בווידוא, ובאודיט (כדי **לא** למחוק תיוג עריכתי תקף בטענה
 * שהדף "לא נמצא בפסק"). כשההגדרה שוכנת בשני מקומות, אחד מהם מוחק את השני.
 *
 * שני סוגי ראיה:
 *   'cited'     — הדף כתוב בפסק במפורש. ראיה ישירה.
 *   'editorial' — האתר זיהה את הסוגיה מתוך תוכן הדברים. ראיה חלשה יותר אך לא
 *                 פסולה: המתייג הוא המוציא לאור של הפסק, ולעתים הזיהוי מדויק
 *                 יותר מציטוט (למשל פסק שדן ברעש בין שכנים ומופנה לב״ב כ ע״ב).
 */

/** הקיצורים שפסקי דין משתמשים בהם בפועל, בלי גרשיים */
const ABBREV = {
  'בבא קמא': ['בק'], 'בבא מציעא': ['במ'], 'בבא בתרא': ['בב'],
  'עבודה זרה': ['עז'], 'ראש השנה': ['רה'], 'מועד קטן': ['מוק'],
  'סנהדרין': ['סנה'], 'כתובות': ['כתו'], 'קידושין': ['קיד'],
  'ירושלמי': ['ירוש'],
};

/** ניקוי לצורך השוואה: גרשיים, מרכאות ורווחים מתערבבים בפסקי דין בלי חוק */
export const normalizeForMatch = (s) => String(s ?? '').replace(/[\s"'׳״]/g, '');

/**
 * האם הדף כתוב בפסק במפורש.
 * @param normText טקסט הפסק אחרי normalizeForMatch
 * @param tractate שם המסכת הקנוני
 * @param dafLetters אותיות הדף כפי שהמפתח כותב אותן ("קלג", "עג")
 */
export function citedInText(normText, tractate, dafLetters) {
  const d = normalizeForMatch(dafLetters);
  if (!d) return false;
  const names = [tractate.replace(/\s/g, ''), ...(ABBREV[tractate] || [])];
  // מה שמותר לבוא אחרי אותיות הדף: סוף, תו שאינו עברי, או סימן עמוד.
  // בלי זה "בבא קמא (יא ע״ב)" נדחה, כי ה-ע' של "ע״ב" נראית כהמשך הגימטריה.
  const after = '(?:$|[^א-ת]|ע[אב]|עמוד|[אב](?![א-ת]))';
  for (const n of names) {
    // שם או קיצור, ואחריו הדף, עם עד שלושה תווים ביניהם (סוגריים, פסיק, "דף")
    if (new RegExp(`${n}[,(.:דף]{0,3}${d}(?=${after})`).test(normText)) return true;
  }
  // "דף נב" בלי שם מסכת סמוך — קביל רק אם שם המסכת מופיע בפסק בכלל
  if (names.some((n) => normText.includes(n)) && new RegExp(`דף${d}(?=${after})`).test(normText)) return true;
  return false;
}

/** 'cited' או 'editorial' */
export const evidenceKind = (normText, tractate, dafLetters) =>
  citedInText(normText, tractate, dafLetters) ? 'cited' : 'editorial';

export const VALIDATED_BY = {
  cited: 'psakim-index-cited',
  editorial: 'psakim-index-editorial',
};

/** כל ה-validated_by שמגיעים ממפתח מוציא לאור ואין לבדוק אותם מול הטקסט */
export const PUBLISHER_INDEX_MARKERS = [
  'psakim-index', 'psakim-index-cited', 'psakim-index-editorial',
];
