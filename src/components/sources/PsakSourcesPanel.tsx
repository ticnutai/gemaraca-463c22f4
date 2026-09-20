import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Library, Loader2, Save, ScrollText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { usePsakSources, type PsakSource } from "@/hooks/usePsakSources";

const n = (x?: number) => (x ?? 0).toLocaleString("he-IL");

/**
 * ניהול המקורות שמהם הובאו פסקי הדין.
 * מקור שמכובה כאן לא מוצג ברשימת הפסקים, והנתונים עצמם נשארים במסד.
 */
export default function PsakSourcesPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: sources, isLoading, refetch } = usePsakSources();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, Partial<PsakSource>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);

  const value = (s: PsakSource, field: keyof PsakSource) => (draft[s.key]?.[field] ?? s[field]) as never;
  const edit = (key: string, patch: Partial<PsakSource>) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const save = async (s: PsakSource) => {
    const patch = draft[s.key];
    if (!patch) return;
    setSaving(s.key);
    try {
      const { error } = await supabase
        .from("psak_source_registry" as never)
        .update(patch as never)
        .eq("key" as never, s.key);
      if (error) throw new Error(error.message);
      setDraft((d) => {
        const next = { ...d };
        delete next[s.key];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["psak_source_registry"] });
      toast({ title: "נשמר", description: s.label });
    } catch (e) {
      toast({ title: "השמירה נכשלה", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const total = (sources ?? []).reduce((sum, s) => sum + (s.count ?? 0), 0);
  const shown = (sources ?? []).filter((s) => s.enabled).reduce((sum, s) => sum + (s.count ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto" dir="rtl">
        <DialogHeader className="text-right pr-10">
          <DialogTitle className="flex items-center gap-2">
            <Library className="h-5 w-5 text-primary" />
            מקורות פסקי הדין
          </DialogTitle>
          <DialogDescription>
            כאן נקבע מאיזה מקורות יוצגו פסקי דין. כיבוי מקור מסתיר אותו מהרשימות, והנתונים נשארים במסד.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> טוען מקורות…
          </div>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              מוצגים {n(shown)} מתוך {n(total)} פסקי דין
            </div>

            <div className="space-y-3">
              {(sources ?? []).map((s) => {
                const dirty = !!draft[s.key];
                return (
                  <div
                    key={s.key}
                    className={cn(
                      "rounded-lg border p-3 space-y-2",
                      value(s, "enabled") ? "border-border" : "border-dashed border-muted-foreground/40 bg-muted/30",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span dir="ltr" className="inline-flex">
                        <Switch
                          checked={value(s, "enabled")}
                          onCheckedChange={(v) => edit(s.key, { enabled: v })}
                        />
                      </span>
                      <Input
                        className="h-8 max-w-[240px] font-medium"
                        value={value(s, "label")}
                        onChange={(e) => edit(s.key, { label: e.target.value })}
                      />
                      <Badge variant="secondary" className="text-[11px]">
                        {n(s.count)} פסקים
                      </Badge>
                      <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                        {s.key}
                      </span>
                      <div className="flex-1" />
                      {s.site_url && (
                        <a
                          href={s.site_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" /> האתר
                        </a>
                      )}
                      {dirty && (
                        <Button size="sm" className="h-7 gap-1" onClick={() => save(s)} disabled={saving === s.key}>
                          {saving === s.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          שמירה
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <ScrollText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">רישוי:</span>
                        <span>{s.license || "לא ידוע"}</span>
                      </div>
                      {s.attribution && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">ייחוס נדרש:</span>
                          <span>{s.attribution}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
