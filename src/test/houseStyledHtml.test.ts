import { describe, it, expect } from "vitest";
import { isStyledDocument, toHouseStyledHtml } from "@/lib/psakDinHtmlTemplate";

const PLAIN_RULING = [
  "בית הדין הרבני האזורי חיפה",
  "תיק 1202045/12",
  "---",
  "טענות התובע",
  "התובע טוען שהנתבע התחייב לשלם עבור שמירת הילדים.",
  "פסק הדין",
  "הנתבע ישלם את הסכום שנקבע.",
].join("\n");

describe("house psak-din styling", () => {
  it("recognises a ruling that was already styled", () => {
    expect(isStyledDocument('<!DOCTYPE html><html><body>פסק</body></html>')).toBe(true);
    expect(isStyledDocument('<div class="container">פסק</div>')).toBe(true);
    expect(isStyledDocument("טקסט רגיל של פסק דין")).toBe(false);
  });

  it("leaves an already-styled ruling untouched", () => {
    const styled = '<!DOCTYPE html><html dir="rtl"><body>פסק מעוצב</body></html>';
    expect(toHouseStyledHtml(styled)).toBe(styled);
  });

  it("wraps imported plain text in the house template", () => {
    const html = toHouseStyledHtml(PLAIN_RULING, {
      title: "חיוב אם אמידה במזונות ילדים",
      court: "בתי הדין הרבניים",
      caseNumber: "1202045/12",
      year: 2019,
      sourceUrl: "https://www.gov.il/He/Departments/DynamicCollectors/verdict_the_rabbinical_courts",
    });
    expect(isStyledDocument(html)).toBe(true);
    expect(html).toContain('dir="rtl"');
    // המטא-דאטה מהמסד משלימה את מה שהטקסט עצמו לא נושא
    expect(html).toContain("חיוב אם אמידה במזונות ילדים");
    expect(html).toContain("1202045/12");
    // גוף הפסק עובר כמות שהוא
    expect(html).toContain("הנתבע ישלם את הסכום שנקבע");
    // קישור המקור נשמר בתוך המסגרת ולא גולש לרוחב
    expect(html).toContain("word-break: break-all");
    expect(html).toContain("gov.il");
  });

  it("does not print an internal storage link as the ruling's source", () => {
    const html = toHouseStyledHtml(PLAIN_RULING, {
      sourceUrl: "https://x.supabase.co/storage/v1/object/public/psakei-din-files/a.html",
    });
    expect(html).not.toContain("/storage/v1/object/");
  });

  it("prefers the stored record's metadata over the parser's guess", () => {
    const parsedOnly = toHouseStyledHtml(PLAIN_RULING);
    // ללא רשומה מהמסד הפרסר מנחש כותרת מתוך גוף הטקסט
    expect(parsedOnly).toContain("טענות התובע");
    const withRecord = toHouseStyledHtml(PLAIN_RULING, { title: "כותרת מהמסד" });
    expect(withRecord).toContain("<title>פסק דין: כותרת מהמסד</title>");
  });

  it("returns blank text as-is instead of an empty frame", () => {
    expect(toHouseStyledHtml("")).toBe("");
    expect(toHouseStyledHtml("   ")).toBe("   ");
  });
});
