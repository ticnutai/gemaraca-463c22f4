import { describe, it, expect } from "vitest";
import { extractWithRegex } from "../../supabase/functions/_shared/extractRegex";

const found = (text: string) =>
  extractWithRegex(text).map((r) => `${r.tractate} ${r.daf}${r.amud ?? ""}`).sort();

describe("regex reference extraction", () => {
  it("reads a citation whose daf carries gershayim", () => {
    // לפני התיקון "פ״ד" נקרא כדף פ׳ בלבד, והעמוד אבד
    expect(found('ועיין כתובות דף פ"ד ע"ב ושם.')).toEqual(["כתובות 84b"]);
    expect(found("ועיין כתובות דף פ״ד ע״ב ושם.")).toEqual(["כתובות 84b"]);
    expect(found('תמורה דף קט"ו ע"א')).toEqual([]); // בתמורה 34 דפים
  });

  it("does not turn the word דף into daf 84", () => {
    // ד+ף = 84 בסכימת אותיות, וכך נוצרו מאות הפניות מדומות
    expect(found("ראה בבא בתרא דף ב ובהמשך.")).toEqual(["בבא בתרא 2"]);
    expect(found("ראה הוריות דף ב.")).toEqual(["הוריות 2"]);
  });

  it("does not read an ordinary Hebrew word as a daf", () => {
    expect(found("כפי שנפסק בקידושין בטלים.")).toEqual([]);
    expect(found("וכן בתמורה עליה.")).toEqual([]);
    expect(found("וכן בשבת הגזילה, א.")).toEqual([]);
    expect(found("ראה מכות אכיפה.")).toEqual([]);
    expect(found('ובע"ז חלק א')).toEqual([]);
    expect(found("ובשבועות הדיינים.")).toEqual([]);
  });

  it("still reads the ordinary citation formats", () => {
    expect(found("סנהדרין דף כ עמוד א")).toEqual(["סנהדרין 20a"]);
    expect(found("מסכת שבת דף כג עמוד ב")).toEqual(["שבת 23b"]);
    expect(found('ב"ק דף י ע"ב')).toEqual(["בבא קמא 10b"]);
    expect(found("גיטין דף פח עמ' א")).toEqual(["גיטין 88a"]);
    expect(found("ברכות ל״ה.")).toEqual(["ברכות 35a"]);
    expect(found("יבמות דף 14 עמוד ב")).toEqual(["יבמות 14b"]);
  });

  it("refuses a daf beyond the end of the tractate", () => {
    expect(found("מכות דף ק עמוד א")).toEqual([]);   // 24 דפים בלבד
    expect(found("ברכות דף ע עמוד א")).toEqual([]);   // 64 דפים
    expect(found("שבת דף קנז עמוד א")).toEqual(["שבת 157a"]);
  });

  it("keeps the amud that the citation states", () => {
    const refs = extractWithRegex('כתובות דף פ"ד ע"ב');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ tractate: "כתובות", daf: "84", amud: "b", source: "regex" });
    expect(refs[0].normalized).toBe("כתובות פ״ד:");
  });
});
