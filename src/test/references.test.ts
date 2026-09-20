import { describe, it, expect } from "vitest";
import { chunkText, isPossibleDaf, stripHtml } from "@/lib/references/extractAll";

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
