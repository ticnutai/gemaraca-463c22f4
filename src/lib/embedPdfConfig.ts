/**
 * Shared EmbedPDF (pdfium) configuration for the document viewer.
 *
 * Everything that is not per-document (theme, source) lives here so the
 * viewer behaves the same wherever it is mounted.
 */
import type { PDFViewerConfig, PluginRegistry, I18nCapability } from "@embedpdf/react-pdf-viewer";
// The engine's WebAssembly is served from our own build, not from jsDelivr:
// works offline (PWA), no third-party request, and the same bytes every deploy.
import pdfiumWasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { hebrewLocale } from "./embedPdfHebrewLocale";

export { hebrewLocale };

/**
 * Add Hebrew to the viewer's built-in locales and switch to it. Passing `i18n.locales`
 * in the config would *replace* the built-in English (the fallback), so the locale is
 * registered on the live plugin instead — pass this as the viewer's `onReady`.
 */
export function registerHebrewLocale(registry: PluginRegistry): void {
  const plugin = registry.getPlugin("i18n") as { provides?: () => I18nCapability } | null;
  const i18n = plugin?.provides?.();
  if (!i18n) return;
  if (!i18n.hasLocale(hebrewLocale.code)) i18n.registerLocale(hebrewLocale);
  i18n.setLocale(hebrewLocale.code);
}

const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/**
 * iOS Safari runs out of memory rendering large scanned pages at a 3x pixel
 * ratio and reloads the tab (embedpdf/embed-pdf-viewer#692). Capping the ratio
 * the engine sees at 1.5 keeps the Shas scans readable and the tab alive.
 */
export function applyIosPixelRatioCap(): () => void {
  if (!isIOS() || typeof window === "undefined" || window.devicePixelRatio <= 1.5) return () => {};
  const original = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  try {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 1.5 });
  } catch {
    return () => {};
  }
  return () => {
    try {
      if (original) Object.defineProperty(window, "devicePixelRatio", original);
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
    } catch { /* ignore */ }
  };
}

/** Options that are the same for every document; merge the per-document ones on top. */
export function baseViewerConfig(): Omit<PDFViewerConfig, "src" | "theme"> {
  return {
    // Absolute: the engine runs in a worker whose base URL is a blob, not the page.
    wasmUrl: new URL(pdfiumWasmUrl, window.location.origin).href,
    // No request to Google Fonts for the viewer chrome — it inherits the app's font.
    fonts: { ui: { stylesheetUrl: null, family: "'Heebo', system-ui, sans-serif" }, signature: null },
    // Touch devices default to pan mode, which makes text impossible to select
    // (embedpdf/embed-pdf-viewer#706); the browser can scroll the page itself.
    pan: { defaultMode: "never" },
    // Redaction rewrites the PDF and removes text for good — not a study tool.
    disabledCategories: ["redaction"],
    annotations: {
      colorPresets: ["#FFEB3B", "#81C784", "#64B5F6", "#FF8A65", "#CE93D8", "#F48FB1", "#FCA5A5"],
    },
    search: { showAllResults: true },
    zoom: { defaultZoomLevel: "fit-width" as never },
  };
}
