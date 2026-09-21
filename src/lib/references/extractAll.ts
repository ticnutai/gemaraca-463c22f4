// חילוץ מראי מקומות על כל אורך הפסק.
//
// ה-Edge Function שולח ל-AI רק 6,000 תווים, ופסק ממוצע הוא כ-34,000 תווים,
// כך שקריאה אחת בודקת בערך חמישית מהפסק. כאן הטקסט מחולק לקטעים חופפים,
// כל קטע נשלח בנפרד, והתוצאות מאוחדות ומסוננות.

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { MASECHTOT } from "@/lib/masechtotData";

const CHUNK = 6000;
const OVERLAP = 600;

const MAX_DAF: Record<string, number> = Object.fromEntries(MASECHTOT.map((m) => [m.hebrewName, m.maxDaf]));

export interface ExtractedReference {
  tractate: string;
  daf: string;
  amud: string | null;
  raw?: string;
  normalized: string;
  confidence?: string;
  confidence_score?: number | null;
  confidence_factors?: Json;
  context_snippet?: string | null;
  source?: string;
}

export const stripHtml = (s: string) =>
  s
    // תוכן style/script אינו חלק מהפסק ואסור שייכנס לניתוח
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function chunkText(text: string): string[] {
  if (text.length <= CHUNK) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK - OVERLAP) out.push(text.slice(i, i + CHUNK));
  return out;
}

/** הגמרא מתחילה בדף ב׳, ולכל מסכת יש דף אחרון — מה שמחוץ לטווח אינו מראה מקום אמיתי */
export const isPossibleDaf = (tractate: string, daf: string | number) => {
  const max = MAX_DAF[tractate];
  const n = Number(daf);
  return Boolean(max) && Number.isFinite(n) && n >= 2 && n <= max;
};

/**
 * מקורות מסוימים ממספרים עמודים ברצף במקום דפים: מסכת של 30 דפים מופיעה אצלם
 * כ-58 עמודים, כי כל דף מורכב מעמוד א ועמוד ב. הפונקציה ממירה מספר עמוד רץ
 * לדף ולעמוד. עמוד 1 הוא דף ב׳ עמוד א׳, כי הגמרא מתחילה בדף ב׳.
 *
 * מחזירה null כשהמספר אינו יכול להיות עמוד במסכת הזו.
 *
 * זהירות: אין להפעיל את זה על כל מספר שחורג מטווח הדפים. בנתונים של הפרויקט
 * נבדקו 1,547 חריגות כאלה, ו-1,542 מהן לא היו ציטוטים אלא צירופי אותיות שהומרו
 * בגימטריה ("שבת שהד" → דף 309). המרה עיוורת הייתה מחזירה את הזבל הזה כדף תקין.
 * להשתמש רק כשידוע שהמקור מספר עמודים.
 */
export function amudIndexToDaf(tractate: string, amudIndex: number): { daf: number; amud: "a" | "b" } | null {
  const max = MAX_DAF[tractate];
  const n = Number(amudIndex);
  if (!max || !Number.isFinite(n) || n < 1) return null;
  if (n > (max - 1) * 2) return null; // מעבר למספר העמודים במסכת
  return { daf: Math.floor((n - 1) / 2) + 2, amud: n % 2 === 1 ? "a" : "b" };
}

/** מספר העמודים במסכת: כל דף מ-ב׳ ועד האחרון, כפול שניים */
export const amudimInTractate = (tractate: string) => {
  const max = MAX_DAF[tractate];
  return max ? (max - 1) * 2 : 0;
};

/** מריץ את החילוץ על כל הקטעים ומחזיר רשימה מאוחדת, בלי כפילויות */
export async function extractReferencesFromText(
  text: string,
  documentId: string,
  useAI: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedReference[]> {
  const clean = stripHtml(text);
  const parts = chunkText(clean);
  const byKey = new Map<string, ExtractedReference>();

  for (let i = 0; i < parts.length; i++) {
    const { data, error } = await supabase.functions.invoke("extract-references", {
      body: { text: parts[i], documentId, useAI },
    });
    onProgress?.(i + 1, parts.length);
    if (error) continue;

    for (const ref of (data?.references ?? []) as ExtractedReference[]) {
      if (!isPossibleDaf(ref.tractate, ref.daf)) continue;
      const key = `${ref.tractate}|${Number(ref.daf)}|${ref.amud ?? ""}`;
      const prev = byKey.get(key);
      if (!prev || (ref.confidence_score ?? 0) > (prev.confidence_score ?? 0)) byKey.set(key, ref);
    }
  }

  return [...byKey.values()];
}

/**
 * שומר את מראי המקומות של פסק.
 * מראי מקומות מהאינדקס הרשמי (source='site-index') לא נמחקים: הם תיוג מדויק
 * של האתר, ואין טעם להחליף אותם בתוצאה של חילוץ אוטומטי.
 */
export async function saveReferences(
  psakDinId: string,
  references: ExtractedReference[],
  userId: string | null,
): Promise<number> {
  await supabase.from("talmud_references").delete().eq("psak_din_id", psakDinId).neq("source", "site-index");

  const { data: kept } = await supabase
    .from("talmud_references")
    .select("tractate,daf,amud")
    .eq("psak_din_id", psakDinId);
  const have = new Set((kept ?? []).map((k) => `${k.tractate}|${k.daf}|${k.amud ?? ""}`));

  const rows = references
    .filter((r) => !have.has(`${r.tractate}|${Number(r.daf)}|${r.amud ?? ""}`))
    .map((r) => ({
      psak_din_id: psakDinId,
      tractate: r.tractate,
      daf: String(Number(r.daf)),
      amud: r.amud ?? null,
      raw_reference: r.raw ?? r.normalized,
      normalized: r.normalized,
      confidence: r.confidence,
      confidence_score: r.confidence_score ?? null,
      confidence_factors: (r.confidence_factors ?? null) as Json,
      source: r.source,
      context_snippet: r.context_snippet || null,
      user_id: userId,
    }));

  if (rows.length) {
    const { error } = await supabase.from("talmud_references").insert(rows);
    if (error) throw error;
  }
  return rows.length;
}
