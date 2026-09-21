import { describe, it, expect } from "vitest";
import { fromHebrewNumeral, toHebrewNumeral } from "@/lib/hebrewNumbers";

describe("fromHebrewNumeral", () => {
  it("reads ordinary daf numbers", () => {
    expect(fromHebrewNumeral("ב")).toBe(2);
    expect(fromHebrewNumeral("ב׳")).toBe(2);
    expect(fromHebrewNumeral("יג")).toBe(13);
    expect(fromHebrewNumeral('פ"ד')).toBe(84);
    expect(fromHebrewNumeral("פ״ד")).toBe(84);
    expect(fromHebrewNumeral("קל״א")).toBe(131);
    expect(fromHebrewNumeral("קנ״ז")).toBe(157);
  });

  it("reads ט״ו and ט״ז, which are not written יה/יו", () => {
    expect(fromHebrewNumeral("ט״ו")).toBe(15);
    expect(fromHebrewNumeral("ט״ז")).toBe(16);
    expect(fromHebrewNumeral("קט״ו")).toBe(115);
    expect(fromHebrewNumeral("קט״ז")).toBe(116);
  });

  it("reads repeated hundreds in descending order", () => {
    expect(fromHebrewNumeral("ת״ק")).toBe(500);
    expect(fromHebrewNumeral("תת״ק")).toBe(900);
    expect(fromHebrewNumeral("ק״ת")).toBeNull(); // מאות בסדר עולה אינן מספר
  });

  it("refuses ordinary words that used to be summed as gematria", () => {
    // אלה המילים שהכניסו למסד דפים שאינם קיימים
    expect(fromHebrewNumeral("עליה")).toBeNull();
    expect(fromHebrewNumeral("אכיפה")).toBeNull();
    expect(fromHebrewNumeral("הדיינים")).toBeNull();
    expect(fromHebrewNumeral("בטלים")).toBeNull();
    expect(fromHebrewNumeral("מלאה")).toBeNull();
    expect(fromHebrewNumeral("כלל")).toBeNull();
    expect(fromHebrewNumeral("בסמוך")).toBeNull();
    expect(fromHebrewNumeral("חלק")).toBeNull();
    expect(fromHebrewNumeral("וגיטין")).toBeNull();
    expect(fromHebrewNumeral("לכך")).toBeNull();
    expect(fromHebrewNumeral("שהד")).toBeNull(); // היה 309
  });

  it("round-trips every daf number in the Talmud", () => {
    for (let n = 2; n <= 157; n++) expect(fromHebrewNumeral(toHebrewNumeral(n))).toBe(n);
  });

  it("returns null for empty input", () => {
    expect(fromHebrewNumeral("")).toBeNull();
    expect(fromHebrewNumeral("״")).toBeNull();
  });
});
