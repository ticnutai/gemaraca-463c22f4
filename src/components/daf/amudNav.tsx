import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toHebrewNumeral } from "@/lib/hebrewNumbers";

/**
 * דפדוף בין עמודים — משותף לצורת הדף ולתצוגת הטקסט.
 *
 * החיצים מבוססים על העמודים שקיימים בפועל בקובץ המסכת, ולא על חשבון
 * מספר הדפים, כדי שלא יובילו לעמוד ריק (מסכת שמסתיימת בעמוד א׳, למשל).
 */

/** סדר העמודים במסכת: ב. ב: ג. ג: … */
export const amudOrder = (key: string) => {
  const m = key.match(/^(\d+)([ab])$/);
  return m ? Number(m[1]) * 2 + (m[2] === "b" ? 1 : 0) : Number.NaN;
};

export const amudLabel = (key: string) => {
  const m = key.match(/^(\d+)([ab])$/);
  return m ? `${toHebrewNumeral(Number(m[1]))} ${m[2] === "a" ? "ע״א" : "ע״ב"}` : key;
};

/** מפתחות העמודים שיש בהם טקסט, ממוינים לפי סדר הדפים */
export const sortedAmudKeys = (amudim: Record<string, unknown> | undefined) =>
  Object.keys(amudim ?? {})
    .filter((k) => !Number.isNaN(amudOrder(k)))
    .sort((a, b) => amudOrder(a) - amudOrder(b));

/**
 * העמוד הקודם והבא, ומקשי החצים במקלדת. כמו בספר עברי, הבא משמאל.
 * המקלדת לא מדפדפת כשמקלידים בשדה.
 */
export function useAmudNavigation(slug: string | null, keys: string[], current: string) {
  const navigate = useNavigate();

  const { prev, next } = useMemo(() => {
    const i = keys.indexOf(current);
    if (i < 0) return { prev: null as string | null, next: null as string | null };
    return { prev: keys[i - 1] ?? null, next: keys[i + 1] ?? null };
  }, [keys, current]);

  const goTo = useMemo(
    () => (key: string) => {
      if (slug) navigate(`/sugya/${slug.toLowerCase()}_${key}`);
    },
    [slug, navigate],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const target = e.key === "ArrowLeft" ? next : e.key === "ArrowRight" ? prev : null;
      if (!target) return;
      e.preventDefault();
      goTo(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, goTo]);

  return { prev, next, goTo };
}

/** חץ דפדוף בצד הדף. "דביק" לגובה המסך כדי שיהיה בהישג יד גם בעמוד ארוך. */
function SideArrow({ side, target, onGo }: { side: "next" | "prev"; target: string | null; onGo: (k: string) => void }) {
  const Icon = side === "next" ? ChevronLeft : ChevronRight;
  const label = side === "next" ? "לעמוד הבא" : "לעמוד הקודם";
  return (
    <div className="hidden md:flex shrink-0 w-12 justify-center">
      <button
        type="button"
        onClick={() => target && onGo(target)}
        disabled={!target}
        aria-label={target ? `${label}: ${amudLabel(target)}` : label}
        title={target ? `${label} — ${amudLabel(target)}` : "אין עמוד"}
        className="sticky top-1/2 -translate-y-1/2 h-24 w-10 rounded-full flex items-center justify-center
                   text-muted-foreground hover:text-foreground hover:bg-accent/15
                   disabled:opacity-20 disabled:cursor-default disabled:hover:bg-transparent transition-colors"
      >
        <Icon className="w-7 h-7" />
      </button>
    </div>
  );
}

/** עוטף תוכן עמוד בחיצים: בצדדים במחשב, מתחת לתוכן בטלפון. */
export function AmudPager({
  prev,
  next,
  onGo,
  children,
}: {
  prev: string | null;
  next: string | null;
  onGo: (k: string) => void;
  children: React.ReactNode;
}) {
  return (
    // dir="rtl": בקוד מופיע קודם הימני — העמוד הקודם, ובסוף השמאלי — הבא
    <div dir="rtl" className="flex items-stretch gap-1">
      <SideArrow side="prev" target={prev} onGo={onGo} />
      <div className="min-w-0 flex-1">
        {children}
        <div className="flex md:hidden items-center justify-between gap-2 pt-3">
          <button type="button" disabled={!prev} onClick={() => prev && onGo(prev)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border text-sm disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />{prev ? amudLabel(prev) : "—"}
          </button>
          <button type="button" disabled={!next} onClick={() => next && onGo(next)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border text-sm disabled:opacity-30">
            {next ? amudLabel(next) : "—"}<ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
      <SideArrow side="next" target={next} onGo={onGo} />
    </div>
  );
}
