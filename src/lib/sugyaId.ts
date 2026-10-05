import { MASECHTOT } from "@/lib/masechtotData";

/**
 * מזהה סוגיה כמו "bava_batra_2a" → מסכת, דף ועמוד.
 * המזהה הוא שם המסכת בספריא, באותיות קטנות, ואחריו הדף והעמוד.
 */
export function parseSugyaId(sugyaId: string) {
  for (const m of MASECHTOT) {
    const prefix = m.sefariaName.toLowerCase() + "_";
    if (sugyaId.startsWith(prefix)) {
      const match = sugyaId.slice(prefix.length).match(/^(\d+)([ab])$/);
      if (match) {
        return { masechet: m, dafNumber: parseInt(match[1], 10), amud: match[2] as "a" | "b" };
      }
    }
  }
  return null;
}
