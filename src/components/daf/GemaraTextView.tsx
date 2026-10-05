import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { Loader2, AlertCircle } from "lucide-react";
import { MASECHTOT } from "@/lib/masechtotData";
import { fetchGzJson } from "@/lib/gzJson";
import { FONT_FAMILY } from "./dafStyle";
import { AmudPager, sortedAmudKeys, useAmudNavigation } from "./amudNav";

/**
 * לשון הגמרא כטקסט רציף — נאמן ככל האפשר לדפוס.
 *
 * המקורות לפי סדר עדיפות:
 *   1. ויקיטקסט, עמודי הדף (public/shas-wsraw) — הטקסט כפי שהוא מודפס,
 *      כולל הקיצורים ("ג' טפחים", "ר' אליעזר").
 *   2. ויקיטקסט (public/shas-ws) — אותו טקסט, מחולק לפסקאות והקיצורים פתוחים.
 *   3. ספריא (public/shas) — רק כשאין ויקיטקסט למסכת. ספריא מוסיפה ניקוד
 *      וסימני פיסוק משלה ("מֵאֵימָתַי קוֹרִין… בָּעֲרָבִין?"), לכן הניקוד
 *      מוסר והמקור מסומן בבירור כזמני.
 *
 * קובצי ויקיטקסט מגיעים מהפרויקט lemaan-v2 (scripts/daf-pipeline/fetch_ws*.py).
 * המסכתות שיש להן קובץ רשומות ב-index.json שבכל תיקייה.
 */

type Source = "wsraw" | "ws" | "sefaria";

const SOURCE_LABEL: Record<Source, string> = {
  wsraw: "ויקיטקסט — עמודי הדף, כפי שמודפס",
  ws: "ויקיטקסט",
  sefaria: "ספריא, בלי ניקוד — מקור זמני עד שיתווסף ויקיטקסט למסכת",
};

/** תגיות שמותר להשאיר: הדגשת מילת הפתיחה ודיבורים. כל השאר מוסר. */
const ALLOWED_TAGS = ["big", "strong", "b", "i", "em", "small", "br", "sup", "sub"];

/** טעמים וניקוד (U+0591–U+05C7) — חוץ מהמקף העליון, שהופך לרווח */
const stripNikud = (s: string) => s.replace(/־/g, " ").replace(/[֑-ֽֿ-ׇ]/g, "");

const clean = (html: string) => DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: [] });

/** אילו מסכתות קיימות בכל תיקייה — נטען פעם אחת */
let manifest: Promise<Record<"wsraw" | "ws", Set<string>>> | null = null;
function loadManifest(base: string) {
  manifest ??= Promise.all(
    (["shas-wsraw", "shas-ws"] as const).map((d) =>
      fetch(`${base}${d}/index.json`)
        .then((r) => (r.ok ? r.json() : []))
        .then((a: string[]) => new Set(a))
        .catch(() => new Set<string>()),
    ),
  ).then(([wsraw, ws]) => ({ wsraw, ws }));
  return manifest;
}

interface Props {
  masechet: string;
  daf: number;
  amud: "a" | "b";
}

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">{children}</div>
);

export default function GemaraTextView({ masechet, daf, amud }: Props) {
  const [segments, setSegments] = useState<string[] | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [amudKeys, setAmudKeys] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  const slug = useMemo(
    () => MASECHTOT.find((m) => m.hebrewName === masechet)?.sefariaName ?? null,
    [masechet],
  );
  const key = `${daf}${amud}`;
  const { prev, next, goTo } = useAmudNavigation(slug, amudKeys, key);

  useEffect(() => {
    let alive = true;
    if (!slug) { setState("missing"); return; }
    setState("loading");

    (async () => {
      const base = import.meta.env.BASE_URL;
      try {
        const have = await loadManifest(base);
        let src: Source = "sefaria";
        let amudim: Record<string, string[]>;

        if (have.wsraw.has(slug) || have.ws.has(slug)) {
          src = have.wsraw.has(slug) ? "wsraw" : "ws";
          const dir = src === "wsraw" ? "shas-wsraw" : "shas-ws";
          ({ amudim } = await fetchGzJson<{ amudim: Record<string, string[]> }>(`${base}${dir}/${slug}.json.gz`));
        } else {
          const s = await fetchGzJson<{ amudim: Record<string, { gemara: string[] }> }>(`${base}shas/${slug}.json.gz`);
          amudim = Object.fromEntries(
            Object.entries(s.amudim ?? {}).map(([k, v]) => [k, (v?.gemara ?? []).map(stripNikud)]),
          );
        }
        if (!alive) return;

        setAmudKeys(sortedAmudKeys(amudim).filter((k) => amudim[k]?.length));
        const page = amudim[key];
        if (!page?.length) { setState("missing"); return; }
        setSegments(page);
        setSource(src);
        setState("ready");
      } catch {
        if (alive) setState("error");
      }
    })();

    return () => { alive = false; };
  }, [slug, key]);

  if (state === "loading") {
    return <Centered><Loader2 className="w-5 h-5 animate-spin" />טוען את לשון הגמרא…</Centered>;
  }
  if (state === "missing") {
    return (
      <Centered>
        <AlertCircle className="w-5 h-5 text-accent" />
        <span>אין טקסט ל{masechet} דף {daf}{amud === "a" ? " ע״א" : " ע״ב"}.</span>
      </Centered>
    );
  }
  if (state === "error" || !segments || !source) {
    return (
      <Centered>
        <AlertCircle className="w-5 h-5 text-destructive" />
        <span>טעינת הטקסט נכשלה.</span>
      </Centered>
    );
  }

  return (
    <AmudPager prev={prev} next={next} onGo={goTo}>
      <article
        dir="rtl"
        className="mx-auto max-w-3xl space-y-4 py-2 text-[1.35rem] leading-[2.1] text-foreground"
        style={{ fontFamily: FONT_FAMILY.Vilna }}
      >
        {segments.map((s, i) => (
          <p key={i} dangerouslySetInnerHTML={{ __html: clean(s) }} />
        ))}
      </article>
      <p
        className={`mx-auto max-w-3xl pt-4 text-xs ${source === "sefaria" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
        dir="rtl"
      >
        מקור: {SOURCE_LABEL[source]}
      </p>
    </AmudPager>
  );
}
