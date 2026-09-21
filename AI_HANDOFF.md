# מסמך מסירה — מצב הפרויקט, מה נעשה, והמלצות

מסמך אחד שנועד לתת לאדם או למודל שנכנס לפרויקט את כל התמונה בלי לקרוא את כל הקוד.
נכתב ב-21.9.2026. לשינויים שוטפים אחריו: [`CHANGELOG.md`](CHANGELOG.md).

---

## 1. מה הפרויקט

**תורה ומציאות** — אפליקציית לימוד בעברית (RTL) שמקשרת סוגיות בתלמוד (בעיקר בבא מציעא)
לפסקי דין רבניים ולמקרים מודרניים.

| | |
| --- | --- |
| Stack | Vite + React 18 + TypeScript + Tailwind + shadcn/ui |
| Backend | Supabase — פרויקט `jaotdqumpcfhcbkgtfib` (Postgres, auth, storage, ~20 edge functions ב-Deno) |
| Deploy | Vercel; הריפו הוא מקור האמת, ו-Lovable (פרויקט `d7f25ac6-…`) דוחף אליו קומיטים |
| ריפו | `github.com/ticnutai/gemaraca-463c22f4` |

**מוסכמות שחייבים להכיר** — מפורטות ב-[`CLAUDE.md`](CLAUDE.md), שנטען אוטומטית בכל סשן של
Claude Code. בתמצית: הממשק עברית ו-RTL; מיגרציות append-only; פונקציות ציבוריות נרשמות ב-
`supabase/config.toml` עם `verify_jwt = false`; **ויש צפיין מסמכים אחד בלבד** (ראו §3).

---

## 2. הנתונים — מה יש ואיפה

### טבלאות מרכזיות

| טבלה | תפקיד | עמודות שחשוב להכיר |
| --- | --- | --- |
| `psakei_din` | פסקי הדין | `title`, `court`, `year`, `case_number`, `summary`, **`full_text`**, **`source_url`**, `tags`, `original_text` (הטקסט לפני עיצוב), `beautify_count`, `content_print` (טביעת אצבע לזיהוי כפילויות), `category`, `search_vector` |
| `talmud_references` | האינדקס המתקדם: הפניה מפסק דין לדף גמרא | `tractate`, `daf`, `amud`, `normalized`, `corrected_normalized`, `confidence_score`, `validation_status`, **`source`** = מי חילץ (`site-index` / `regex` / `ai` / `extracted`), **`validated_by`** + **`validated_at`** = מי אימת. שתי השאלות נפרדות: לפני 22.9 האימות דרס את הייחוס |
| `gemara_pages` | טקסט הגמרא לפי `sugya_id` (למשל `berakhot_2a`) | `gemara_text`, `full_text`, `daf_yomi`, `masechet` |
| `sugya_psak_links` | קישור ידני/AI בין סוגיה לפסק | `relevance_score`, `connection_explanation` |
| `psak_sources` | מראי מקומות שאינם בבלי: שולחן ערוך (סימן/סעיף), רמב"ם וירושלמי (פרק/הלכה) — 3,394 שורות | `corpus`, `book`, `section`, `subsection`, `display`, `raw_path` |
| `psak_source_registry` | מרשם המקורות: שם לתצוגה, אתר, רישוי, נוסח ייחוס, והאם להציג | `key`, `label`, `license`, `attribution`, `enabled` |
| `masechtot_daf_limits` | מספר הדפים בכל מסכת; טריגר `guard_daf_range` חוסם מראה מקום לדף שאינו קיים | `name`, `max_daf` |
| `data_backups`, `data_restores` | היסטוריית גיבויים ושחזורים; העותקים עצמם ב-Storage בדלי `system-backups` | `kind`, `status`, `tables`, `total_rows`, `storage_path` |
| `user_books`, `pdf_annotations`, `text_annotations`, `user_preferences`, `shas_download_progress` | מצב משתמש, הערות, התקדמות הורדת ש"ס | |

### קורפוסים — **רוב המסמכים אינם PDF**

לכל פסק יש `source_key` שמציין מאיזה מקור הובא, וכל מקור רשום ב-`psak_source_registry`
עם הרישוי והייחוס שלו. המספרים למטה הם מצב המסד ב-22.9.2026 (סה"כ 8,541 פסקים):

| `source_key` | מקור | כמות | פורמט במסד | מוריד |
| --- | --- | --- | --- | --- |
| `psakim.org` | אתר פסקים | 3,053 | HTML (גם `all-psakim/` בריפו) | `download-all-psakim.mjs` |
| `daat.ac.il` | אתר דעת | 1,552 | HTML ב-windows-1255 | `download-daat-psakim.mjs` |
| `gov.il` | בתי הדין הרבניים | 1,984 | **טקסט** שחולץ מ-docx, `source_url` לדף ב-gov.il | `download-govil-psakim.mjs` |
| `upload` | קבצים שהועלו למערכת | 1,879 | מעורב | — |
| `bdmz` | בית דין לממונות משפט צדק | 27 | HTML, כולל הערות שוליים | `download-bdmz-psakim.mjs` |
| `bethdin` | בית הדין דאמריקה | 25 | PDF עם שכבת טקסט, חולץ עם pdfjs-dist | `download-bethdin-psakim.mjs` |
| `other` | אחר | 21 | מעורב | — |
| — | סריקות ש"ס | PDF | Supabase Storage (`shas-pdf-pages`) | `upload-shas-pdfs.mjs` |

מוריד חדש כותב קאש JSON ל-`scripts/data/<מקור>/`, ו-`scripts/import-cached-psakim.mjs`
מייבא ממנו: מדלג על כפילויות לפי כותרת ולפי `content_print`, מעצב בתבנית הבית, שומר את
הטקסט המקורי ב-`original_text`, ורושם את המקור במרשם. מ-daat.ac.il הורדו 2,591 פסקים
ויובאו 1,552 — 1,041 נחסמו כי טביעת האצבע זיהתה שהם כבר במסד.

**זו העובדה החשובה ביותר להבנת ארכיטקטורת הצפיין:** PDF הוא מיעוט. הצפיין הוא מעטפת אחת
עם שני מנועי הצגה בפנים — EmbedPDF ל-PDF, ותבנית הבית ל-HTML/טקסט.

---

### שלוש מערכות נתונים שחייבים להכיר

**א. גיבוי ושחזור** — `src/lib/backup/engine.ts` + `src/components/backup/`, נפתח מתפריט
ההגדרות למנהל בלבד. גיבוי לענן או לקובץ ZIP, בחירה לפי נושאים, שחזור בשלושה מצבים
(הוספת חסרים / עדכון / החלפה מלאה), גיבוי ביטחון אוטומטי לפני שחזור, בדיקת תקינות,
וגיבוי אוטומטי שבועי שרץ מהדפדפן של המנהל (`AutoBackupRunner`). צד השרת במיגרציה
`20260918120000`: הפונקציות `backup_catalog`, `backup_export_rows`, `backup_restore_rows`,
`backup_delete_missing`. **המסד אינו מאפשר `session_replication_role`**, ולכן השחזור
מכבה טריגרים לכל אצווה ונופל לשורה-שורה כשיש הפרת מפתח זר.

**ב. מראי מקומות** — שלוש שכבות, לפי סדר אמינות יורד:
1. `source='site-index'` — תיוג ידני של psakim.org שיובא כמו שהוא (`import-source-index-refs.mjs`
   לבבלי, `import-other-sources.mjs` לשאר). **מדויק, בלי AI.**
2. `source='regex'` — 12 תבניות ב-`supabase/functions/extract-references`.
3. `source='ai'` — Gemini, על אותו טקסט.
   כל מראה מקום נבדק מול `masechtot_daf_limits`; מה שמחוץ לטווח מסומן `incorrect`.
   **חשוב:** ה-Edge Function שולח ל-AI 6,000 תווים בלבד, ולכן הקריאה מתבצעת לפי קטעים
   חופפים — `src/lib/references/extractAll.ts` באפליקציה, `scripts/reanalyze-refs.mjs` בסקריפט.
   מצב נוכחי: 20,997 מראי מקומות תקפים ל-4,066 פסקים.

**ג. כפילויות** — `content_print` הוא md5 של 2,000 האותיות הראשונות (בלי תגיות וסימני פיסוק).
`scripts/dedupe-psakim.mjs` מאחד כפילויות: מעביר את כל מה שמקושר לפסק הנשמר ואז מוחק.
כל ייבוא חדש בודק מול טביעות האצבע הקיימות, וכך נחסמו 712 פסקים כפולים בייבוא מ-gov.il.

---

## 3. ארכיטקטורת הצפיין (המצב הקיים)

```
כל מקום שמציג פסק דין  ──►  useDocumentViewer().open({ id, title, source_url })
                                        │  src/components/DocumentViewerProvider.tsx
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
            חלון מעל הדף (ברירת מחדל)            עמוד מלא (fullPage: true)
            iframe → ?embedded=1                  /embedpdf-viewer?…
                        └───────────────┬───────────────┘
                                        ▼
                            src/pages/EmbedPdfViewerPage.tsx
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
            PDF → מנוע EmbedPDF (pdfium)      HTML/טקסט → תבנית הבית
            src/lib/embedPdfConfig.ts         src/lib/psakDinHtmlTemplate.ts
                                              → toHouseStyledHtml()
```

### כללים שאסור לשבור

1. **לא מוסיפים צפיין נוסף.** עד 21.9 היו ארבעה צפיינים ותפריט בחירה למשתמש; הכול אוחד.
   תוספת יכולת נכנסת ל-`EmbedPdfViewerPage` או ל-`embedPdfConfig.ts`.
2. **`toHouseStyledHtml` הוא מקור האמת היחיד לעיצוב פסק דין.** גם הצפיין החי וגם הסקריפט
   `scripts/style-all-psakim.mjs` (דרך `scripts/style/entry.ts` → `build.cjs`) קוראים לה.
   אם משנים את התבנית — בונים מחדש את `scripts/style/build.cjs` ומוודאים שהפלט זהה.
3. **עמוד אינטרנט חיצוני לא מוטמע.** אתרים כמו gov.il שולחים `X-Frame-Options` ולכן iframe
   אליהם נשאר ריק. כשיש `full_text` במסד — מציגים אותו, לא את המקור.

### קבצים שצריך להכיר

| קובץ | מה יש בו |
| --- | --- |
| `src/components/DocumentViewerProvider.tsx` | נקודת הכניסה היחידה; החלון, כפתור "עמוד מלא", ו-`postMessage` שמרענן רשימות אחרי עריכה |
| `src/pages/EmbedPdfViewerPage.tsx` | ~4,400 שורות: הצפיין עצמו — פיצול/השוואה, אנוטציות, סימניות, מועדפים, עיצוב, חיפוש במסמך, ייצוא, עריכת פרטי הפסק |
| `src/lib/embedPdfConfig.ts` | כל הגדרות המנוע (ראו §4) |
| `src/lib/embedPdfHebrewLocale.ts` | 331 מחרוזות הממשק בעברית |
| `src/lib/psakDinHtmlTemplate.ts` | תבנית הבית + `toHouseStyledHtml` |
| `src/lib/psakDinParser.ts` | ניתוח טקסט פסק דין לסעיפים |

---

## 4. הגדרות מנוע ה-PDF ולמה הן כאלה

הכול ב-`src/lib/embedPdfConfig.ts`. כל שורה שם היא תשובה לבעיה אמיתית:

| הגדרה | למה |
| --- | --- |
| `wasmUrl` אבסולוטי מה-build שלנו | ה-WASM (4.6MB) לא נטען מ-jsDelivr: עובד offline (PWA), אותם בתים בכל דיפלוי. **אבסולוטי** כי ה-worker נטען מ-blob וכתובת יחסית נשברת שם |
| `i18n` — עברית נרשמת ב-`onReady` ולא ב-config | העברת `i18n.locales` ב-config **דורסת** את האנגלית המובנית שהיא ה-fallback |
| `fonts: { ui: …, signature: null }` | בלי Open Sans מ-Google Fonts; הצפיין יורש את גופן האתר |
| `stamp: { manifests: [] }` | בלי מניפסט חותמות מ-jsDelivr — אפס בקשות לצד שלישי |
| `pan.defaultMode: "never"` | ברירת המחדל במגע היא pan, ואז אי אפשר לבחור טקסט כלל ([embedpdf#706](https://github.com/embedpdf/embed-pdf-viewer/issues/706)) |
| `applyIosPixelRatioCap()` (1.5) | iOS Safari נגמר לו הזיכרון ברינדור סריקות גדולות ב-3x ומרענן את הלשונית ([embedpdf#692](https://github.com/embedpdf/embed-pdf-viewer/issues/692)) |
| `disabledCategories: ["redaction"]` | השחרה מוחקת טקסט מה-PDF לצמיתות — לא כלי לימוד |

---

## 5. מה נעשה ב-20–21.9.2026

שלושה PR-ים. הפירוט המלא ב-[`CHANGELOG.md`](CHANGELOG.md).

| PR | מה | קומיט מיזוג |
| --- | --- | --- |
| [#1](https://github.com/ticnutai/gemaraca-463c22f4/pull/1) | פסקי דין מ-gov.il נפתחים בתוך האתר; התאמה יסודית למובייל; `CLAUDE.md` + `CLOUD_SYNC.md` | `df91e18` |
| [#2](https://github.com/ticnutai/gemaraca-463c22f4/pull/2) | צפיין אחד: מחיקת שלושת האחרים, שדרוג EmbedPDF 2.8.0 → 2.15.1, עברית, WASM מקומי, תיקוני מובייל ו-iOS | `cfb81d6` |
| [#3](https://github.com/ticnutai/gemaraca-463c22f4/pull/3) | תיעוד: `CHANGELOG.md`, המסמך הזה, באנר למדריך שהתיישן | |

**שלושה באגים שנמצאו בדרך ותוקנו:**
1. פסקי gov.il הציגו מסך ריק — הצפיין העדיף `source_url` (דף שאי אפשר להטמיע) על פני
   ה-`full_text` שכבר היה במסד.
2. `TabsContent` — מחלקת `flex` גברה על מאפיין `hidden`, ולשונית לא פעילה השאירה חלל ריק
   של 200px מעל התוכן (גם בדסקטופ). תוקן ב-`src/components/ui/tabs.tsx`.
3. אחרי שדרוג המנוע ה-PDF הפסיק להיטען — כתובת WASM יחסית נשברת ב-worker שנטען מ-blob.

---

## 5א. מה נעשה ב-22.9.2026 — מראי המקומות

הפירוט ב-[`CHANGELOG.md`](CHANGELOG.md). בשורה אחת: **שני החילוצים סכמו אותיות עבריות בלי
לבדוק שהצירוף הוא מספר**, ולכן מילים רגילות שבאו אחרי שם מסכת נשמרו כדפים — כולל המילה
"דף" עצמה, שהיא ד+ף = 84. מכאן מאות מראי מקומות שלא קיימים.

| מה | כמה |
| --- | --- |
| מילים שהומרו לדפים — נמחקו | 755 |
| מספרים שנקטעו (`דף פ״ד` שנקרא כדף פ׳) והוחלפו בקריאה השלמה | 1,102 |
| מראי מקומות חדשים מהחילוץ המתוקן | 6,856 |
| סה"כ מראי מקומות במסד | 26,258 על 4,789 פסקים |

**מה שונה בקוד:** מספר עברי נבדק לפי צורה (מאות יורדות, עשרה אחת, יחידה אחת, ט״ו/ט״ז),
וכל תו עודף פוסל; הדף חייב להתקיים במסכת, גם כשה-AI מחזיר אותו; אסימון הדף שומר גרשיים
פנימיים. החילוץ עבר ל-`supabase/functions/_shared/extractRegex.ts` והוא נבדק ב-30 בדיקות.

**כללי הקריאה של ציטוט מרוכזים ב-[`docs/CITATION_RULES.md`](docs/CITATION_RULES.md)** —
עשרה כללים, כל אחד עם הדוגמה שממנה נולד והראיה שמאחוריו. לקרוא לפני כל שינוי
ב-`extractRegex.ts` או ב-`textAnalyzer.ts`.

**איך יודעים שמראי המקומות נכונים.** `scripts/audit-references.mjs` בודק כל הפניה מול
הפסק שממנו היא באה, בלי שירות חיצוני: הציטוט חייב להימצא בטקסט, והמספר והעמוד שבו
חייבים להתאים לשדות. מומלץ להריץ בקטן ולבדוק ידנית לפני שמפעילים `--fix`:

```sh
node scripts/audit-references.mjs --limit 10 --verbose    # עשרה פסקים, הפניה־הפניה
node scripts/audit-references.mjs --limit 100             # סיכום לפי שכבת חילוץ
node scripts/audit-references.mjs --csv audit.csv         # הכול, עם קובץ ממצאים
node scripts/audit-references.mjs --limit 100 --fix       # מוחק את מה שהטקסט מפריך
```

הביקורת מפרידה בין **הפניה שהטקסט מפריך** (נמחקת) ובין **ציטוט שנוסח אחרת** (נשאר).
מה שנמחק נשמר קודם לקובץ JSON תחת `scripts/data/`.

**כשיש ספק בין שתי קריאות** — `scripts/verify-with-sefaria.mjs` מכריע לפי התוכן:
מושך את נוסח הדף מספריא ובודק כמה מצירופי המילים שבפסק נמצאים בו. זה מה שהכריע
ש-"דף ע״ב" הוא דף 72 ולא דף ע׳ עמוד ב, ושבמחלוקת מול מנוע הזיהוי של ספריא —
**הנוסח גובר**, גם כשספריא אומרת אחרת.

**עימוד הרי״ף.** ציטוט שכתוב בו "בעמוה״ר" או "מדפי הרי״ף" מפנה לעמוד ברי״ף, לא לדף
בבבלי. `scripts/fix-rif-pagination.mjs` ממיר לפי סימוני הדף שספריא מטביעה בתוך הרי״ף.

**`scripts/extract-refs-local.mjs`** מריץ את החילוץ מקומית על 8,541 פסקים בשתי דקות, בלי
Edge Function ובלי עלות. הוא מוסיף מה שחסר, מחליף מספר שנקטע, ואינו נוגע באינדקס האתר.

**מצב הפריסה של `extract-references` בענן (22.9, 00:35):** Lovable פרסה את התיקון
הראשון — מילים כבר אינן נקראות כדפים, "דף" אינו 84, והגרשיים נשמרים. **טרם נפרס**
השינוי האחרון: החסימה של ציטוטי ירושלמי ופרק־ומשנה, שתי צורות הציטוט החדשות והסוגריים.
בדיקה מהירה, `node tmp-probe.mjs` או מהאפליקציה:

| מה שולחים | לפני הפריסה | אחרי |
| --- | --- | --- |
| `בירושלמי (סוכה ג,א)` | סוכה ג׳ ע״א | אין תוצאה |
| `מסנהדרין כ"ט` | אין תוצאה | סנהדרין כ״ט |
| `קידושין (דף ל"א עמ' א')` | אין תוצאה | קידושין ל״א ע״א |

אין בסביבה הזו טוקן Supabase, ולכן הפריסה נעשית דרך Lovable. עד שתתבצע, הסקריפט
המקומי `scripts/extract-refs-local.mjs` מריץ את הקוד המעודכן ישירות מול המסד.

---

## 6. המלצות — מה בדקתי ומה המסקנה

### מנוע ה-PDF: להישאר על EmbedPDF v2

נבדקו החלופות (ספטמבר 2026):

| חלופה | מסקנה |
| --- | --- |
| **EmbedPDF v2** (MIT/Apache-2, מנוע PDFium ב-WASM — אותו מנוע של Chrome) | **הבחירה הנוכחית.** תחזוקה פעילה, שחרור כל שבועיים, הערות שנשמרות *בתוך* ה-PDF, טפסים, חתימות, השחרה אמיתית |
| EmbedPDF **v3** | **לא.** המתחזקים עצמם כותבים "not recommended for production" |
| pdf.js (Mozilla) | עורך בסיסי בלבד: אין קו תחתון, צורות, השחרה. בוגר יותר במובייל אבל פחות יכולות |
| react-pdf-viewer.dev | **הארכיון נסגר במרץ 2026** — מבוי סתום |
| MuPDF WASM | AGPL — מחייב פתיחת הקוד של הפרויקט |
| Nutrient / Syncfusion / Apryse | מסחריים, אלפי דולרים בשנה. לא מוצדק |

**מגבלות ידועות שכדאי לעקוב אחריהן** ([issues](https://github.com/embedpdf/embed-pdf-viewer/issues)):
`#706` בחירת טקסט במובייל, `#692` קריסת iOS, `#818` CSP קפדני שובר את הצפיין.
שתי הראשונות עוקפו ב-`embedPdfConfig.ts`; השלישית לא רלוונטית כרגע (אין CSP קפדני ב-Vercel).

### מה הייתי עושה הלאה, לפי סדר

1. **לוודא על PDF אמיתי שלך.** האימות נעשה עם PDF עברי שנוצר מתבנית הבית (חיפוש "הסדר"
   מצא 11 תוצאות). סריקות ש"ס הן תמונות ללא שכבת טקסט — שם חיפוש **לא** יעבוד בלי OCR.
   כדאי לבדוק מה מצב שכבת הטקסט בסריקות, ולשקול OCR (יש כבר `src/lib/ocrService.ts`).
2. **`setSelection()`** — יכולת חדשה ב-2.15: בחירת טקסט תכנותית. זה הבסיס ל"סמן בפסק את
   המקור שמצוטט מהגמרא" — הקישור בין שני חצאי האפליקציה.
3. ~~**`.env.supabase` עוקב ב-git**~~ — **טופל ב-21.9**: הוצא מהמעקב ונוסף ל-`.gitignore`.
   נשאר פתוח: **הסיסמה של משתמש האדמין עדיין בהיסטוריית הגיט** (הוצאה מהקוד ב-`8aef679`
   לקובץ `.env.migrations.local` שאינו נכנס לגיט). הריפו ציבורי — צריך להחליף סיסמה.
4. **חוב lint** — מאות ממצאים קיימים מראש, רובם `no-explicit-any`. לנקות בהדרגה, קובץ-קובץ.
5. ~~**קבצי זבל בריפו**~~ — **טופל ב-21.9**: `-w` ו-`vite.config.ts.timestamp-*.mjs` נמחקו,
   והתבנית נוספה ל-`.gitignore`.
6. **`EMBEDPDF_SYSTEM_GUIDE.md` מתיישן** — יש בו באנר שמסמן מה כבר לא נכון, אבל בסופו של
   דבר כדאי לכתוב אותו מחדש או למחוק חלקים.
7. **`user_preferences.viewer_mode`** נשארה במסד אך האפליקציה לא קוראת אותה יותר.
8. **הכלל "צפיין אחד" לא הושלם בכל האפליקציה** — `PdfViewerTab` (נקרא מ-`Index.tsx`)
   ו-`RichTextViewer` (ב-`GemaraTextPanel` וב-`ModernExamplesPanel`) עדיין חיים לצד הצפיין
   המאוחד. לפסקי דין יש צפיין אחד; לשאר התכנים עוד לא.
9. **לבקש מ-Lovable פריסה נוספת של `extract-references`** — התיקון הראשון נפרס, האחרון
   (ירושלמי, פרק־ומשנה, שתי צורות ציטוט וסוגריים) עדיין לא. הבדיקה בסעיף 5א מראה מה
   אמור להשתנות.
10. **שכבת ה-AI על החילוץ המתוקן** — 3,752 פסקים עדיין בלי מראה מקום; 1,039 מהם בלי טקסט
   כלל, ובמדגם של 150 רוב השאר פשוט אינם מצטטים גמרא. ה-AI עשוי למצוא ציטוטים בפורמט
   חריג, אבל זה בתשלום, ולכן שווה להריץ על מדגם לפני הכול.
11. **29 מחלוקות בין ספריא ובינינו** ממתינות להכרעה ידנית ב-`RefCorrectionDialog`.
12. **לחבר את מראי המקומות לצפיין** — ל-`talmud_references` יש `context_snippet`, ובגרסה 2.15
   יש `setSelection()`. יחד אפשר לסמן בפסק את הציטוט עצמו כשנכנסים אליו מדף הגמרא.

### מה **לא** הייתי עושה

- לא לפצל שוב את הצפיין ל"רגיל" ו"מתקדם". זו בדיוק הבעיה שנפתרה.
- לא להחליף מנוע PDF בלי סיבה חזקה — ההגדרות ב-`embedPdfConfig.ts` הן ידע שנצבר מבאגים.
- לא לערוך את `scripts/style/build.cjs` ביד. הוא נבנה מ-`scripts/style/entry.ts`.

---

## 7. איך מוודאים שהכול עובד

```sh
npm install
npm test            # 150 בדיקות יחידה
npx tsc -p tsconfig.app.json --noEmit
npm run build
npm run lint        # מאות ממצאים קיימים מראש — משווים לפני/אחרי, לא מצפים לאפס
npm run test:e2e    # Playwright; דורש npx playwright install בפעם הראשונה
```

**בדיקת מראי מקומות:**

```sh
node scripts/extract-refs-local.mjs --dry-run       # מה החילוץ היה מוסיף ומחליף
node scripts/triage-bad-references.mjs --dry-run    # מיון מה שסומן כשגוי
node scripts/sefaria-validate-refs.mjs --limit 120 --dry-run   # אימות מול ספריא
```

**בדיקה ידנית מהירה בדפדפן:** גמרא → סוגיה → לשונית "פסקי דין" → "פתח פסק דין".
אמור להיפתח **חלון מעל הדף** (לא עמוד חדש), עם תוכן הפסק בתבנית הבית; "פתח בעמוד מלא"
עובר לעמוד; "חזור" מחזיר לסוגיה.

הבדיקות בסשן הזה נעשו גם באמצעות רתמת Playwright שמדמה את ה-API של Supabase ומריצה את
ה-build ברוחב טלפון (412px) מסך אחרי מסך, כולל זיהוי אוטומטי של גלילה אופקית. הרתמה לא
נשמרה בריפו — אם היא נחוצה, אפשר לשחזר אותה: `vite preview` + Playwright עם
`page.route('**/rest/v1/**')` שמחזיר נתוני דמה.

---

## 8. נקודות שחזור

| ברנץ' ב-GitHub | מחזיר את `main` למצב שלפני |
| --- | --- |
| `backup/main-before-pr1-2026-09-21` | PR #1 |
| `backup/main-before-pr2-2026-09-21` | PR #2 |

```sh
git checkout main
git reset --hard origin/backup/main-before-pr2-2026-09-21
git push --force origin main
```
