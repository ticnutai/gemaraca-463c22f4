import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { MASECHTOT } from "@/lib/masechtotData";
import { toHebrewNumeral } from "@/lib/hebrewNumbers";
import { fetchGzJson } from "@/lib/gzJson";
import type { PrintLayout } from "./PrintDaf";

const DafPage = lazy(() => import("./DafPage"));

/**
 * צורת הדף — העמוד כפי שהוא נראה בדפוס וילנא: הגמרא במרכז, רש"י פנימה,
 * תוספות בחוץ.
 *
 * הטקסט מגיע ממאגר מקומי (public/shas) ולא מן הרשת, ולכן העמוד נפתח מיד
 * וגם בלי חיבור. למדפוס של שש מסכתות קיימת גם גיאומטריית שורות מדויקת
 * (public/tzurat/print) — כשהיא קיימת הפריסה זהה לדפוס, וכשאין היא
 * מחושבת חיה. בשני המצבים זו צורת הדף, לא תמונה סרוקה, ולכן אפשר לחפש
 * ולהעתיק מן הטקסט.
 *
 * ייחוס ורישיון: public/tzurat/ATTRIBUTION.md
 */

interface AmudData {
  gemara: string[];
  commentaries: { key: string; segments: string[] }[];
}

interface Props {
  /** שם המסכת בעברית, כפי שהוא בטבלת המסכתות */
  masechet: string;
  /** מספר הדף */
  daf: number;
  /** א או ב */
  amud: "a" | "b";
  /** חיפוש התחלתי, כשנכנסים מתוך תוצאה */
  initialQuery?: string;
}

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">{children}</div>
);

/** סדר העמודים במסכת: ב. ב: ג. ג: … */
const amudOrder = (key: string) => {
  const m = key.match(/^(\d+)([ab])$/);
  return m ? Number(m[1]) * 2 + (m[2] === "b" ? 1 : 0) : Number.NaN;
};

const amudLabel = (key: string) => {
  const m = key.match(/^(\d+)([ab])$/);
  return m ? `${toHebrewNumeral(Number(m[1]))} ${m[2] === "a" ? "ע״א" : "ע״ב"}` : key;
};

/**
 * חץ דפדוף בצד הדף. כמו בספר עברי, העמוד הבא נמצא משמאל.
 * החצים "דביקים" לגובה המסך כדי שיהיו בהישג יד גם בעמוד ארוך.
 */
function PageArrow({ side, target, onGo }: { side: "next" | "prev"; target: string | null; onGo: (k: string) => void }) {
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

export default function TzuratHaDafPanel({ masechet, daf, amud, initialQuery }: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<AmudData | null>(null);
  const [layout, setLayout] = useState<PrintLayout | undefined>();
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  /** העמודים שקיימים בקובץ המסכת, לפי הסדר — כדי שהחיצים לא יובילו לעמוד ריק */
  const [amudKeys, setAmudKeys] = useState<string[]>([]);

  const slug = useMemo(
    () => MASECHTOT.find((m) => m.hebrewName === masechet)?.sefariaName ?? null,
    [masechet],
  );

  const current = `${daf}${amud}`;
  const { prev, next } = useMemo(() => {
    const i = amudKeys.indexOf(current);
    if (i < 0) return { prev: null, next: null };
    return { prev: amudKeys[i - 1] ?? null, next: amudKeys[i + 1] ?? null };
  }, [amudKeys, current]);

  const goTo = (key: string) => {
    if (!slug) return;
    navigate(`/sugya/${slug.toLowerCase()}_${key}`);
  };

  // מקשי החצים במקלדת. שמאל = הבא, כמו בספר עברי. לא מפריעים כשמקלידים בשדה.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const target = e.key === "ArrowLeft" ? next : e.key === "ArrowRight" ? prev : null;
      if (!target || !slug) return;
      e.preventDefault();
      navigate(`/sugya/${slug.toLowerCase()}_${target}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, slug, navigate]);

  useEffect(() => {
    let alive = true;
    if (!slug) { setState("missing"); return; }
    setState("loading");
    setData(null);
    setLayout(undefined);

    (async () => {
      const base = import.meta.env.BASE_URL;
      try {
        const { amudim } = await fetchGzJson<{ amudim: Record<string, AmudData> }>(`${base}shas/${slug}.json.gz`);
        const page = amudim?.[`${daf}${amud}`];
        if (!alive) return;
        setAmudKeys(
          Object.keys(amudim ?? {})
            .filter((k) => amudim[k]?.gemara?.length && !Number.isNaN(amudOrder(k)))
            .sort((a, b) => amudOrder(a) - amudOrder(b)),
        );
        if (!page?.gemara?.length) { setState("missing"); return; }
        setData(page);
        setState("ready");
      } catch {
        if (alive) setState("error");
        return;
      }
      // גיאומטריית הדפוס קיימת לחלק מן המסכתות בלבד; היעדרה אינו שגיאה
      try {
        const print = await fetchGzJson<Record<string, PrintLayout>>(`${base}tzurat/print/${slug.toLowerCase()}.json.gz`);
        if (alive) setLayout(print?.[`${daf}${amud}`]);
      } catch { /* נרנדר בפריסה חיה */ }
    })();

    return () => { alive = false; };
  }, [slug, daf, amud]);

  const rashi = useMemo(() => data?.commentaries.find((c) => c.key === "rashi")?.segments ?? [], [data]);
  const tosafot = useMemo(() => data?.commentaries.find((c) => c.key === "tosafot")?.segments ?? [], [data]);

  if (state === "loading") {
    return <Centered><Loader2 className="w-5 h-5 animate-spin" />טוען את צורת הדף…</Centered>;
  }
  if (state === "missing") {
    return (
      <Centered>
        <AlertCircle className="w-5 h-5 text-accent" />
        <span>צורת הדף אינה זמינה ל{masechet} דף {daf}{amud === "a" ? " ע״א" : " ע״ב"}.</span>
      </Centered>
    );
  }
  if (state === "error" || !data) {
    return (
      <Centered>
        <AlertCircle className="w-5 h-5 text-destructive" />
        <span>טעינת צורת הדף נכשלה.</span>
      </Centered>
    );
  }

  return (
    // הסדר בקוד הוא מימין לשמאל (dir="rtl"): קודם ← הדף → הבא
    <div dir="rtl" className="flex items-stretch gap-1">
      <PageArrow side="prev" target={prev} onGo={goTo} />
      <div className="min-w-0 flex-1">
        <Suspense fallback={<Centered><Loader2 className="w-5 h-5 animate-spin" />מסדר את העמוד…</Centered>}>
          <DafPage
            gemara={data.gemara}
            rashi={rashi}
            tosafot={tosafot}
            amud={amud}
            title={`${masechet} ${daf}${amud === "a" ? " ע״א" : " ע״ב"}`}
            printLayout={layout}
            initialQuery={initialQuery}
          />
        </Suspense>
        {/* בטלפון אין מקום לחצים בצדדים — הם עוברים מתחת לדף */}
        <div className="flex md:hidden items-center justify-between gap-2 pt-3" dir="rtl">
          <button type="button" disabled={!prev} onClick={() => prev && goTo(prev)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border text-sm disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />{prev ? amudLabel(prev) : "—"}
          </button>
          <button type="button" disabled={!next} onClick={() => next && goTo(next)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border text-sm disabled:opacity-30">
            {next ? amudLabel(next) : "—"}<ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
      <PageArrow side="next" target={next} onGo={goTo} />
    </div>
  );
}
