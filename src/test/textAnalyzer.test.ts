import { describe, it, expect } from "vitest";
import { analyzeText, parseHebrewNumber } from "@/lib/textAnalyzer";

const gemaraRefs = (text: string) =>
  analyzeText(text).sources
    .filter((s) => s.type === "gemara" && s.dafNumber)
    .map((s) => `${s.masechet} ${s.dafNumber}${s.amud ?? ""}`)
    .sort();

describe("text analysis of Gemara citations", () => {
  it("reads the whole daf number, gershayim included", () => {
    // לפני התיקון "פ״ד" נקרא כדף פ׳, כלומר 80 במקום 84
    expect(gemaraRefs('ועיין כתובות דף פ"ד ע"ב')).toEqual(["כתובות 84b"]);
    expect(gemaraRefs("ועיין כתובות דף פ״ד ע״ב")).toEqual(["כתובות 84b"]);
    expect(gemaraRefs("סנהדרין דף כ עמוד א")).toEqual(["סנהדרין 20a"]);
  });

  it("does not read an ordinary word as a daf", () => {
    expect(parseHebrewNumber("שהד")).toBeNull();
    expect(parseHebrewNumber("עליה")).toBeNull();
    expect(gemaraRefs("בשבת שהד הוא הדין")).toEqual([]);
    expect(gemaraRefs("בשבת כמחילה.")).toEqual([]);
  });

  it("drops a daf beyond the end of the tractate", () => {
    expect(gemaraRefs("מכות דף ק עמוד א")).toEqual([]);
    expect(gemaraRefs("שבת דף קנז עמוד א")).toEqual(["שבת 157a"]);
  });
});
