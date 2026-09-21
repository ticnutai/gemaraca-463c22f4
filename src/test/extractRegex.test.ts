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

  it("does not file a Yerushalmi citation as a Bavli daf", () => {
    // "ירושלמי ברכות פ״א ה״א" הוא פרק והלכה בירושלמי; במסד הוא נשמר כברכות ב׳ ע״א
    expect(found('וכדאיתא כך היא גאולתן של ישראל קמעא קמעא (ירושלמי ברכות פ"א ה"א) ואולי')).toEqual([]);
    expect(found("והכי איתא בירושלמי (סוכה ג,א) מה בין לולב לשופר")).toEqual([]);
    expect(found("כמשמעות הירושלמי מגילה ג,ב")).toEqual([]);
    // הבבלי שלפני אזכור הירושלמי נשאר
    expect(found('גמרא בקידושין כט ע"א, ירושלמי בקידושין פ"א')).toEqual(["קידושין 29a"]);
  });

  it("does not file a chapter-and-mishna citation as a daf", () => {
    expect(found('איתא בבבא קמא (פ"י מ"א): אין פורטין')).toEqual([]);
    expect(found('במשנה בנדרים (פ"ה מ"ו) המודר הנייה')).toEqual([]);
  });

  it("reads a citation written as tractate and number with gershayim", () => {
    // הצורה הרבנית הנפוצה, בלי "דף" ובלי ציון עמוד
    expect(found('חדא מסנהדרין כ"ט בבני חמוה דמר עוקבא')).toEqual(["סנהדרין 29"]);
    expect(found('וכמבואר במשנה יבמות ק"כ ומובא להלכה')).toEqual(["יבמות 120"]);
    // ראשי תיבות רגילים אינם מספרים
    expect(found('נעשה ע"י רבנים הרגילים בקידושין ע"י שליח')).toEqual([]);
  });

  it("reads a citation that opens with a bracket", () => {
    expect(found("בהתאם למה שנאמר בקידושין (דף ל\"א עמ' א') ששניהם שווים")).toEqual(["קידושין 31a"]);
  });

  it("keeps a Bavli citation that follows a mention of the Yerushalmi", () => {
    // "מהירושלמי סוטה פ״ה ה״א והביאו תוספות בסוטה דף כ״ז ע״ב" — שניים שונים
    expect(found('ושכן עולה מהירושלמי סוטה פ"ה ה"א והביאו תוספות בסוטה דף כ"ז ע"ב ד"ה כשם')).toEqual(["סוטה 27b"]);
  });
});
