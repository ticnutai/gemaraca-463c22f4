// נקודת כניסה לקומפילציה עם esbuild: מריצה את אותה תבנית שהאפליקציה משתמשת בה
import { parsePsakDinText } from '@/lib/psakDinParser';
import { generatePsakDinHtml } from '@/lib/psakDinHtmlTemplate';

export interface Meta {
  title?: string;
  court?: string;
  year?: number;
  caseNumber?: string;
  summary?: string;
  sourceUrl?: string;
}

export function buildStyledHtml(rawText: string, meta: Meta = {}): string {
  const parsed = parsePsakDinText(rawText);
  // מה שידוע לנו במסד גובר על מה שהפרסר ניחש מהטקסט
  if (meta.title) parsed.title = meta.title;
  if (meta.court) parsed.court = meta.court || parsed.court;
  if (meta.year) parsed.year = meta.year;
  if (meta.caseNumber) parsed.caseNumber = meta.caseNumber;
  if (meta.summary && !parsed.summary) parsed.summary = meta.summary;
  // קישור לקובץ באחסון הפנימי ארוך מאוד וגולש מהמסגרת, והמסמך ממילא מוצג כאן
  if (meta.sourceUrl && !meta.sourceUrl.includes('/storage/v1/object/')) parsed.sourceUrl = meta.sourceUrl;
  return generatePsakDinHtml(parsed);
}
