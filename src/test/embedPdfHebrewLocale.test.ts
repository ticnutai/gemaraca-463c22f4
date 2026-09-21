import { describe, it, expect } from "vitest";
import { hebrewLocale } from "@/lib/embedPdfHebrewLocale";

const flatten = (o: Record<string, unknown>, prefix = ""): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]],
  );

describe("EmbedPDF Hebrew locale", () => {
  const entries = flatten(hebrewLocale.translations);

  it("covers the viewer's namespaces", () => {
    const top = Object.keys(hebrewLocale.translations);
    for (const ns of ["commands", "search", "zoom", "document", "panel", "mode", "annotation", "print", "signature", "common"]) {
      expect(top, ns).toContain(ns);
    }
    expect(entries.length).toBeGreaterThan(300);
  });

  it("is actually Hebrew, with the placeholders kept", () => {
    for (const [key, value] of entries) {
      expect(value.trim().length, key).toBeGreaterThan(0);
      expect(/[֐-׿]/.test(value) || /^[A-Z]{2,}$/.test(value), `${key}: ${value}`).toBe(true);
    }
    expect(entries.find(([k]) => k === "search.resultsFound")?.[1]).toContain("{count}");
    expect(entries.find(([k]) => k === "print.total")?.[1]).toContain("{totalPages}");
  });
});
