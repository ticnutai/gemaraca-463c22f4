import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { MASECHTOT } from "@/lib/masechtotData";
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

export default function TzuratHaDafPanel({ masechet, daf, amud, initialQuery }: Props) {
  const [data, setData] = useState<AmudData | null>(null);
  const [layout, setLayout] = useState<PrintLayout | undefined>();
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  const slug = useMemo(
    () => MASECHTOT.find((m) => m.hebrewName === masechet)?.sefariaName ?? null,
    [masechet],
  );

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
  );
}
