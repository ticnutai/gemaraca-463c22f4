import { useEffect } from "react";
import { toast } from "@/hooks/use-toast";

const START_DELAY_MS = 45_000; // let the app finish loading first

/** Mounted for admins only: runs the scheduled cloud backup in the background when it is due. */
export default function AutoBackupRunner() {
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { runAutoBackupIfDue } = await import("@/lib/backup/engine");
        let announced = false;
        const result = await runAutoBackupIfDue(() => {
          if (!announced) {
            announced = true;
            toast({ title: "גיבוי אוטומטי התחיל", description: "הנתונים מגובים לענן ברקע" });
          }
        }, controller.signal);
        if (result) {
          const rows = Object.values(result.manifest.tables).reduce((s, t) => s + t.rows, 0);
          toast({ title: "הגיבוי האוטומטי הושלם", description: `${rows.toLocaleString("he-IL")} שורות גובו לענן` });
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        toast({
          title: "הגיבוי האוטומטי נכשל",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      }
    }, START_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return null;
}
