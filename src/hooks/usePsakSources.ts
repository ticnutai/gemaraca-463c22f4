import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PsakSource {
  key: string;
  label: string;
  site_url: string | null;
  license: string | null;
  attribution: string | null;
  enabled: boolean;
  sort_order: number;
  count?: number;
}

/**
 * מרשם המקורות שמהם הובאו פסקי הדין, יחד עם מספר הפסקים מכל מקור.
 * מקור שכובה במרשם לא מוצג ברשימות הפסקים.
 */
export function usePsakSources() {
  return useQuery({
    queryKey: ["psak_source_registry"],
    queryFn: async (): Promise<PsakSource[]> => {
      const { data, error } = await supabase
        .from("psak_source_registry" as never)
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;

      const sources = (data ?? []) as unknown as PsakSource[];

      // ספירה לכל מקור — שאילתת count נפרדת לכל אחד היא זולה בזכות האינדקס
      const counts = await Promise.all(
        sources.map(async (s) => {
          const { count } = await supabase
            .from("psakei_din")
            .select("id", { count: "exact", head: true })
            .eq("source_key" as never, s.key);
          return count ?? 0;
        }),
      );

      return sources.map((s, i) => ({ ...s, count: counts[i] }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** המפתחות שמותר להציג; null כשאין צורך לסנן כלל */
export function enabledSourceKeys(sources: PsakSource[] | undefined): string[] | null {
  if (!sources?.length) return null;
  const disabled = sources.filter((s) => !s.enabled);
  if (disabled.length === 0) return null;
  return sources.filter((s) => s.enabled).map((s) => s.key);
}
