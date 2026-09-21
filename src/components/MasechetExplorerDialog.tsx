import { useState, useEffect, useMemo, useCallback } from "react";
import {
  BookOpen, ChevronLeft, Scale, Sparkles, ArrowRight,
  Loader2, Crown, Star, Flame, TrendingUp,
  Building2, Calendar, ChevronDown, ExternalLink, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SEDARIM, getMasechtotBySeder, MASECHTOT, Masechet } from "@/lib/masechtotData";
import { toHebrewNumeral, toDafFormat } from "@/lib/hebrewNumbers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "@/contexts/AppContext";
import { useQuery } from "@tanstack/react-query";
import { useDocumentViewer } from "./DocumentViewerProvider";
import FileTypeBadge from "./FileTypeBadge";
import SummaryToggle from "./SummaryToggle";
import { useGemaraDownloadStore } from "@/stores/gemaraDownloadStore";
import { buildMasechetJob, buildSederJob, buildShasJob } from "@/hooks/useGemaraDownloadEngine";
import { useToast } from "@/hooks/use-toast";

// ─── Types ──────────────────────────────────────────────
type Step = "sedarim" | "masechtot" | "dafim" | "psakim";

interface PsakCount {
  [masechetSefaria: string]: {
    total: number;
    byDaf: { [daf: number]: number };
  };
}

interface DafPsak {
  id: string;
  psak_din_id: string;
  title: string;
  court: string;
  year: number;
  summary: string;
  tags: string[];
  relevance_score: number;
  connection: string;
  source_url?: string;
}

// ─── Seder icons & colors ───────────────────────────────
const SEDER_META: Record<string, { icon: typeof BookOpen; gradient: string; glow: string }> = {
  "זרעים": { icon: Sparkles, gradient: "from-emerald-500/20 to-green-600/10", glow: "shadow-emerald-500/20" },
  "מועד":  { icon: Star, gradient: "from-amber-500/20 to-yellow-600/10", glow: "shadow-amber-500/20" },
  "נשים":  { icon: Crown, gradient: "from-rose-500/20 to-pink-600/10", glow: "shadow-rose-500/20" },
  "נזיקין": { icon: Scale, gradient: "from-blue-500/20 to-indigo-600/10", glow: "shadow-blue-500/20" },
  "קדשים": { icon: Flame, gradient: "from-orange-500/20 to-red-600/10", glow: "shadow-orange-500/20" },
  "טהרות": { icon: TrendingUp, gradient: "from-cyan-500/20 to-teal-600/10", glow: "shadow-cyan-500/20" },
};

// ─── Component ──────────────────────────────────────────
interface MasechetExplorerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MasechetExplorerDialog = ({ open, onOpenChange }: MasechetExplorerDialogProps) => {
  const navigate = useNavigate();
  const { open: openDocument } = useDocumentViewer();
  const { setSelectedMasechet, setActiveTab } = useAppContext();

  const [step, setStep] = useState<Step>("sedarim");
  const [selectedSeder, setSelectedSeder] = useState<string | null>(null);
  const [selectedMasechetLocal, setSelectedMasechetLocal] = useState<Masechet | null>(null);
  const [selectedDaf, setSelectedDaf] = useState<number | null>(null);
  const [dafPsakim, setDafPsakim] = useState<DafPsak[]>([]);
  const [loadingPsakim, setLoadingPsakim] = useState(false);

  const enqueueJobRaw = useGemaraDownloadStore((s) => s.enqueueJob);
  const { toast: downloadToast } = useToast();

  const enqueueJob = async (job: Parameters<typeof enqueueJobRaw>[0]) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      downloadToast({ title: 'נדרשת התחברות', description: 'יש להתחבר למערכת לפני הורדת דפים', variant: 'destructive' });
      return;
    }
    enqueueJobRaw(job);
  };

  // Load psak counts per masechet and daf
  const { data: psakCounts = {} } = useQuery<PsakCount>({
    queryKey: ["explorer-psak-counts"],
    queryFn: async () => {
      const counts: PsakCount = {};

      const [sugyaRes, patternRes] = await Promise.all([
        supabase.from("sugya_psak_links").select("sugya_id"),
        supabase.from("pattern_sugya_links").select("masechet, daf"),
      ]);

      // Process sugya_psak_links
      (sugyaRes.data || []).forEach((link: { sugya_id?: string }) => {
        const sugyaId = link.sugya_id || "";
        for (const m of MASECHTOT) {
          const prefix = m.sefariaName.toLowerCase() + "_";
          if (sugyaId.toLowerCase().startsWith(prefix)) {
            const rest = sugyaId.slice(prefix.length);
            const match = rest.match(/^(\d+)/);
            if (match) {
              const dafNum = parseInt(match[1]);
              if (!counts[m.sefariaName]) counts[m.sefariaName] = { total: 0, byDaf: {} };
              counts[m.sefariaName].total++;
              counts[m.sefariaName].byDaf[dafNum] = (counts[m.sefariaName].byDaf[dafNum] || 0) + 1;
            }
            break;
          }
        }
      });

      // Process pattern_sugya_links (Hebrew masechet names)
      (patternRes.data || []).forEach((link: { masechet?: string; daf?: string }) => {
        const m = MASECHTOT.find(ms => ms.hebrewName === link.masechet);
        if (m && link.daf) {
          const dafNum = parseInt(link.daf);
          if (!counts[m.sefariaName]) counts[m.sefariaName] = { total: 0, byDaf: {} };
          counts[m.sefariaName].total++;
          counts[m.sefariaName].byDaf[dafNum] = (counts[m.sefariaName].byDaf[dafNum] || 0) + 1;
        }
      });

      return counts;
    },
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  // Compute seder-level psak counts
  const sederCounts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const seder of SEDARIM) {
      let total = 0;
      for (const m of getMasechtotBySeder(seder)) {
        total += psakCounts[m.sefariaName]?.total || 0;
      }
      result[seder] = total;
    }
    return result;
  }, [psakCounts]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep("sedarim");
      setSelectedSeder(null);
      setSelectedMasechetLocal(null);
      setSelectedDaf(null);
      setDafPsakim([]);
    }
  }, [open]);

  const goBack = () => {
    if (step === "psakim") { setStep("dafim"); setSelectedDaf(null); setDafPsakim([]); }
    else if (step === "dafim") { setStep("masechtot"); setSelectedMasechetLocal(null); }
    else if (step === "masechtot") { setStep("sedarim"); setSelectedSeder(null); }
    else onOpenChange(false);
  };

  const handleSederSelect = (seder: string) => {
    setSelectedSeder(seder);
    setStep("masechtot");
  };

  const handleMasechetSelect = (m: Masechet) => {
    setSelectedMasechetLocal(m);
    setStep("dafim");
  };

  const handleDafSelect = useCallback(async (dafNumber: number) => {
    if (!selectedMasechetLocal) return;
    setSelectedDaf(dafNumber);
    setStep("psakim");
    setLoadingPsakim(true);

    try {
      const masechet = selectedMasechetLocal;
      const [sugyaRes, patternRes] = await Promise.all([
        supabase
          .from("sugya_psak_links")
          .select(`
            id, psak_din_id, sugya_id, connection_explanation, relevance_score,
            psakei_din (id, title, court, year, summary, tags, source_url)
          `)
          .like("sugya_id", `${masechet.sefariaName}_${dafNumber}%`),
        supabase
          .from("pattern_sugya_links")
          .select(`
            id, psak_din_id, sugya_id, source_text, confidence,
            psakei_din:psak_din_id (id, title, court, year, summary, tags, source_url)
          `)
          .eq("masechet", masechet.hebrewName)
          .eq("daf", dafNumber.toString()),
      ]);

      const seen = new Set<string>();
      const result: DafPsak[] = [];

      (sugyaRes.data || []).forEach((link: any) => {
        if (link.psakei_din && !seen.has(link.psak_din_id)) {
          seen.add(link.psak_din_id);
          result.push({
            id: link.id,
            psak_din_id: link.psak_din_id,
            title: link.psakei_din.title,
            court: link.psakei_din.court,
            year: link.psakei_din.year,
            summary: link.psakei_din.summary,
            tags: link.psakei_din.tags || [],
            relevance_score: link.relevance_score ?? (link.confidence === "high" ? 8 : link.confidence === "medium" ? 6 : 4),
            connection: link.connection_explanation || link.source_text || "",
            source_url: link.psakei_din.source_url,
          });
        }
      });

      result.sort((a, b) => b.relevance_score - a.relevance_score);
      setDafPsakim(result);
    } catch (err) {
      console.error("Error loading daf psakim:", err);
    } finally {
      setLoadingPsakim(false);
    }
  }, [selectedMasechetLocal]);

  const navigateToDaf = (dafNumber: number) => {
    if (!selectedMasechetLocal) return;
    const sugyaId = `${selectedMasechetLocal.sefariaName.toLowerCase()}_${dafNumber}a`;
    setSelectedMasechet(selectedMasechetLocal.hebrewName);
    setActiveTab("gemara");
    onOpenChange(false);
    navigate(`/sugya/${sugyaId}`);
  };

  // ─── Breadcrumb ─────────────────────────────
  const breadcrumbs = useMemo(() => {
    const items: { label: string; onClick?: () => void }[] = [{ label: "סדרים", onClick: () => { setStep("sedarim"); setSelectedSeder(null); setSelectedMasechetLocal(null); setSelectedDaf(null); } }];
    if (selectedSeder) items.push({ label: `סדר ${selectedSeder}`, onClick: () => { setStep("masechtot"); setSelectedMasechetLocal(null); setSelectedDaf(null); } });
    if (selectedMasechetLocal) items.push({ label: selectedMasechetLocal.hebrewName, onClick: () => { setStep("dafim"); setSelectedDaf(null); } });
    if (selectedDaf) items.push({ label: `דף ${toHebrewNumeral(selectedDaf)}` });
    return items;
  }, [selectedSeder, selectedMasechetLocal, selectedDaf]);

  // ─── Step title ─────────────────────────────
  const stepTitle = step === "sedarim" ? "ששת סדרי הש\"ס"
    : step === "masechtot" ? `סדר ${selectedSeder}`
    : step === "dafim" ? `מסכת ${selectedMasechetLocal?.hebrewName}`
    : `${selectedMasechetLocal?.hebrewName} דף ${toHebrewNumeral(selectedDaf || 0)}`;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden bg-card" dir="rtl">
          {/* Header with gradient */}
          <div className="bg-gradient-to-l from-primary/10 via-accent/5 to-transparent p-5 pb-3 border-b border-border">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className="text-xl font-bold flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  {stepTitle}
                </DialogTitle>
                {step !== "sedarim" && (
                  <Button variant="ghost" size="sm" onClick={goBack} className="gap-1">
                    <ArrowRight className="h-4 w-4" />
                    חזרה
                  </Button>
                )}
              </div>
            </DialogHeader>
            {/* Breadcrumb */}
            <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground overflow-x-auto">
              {breadcrumbs.map((bc, i) => (
                <span key={i} className="flex items-center gap-1 shrink-0">
                  {i > 0 && <ChevronLeft className="h-3 w-3" />}
                  {bc.onClick ? (
                    <button onClick={bc.onClick} className="hover:text-primary transition-colors underline-offset-2 hover:underline">
                      {bc.label}
                    </button>
                  ) : (
                    <span className="text-foreground font-medium">{bc.label}</span>
                  )}
                </span>
              ))}
            </div>
          </div>

          {/* Content area */}
          <ScrollArea className="h-[60vh] px-5 py-4">
            {/* ──── Step 1: Sedarim ──── */}
            {step === "sedarim" && (
              <div className="space-y-3">
              {/* Download all Shas button */}
              <button
                onClick={(e) => { e.stopPropagation(); enqueueJob(buildShasJob()); }}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 transition-all text-primary text-sm font-semibold"
              >
                <Download className="h-4 w-4" />
                הורד את כל הש״ס
              </button>
              <div className="grid grid-cols-2 gap-3" dir="rtl">
                {SEDARIM.map((seder) => {
                  const meta = SEDER_META[seder] || SEDER_META["זרעים"];
                  const Icon = meta.icon;
                  const count = sederCounts[seder] || 0;
                  const masechtot = getMasechtotBySeder(seder);

                  return (
                    <button
                      key={seder}
                      onClick={() => handleSederSelect(seder)}
                      className={cn(
                        "relative p-5 rounded-xl border border-border transition-all duration-300 text-right",
                        "hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]",
                        `bg-gradient-to-br ${meta.gradient}`,
                        `hover:${meta.glow}`
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="p-2 rounded-lg bg-background/60 backdrop-blur">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        {count > 0 && (
                          <div className="flex items-center gap-1 bg-primary/15 text-primary rounded-full px-2 py-0.5">
                            <Scale className="h-3 w-3" />
                            <span className="text-xs font-bold">{count}</span>
                          </div>
                        )}
                      </div>
                      <h3 className="font-bold text-lg mt-3">סדר {seder}</h3>
                      <div className="flex items-center justify-between mt-1">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); enqueueJob(buildSederJob(seder)); }}
                          className="p-1.5 rounded-lg bg-background/70 hover:bg-primary/20 transition-colors cursor-pointer"
                          title={`הורד סדר ${seder}`}
                        >
                          <Download className="h-3.5 w-3.5 text-primary" />
                        </span>
                        <p className="text-sm text-muted-foreground">{masechtot.length} מסכתות</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              </div>
            )}

            {/* ──── Step 2: Masechtot ──── */}
            {step === "masechtot" && selectedSeder && (
              <div className="space-y-2">
                {/* Download entire seder button */}
                <button
                  onClick={() => enqueueJob(buildSederJob(selectedSeder))}
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 transition-all text-primary text-sm font-semibold"
                >
                  <Download className="h-4 w-4" />
                  הורד את כל סדר {selectedSeder}
                </button>
                {getMasechtotBySeder(selectedSeder).map((m) => {
                  const count = psakCounts[m.sefariaName]?.total || 0;
                  const dafCount = Object.keys(psakCounts[m.sefariaName]?.byDaf || {}).length;
                  const coverage = Math.round((dafCount / (m.maxDaf - 1)) * 100);

                  return (
                    <div key={m.englishName} className="flex items-stretch gap-2">
                    <button
                      onClick={() => handleMasechetSelect(m)}
                      className={cn(
                        "flex-1 flex items-center gap-4 p-4 rounded-xl border border-border transition-all duration-200",
                        "hover:shadow-md hover:border-primary/30 hover:bg-primary/5 active:scale-[0.99]",
                        "bg-card text-right"
                      )}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-base">{m.hebrewName}</h4>
                          <span className="text-xs text-muted-foreground">({m.maxDaf - 1} דפים)</span>
                        </div>
                        {count > 0 && (
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                              <span>{coverage}% כיסוי</span>
                              <span>{dafCount} דפים עם פסקים</span>
                            </div>
                            <Progress value={coverage} className="h-1.5" />
                          </div>
                        )}
                      </div>
                      {/* Psak indicator */}
                      {count > 0 ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <div className={cn(
                            "relative p-2.5 rounded-xl",
                            count >= 10 ? "bg-primary/20 ring-2 ring-primary/30" :
                            count >= 5 ? "bg-primary/15" : "bg-primary/10"
                          )}>
                            <Scale className={cn(
                              "h-5 w-5",
                              count >= 10 ? "text-primary" : "text-primary/70"
                            )} />
                            <span className="absolute -top-1.5 -left-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 shadow-md">
                              {count}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">פסקים</span>
                        </div>
                      ) : (
                        <div className="p-2.5 rounded-xl bg-muted/50">
                          <BookOpen className="h-5 w-5 text-muted-foreground/50" />
                        </div>
                      )}
                      <ChevronLeft className="h-4 w-4 text-muted-foreground/50" />
                    </button>
                    {/* Download masechet button */}
                    <button
                      onClick={() => enqueueJob(buildMasechetJob(m))}
                      className="shrink-0 p-3 rounded-xl border border-border hover:bg-primary/10 hover:border-primary/30 transition-all"
                      title={`הורד מסכת ${m.hebrewName}`}
                    >
                      <Download className="h-4 w-4 text-primary" />
                    </button>
                  </div>
                  );
                })}
              </div>
            )}

            {/* ──── Step 3: Dafim ──── */}
            {step === "dafim" && selectedMasechetLocal && (
              <div>
                {/* Download masechet button */}
                <button
                  onClick={() => enqueueJob(buildMasechetJob(selectedMasechetLocal))}
                  className="w-full flex items-center justify-center gap-2 p-2.5 mb-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 transition-all text-primary text-sm font-semibold"
                >
                  <Download className="h-4 w-4" />
                  הורד מסכת {selectedMasechetLocal.hebrewName}
                </button>
                {/* Quick stats */}
                {(psakCounts[selectedMasechetLocal.sefariaName]?.total || 0) > 0 && (
                  <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-primary/5 border border-primary/10">
                    <Scale className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">
                      {psakCounts[selectedMasechetLocal.sefariaName]?.total || 0} פסקי דין מקושרים
                      {" "}ב-{Object.keys(psakCounts[selectedMasechetLocal.sefariaName]?.byDaf || {}).length} דפים
                    </span>
                  </div>
                )}
                {/* Daf grid */}
                <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-8 gap-2">
                  {Array.from({ length: selectedMasechetLocal.maxDaf - 1 }, (_, i) => i + 2).map(daf => {
                    const pCount = psakCounts[selectedMasechetLocal.sefariaName]?.byDaf[daf] || 0;
                    const hasPsakim = pCount > 0;

                    return (
                      <button
                        key={daf}
                        onClick={() => {
                          if (hasPsakim) {
                            handleDafSelect(daf);
                          } else {
                            navigateToDaf(daf);
                          }
                        }}
                        className={cn(
                          "relative p-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                          "border min-h-[44px] flex flex-col items-center justify-center",
                          "hover:scale-105 active:scale-95",
                          hasPsakim
                            ? cn(
                                "bg-gradient-to-br from-accent to-accent/80 text-accent-foreground border-accent/50",
                                "hover:shadow-lg hover:shadow-accent/20",
                                pCount >= 5 && "ring-2 ring-primary/40"
                              )
                            : "bg-card border-border hover:border-accent/50 hover:bg-accent/5 text-foreground"
                        )}
                      >
                        <span>{toHebrewNumeral(daf)}</span>
                        {hasPsakim && (
                          <span className="absolute -top-1.5 -left-1 bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5 shadow">
                            {pCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {/* Legend */}
                <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded bg-accent border border-accent/50" />
                    <span>יש פסקי דין</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded bg-card border border-border" />
                    <span>טקסט בלבד</span>
                  </div>
                </div>
              </div>
            )}

            {/* ──── Step 4: Psakim for selected daf ──── */}
            {step === "psakim" && selectedMasechetLocal && selectedDaf && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToDaf(selectedDaf)}
                    className="gap-1"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    פתח דף
                  </Button>
                  <Badge variant="secondary" className="text-sm">
                    {loadingPsakim ? "טוען..." : `${dafPsakim.length} פסקי דין`}
                  </Badge>
                </div>

                {loadingPsakim ? (
                  <div className="flex flex-col items-center py-12 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">טוען פסקי דין...</p>
                  </div>
                ) : dafPsakim.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Scale className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p>לא נמצאו פסקי דין לדף זה</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {dafPsakim.map((psak) => (
                      <button
                        key={psak.id}
                        onClick={() => openDocument({ id: psak.psak_din_id, title: psak.title, source_url: (psak as any).source_url })}
                        className={cn(
                          "w-full text-right p-4 rounded-xl border border-border transition-all duration-200",
                          "hover:shadow-md hover:border-primary/30 hover:bg-primary/5 active:scale-[0.99]",
                          "bg-card"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <h4 className="font-bold text-sm line-clamp-2 flex items-center gap-1 justify-end"><SummaryToggle summary={psak.summary} compact /><FileTypeBadge url={psak.source_url} />{psak.title}</h4>
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Building2 className="h-3 w-3" />
                                {psak.court}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {psak.year}
                              </span>
                            </div>
                            {psak.connection && (
                              <p className="text-xs text-foreground/70 mt-2 line-clamp-2">{psak.connection}</p>
                            )}
                            {psak.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {psak.tags.slice(0, 4).map((tag, i) => (
                                  <Badge key={i} variant="outline" className="text-[10px] h-5">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* Relevance indicator */}
                          <div className={cn(
                            "shrink-0 flex flex-col items-center gap-0.5 p-2 rounded-lg",
                            psak.relevance_score >= 7 ? "bg-green-500/10" :
                            psak.relevance_score >= 5 ? "bg-yellow-500/10" : "bg-muted/50"
                          )}>
                            <span className={cn(
                              "text-lg font-bold",
                              psak.relevance_score >= 7 ? "text-green-600" :
                              psak.relevance_score >= 5 ? "text-yellow-600" : "text-muted-foreground"
                            )}>
                              {psak.relevance_score}
                            </span>
                            <span className="text-[9px] text-muted-foreground">רלוונטיות</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

    </>
  );
};

export default MasechetExplorerDialog;
