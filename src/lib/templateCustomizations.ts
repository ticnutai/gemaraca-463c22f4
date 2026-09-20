/**
 * User-editable customization layer on top of the built-in psak din templates.
 * - Built-in templates can be tweaked (color / font overrides) without touching their code.
 * - Templates can be duplicated into new custom templates with their own name + overrides.
 * Everything is persisted in localStorage.
 */
import { TEMPLATES, generateFromTemplate, type TemplateInfo } from "./psakDinTemplates";
import type { ParsedPsakDin } from "./psakDinParser";

export interface TemplateOverrides {
  navy?: string;
  gold?: string;
  pageBg?: string;
  docBg?: string;
  textColor?: string;
  headingColor?: string;
  bannerBg?: string;
  bannerTextColor?: string;
  bannerAccentColor?: string;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  maxWidth?: number;
  justify?: boolean;
}

export interface CustomTemplate {
  id: string;
  name: string;
  baseId: string;
  icon: string;
  description: string;
  overrides: TemplateOverrides;
  createdAt: string;
}

export interface TemplateOption extends TemplateInfo {
  isCustom: boolean;
  baseId: string;
  edited: boolean;
}

const CUSTOM_KEY = "psak_custom_templates";
const BASE_OVERRIDES_KEY = "psak_template_base_overrides";

export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "ברירת מחדל (התבנית)", value: "" },
  { label: "דויד (David)", value: "'David','Frank Ruhl Libre',serif" },
  { label: "פרנק רוהל", value: "'Frank Ruhl Libre','David',serif" },
  { label: "נוטו סריף עברי", value: "'Noto Serif Hebrew',Georgia,serif" },
  { label: "אריאל / נקי", value: "'Arial','Noto Sans Hebrew',sans-serif" },
  { label: "רוביק (Rubik)", value: "'Rubik','Segoe UI',sans-serif" },
  { label: "היבו (Heebo)", value: "'Heebo','Segoe UI',sans-serif" },
];

// ─── persistence ───

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadCustomTemplates(): CustomTemplate[] {
  return readJson<CustomTemplate[]>(CUSTOM_KEY, []);
}

export function saveCustomTemplates(list: CustomTemplate[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch { /* ignore quota */ }
}

export function loadBaseOverrides(): Record<string, TemplateOverrides> {
  return readJson<Record<string, TemplateOverrides>>(BASE_OVERRIDES_KEY, {});
}

export function saveBaseOverrides(map: Record<string, TemplateOverrides>): void {
  try {
    localStorage.setItem(BASE_OVERRIDES_KEY, JSON.stringify(map));
  } catch { /* ignore quota */ }
}

export function getOverridesFor(templateId: string): TemplateOverrides {
  const custom = loadCustomTemplates().find((t) => t.id === templateId);
  if (custom) return custom.overrides || {};
  return loadBaseOverrides()[templateId] || {};
}

export function setOverridesFor(templateId: string, overrides: TemplateOverrides): void {
  const customs = loadCustomTemplates();
  const idx = customs.findIndex((t) => t.id === templateId);
  if (idx >= 0) {
    customs[idx] = { ...customs[idx], overrides };
    saveCustomTemplates(customs);
    return;
  }
  const map = loadBaseOverrides();
  if (Object.keys(overrides).length === 0) delete map[templateId];
  else map[templateId] = overrides;
  saveBaseOverrides(map);
}

export function renameTemplate(templateId: string, name: string): void {
  const customs = loadCustomTemplates();
  const idx = customs.findIndex((t) => t.id === templateId);
  if (idx < 0) return;
  customs[idx] = { ...customs[idx], name };
  saveCustomTemplates(customs);
}

export function duplicateTemplate(sourceId: string, name?: string): CustomTemplate {
  const customs = loadCustomTemplates();
  const source = customs.find((t) => t.id === sourceId);
  const baseInfo = TEMPLATES.find((t) => t.id === (source ? source.baseId : sourceId));
  const baseId = source ? source.baseId : (baseInfo?.id || "classic");
  const sourceName = source ? source.name : baseInfo?.name || "תבנית";
  const created: CustomTemplate = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || `${sourceName} (העתק)`,
    baseId,
    icon: source?.icon || baseInfo?.icon || "🎨",
    description: `מבוסס על "${baseInfo?.name || sourceName}" — ניתן לעריכה`,
    overrides: { ...(source ? source.overrides : loadBaseOverrides()[sourceId] || {}) },
    createdAt: new Date().toISOString(),
  };
  saveCustomTemplates([...customs, created]);
  return created;
}

export function deleteCustomTemplate(templateId: string): void {
  saveCustomTemplates(loadCustomTemplates().filter((t) => t.id !== templateId));
}

export function resetTemplate(templateId: string): void {
  setOverridesFor(templateId, {});
}

// ─── template list ───

export function getAllTemplateOptions(): TemplateOption[] {
  const baseOverrides = loadBaseOverrides();
  const builtIns: TemplateOption[] = TEMPLATES.map((t) => ({
    ...t,
    isCustom: false,
    baseId: t.id,
    edited: Object.keys(baseOverrides[t.id] || {}).length > 0,
  }));
  const customs: TemplateOption[] = loadCustomTemplates().map((c) => {
    const base = TEMPLATES.find((t) => t.id === c.baseId);
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      requiresAi: false,
      icon: c.icon || "🎨",
      hasIndex: base?.hasIndex ?? false,
      isCustom: true,
      baseId: c.baseId,
      edited: Object.keys(c.overrides || {}).length > 0,
    };
  });
  return [...builtIns, ...customs];
}

export function getTemplateName(templateId: string | null): string | undefined {
  if (!templateId) return undefined;
  return getAllTemplateOptions().find((t) => t.id === templateId)?.name;
}

// ─── CSS generation ───

const BANNER_SELECTORS = [
  ".cd-header",
  ".eb-hero",
  ".modern-header",
  ".doc-header",
  ".header",
  ".title-banner",
  '[class*="-header"]',
  '[class*="hero"]',
  '[class*="banner"]',
];

const CONTAINER_SELECTORS = [
  ".container",
  ".cd-container",
  ".eb-container",
  ".cs-container",
  ".lx-container",
  ".cd-body",
  ".eb-main",
];

export function buildOverrideCss(o: TemplateOverrides): string {
  if (!o || Object.keys(o).length === 0) return "";
  const out: string[] = [];

  const root: string[] = [];
  if (o.navy) root.push(`--navy:${o.navy}!important;--dark-navy:${o.navy}!important;`);
  if (o.gold) root.push(`--gold:${o.gold}!important;`);
  if (root.length) out.push(`:root{${root.join("")}}`);

  const body: string[] = [];
  if (o.pageBg) body.push(`background:${o.pageBg}!important;`);
  if (o.textColor) body.push(`color:${o.textColor}!important;`);
  if (o.fontFamily) body.push(`font-family:${o.fontFamily}!important;`);
  if (o.fontSize) body.push(`font-size:${o.fontSize}px!important;`);
  if (o.lineHeight) body.push(`line-height:${o.lineHeight}!important;`);
  if (body.length) out.push(`body{${body.join("")}}`);

  if (o.fontFamily) out.push(`body, body *{font-family:${o.fontFamily}!important;}`);

  if (o.docBg) out.push(`${CONTAINER_SELECTORS.join(",")}{background:${o.docBg}!important;}`);
  if (o.maxWidth) out.push(`${CONTAINER_SELECTORS.slice(0, 5).join(",")}{max-width:${o.maxWidth}px!important;}`);
  if (o.justify) out.push(`p,.doc-paragraph{text-align:justify!important;}`);

  const banners = BANNER_SELECTORS.join(",");
  if (o.bannerBg) out.push(`${banners}{background:${o.bannerBg}!important;background-image:none!important;}`);
  if (o.bannerTextColor) {
    const inner = BANNER_SELECTORS.map((s) => `${s},${s} h1,${s} h2,${s} h3,${s} div,${s} p,${s} span,${s} strong`).join(",");
    out.push(`${inner}{color:${o.bannerTextColor}!important;}`);
  }
  if (o.bannerAccentColor) {
    const accents = BANNER_SELECTORS.map(
      (s) => `${s} [class*="sub"],${s} [class*="case"],${s} [class*="serial"],${s} [class*="meta"],${s} a`,
    ).join(",");
    out.push(`${accents}{color:${o.bannerAccentColor}!important;}`);
  }
  if (o.headingColor) {
    out.push(
      `[class*="section-head"],[class*="section-title"],.doc-section-title,h2,h3,h4{color:${o.headingColor}!important;}`,
    );
  }

  return out.join("\n");
}

/** Generate the template HTML, resolving custom templates and applying user overrides. */
export function generateCustomizedHtml(templateId: string, data: ParsedPsakDin): string {
  const custom = loadCustomTemplates().find((t) => t.id === templateId);
  const baseId = custom ? custom.baseId : templateId;
  const overrides = custom ? custom.overrides : loadBaseOverrides()[templateId] || {};
  const html = generateFromTemplate(baseId, data);
  const css = buildOverrideCss(overrides || {});
  if (!css) return html;
  const styleTag = `<style id="psak-template-overrides">\n${css}\n</style>`;
  if (html.includes("</head>")) return html.replace("</head>", `${styleTag}\n</head>`);
  return `${html}\n${styleTag}`;
}

export function generateWithOverrides(baseId: string, data: ParsedPsakDin, overrides: TemplateOverrides): string {
  const html = generateFromTemplate(baseId, data);
  const css = buildOverrideCss(overrides || {});
  if (!css) return html;
  const styleTag = `<style id="psak-template-overrides">\n${css}\n</style>`;
  if (html.includes("</head>")) return html.replace("</head>", `${styleTag}\n</head>`);
  return `${html}\n${styleTag}`;
}
