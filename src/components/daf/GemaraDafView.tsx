import { lazy, Suspense, useState } from "react";
import { Loader2, LayoutTemplate, AlignRight } from "lucide-react";

const TzuratHaDafPanel = lazy(() => import("./TzuratHaDafPanel"));
const GemaraTextView = lazy(() => import("./GemaraTextView"));

/**
 * לשונית הגמרא: שתי תצוגות של אותו עמוד.
 *
 *   צורת הדף — העמוד כפי שהוא בדפוס וילנא (ברירת המחדל)
 *   טקסט     — לשון הגמרא כטקסט רציף, מוויקיטקסט
 *
 * עד אוקטובר 2026 היו כאן שמונה תצוגות: ספריא בתוך מסגרת, תמונה ואתר של
 * E-Daf, וסריקות PDF בשלושה מצבים. כולן הוסרו — ספריא ו-E-Daf תלויים באתרים
 * של אחרים (ספריא חסמו אותנו בשגיאה 429 בדיוק כשזו הייתה תצוגת ברירת
 * המחדל), והסריקות כיסו רק חמש מסכתות.
 *
 * הבחירה נשמרת במכשיר. היא לא נשמרת בענן כי עמודת ההעדפה במסד מקבלת רק
 * את שמות התצוגות הישנות.
 */

type Mode = "tzurat" | "text";

const STORAGE_KEY = "gemara-view";

function readMode(): Mode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "text" ? "text" : "tzurat";
  } catch {
    return "tzurat";
  }
}

const MODES: { id: Mode; label: string; Icon: typeof LayoutTemplate }[] = [
  { id: "tzurat", label: "צורת הדף", Icon: LayoutTemplate },
  { id: "text", label: "טקסט", Icon: AlignRight },
];

interface Props {
  masechet: string;
  daf: number;
  amud: "a" | "b";
}

export default function GemaraDafView({ masechet, daf, amud }: Props) {
  const [mode, setModeState] = useState<Mode>(readMode);

  const setMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* אחסון חסום — הבחירה תחזיק עד רענון */ }
  };

  return (
    <div className="space-y-3">
      <div dir="rtl" role="tablist" aria-label="תצוגת הגמרא"
        className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {MODES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              mode === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        }
      >
        {mode === "tzurat"
          ? <TzuratHaDafPanel masechet={masechet} daf={daf} amud={amud} />
          : <GemaraTextView masechet={masechet} daf={daf} amud={amud} />}
      </Suspense>
    </div>
  );
}
