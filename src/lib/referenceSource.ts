/**
 * מי חילץ את מראה המקום.
 *
 * `source` בטבלת `talmud_references` מתעד את שכבת החילוץ, לא את האימות —
 * האימות יושב ב-`validated_by`. ארבעה ערכים קיימים בפועל:
 *
 *   site-index  תיוג רשמי של האתר שממנו הפסק הגיע. הכי מדויק, ואינו נמחק בחילוץ מחדש
 *   regex       ביטויים רגולריים על טקסט הפסק
 *   ai          מודל שקרא את הטקסט
 *   extracted   חילוץ אוטומטי שהייחוס שלו אבד (ריצת reanalyze שלפני תיקון הייחוס)
 */
export type ReferenceSource = 'site-index' | 'regex' | 'ai' | 'extracted';

export const REFERENCE_SOURCE_LABELS: Record<string, string> = {
  'site-index': 'אינדקס האתר',
  regex: 'ביטוי רגולרי',
  ai: 'בינה מלאכותית',
  extracted: 'חילוץ אוטומטי',
};

/** תווית לתצוגה; ערך שאינו מוכר מוצג כמו שהוא ולא מוצג בכזב כ-AI */
export const sourceLabel = (source?: string | null): string =>
  (source && REFERENCE_SOURCE_LABELS[source]) || source || 'לא ידוע';

/** תווית קצרה לטבלה */
export const shortSourceLabel = (source?: string | null): string =>
  source === 'site-index' ? 'אינדקס' : source === 'regex' ? 'regex' : source === 'ai' ? 'AI' : 'חילוץ';
