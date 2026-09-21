/**
 * Converts a number to Hebrew letters (Gematria)
 * Examples: 1 -> א, 2 -> ב, 10 -> י, 15 -> ט"ו
 */
export function toHebrewNumeral(num: number): string {
  if (num <= 0 || num > 9999) return String(num);

  const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const hundreds = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
  const thousands = ['', 'א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳', 'ח׳', 'ט׳'];

  let result = '';
  
  // Thousands
  const thousandsDigit = Math.floor(num / 1000);
  if (thousandsDigit > 0) {
    result += thousands[thousandsDigit];
    num %= 1000;
  }

  // Hundreds
  const hundredsDigit = Math.floor(num / 100);
  if (hundredsDigit > 0) {
    result += hundreds[hundredsDigit];
    num %= 100;
  }

  // Special cases for 15 and 16 (ט"ו, ט"ז instead of יה, יו which spell God's name)
  if (num === 15) {
    result += 'ט״ו';
  } else if (num === 16) {
    result += 'ט״ז';
  } else {
    // Tens
    const tensDigit = Math.floor(num / 10);
    if (tensDigit > 0) {
      result += tens[tensDigit];
      num %= 10;
    }

    // Ones
    if (num > 0) {
      result += ones[num];
    }
  }

  // Add gershayim (") for multi-letter numbers or geresh (') for single letter
  if (result.length > 1 && !result.includes('״') && !result.includes('׳')) {
    result = result.slice(0, -1) + '״' + result.slice(-1);
  } else if (result.length === 1) {
    result += '׳';
  }

  return result;
}

/**
 * ממיר מספר עברי למספר, בבדיקה קפדנית של צורת המספר.
 *
 * מספר עברי תקני נכתב לפי סדר יורד: מאות, עשרות, יחידות, כל מחלקה פעם אחת
 * (חוץ מהמאות שחוזרות: ת"ק=500 ... תת"ק=900), ו-15/16 נכתבים ט"ו/ט"ז.
 * מילה רגילה כמעט תמיד מפרה את הסדר הזה, ולכן הבדיקה מבדילה בין ציטוט
 * ("פ״ד" → 84) ובין מילה שנמצאת אחרי שם מסכת ("עליה", "אכיפה", "הדיינים").
 *
 * כל תו שנשאר בלי שימוש פוסל את המחרוזת: "שהד" אינו 309 אלא לא־מספר.
 *
 * Examples: "ב" -> 2, "כג" -> 23, "ט״ו" -> 15, "עליה" -> null
 */
export function fromHebrewNumeral(hebrewNum: string): number | null {
  if (!hebrewNum) return null;

  // הסרת גרשיים וגרש — הם סימני מספר, לא חלק מהערך
  const s = hebrewNum.replace(/[״׳"'’”]/g, '').trim();
  if (!s) return null;

  const ones: Record<string, number> = {
    'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5,
    'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
  };
  const tens: Record<string, number> = {
    'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50,
    'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90,
  };
  const hundreds: Record<string, number> = { 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };

  let total = 0;
  let i = 0;

  // מאות, בסדר לא עולה: ת״ק=500, תת״ק=900
  let prevHundred = Infinity;
  while (i < s.length && hundreds[s[i]] !== undefined) {
    const v = hundreds[s[i]];
    if (v > prevHundred) return null;
    total += v;
    prevHundred = v;
    i++;
    if (total > 900) return null;
  }

  // ט״ו ו-ט״ז נכתבים כך כדי לא לכתוב שם השם
  const rest = s.slice(i);
  if (rest === 'טו') return total + 15;
  if (rest === 'טז') return total + 16;

  if (i < s.length && tens[s[i]] !== undefined) {
    total += tens[s[i]];
    i++;
  }

  if (i < s.length && ones[s[i]] !== undefined) {
    total += ones[s[i]];
    i++;
  }

  // תו שנשאר מסמן שזו מילה ולא מספר
  if (i !== s.length) return null;

  return total > 0 ? total : null;
}

/**
 * Converts daf format to Hebrew
 * Examples: "2a" -> "ב ע\"א", "10b" -> "י ע\"ב"
 */
export function toDafFormat(dafNumber: number, side: 'a' | 'b' = 'a'): string {
  const hebrewNum = toHebrewNumeral(dafNumber);
  const sideText = side === 'a' ? 'ע״א' : 'ע״ב';
  return `${hebrewNum} ${sideText}`;
}
