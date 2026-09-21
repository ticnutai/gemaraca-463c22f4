import { describe, it, expect } from "vitest";
import { amudIndexToDaf, amudimInTractate, chunkText, isPossibleDaf, stripHtml } from "@/lib/references/extractAll";

describe("reference extraction helpers", () => {
  it("covers the whole text with overlapping chunks", () => {
    const text = "א".repeat(34_000);
    const parts = chunkText(text);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.every((p) => p.length <= 6000)).toBe(true);
    // כל תו מופיע לפחות בקטע אחד
    expect(parts.reduce((s, p) => s + p.length, 0)).toBeGreaterThanOrEqual(text.length);
    const short = "קצר";
    expect(chunkText(short)).toEqual([short]);
  });

  it("rejects daf numbers that cannot exist", () => {
    expect(isPossibleDaf("סנהדרין", 113)).toBe(true);
    expect(isPossibleDaf("סנהדרין", 214)).toBe(false); // הדף שהופיע בקישורים השגויים
    expect(isPossibleDaf("בבא מציעא", 1)).toBe(false); // הגמרא מתחילה בדף ב׳
    expect(isPossibleDaf("בבא מציעא", 73)).toBe(true);
    expect(isPossibleDaf("מסכת שלא קיימת", 5)).toBe(false);
  });

  it("strips html before analysis", () => {
    expect(stripHtml('<p class="x">בבא מציעא&nbsp;ע"ג</p>')).toBe('בבא מציעא ע"ג');
  });
});

describe("amud numbering", () => {
  it("converts a running amud number to daf and amud", () => {
    // הגמרא מתחילה בדף ב׳: עמוד 1 הוא ב׳ עמוד א׳, עמוד 2 הוא ב׳ עמוד ב׳
    expect(amudIndexToDaf("מכות", 1)).toEqual({ daf: 2, amud: "a" });
    expect(amudIndexToDaf("מכות", 2)).toEqual({ daf: 2, amud: "b" });
    expect(amudIndexToDaf("מכות", 3)).toEqual({ daf: 3, amud: "a" });
    // מכות: 24 דפים = 46 עמודים
    expect(amudimInTractate("מכות")).toBe(46);
    expect(amudIndexToDaf("מכות", 46)).toEqual({ daf: 24, amud: "b" });
  });

  it("refuses a number that cannot be an amud in that tractate", () => {
    expect(amudIndexToDaf("מכות", 47)).toBeNull();   // מעבר למספר העמודים
    expect(amudIndexToDaf("סנהדרין", 809)).toBeNull();
    expect(amudIndexToDaf("מסכת שלא קיימת", 4)).toBeNull();
    expect(amudIndexToDaf("מכות", 0)).toBeNull();
  });

  it("a tractate of 30 dapim is 58 amudim, and the last one maps back", () => {
    const max = 30;
    const tractate = "מועד קטן"; // 29 דפים, כלומר 56 עמודים
    expect(amudimInTractate(tractate)).toBe((29 - 1) * 2);
    expect(max).toBeGreaterThan(0);
    expect(amudIndexToDaf(tractate, 56)).toEqual({ daf: 29, amud: "b" });
  });
});
