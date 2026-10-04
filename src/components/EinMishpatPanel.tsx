import { useEffect, useMemo, useState } from "react";
import { Loader2, Scale, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

/**
 * עין משפט נר מצוה — מן הדף אל ההלכה.
 *
 * כל שאר המערכת הולכת בכיוון אחד: מפסק דין אל דף הגמרא. כאן הכיוון הפוך —
 * מה נפסק להלכה מתוך הדף שלפניך, ברמב"ם, בסמ"ג, בטור ובשולחן ערוך. זהו
 * מפתח מסורתי בן מאות שנים, מתויג ביד, והטקסטים שאליהם הוא מפנה הם
 * נחלת הכלל.
 */

interface Row {
  target_ref: string;
  target_book: string | null;
}

interface Props {
  tractate: string;
  daf: number;
  amud: "a" | "b";
}

/** שמות הספרים בעברית. מה שאינו ברשימה מוצג כפי שהוא */
const BOOK_HE: Record<string, string> = {
  "Mishneh Torah": 'רמב"ם',
  "Shulchan Arukh": "שולחן ערוך",
  "Tur": "טור",
  "Sefer Mitzvot Gadol": 'סמ"ג',
  "Beur HaGra on Shulchan Arukh": 'ביאור הגר"א',
};

/** סדר התצוגה: הפוסקים לפי סדר הדורות, והשאר אחריהם */
const ORDER = ["Mishneh Torah", "Sefer Mitzvot Gadol", "Tur", "Shulchan Arukh"];

export default function EinMishpatPanel({ tractate, daf, amud }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setFailed(false);
    (async () => {
      const { data, error } = await supabase
        .from("ein_mishpat")
        .select("target_ref,target_book")
        .eq("tractate", tractate)
        .eq("daf", daf)
        .eq("amud", amud);
      if (!alive) return;
      if (error) { setFailed(true); return; }
      setRows(data ?? []);
    })();
    return () => { alive = false; };
  }, [tractate, daf, amud]);

  const grouped = useMemo(() => {
    if (!rows) return [];
    const by = new Map<string, string[]>();
    for (const r of rows) {
      const k = r.target_book ?? "אחר";
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(r.target_ref);
    }
    return [...by.entries()].sort((a, b) => {
      const ia = ORDER.indexOf(a[0]), ib = ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [rows]);

  if (failed) return null;        // שכבה משלימה; כשלון בה אינו צריך להרעיש
  if (rows === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />טוען עין משפט…
      </div>
    );
  }
  if (!rows.length) return null;  // לא לכל דף יש עין משפט

  return (
    <Card className="border-accent/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="w-4 h-4 text-accent" />
          עין משפט נר מצוה
          <Badge variant="secondary" className="text-xs">{rows.length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">מה נפסק להלכה מן הדף הזה</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {grouped.map(([book, refs]) => (
          <div key={book}>
            <div className="text-sm font-semibold text-foreground mb-1.5">
              {BOOK_HE[book] ?? book}
              <span className="text-muted-foreground font-normal text-xs mr-2">{refs.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {refs.map((ref) => (
                <a
                  key={ref}
                  href={`https://www.sefaria.org.il/${encodeURIComponent(ref.replace(/\s/g, "_"))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs hover:bg-primary/10 transition-colors"
                  title={ref}
                >
                  {ref.replace(/^[^,]+,\s*/, "")}
                  <ExternalLink className="w-3 h-3 opacity-50" />
                </a>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
