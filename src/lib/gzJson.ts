/**
 * טעינת JSON דחוס (.json.gz). שרתים מסוימים (vite dev) מפענחים את ה-gzip בעצמם;
 * אחרים (GitHub Pages, קבצי האפליקציה) מגישים בייטים גולמיים — מזהים לפי חתימת
 * gzip (1f 8b) ומפענחים רק במקרה הצורך.
 *
 * התוצאה נשמרת בזיכרון לפי כתובת. קובץ מסכת מכיל את כל העמודים שלה — בבבא
 * בתרא 4 מגה דחוסים — ובלי המטמון כל מעבר לעמוד הבא הוריד ופענח מחדש את
 * המסכת כולה. נשמרות רק הכתובות האחרונות, כדי שמי שעובר בין מסכתות לא
 * יצבור את הש"ס כולו בזיכרון.
 */
const MAX_CACHED = 6;
const cache = new Map<string, Promise<unknown>>();

async function load(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`טעינה נכשלה: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

export function fetchGzJson<T = unknown>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit) {
    // שימוש אחרון מעביר לסוף התור, כך שהמסכת הפתוחה לא נזרקת ראשונה
    cache.delete(url);
    cache.set(url, hit);
    return hit as Promise<T>;
  }
  const p = load(url);
  // כישלון לא נשמר: הניסיון הבא ינסה שוב במקום לקבל את אותה שגיאה לנצח
  p.catch(() => cache.delete(url));
  cache.set(url, p);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  return p as Promise<T>;
}
