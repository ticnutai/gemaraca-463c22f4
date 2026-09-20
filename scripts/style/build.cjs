var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// scripts/style/entry.ts
var entry_exports = {};
__export(entry_exports, {
  buildStyledHtml: () => buildStyledHtml
});
module.exports = __toCommonJS(entry_exports);

// src/lib/psakDinParser.ts
function parsePsakDinText(text) {
  const lines = text.split("\n").map((l) => l.trim());
  const headerEnd = lines.findIndex((l) => l.startsWith("---"));
  const headerLines = headerEnd > 0 ? lines.slice(0, headerEnd) : [];
  const bodyLines = headerEnd > 0 ? lines.slice(headerEnd + 1) : lines;
  const bodyText = bodyLines.join("\n");
  const headerMap = {};
  for (const line of headerLines) {
    const match = line.match(/^(Title|Court|Date|URL|ID):\s*(.+)/i);
    if (match) {
      headerMap[match[1].toLowerCase()] = match[2].trim();
    }
  }
  let title = headerMap["title"] || extractByPattern(bodyText, /^(.+?)(?:\s*-\s*אתר פסקי דין רבניים)?$/m) || "\u05E4\u05E1\u05E7 \u05D3\u05D9\u05DF";
  title = title.replace(/\.(html?|pdf|docx?|txt)$/i, "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "").replace(/-\d{10,}/, "").replace(/[_-]+/g, " ").trim();
  if (!title || title.length < 2) title = "\u05E4\u05E1\u05E7 \u05D3\u05D9\u05DF";
  let court = headerMap["court"] || extractByPattern(bodyText, /שם ?בית ?דין:\s*\n?\s*(.+)/);
  court = court.replace(/<[^>]*>/g, "").trim();
  if (/^תאריך:?$|^כותרת:?$|^פסק:?$/.test(court)) court = "";
  const date = headerMap["date"]?.replace(/^תאריך:\s*/, "") || extractByPattern(bodyText, /תאריך:\s*(.+)/);
  const yearMatch = date.match(/(\d{4})/);
  const hebrewYearMatch = date.match(/תש[א-ת]"?[א-ת]/);
  const year = yearMatch ? parseInt(yearMatch[1]) : hebrewYearMatch ? 2022 : (/* @__PURE__ */ new Date()).getFullYear();
  const caseNumber = extractByPattern(bodyText, /תיק מספר:\s*(.+)/) || extractByPattern(bodyText, /מס\.\s*סידורי:\s*(.+)/);
  const sourceUrl = headerMap["url"] || "";
  const sourceId = headerMap["id"] || extractByPattern(sourceUrl, /(\d+)$/) || "";
  const judges = extractJudges(bodyText);
  const sections = extractSections(bodyText);
  let summary = "";
  const sm1 = bodyText.match(/תקציר[:\s]*\n?\s*(.+?)(?=\n\s*(?:נושאים|פסק\b|טענות|החלטה|הכרעת|עובדות|דיון|הנמקה|סיכום|תאריך))/s);
  if (sm1) summary = sm1[1].trim();
  if (!summary) {
    const sm2 = bodyText.match(/תקציר[:\s]*\n?\s*(.+?)(?=\n\s*\n)/s);
    if (sm2) summary = sm2[1].trim();
  }
  if (!summary) {
    const sm3 = bodyText.match(/תקציר[:\s]*\n?\s*(.+)/s);
    if (sm3) {
      summary = sm3[1].trim();
      if (summary.length > 2e3) summary = summary.slice(0, 2e3);
    }
  }
  if (!summary) {
    const sSec = sections.find((s) => s.type === "summary");
    if (sSec) summary = sSec.content;
  }
  if (!summary) {
    const bgSec = sections.find((s) => s.type === "general" && (s.title === "\u05E8\u05E7\u05E2" || s.title === "\u05EA\u05D5\u05DB\u05DF \u05E4\u05E1\u05E7 \u05D4\u05D3\u05D9\u05DF"));
    if (bgSec) {
      summary = bgSec.content.length > 2e3 ? bgSec.content.slice(0, 2e3) + "..." : bgSec.content;
    }
  }
  let topics = extractByPattern(bodyText, /נושאים הנידונים בפסק[:\s]*\n?\s*(.+?)(?=\n\s*(?:תאריך|פסק\b|תקציר|טענות|החלטה|דיון|עובדות))/s);
  if (!topics) {
    topics = extractByPattern(bodyText, /נושאים הנידונים בפסק[:\s]*\n?\s*(.+?)(?=\n\s*\n)/s);
  }
  if (!topics) {
    topics = extractByPattern(bodyText, /נושאים הנידונים בפסק[:\s]*\n?\s*(.+)/s);
    if (topics.length > 1e3) topics = topics.slice(0, 1e3);
  }
  return {
    title,
    court,
    date,
    year,
    caseNumber,
    sourceUrl,
    sourceId,
    judges,
    summary,
    topics,
    sections,
    rawText: text
  };
}
function extractByPattern(text, pattern) {
  const match = text.match(pattern);
  return match?.[1]?.trim() || "";
}
function extractJudges(text) {
  const judgesBlock = text.match(/דיינים:\s*\n([\s\S]*?)(?=\n\s*(?:תקציר|נושאים|תאריך|פסק דין))/);
  if (!judgesBlock) return [];
  return judgesBlock[1].split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && l.startsWith("\u05D4\u05E8\u05D1"));
}
function extractSections(text) {
  const sectionPatterns = [
    { type: "summary", patterns: [
      /^תקציר[:\s]/m,
      /^תמצית\s*(?:פסק\s*הדין|העובדות|המקרה|העובדות\s*המוסכמות)?[:\s.]/m
    ] },
    { type: "facts", patterns: [
      /^עובדות(?:\s*(?:המקרה|התיק|הרקע|מוסכמות))?[:\s.]/m,
      /^(?:ה)?עובדות\s*(?:ה)?מוסכמות[:\s.]/m,
      /^רקע(?:\s*(?:עובדתי|מוסכם|וטענות\s*הצדדים))?[:\s.]/m,
      /^המקרה\s*העובדתי[:\s.]/m,
      /^תיאור\s*(?:המקרה|העובדות)(?:\s*(?:ו)?(?:ה)?עובדות\s*(?:ה)?מוסכמות)?[:\s.]/m,
      /^נושא\s*(?:המקרה|התביעה|הדיון)[:\s.]/m,
      /^נושאי\s*הדיון[:\s.]/m
    ] },
    { type: "chapters", patterns: [/^ראשי\s*פרקים[:\s]?/m, /^תוכן\s*(?:ה)?עניינים[:\s]?/m] },
    { type: "plaintiff-claims", patterns: [
      /^טענות\s*התובע[ים]?(?:\s*ותביעות[ים]?(?:הם)?)?[:\s]/m,
      /^טענות\s*צד\s*א[:\s]/m,
      /^טענות\s*המבקש[ים]?[:\s]/m,
      /^תביעת\s*התובע[ים]?\s*וטענות[יו]?[:\s]/m,
      /^תביעות\s*וטענות\s*הצדדים[:\s]/m
    ] },
    { type: "defendant-claims", patterns: [
      /^טענות\s*הנתבע[ים]?(?:\s*ותביעות[ים]?(?:הם)?)?[:\s]/m,
      /^טענות\s*צד\s*ב[:\s]/m,
      /^טענות\s*המשיב[ים]?[:\s]/m
    ] },
    { type: "discussion", patterns: [
      /^דיון(?:\s*(?:הלכתי|משפטי))?[:\s]/m,
      /^ניתוח\s*(?:הלכתי|משפטי)[:\s]/m,
      /^(?:ה)?שאלות\s*לדיון[:\s]/m,
      /^נושאים\s*לדיון[:\s]/m
    ] },
    { type: "reasoning", patterns: [
      /^הנמקה[:\s]/m,
      /^נימוקים[:\s]/m,
      /^נימוקי\s*(?:הדין|הפסק|פסק\s*הדין|בית\s*הדין)(?:\s*בהרחבה)?[:\s]/m
    ] },
    { type: "law-sources", patterns: [/^מקורות\s*(?:הלכתיים|משפטיים)?[:\s]/m, /^מראי\s*מקומות[:\s]/m] },
    { type: "ruling", patterns: [/^פסק\s*(?:הדין|דין|ביניים)[:\s]/m, /^פסיקה[:\s]/m] },
    { type: "decision", patterns: [
      /^החלט(?:ה|ות|ת\s*(?:ה)?ביניים)[:\s]/m,
      /^הכרעת\s*(?:הדין|השו"ע|הרמ"א)[:\s]/m,
      /^הכרעה[:\s]/m,
      /^מסקנ(?:ה|ות)[:\s]/m
    ] },
    { type: "conclusion", patterns: [/^סוף\s*דבר[:\s]/m, /^לסיכום[:\s]/m, /^סיכום(?:\s*ביניים)?[:\s]/m] }
  ];
  const found = [];
  for (const { type, patterns } of sectionPatterns) {
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m && m.index !== void 0) {
        const titleEnd = text.indexOf("\n", m.index);
        const title = text.slice(m.index, titleEnd > m.index ? titleEnd : m.index + m[0].length).replace(/[:]/g, "").trim();
        found.push({ type, title, start: m.index });
        break;
      }
    }
  }
  found.sort((a, b) => a.start - b.start);
  const sections = [];
  if (found.length > 0) {
    for (let i = 0; i < found.length; i++) {
      const headerLineEnd = text.indexOf("\n", found[i].start);
      const contentStart = headerLineEnd > found[i].start ? headerLineEnd + 1 : found[i].start + found[i].title.length;
      const contentEnd = i + 1 < found.length ? found[i + 1].start : text.length;
      const content = text.slice(contentStart, contentEnd).trim();
      if (content) {
        sections.push({ type: found[i].type, title: found[i].title, content });
      }
    }
    const preContent = text.slice(0, found[0].start).trim();
    const preLines = preContent.split("\n").filter((l) => {
      const t = l.trim();
      return t && !/^(שם בית דין|דיינים|תקציר|נושאים הנידונים|תאריך|תיק מספר|מס\. סידורי|בס"ד)/.test(t) && !/^הרב /.test(t) && t.length > 0;
    });
    if (preLines.length > 0) {
      sections.unshift({ type: "general", title: "\u05E8\u05E7\u05E2", content: preLines.join("\n") });
    }
  } else {
    const bodyLines = text.split("\n");
    const contentLines = [];
    let pastMetadata = false;
    for (const line of bodyLines) {
      const t = line.trim();
      if (!pastMetadata) {
        if (/^(שם בית דין|דיינים|תקציר|נושאים הנידונים|תאריך|תיק מספר|מס\. סידורי|Title|Court|Date|URL|ID)[:]/i.test(t)) continue;
        if (/^הרב /.test(t)) continue;
        if (t === "" || t === '\u05D1\u05E1"\u05D3' || /^-{3,}$/.test(t)) continue;
        if (t.length > 0) pastMetadata = true;
      }
      if (pastMetadata) {
        contentLines.push(line);
      }
    }
    const generalContent = contentLines.join("\n").trim();
    if (generalContent) {
      sections.push({ type: "general", title: "\u05EA\u05D5\u05DB\u05DF \u05E4\u05E1\u05E7 \u05D4\u05D3\u05D9\u05DF", content: generalContent });
    }
  }
  return sections;
}

// src/lib/smartTextFormatter.ts
var SECTION_HEADER_PATTERNS = [
  // Exact known headers
  /^(?:ראשי\s*פרקים|תוכן\s*(?:ה)?עניינים)\s*:?\s*$/,
  /^(?:תקציר|סיכום)\s*:?\s*$/,
  /^(?:עובדות(?:\s*(?:המקרה|התיק|הרקע))?|המקרה\s*העובדתי|רקע(?:\s*עובדתי)?|תיאור\s*(?:המקרה|העובדות))\s*:?\s*$/,
  /^(?:טענות\s*(?:התובע[ים]?|הנתבע[ים]?|המבקש[ים]?|המשיב[ים]?|צד\s*[אב]))\s*:?\s*$/,
  /^(?:דיון(?:\s*(?:הלכתי|משפטי))?|ניתוח(?:\s*(?:הלכתי|משפטי))?)\s*:?\s*$/,
  /^(?:הנמקה|נימוקים|נימוקי\s*(?:הדין|הפסק|בית\s*הדין))\s*:?\s*$/,
  /^(?:פסק\s*(?:הדין)?|פסיקה|החלטה|הכרעת?\s*(?:הדין)?|מסקנה|מסקנות)\s*:?\s*$/,
  /^(?:סוף\s*דבר|לסיכום)\s*:?\s*$/,
  /^(?:מקורות(?:\s*(?:הלכתיים|משפטיים))?|מראי\s*מקומות)\s*:?\s*$/,
  /^(?:שאלה|תשובה|הלכה\s*למעשה)\s*:?\s*$/,
  /^(?:נושאים\s*הנידונים\s*בפסק)\s*:?\s*$/,
  // Generic pattern: short line (< 60 chars) ending with colon
  /^.{3,60}:\s*$/
];
var SUB_HEADER_PATTERNS = [
  // Hebrew lettered list headers: "א. על הניזק להרחיק"
  /^[א-ת][.׳']\s+.{3,80}$/,
  // Numeric list headers: "1. נושא ראשון"
  /^\d{1,3}[.)]\s+.{3,80}$/
];
var REFERENCE_PATTERNS = [
  // Talmud references: בב"ק כג,ב
  /^(?:ב?ב"[קמגפ]|ב?שבת|ב?יבמות|ב?כתובות|ב?גיטין|ב?קידושין|ב?סנהדרין|ב?מכות|ב?שבועות|ב?ע"ז|ב?חולין|ב?בכורות|ב?ערכין|ב?נדרים|ב?נזיר)\s+[א-ת]{1,3}[,׳'][א-ב]?\s*;?\s*$/,
  // Short source citations: "ועי'" or "וכן" alone
  /^(?:ועי['\u2019]|ועיין|וכן|וע"ע|וע"ש|עי['\u2019]|עיין)\s*$/,
  // Rambam/Shulchan Aruch refs
  /^(?:ב?רמב"ם|ב?שו"ע|ב?רמ"א|ב?טור|ב?ש"ך|ב?ט"ז)\s+.{3,80}$/,
  // Responsa references
  /^(?:ב?שו"ת|ב?תשו['\u2019])\s+.{3,80}$/
];
function isQuoteLine(line) {
  if (/^["״"'].+["״"']\.?\s*$/.test(line)) return true;
  if (/^["״"']/.test(line) && line.length > 10) return true;
  return false;
}
function isSectionHeader(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return false;
  return SECTION_HEADER_PATTERNS.some((p) => p.test(trimmed));
}
function isSubHeader(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return SUB_HEADER_PATTERNS.some((p) => p.test(trimmed));
}
function isReference(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return REFERENCE_PATTERNS.some((p) => p.test(trimmed));
}
function classifyLines(text) {
  const normalized = text.replace(/\n{4,}/g, "\n\n\n");
  const lines = normalized.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      if (result.length > 0 && result[result.length - 1].type === "empty") continue;
      result.push({ type: "empty", text: "" });
    } else if (isSectionHeader(trimmed)) {
      result.push({ type: "header", text: trimmed.replace(/:$/, "").trim() });
    } else if (isSubHeader(trimmed)) {
      result.push({ type: "subheader", text: trimmed });
    } else if (isReference(trimmed)) {
      result.push({ type: "reference", text: trimmed });
    } else if (isQuoteLine(trimmed)) {
      result.push({ type: "quote", text: trimmed });
    } else {
      result.push({ type: "paragraph", text: trimmed });
    }
  }
  return result;
}
function classifiedLinesToHtml(lines) {
  const parts = [];
  for (const line of lines) {
    switch (line.type) {
      case "header":
        parts.push(`<h3 class="detected-header">${esc(line.text)}</h3>`);
        break;
      case "subheader":
        parts.push(`<div class="detected-subheader">${esc(line.text)}</div>`);
        break;
      case "reference":
        parts.push(`<div class="detected-reference">${esc(line.text)}</div>`);
        break;
      case "quote":
        parts.push(`<blockquote class="detected-quote">${esc(line.text)}</blockquote>`);
        break;
      case "paragraph":
        parts.push(`<div class="paragraph">${esc(line.text)}</div>`);
        break;
      case "empty":
        parts.push(`<div class="spacer"></div>`);
        break;
    }
  }
  return parts.join("\n        ");
}
function esc(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// src/lib/psakDinHtmlTemplate.ts
function esc2(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function generatePsakDinHtml(data) {
  const judgesHtml = data.judges.length > 0 ? `<ul style="list-style-type: none; padding: 0; margin: 0;">
                ${data.judges.map((j) => `<li>${esc2(j)}</li>`).join("\n                ")}
            </ul>` : "";
  const sectionsHtml = data.sections.map((section) => {
    const icon = section.type === "plaintiff-claims" ? "\u{1F4CC}" : section.type === "defendant-claims" ? "\u{1F4CC}" : section.type === "ruling" ? "\u2705" : section.type === "decision" ? "\u2705" : section.type === "summary" ? "\u{1F4DD}" : section.type === "facts" ? "\u{1F4CB}" : section.type === "discussion" ? "\u{1F4AC}" : section.type === "reasoning" ? "\u2696\uFE0F" : section.type === "chapters" ? "\u{1F4D1}" : section.type === "law-sources" ? "\u{1F4DA}" : section.type === "conclusion" ? "\u{1F3C1}" : "\u{1F4DC}";
    const classified = classifyLines(section.content);
    const contentHtml = classifiedLinesToHtml(classified);
    return `
        <h3 class="subsection-title"><span class="icon">${icon}</span> ${esc2(section.title)}</h3>
        ${contentHtml}`;
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>\u05E4\u05E1\u05E7 \u05D3\u05D9\u05DF: ${esc2(data.title)}</title>
    <style>
        @font-face {
            font-family: 'David';
            src: url('https://fonts.cdnfonts.com/s/17208/David.woff') format('woff');
            font-weight: normal;
            font-style: normal;
        }
        body {
            font-family: 'David', 'Times New Roman', serif;
            line-height: 1.8;
            color: #333;
            background-color: #f9f9f9;
            margin: 0;
            padding: 20px;
            direction: rtl;
            text-align: right;
        }
        .container {
            max-width: 900px;
            margin: 30px auto;
            background-color: #ffffff;
            border: 1px solid #eee;
            box-shadow: 0 0 15px rgba(0, 0, 0, 0.05);
            padding: 40px 60px;
            border-radius: 8px;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 3px solid #D4AF37;
            padding-bottom: 20px;
        }
        .header h1 {
            color: #0B1F5B;
            font-size: 2.8em;
            margin: 0;
            padding-bottom: 10px;
            font-weight: bold;
        }
        .header .logo {
            font-size: 1.2em;
            color: #555;
            margin-top: 5px;
        }
        .section-title {
            color: #0B1F5B;
            font-size: 1.8em;
            margin-top: 35px;
            margin-bottom: 15px;
            border-bottom: 2px solid #D4AF37;
            padding-bottom: 8px;
            font-weight: bold;
        }
        .subsection-title {
            color: #0B1F5B;
            font-size: 1.4em;
            margin-top: 25px;
            margin-bottom: 10px;
            font-weight: bold;
        }
        .details-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 25px;
        }
        .details-table td {
            padding: 10px 0;
            border-bottom: 1px dashed #eee;
            vertical-align: top;
        }
        .details-table td:first-child {
            font-weight: bold;
            width: 150px;
            color: #0B1F5B;
        }
        .paragraph {
            margin-bottom: 15px;
            text-align: justify;
        }
        .bold-text {
            font-weight: bold;
            color: #0B1F5B;
        }
        .icon {
            margin-left: 8px;
            color: #D4AF37;
        }
        .divider {
            border: none;
            border-top: 1px solid #eee;
            margin: 30px 0;
        }
        .footer {
            text-align: center;
            margin-top: 50px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            color: #777;
            font-size: 0.9em;
        }
        .signature {
            text-align: center;
            margin-top: 40px;
            font-weight: bold;
            color: #0B1F5B;
        }
        .signature div {
            margin-top: 10px;
        }
        .psakim-link {
            text-align: center;
            margin-top: 30px;
            font-size: 1.1em;
        }
        .psakim-link a {
            color: #0B1F5B;
            text-decoration: none;
            font-weight: bold;
        }
        .psakim-link a:hover {
            text-decoration: underline;
        }
        .detected-header {
            color: #0B1F5B;
            font-size: 1.3em;
            font-weight: bold;
            margin-top: 28px;
            margin-bottom: 12px;
            padding-bottom: 6px;
            border-bottom: 2px solid #D4AF37;
        }
        .detected-subheader {
            color: #0B1F5B;
            font-size: 1.1em;
            font-weight: bold;
            margin-top: 16px;
            margin-bottom: 8px;
        }
        .detected-reference {
            color: #555;
            font-size: 0.95em;
            margin: 4px 0;
            padding-right: 20px;
            font-style: italic;
        }
        .detected-quote {
            margin: 12px 30px;
            padding: 10px 20px;
            border-right: 4px solid #D4AF37;
            background-color: #faf8f0;
            font-style: italic;
            color: #333;
        }
        .spacer {
            height: 12px;
        }
        @media print {
            body { background: white; padding: 0; }
            .container { box-shadow: none; border: none; padding: 20px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">\u{1F3DB}\uFE0F \u05D1\u05D9\u05EA \u05D3\u05D9\u05DF \u05E8\u05D1\u05E0\u05D9 \u2696\uFE0F</div>
            <h1>\u05E4\u05E1\u05E7 \u05D3\u05D9\u05DF</h1>
            ${data.caseNumber ? `<div style="font-size: 1.1em; color: #555;">\u05EA\u05D9\u05E7 \u05DE\u05E1' ${esc2(data.caseNumber)}</div>` : ""}
        </div>

        <h2 class="section-title"><span class="icon">\u{1F4CB}</span> \u05E4\u05E8\u05D8\u05D9 \u05D4\u05EA\u05D9\u05E7</h2>
        <table class="details-table">
            <tr>
                <td><span class="icon">\u{1F4CC}</span> \u05DB\u05D5\u05EA\u05E8\u05EA:</td>
                <td>${esc2(data.title)}</td>
            </tr>
            <tr>
                <td><span class="icon">\u{1F3DB}\uFE0F</span> \u05D1\u05D9\u05EA \u05D3\u05D9\u05DF:</td>
                <td>${esc2(data.court)}</td>
            </tr>
            <tr>
                <td><span class="icon">\u{1F4C5}</span> \u05EA\u05D0\u05E8\u05D9\u05DA:</td>
                <td>${esc2(data.date)}${data.year ? ` (${data.year})` : ""}</td>
            </tr>
            ${data.sourceId ? `<tr>
                <td><span class="icon">\u{1F194}</span> \u05DE\u05D6\u05D4\u05D4 \u05EA\u05D9\u05E7:</td>
                <td>${esc2(data.sourceId)}</td>
            </tr>` : ""}
            ${data.sourceUrl ? `<tr>
                <td><span class="icon">\u{1F517}</span> \u05E7\u05D9\u05E9\u05D5\u05E8 \u05DE\u05E7\u05D5\u05E8:</td>
                <td><a href="${esc2(data.sourceUrl)}" target="_blank" rel="noopener noreferrer" style="color: #0B1F5B;">${esc2(data.sourceUrl)}</a></td>
            </tr>` : ""}
        </table>

        ${data.summary ? `
        <h2 class="section-title"><span class="icon">\u{1F4DD}</span> \u05EA\u05E7\u05E6\u05D9\u05E8</h2>
        <div class="paragraph">${esc2(data.summary)}</div>
        ` : ""}

        <hr class="divider">

        <h2 class="section-title"><span class="icon">\u{1F4DC}</span> \u05D8\u05E7\u05E1\u05D8 \u05DE\u05DC\u05D0 \u05E9\u05DC \u05E4\u05E1\u05E7 \u05D4\u05D3\u05D9\u05DF</h2>

        <div style="text-align: center; margin-bottom: 20px; font-weight: bold; font-size: 1.1em;">
            \u05D1\u05E1"\u05D3
        </div>
        ${data.sourceId ? `<div style="text-align: center; margin-bottom: 20px;">\u05DE\u05E1. \u05E1\u05D9\u05D3\u05D5\u05E8\u05D9:${esc2(data.sourceId)}</div>` : ""}
        <h3 style="text-align: center; color: #0B1F5B; font-size: 1.6em; margin-bottom: 25px;">
            ${esc2(data.title)}
        </h3>

        <div style="font-size: 1.1em; margin-bottom: 20px;">
            <span class="bold-text">\u05E9\u05DD \u05D1\u05D9\u05EA \u05D3\u05D9\u05DF:</span> ${esc2(data.court)}
        </div>
        ${judgesHtml ? `<div style="font-size: 1.1em; margin-bottom: 20px;">
            <span class="bold-text">\u05D3\u05D9\u05D9\u05E0\u05D9\u05DD:</span>
            ${judgesHtml}
        </div>` : ""}
        ${data.topics ? `<div style="font-size: 1.1em; margin-bottom: 20px;">
            <span class="bold-text">\u05E0\u05D5\u05E9\u05D0\u05D9\u05DD \u05D4\u05E0\u05D9\u05D3\u05D5\u05E0\u05D9\u05DD \u05D1\u05E4\u05E1\u05E7:</span> ${esc2(data.topics)}
        </div>` : ""}
        <div style="font-size: 1.1em; margin-bottom: 20px;">
            <span class="bold-text">\u05EA\u05D0\u05E8\u05D9\u05DA:</span> ${esc2(data.date)}
        </div>
        ${data.caseNumber ? `<div style="font-size: 1.1em; margin-bottom: 20px;">
            <span class="bold-text">\u05EA\u05D9\u05E7 \u05DE\u05E1\u05E4\u05E8:</span> ${esc2(data.caseNumber)}
        </div>` : ""}

        ${sectionsHtml}

        ${data.sections.length === 0 ? `
        <div style="font-size: 1.1em; line-height: 2;">
            ${classifiedLinesToHtml(classifyLines(data.rawText))}
        </div>
        ` : ""}

        <div style="text-align: center; margin-top: 40px; font-style: italic; color: #555;">
            '\u05D5\u05D4\u05D0\u05DE\u05EA \u05D5\u05D4\u05E9\u05DC\u05D5\u05DD \u05D0\u05D4\u05D1\u05D5'
        </div>

        ${data.judges.length > 0 ? `<div class="signature">
            ${data.judges.map((j) => `<div>${esc2(j)}</div>`).join("\n            ")}
        </div>` : ""}

        ${data.sourceUrl ? `<div class="psakim-link">
            \u05D1\u05DB\u05D3\u05D9 \u05DC\u05D4\u05EA\u05D9\u05D9\u05D7\u05E1 \u05DC\u05E4\u05E1\u05E7 \u05D3\u05D9\u05DF \u05D6\u05D4,
            <a href="${esc2(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">\u05DC\u05D7\u05E5 \u05DB\u05D0\u05DF</a>
        </div>` : ""}

        <div class="footer">
            <hr class="divider">
            \u05DE\u05E2\u05D5\u05E6\u05D1 \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA | &copy; ${(/* @__PURE__ */ new Date()).getFullYear()} \u05DB\u05DC \u05D4\u05D6\u05DB\u05D5\u05D9\u05D5\u05EA \u05E9\u05DE\u05D5\u05E8\u05D5\u05EA
        </div>
    </div>
</body>
</html>`;
}
function isStyledDocument(text) {
  return /<!doctype html|<html[\s>]/i.test(text) || text.includes('class="container"');
}
function toHouseStyledHtml(text, meta = {}) {
  if (!text.trim() || isStyledDocument(text)) return text;
  const parsed = parsePsakDinText(text);
  if (meta.title) parsed.title = meta.title;
  if (meta.court) parsed.court = meta.court || parsed.court;
  if (meta.year) parsed.year = meta.year;
  if (meta.caseNumber) parsed.caseNumber = meta.caseNumber;
  if (meta.summary && !parsed.summary) parsed.summary = meta.summary;
  if (meta.sourceUrl && !meta.sourceUrl.includes("/storage/v1/object/")) parsed.sourceUrl = meta.sourceUrl;
  const html = generatePsakDinHtml(parsed);
  return html.replace(
    ".paragraph {",
    ".details-table a, .psakim-link a { word-break: break-all; }\n        .paragraph {"
  );
}

// scripts/style/entry.ts
function buildStyledHtml(rawText, meta = {}) {
  return toHouseStyledHtml(rawText, meta);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildStyledHtml
});
