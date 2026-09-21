# מערכת EmbedPDF - צפיין PDF מתקדם
### מדריך מלא - לבן 14 ולמפתחים + פרומפט ליצירה מחדש

> ⚠️ **המדריך הזה מתוארך בחלקו (עודכן לאחרונה לפני 21.9.2026).** מה שהשתנה מאז:
> - **יש צפיין אחד בלבד.** הטבלה "קוראי PDF נוספים במערכת" וחלק ממפת הקבצים
>   (`src/components/book/*`, `src/pages/ProPDFViewer.tsx`, `PDFTest`, `PDFHighlighterHebrew`)
>   מתארות קבצים שכבר נמחקו. פסק דין נפתח רק דרך `useDocumentViewer().open(psak)`.
> - **גרסת `@embedpdf/*` היא 2.15.1**, לא 2.8.0 כפי שכתוב בטבלת הספריות.
> - הגדרות המנוע (WASM מקומי, ממשק בעברית, מובייל) יושבות ב-`src/lib/embedPdfConfig.ts`.
>
> הפירוט העדכני: [`CHANGELOG.md`](CHANGELOG.md). התיאור של `EmbedPdfViewerPage` עצמו
> (מצבי תצוגה, אנוטציות, סימניות, ייצוא) עדיין נכון ברובו.

---

## 🎯 בשביל מי המדריך הזה?

| סמל | למי | מה תמצא |
|------|------|----------|
| 🧒 | כל אחד (בן 14+) | הסבר פשוט מה המערכת עושה ואיך להשתמש |
| 👨‍💻 | מפתחים | קוד, קבצים, ארכיטקטורה, API |
| 📝 | יוצרים | פרומפט מלא ליצירה מחדש של כל הפיצ'ר |

---

# 🧒 חלק א': מה זה EmbedPDF? (הסבר לכולם)

## מה זה בכלל?

דמיין שיש לך קורא PDF — כמו אפליקציה שפותחת מסמכים. עכשיו דמיין שהוא **חי בתוך הדפדפן**, בלי להוריד כלום, ואתה יכול:

- 📖 **לקרוא כל PDF** ישירות באתר
- 🖊️ **לכתוב הערות** על כל עמוד
- 🔖 **לשמור סימניות** כדי לחזור לעמוד חשוב
- 🎨 **להדגיש טקסט** ב-6 צבעים שונים
- 📊 **להשוות שני PDFs** זה מול זה
- 📥 **לייצא הערות** ל-JSON או CSV
- 🔍 **לחפש** בתוך ההערות שלך

---

## 🧒 איך נכנסים?

בתפריט הצדדי של האפליקציה, לוחצים על **"צפיין EmbedPDF"** (עם אייקון של מסמך).

```
תפריט ראשי:
├── 🏠 בית
├── 📅 היום שלי
├── 🔄 הרגלים
├── ✅ לוח משימות
├── ...
└── 📄 צפיין EmbedPDF  ← כאן! 
```

---

## 🧒 המסך הראשי

כשנכנסים, רואים 3 חלקים:

```
┌──────────────────────────────────────────────────────────┐
│  📄 EmbedPDF Viewer    [Single] [Split] [Compare]        │
│                        [Cobalt] [Sand] [Noir]            │
├─────────────┬──────────────────────────┬─────────────────┤
│             │                          │                 │
│  📋 רשימת   │     📖 צופה PDF          │  📝 שולחן       │
│  מסמכים     │     (עם כל הכלים)       │  אנוטציות      │
│             │                          │                 │
│ • מסמך 1   │  [עמוד 1 מתוך 50]        │  עמוד: [__]     │
│ • מסמך 2   │                          │  צבע: 🟡        │
│ • מסמך 3   │                          │  הערה: [____]   │
│             │                          │  [שמור] [סימניה]│
│─────────────│                          │─────────────────│
│ אנוטציות: 5│                          │  🔍 חיפוש       │
│ סימניות: 2 │                          │                 │
│ [JSON][CSV] │                          │  📝 הערה 1...   │
│             │                          │  📝 הערה 2...   │
└─────────────┴──────────────────────────┴─────────────────┘
```

---

## 🧒 כל הפיצ'רים בפשטות

### 1. בחירת PDF
- **מהרשימה:** לוחצים על שם המסמך בצד ימין
- **מקישור:** מדביקים כתובת PDF בשדה "קישור ידני"

### 2. מצבי צפייה

| מצב | מה עושה | מתי שימושי |
|:---:|---------|-----------|
| **Single** | PDF אחד במסך מלא | קריאה רגילה |
| **Split** | שני PDFs זה לצד זה | השוואה מהירה |
| **Compare** | שני PDFs + כלי השוואה | עבודה מדוקדקת |

### 3. תצוגות נושא (Themes)

| נושא | סגנון |
|------|-------|
| **Cobalt** | כחול-כהה עם זהב |
| **Sand** | חם ובהיר |
| **Noir** | כהה ואלגנטי |

### 4. הוספת הערה (אנוטציה)
1. בוחרים מספר עמוד
2. בוחרים צבע
3. כותבים את הטקסט המודגש (אם יש)
4. כותבים הערה
5. לוחצים **"שמור אנוטציה"**

### 5. הוספת סימניה
1. בוחרים מספר עמוד
2. (אופציונלי) כותבים שם לסימניה
3. לוחצים **"סימניה"** 🔖

### 6. חיפוש בהערות
- כותבים טקסט בשדה חיפוש → רואים רק הערות תואמות
- אפשר לחפש לפי תוכן הערה, טקסט מודגש, או מספר עמוד

### 7. ייצוא הערות
- **JSON** — פורמט טכני, טוב לגיבוי
- **CSV** — פותחים באקסל/גוגל שיטס

### 8. מחיקת הערה
- לוחצים על 🗑️ ליד כל הערה

---

## 🧒 6 צבעי הדגשה

| צבע | שם | קוד |
|:---:|------|------|
| 🟡 | צהוב | #FFEB3B |
| 🟢 | ירוק | #81C784 |
| 🔵 | כחול | #64B5F6 |
| 🟠 | כתום | #FF8A65 |
| 🟣 | סגול | #CE93D8 |
| 🩷 | ורוד | #F48FB1 |

---

## 🧒 קוראי PDF נוספים במערכת

חוץ מ-EmbedPDF, יש עוד דרכים לקרוא PDF:

| קורא | איפה | מה מיוחד |
|-------|------|----------|
| **EmbedPDF** | צפיין EmbedPDF | הכי מתקדם, תוכנת pdfium |
| **קורא ספרים** | הספר שלי | הדגשות + ציורים + TOC |
| **Mozilla PDF.js** | בתוך קורא הספרים | zoom + rotation + הדגשות |
| **PDF Highlighter** | נפרד (legacy) | הדגשות מתקדמות בעברית |

---

---

# 👨‍💻 חלק ב': תיעוד טכני למפתחים

---

## ארכיטקטורה כללית

```
┌───────────────────────────────────────────────────┐
│                    App.tsx (Router)                 │
│  /embedpdf-viewer  → EmbedPdfViewerPage (lazy)    │
│  /book             → BookReader                    │
│  /pdf-test         → PDFTestPage                   │
│  /pdf-hebrew       → PDFHighlighterHebrew          │
├───────────────────────────────────────────────────┤
│ Rendering Engines:                                 │
│  ┌─────────────────┐  ┌─────────────────────────┐ │
│  │ @embedpdf/       │  │ pdfjs-dist (Mozilla)    │ │
│  │ react-pdf-viewer │  │ + react-pdf-highlighter │ │
│  │ (pdfium engine)  │  │   -extended             │ │
│  └────────┬────────┘  └──────────┬──────────────┘ │
│           │                      │                 │
│  EmbedPdfViewerPage    MozillaPDFViewer            │
│                        LuxuryPDFReader             │
│                        EnhancedPDFReader           │
│                        PDFHighlighter              │
├───────────────────────────────────────────────────┤
│ Data Layer:                                        │
│  usePDFAnnotations (React Query → Supabase)        │
│  useUserBooks (React Query → Supabase)             │
│  localStorage (form overlays, theme, view mode)    │
└───────────────────────────────────────────────────┘
```

---

## קבצי המערכת — מפת קבצים מלאה

### דפים (Pages)

| קובץ | שורות | תפקיד |
|-------|-------|--------|
| `src/pages/EmbedPdfViewerPage.tsx` | ~600 | **ראשי** — צפיין EmbedPDF עם split/compare, אנוטציות, סימניות, ייצוא |
| `src/pages/ProPDFViewer.tsx` | ~136 | עוטף את MozillaPDFViewer |
| `src/pages/PDFTest.tsx` | ~300 | דף E2E: העלאה → Storage → URL → טעינה |
| `src/pages/PDFHighlighterHebrew.tsx` | ~400 | PDF.js + הדגשות עברית (legacy) |
| `src/pages/PDFHighlighter.tsx` | ריק | placeholder |
| `src/pages/PDFEditorComparison.tsx` | ריק | placeholder |
| `src/pages/PDFDemo.tsx` | ריק | placeholder |

### קומפוננטות (Components)

| קובץ | שורות | תפקיד |
|-------|-------|--------|
| `src/components/book/MozillaPDFViewer.tsx` | ~500 | מנוע Mozilla PDF.js: render, zoom, rotation, highlight rects, text layer |
| `src/components/book/PDFViewer.tsx` | ~150 | wrapper עם ניהול אנוטציות + Google Docs fallback |
| `src/components/book/LuxuryPDFReader.tsx` | ~800 | קורא מלא: side panels, TOC, night mode, typography, form overlay |
| `src/components/book/EnhancedPDFReader.tsx` | ~250 | קורא עם typography control, annotation grouping, fullscreen |
| `src/components/book/PDFHighlighter.tsx` | ~500 | react-pdf-highlighter-extended: 6 צבעים, context menu, tips |
| `src/components/book/PDFFormOverlay.tsx` | ~250 | שכבת טפסים: text, textarea, checkbox, drawing, eraser |
| `src/components/book/PDFTableOfContents.tsx` | ~150 | חילוץ TOC מ-pdf-lib + fallback + bookmarks |
| `src/components/book/PDFSearchBar.tsx` | ~150 | חיפוש full-text, debounce 500ms, ניווט תוצאות |
| `src/components/book/PDFUploader.tsx` | ~150 | drag-drop upload, progress, file validation |

### Hooks

| קובץ | תפקיד |
|-------|--------|
| `src/hooks/usePDFAnnotations.tsx` | CRUD אנוטציות + סימניות + reading progress |
| `src/hooks/useUserBooks.tsx` | ניהול ספרי המשתמש מ-Supabase |

---

## EmbedPdfViewerPage — פירוט מלא

### State

```typescript
// בחירת PDF
const [selectedPdfId, setSelectedPdfId] = useState<string | null>(null);
const [comparePdfId, setComparePdfId] = useState<string | null>(null);
const [manualUrl, setManualUrl] = useState("");        // URL ידני (עדיפות)
const [compareManualUrl, setCompareManualUrl] = useState("");

// מצב תצוגה
const [viewMode, setViewMode] = useState<"single" | "split" | "compare">("single");
const [themeKey, setThemeKey] = useState<"cobalt" | "sand" | "noir">("cobalt");

// אנוטציות
const [currentPage, setCurrentPage] = useState("1");
const [highlightText, setHighlightText] = useState("");
const [noteText, setNoteText] = useState("");
const [annotationColor, setAnnotationColor] = useState("#FFD54F");
const [annotationSearch, setAnnotationSearch] = useState("");
```

### Persistence

```typescript
// נשמר ב-localStorage
THEME_STORAGE_KEY     = "embedpdf-theme-v1"
VIEW_MODE_STORAGE_KEY = "embedpdf-view-mode-v1"
```

### לוגיקה — מקור PDF

```typescript
// URL ידני מקבל עדיפות על מסמך מהרשימה
const leftSourceUrl = manualUrl.trim() || selectedPdf?.file_url || "";
const rightSourceUrl = compareManualUrl.trim() || comparePdf?.file_url || "";

// אפשר לשמור אנוטציות רק אם נבחר מהרשימה (לא URL ידני)
const canPersist = Boolean(selectedPdf?.id && !manualUrl.trim());
```

### לוגיקה — בטיחות עמוד

```typescript
function safePage(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}
```

### ייצוא

```typescript
// JSON
const payload = JSON.stringify(filteredAnnotations, null, 2);
downloadBlob(payload, `embedpdf-annotations-${Date.now()}.json`, "application/json");

// CSV  
const header = ["id","page_number","note_text","highlight_text","color","created_at"];
// escaped with double-quote wrapping
```

---

## Theme System

### EmbedPDF Viewer Theme Config

```typescript
const embedViewerTheme = {
  preference: "light",
  light: {
    background: {
      app: "#ffffff",
      surface: "#ffffff",
      surfaceAlt: "#ffffff",
      elevated: "#ffffff",
      overlay: "rgba(11, 31, 91, 0.18)",
      input: "#ffffff",
    },
    foreground: {
      primary: "#0B1F5B",     // כחול כהה
      secondary: "#1D3270",
      muted: "#4A5A86",
      disabled: "#8A95B8",
      onAccent: "#0B1F5B",
    },
    border: {
      default: "#D4AF37",    // זהב
      subtle: "#E6C976",
      strong: "#B9901F",
    },
    accent: {
      primary: "#D4AF37",    // זהב
      primaryHover: "#C6A132",
      primaryActive: "#AF8B21",
      primaryLight: "#FFF4D2",
      primaryForeground: "#0B1F5B",
    },
    interactive: {
      hover: "#FFF9E8",
      active: "#FFF1CC",
      selected: "#FFF1CC",
      focus: "#D4AF37",
      focusRing: "rgba(212, 175, 55, 0.35)",
    },
  },
};
```

### Shell Themes (3 themes currently identical — prepared for customization)

```typescript
const embedThemes: Record<EmbedPdfThemeKey, {
  label: string;
  shellClass: string;    // bg + text class for main container
  panelClass: string;    // bg + border for Card panels
  mutedClass: string;    // bg + border for muted sections
  pillClass: string;     // bg + border for Badge/pill
}>;
```

---

## usePDFAnnotations Hook

### Interfaces

```typescript
interface HighlightRect {
  x: number; y: number; width: number; height: number;
}

interface PDFAnnotation {
  id: string;
  book_id: string;
  page_number: number;
  note_text: string;
  highlight_text: string | null;
  highlight_rects: HighlightRect[] | null;
  position_x: number | null;
  position_y: number | null;
  color: string;
  created_at: string;
  updated_at: string;
}

interface PDFBookmark {
  id: string;
  book_id: string;
  page_number: number;
  title: string;
  created_at: string;
}

interface ReadingProgress {
  book_id: string;
  current_page: number;
  total_pages: number;
  last_read_at: string;
  highlights_count: number;
  notes_count: number;
}
```

### Mutations

| פעולה | תיאור | Supabase |
|-------|--------|----------|
| `addAnnotation` | הוספת אנוטציה + highlight rects | INSERT into pdf_annotations |
| `updateAnnotation` | עדכון note_text + color | UPDATE pdf_annotations SET ... WHERE id |
| `deleteAnnotation` | מחיקת אנוטציה | DELETE FROM pdf_annotations WHERE id |
| `addBookmark` | סימניה (note_text='BOOKMARK', color='#4CAF50') | INSERT into pdf_annotations |
| `deleteBookmark` | מחיקת סימניה | DELETE FROM pdf_annotations WHERE id |
| `updateProgress` | עדכון התקדמות קריאה | upsert reading_progress |

### Queries

```typescript
// כל האנוטציות של ספר מסוים
const { data: annotations } = useQuery({
  queryKey: ['pdf-annotations', bookId],
  queryFn: () => supabase.from('pdf_annotations')
    .select('*')
    .eq('book_id', bookId)
    .order('page_number')
    .order('created_at')
});

// סימניות = אנוטציות עם note_text === 'BOOKMARK'
const bookmarks = annotations.filter(a => a.note_text === 'BOOKMARK');

// אנוטציות לפי עמוד
const getPageAnnotations = (page: number) =>
  annotations.filter(a => a.page_number === page);

// ספירת אנוטציות לפי עמוד
const annotationCountsByPage: Record<number, number>;
```

---

## Database Schema

### טבלת `pdf_annotations`

```sql
CREATE TABLE pdf_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES user_books(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  note_text TEXT NOT NULL,
  highlight_text TEXT,           -- טקסט שסומן
  highlight_rects JSONB,         -- [{x, y, width, height}, ...]
  position_x NUMERIC,            -- מיקום X בעמוד
  position_y NUMERIC,            -- מיקום Y בעמוד
  color TEXT DEFAULT '#FFEB3B',  -- צבע הדגשה
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- אינדקס מהיר לחיפוש לפי ספר + עמוד
CREATE INDEX idx_pdf_annotations_book_page ON pdf_annotations(book_id, page_number);

-- RLS מופעל
ALTER TABLE pdf_annotations ENABLE ROW LEVEL SECURITY;
```

### שימושים מיוחדים

| פריט | איך נשמר |
|------|---------|
| **סימניה** | `note_text = 'BOOKMARK'`, `color = '#4CAF50'` |
| **הדגשה עם מלבנים** | `highlight_rects` = JSON array של {x, y, width, height} |
| **הערה רגילה** | `note_text` = טקסט חופשי |

---

## MozillaPDFViewer — מנוע PDF.js

### Props

```typescript
interface MozillaPDFViewerProps {
  fileUrl: string;
  onHighlightAdd?: (rect: HighlightRect, page: number) => void;
  onHighlightRemove?: (id: string) => void;
  initialHighlights?: PDFAnnotation[];
}
```

### יכולות

| פיצ'ר | פירוט |
|--------|--------|
| **Zoom** | 0.5x – 3.0x, כפתורי +/- |
| **Rotation** | סיבוב ב-90° (0°, 90°, 180°, 270°) |
| **ניווט** | שדה מספר עמוד + חיצים |
| **מצבי תצוגה** | Single page / Continuous scroll |
| **Text Layer** | שכבה שקופה מעל Canvas לבחירת טקסט |
| **Highlight Mode** | מצב הדגשה — בחירת טקסט → הדגשה בצבע |
| **Highlight Color Picker** | בחירת צבע הדגשה (6 צבעים) |
| **הדפסה** | `window.print()` |
| **הורדה** | קישור ישיר לקובץ |
| **RTL** | תמיכה מלאה בעברית |

### CSS Layers

```css
.pdf-page-wrapper    /* מכיל את כל שכבות העמוד */
.pdf-canvas          /* Canvas element — הרנדור עצמו */
.textLayer           /* שכבה שקופה לבחירת טקסט */
.highlight-layer     /* שכבת הדגשות */
.highlight-rect      /* מלבן הדגשה בודד */
```

---

## LuxuryPDFReader — הקורא המלא

### Props

```typescript
interface LuxuryPDFReaderProps {
  bookId: string;
  fileUrl: string;
  fileName: string;
  currentPage: number;
  totalPages?: number;
  onPageChange: (page: number) => void;
  onDelete: () => void;
  onBack: () => void;
}
```

### פאנלים צידיים (Tabs)

| טאב | תוכן |
|-----|-------|
| 📑 **תוכן עניינים** | TOC מ-pdf-lib + bookmarks |
| 📊 **התקדמות** | reading progress tracker |
| 📝 **אנוטציות** | כל ההערות מקובצות לפי עמוד |
| ⚙️ **הגדרות** | פונט, גודל, ריווח |

### Typography Settings

```typescript
fontFamily: "David" | "Frank Ruhl" | "Heebo" | "Rubik" | "Assistant"
fontSize: number  // px
lineSpacing: number
```

### מצבי תצוגה

```
Grid | List | Compact | Mini
```

### Form Overlay (PDFFormOverlay)

| כלי | תיאור |
|-----|--------|
| **Text** | הוספת שדה טקסט |
| **Textarea** | שדה טקסט גדול |
| **Checkbox** | תיבת סימון |
| **Draw** | ציור חופשי (color + width) |
| **Eraser** | מחיקת ציורים |

הפורמים נשמרים ב-localStorage: `pdf-form-overlay-{bookId}-page-{pageNumber}`

---

## ספריות חיצוניות

### מנועי PDF

| ספרייה | גרסה | תפקיד |
|--------|-------|--------|
| `@embedpdf/react-pdf-viewer` | ^2.8.0 | צפיין PDF Premium (מנוע pdfium) |
| `@embedpdf/core` | 2.8.0 | ליבת EmbedPDF |
| `@embedpdf/engines` | 2.8.0 | מנועי רנדור |
| `@embedpdf/pdfium` | 2.8.0 | מנוע pdfium (Chrome-level) |
| `@embedpdf/fonts-hebrew` | | פונטים עבריים |
| `@embedpdf/fonts-arabic` | | פונטים ערביים |
| `@embedpdf/fonts-latin` | | פונטים לטיניים |
| `@embedpdf/fonts-{jp,kr,sc,tc}` | | פונטים אסיאתיים |
| `@embedpdf/plugin-annotation` | 2.8.0 | פלאגין אנוטציות |
| `@embedpdf/plugin-attachment` | 2.8.0 | פלאגין קבצים מצורפים |
| `@embedpdf/plugin-bookmark` | 2.8.0 | פלאגין סימניות |
| `pdfjs-dist` | ^4.10.38 | Mozilla PDF.js |
| `react-pdf-highlighter-extended` | ^8.1.0 | הדגשות מתקדמות |
| `pdf-lib` | ^1.17.1 | מניפולציה + TOC extraction |

### UI

| ספרייה | תפקיד |
|--------|--------|
| `@radix-ui/*` | dialog, dropdown, popover, scroll-area, select... |
| `lucide-react` | אייקונים |
| `react-resizable-panels` | panels שניתנים לשינוי גודל |
| `sonner` | toast notifications |
| `html2canvas` | צילום מסך |
| `dompurify` | סניטציית HTML |

### State Management

| ספרייה | תפקיד |
|--------|--------|
| `@tanstack/react-query` | server state (annotations, books) |
| `zustand` | client state |
| `@supabase/supabase-js` | backend |

---

## Responsive Layout

### Desktop (xl+)

```
┌──────────────┬──────────────────────────┬──────────────┐
│  Sidebar     │      PDF Viewer          │  Annotation  │
│  col-span-3  │   col-span-9             │    Desk      │
│  (PDF list,  │   (single/split/compare) │  col-span-3  │
│   export)    │                          │  (inside 9)  │
└──────────────┴──────────────────────────┴──────────────┘
```

### Mobile

```
┌─────────────────────────┐
│   Header (modes/themes) │
├─────────────────────────┤
│   Sidebar (collapsible) │
├─────────────────────────┤
│   PDF Viewer (full)     │
├─────────────────────────┤
│   Annotation Desk       │
└─────────────────────────┘
```

---

## E2E Testing

### PDFTest Page (`/pdf-test`)

```
1. Fetch    →  GET /e2e-sample.pdf from public folder
2. Upload   →  supabase.storage.from('books').upload(...)
3. Get URL  →  supabase.storage.from('books').getPublicUrl(...)
4. Load     →  Render in PDFViewer component
5. Track    →  Performance timing for each step
```

### Playwright Config

```typescript
// e2e/pdf-editor.spec.ts
// automated testing via playwright.config.ts
```

---

## Data Flow — תרשים זרימה

```
משתמש בוחר PDF מהרשימה
        │
        ▼
  selectedPdfId = doc.id
  leftSourceUrl = doc.file_url
        │
        ▼
  <PDFViewer config={{ src: url, theme }} />
  (EmbedPDF pdfium engine renders)
        │
        ▼
  usePDFAnnotations(selectedPdf.id)
  useQuery → Supabase → pdf_annotations
        │
        ▼
  Annotation Desk מציג
  את כל ההערות + סימניות
        │
        ▼
  ┌─────┴──────┐
  │ משתמש כותב │
  │ הערה חדשה  │
  └─────┬──────┘
        │
        ▼
  addAnnotation.mutateAsync({
    bookId, pageNumber, noteText,
    highlightText, color
  })
        │
        ▼
  Supabase INSERT pdf_annotations
        │
        ▼
  invalidateQueries('pdf-annotations')
        │
        ▼
  UI מתעדכן + toast "האנוטציה נשמרה"
```

---

## סיכום מהיר

| רכיב | מה עושה | קובץ |
|------|---------|------|
| **EmbedPdfViewerPage** | דף ראשי — צפייה, split, compare, אנוטציות | `src/pages/EmbedPdfViewerPage.tsx` |
| **MozillaPDFViewer** | מנוע PDF.js — zoom, rotate, highlight | `src/components/book/MozillaPDFViewer.tsx` |
| **LuxuryPDFReader** | קורא מלא — TOC, night mode, typography | `src/components/book/LuxuryPDFReader.tsx` |
| **PDFHighlighter** | הדגשות מתקדמות 6 צבעים | `src/components/book/PDFHighlighter.tsx` |
| **PDFFormOverlay** | שכבת ציור + טפסים | `src/components/book/PDFFormOverlay.tsx` |
| **PDFSearchBar** | חיפוש full-text | `src/components/book/PDFSearchBar.tsx` |
| **PDFTableOfContents** | TOC מ-pdf-lib | `src/components/book/PDFTableOfContents.tsx` |
| **usePDFAnnotations** | CRUD אנוטציות | `src/hooks/usePDFAnnotations.tsx` |
| **useUserBooks** | ניהול ספרים | `src/hooks/useUserBooks.tsx` |
| **pdf_annotations** | טבלת DB | `supabase/migrations/...` |

---

---

# 📝 חלק ג': פרומפט מלא ליצירה מחדש

אם רוצים ליצור את כל מערכת ה-EmbedPDF מאפס בפרויקט React חדש, הנה הפרומפט המפורט:

---

## PROMPT: יצירת מערכת EmbedPDF Viewer מלאה

```
צור לי מערכת צפיין PDF מתקדמת באפליקציית React + TypeScript + Vite עם הפיצ'רים הבאים:

=== טכנולוגיות נדרשות ===
- React 18 + TypeScript + Vite
- @embedpdf/react-pdf-viewer@^2.8.0 (מנוע PDF pdfium — Premium)
  כולל: @embedpdf/core, @embedpdf/engines, @embedpdf/pdfium
  כולל פונטים: @embedpdf/fonts-hebrew, @embedpdf/fonts-arabic, @embedpdf/fonts-latin
  כולל פלאגינים: @embedpdf/plugin-annotation, @embedpdf/plugin-attachment, @embedpdf/plugin-bookmark
- pdfjs-dist@^4.10.38 (Mozilla PDF.js — קורא משני)
- react-pdf-highlighter-extended@^8.1.0 (הדגשות מתקדמות)
- pdf-lib@^1.17.1 (מניפולציה + חילוץ TOC)
- Supabase (@supabase/supabase-js@^2.78.0) — backend + storage
- @tanstack/react-query@^5.83.0 — server state management
- shadcn/ui (Radix + Tailwind) — UI components
- lucide-react — אייקונים
- sonner — toast notifications
- react-resizable-panels — panels מתכווננים
- Tailwind CSS 4 — עיצוב
- כיוון RTL (עברית)

=== דף ראשי: EmbedPdfViewerPage ===
1. **Layout 3 חלקים:**
   - Sidebar שמאלי (col-span-3): רשימת PDFs מ-Supabase, שדה URL ידני, סטטיסטיקת אנוטציות, כפתורי ייצוא JSON/CSV
   - Viewer מרכזי (col-span-9): תצוגת EmbedPDF עם theme customization
   - Annotation Desk (col-span-3 בתוך ה-9): שדות יצירת אנוטציה + רשימת הערות קיימות

2. **3 מצבי תצוגה:**
   - Single — PDF יחיד ברוחב מלא
   - Split — שני PDFs זה לצד זה
   - Compare — השוואה עם שני מקורות

3. **3 ערכות נושא (themes):**
   - Cobalt, Sand, Noir — מבוססות על פלטת צבעים: כחול כהה (#0B1F5B) + זהב (#D4AF37)
   - Theme נשמר ב-localStorage

4. **EmbedPDF Viewer Theme Config:**
   - light mode עם background, foreground, border, accent, interactive sections
   - צבע ראשי: #D4AF37 (זהב)
   - טקסט: #0B1F5B (כחול כהה)
   - borders זהובים

5. **שולחן אנוטציות (Annotation Desk):**
   - שדה מספר עמוד (עם safePage validation)
   - בוחר צבע (color input)
   - שדה טקסט מודגש (אופציונלי)
   - שדה הערה (textarea)
   - כפתור "שמור אנוטציה"
   - כפתור "סימניה" (bookmark)
   - חיפוש בהערות (לפי תוכן, טקסט מודגש, מספר עמוד)
   - רשימת אנוטציות עם מחיקה

6. **ייצוא:**
   - JSON (pretty-printed)
   - CSV (עם escape ל-double quotes)
   - שם קובץ: embedpdf-annotations-{timestamp}.{ext}

=== Hook: usePDFAnnotations ===
- React Query עם Supabase
- CRUD: addAnnotation, updateAnnotation, deleteAnnotation
- Bookmarks: addBookmark, deleteBookmark (סימניה = אנוטציה עם note_text='BOOKMARK')
- Reading Progress: updateProgress
- Queries: annotations, bookmarks, getPageAnnotations, annotationCountsByPage

=== Database Schema (Supabase) ===
טבלת pdf_annotations:
- id UUID PRIMARY KEY DEFAULT gen_random_uuid()
- book_id UUID NOT NULL REFERENCES user_books(id) ON DELETE CASCADE
- page_number INTEGER NOT NULL
- note_text TEXT NOT NULL
- highlight_text TEXT (nullable)
- highlight_rects JSONB (nullable, array of {x, y, width, height})
- position_x NUMERIC (nullable)
- position_y NUMERIC (nullable)
- color TEXT DEFAULT '#FFEB3B'
- created_at TIMESTAMP DEFAULT now()
- updated_at TIMESTAMP DEFAULT now()
- INDEX על (book_id, page_number)
- RLS enabled

=== קורא PDF משני: MozillaPDFViewer ===
- pdfjs-dist rendering to Canvas
- Text selection layer (transparent)
- Highlight rectangles layer
- Zoom 0.5x-3.0x
- Rotation (0°, 90°, 180°, 270°)
- Single page / Continuous scroll modes
- Highlight mode + 6 color picker
- Print + Download
- RTL Hebrew support

=== קורא מלא: LuxuryPDFReader ===
- Side panels (tabs): TOC, Progress, Annotations, Settings
- Night mode toggle
- View modes: Grid / List / Compact / Mini
- Typography: font family (David, Frank Ruhl, Heebo, Rubik, Assistant), font size, line spacing
- Form overlay mode (PDFFormOverlay): text, textarea, checkbox, draw, erase
- Full screen support
- Panel pin/unpin with width options

=== הדגשות: PDFHighlighter ===
- react-pdf-highlighter-extended
- 6 צבעים: צהוב #FFEB3B, ירוק #81C784, כחול #64B5F6, כתום #FF8A65, סגול #CE93D8, ורוד #F48FB1
- Selection tip popup
- Context menu per highlight
- Highlight container with color indicator

=== חיפוש: PDFSearchBar ===
- Full-text search across all pages
- Debounce 500ms
- Result navigation (prev/next)
- Context preview for each match

=== TOC: PDFTableOfContents ===
- Extract from pdf-lib metadata
- Fallback to page-based TOC
- Bookmark management
- Expandable hierarchy

=== Form Overlay: PDFFormOverlay ===
- Tools: Text field, Textarea, Checkbox, Draw (freehand), Eraser
- Drawing: configurable color + width
- Persistence: localStorage per book per page
- Key format: pdf-form-overlay-{bookId}-page-{pageNumber}

=== Responsive Design ===
- Mobile-first, RTL (dir="rtl")
- Mobile: stacked layout (sidebar → viewer → desk)
- Desktop (xl+): grid 3-col + 9-col
- Desktop (2xl): 3-panel desktop layout
- min-height guards for viewer

=== Error Handling ===
- Toast notifications (sonner) בעברית:
  "האנוטציה נשמרה" (success)
  "שמירת אנוטציה נכשלה" (error)
  "שמירה למסד נתונים זמינה רק למסמך שנבחר" (info)
- Try/catch on PDF loading
- safePage validation (defaults to 1)
- File type validation: PDF, DOCX, TXT, HTML only

=== E2E Testing ===
- דף PDFTest ב-route /pdf-test
- שלבים: fetch sample → upload to storage → get URL → render → track timing
- Playwright config for automation

=== ניווט ===
- Route: /embedpdf-viewer (lazy loaded)
- Sidebar menu item: "צפיין EmbedPDF" עם אייקון מסמך
- Route נוסף: /book (BookReader), /pdf-test, /pdf-hebrew
```

---

### הרחבות נדרשות ב-VS Code (לפיתוח)

| הרחבה | תפקיד |
|-------|--------|
| **ESLint** | בדיקת קוד |
| **Tailwind CSS IntelliSense** | autocomplete לסגנונות |
| **Prettier** | formatting |
| **vscode-styled-components** | CSS-in-JS |
| **Playwright Test** | E2E testing |
| **Supabase** | DB management |

### פקודות התקנה

```bash
# מנוע PDF ראשי (EmbedPDF Premium)
npm i @embedpdf/react-pdf-viewer@^2.8.0

# Mozilla PDF.js
npm i pdfjs-dist@^4.10.38

# הדגשות מתקדמות
npm i react-pdf-highlighter-extended@^8.1.0

# מניפולציית PDF
npm i pdf-lib@^1.17.1

# Supabase
npm i @supabase/supabase-js@^2.78.0

# State management
npm i @tanstack/react-query@^5.83.0 zustand@^5.0.9

# UI
npm i @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-popover
npm i @radix-ui/react-scroll-area @radix-ui/react-select @radix-ui/react-accordion
npm i lucide-react sonner react-resizable-panels

# Utils
npm i html2canvas dompurify date-fns
```

### מידע נוסף שנדרש ליצירה

| פריט | ערך |
|------|-----|
| **Supabase URL** | https://{PROJECT_ID}.supabase.co |
| **Supabase Anon Key** | (מהדאשבורד) |
| **Storage Bucket** | `books` (public) |
| **טבלת ספרים** | `user_books` (id, title, file_name, file_url, user_id) |
| **טבלת אנוטציות** | `pdf_annotations` (ראה schema למעלה) |
| **Admin Email** | לצורך RLS |
| **PWA Config** | vite-plugin-pwa (אם נדרש offline support) |
