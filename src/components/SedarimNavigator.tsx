import { useState, useEffect, lazy, Suspense } from "react";
import { BookOpen, ChevronLeft, ChevronDown, Scale, Download, Loader2, Check, X, MoreVertical, Trash2, RefreshCw, LayoutGrid, List, Compass, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { trackRecentPsak } from "@/lib/recentPsakim";
import { useDocumentViewer } from "@/components/DocumentViewerProvider";
import { SEDARIM, getMasechtotBySeder, MASECHTOT, Masechet } from "@/lib/masechtotData";
import { toDafFormat } from "@/lib/hebrewNumbers";
import { Button } from "@/components/ui/button";
import { useGemaraDownloadStore } from "@/stores/gemaraDownloadStore";
import { buildMasechetJob, buildSederJob, buildShasJob } from "@/hooks/useGemaraDownloadEngine";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "@/contexts/AppContext";
import FileTypeBadge from "./FileTypeBadge";
import SummaryToggle from "./SummaryToggle";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useExplorerPanelStore } from "@/stores/explorerPanelStore";

const GemaraPsakDinIndex = lazy(() => import("./GemaraPsakDinIndex"));
const TalmudTreeView = lazy(() => import("./TalmudTreeView"));

type ViewMode = "grid" | "list" | "tree" | "explorer";

interface SedarimNavigatorProps {
  className?: string;
}

interface PsakDinExample {
  id: string;
  title: string;
  court: string;
  year: number;
  summary: string;
  source_url?: string;
}

const RECENT_PSAKIM_KEY = 'recently_viewed_psakim';

interface LoadedPagesMap {
  [masechetName: string]: { loaded: number; total: number };
}

const SedarimNavigator = ({ className }: SedarimNavigatorProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { setSelectedMasechet, setActiveTab, selectedMasechet } = useAppContext();
  const [selectedSeder, setSelectedSeder] = useState<string | null>(null);
  const [selectedMasechetLocal, setSelectedMasechetLocal] = useState<Masechet | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [managingMasechet, setManagingMasechet] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const queryClient = useQueryClient();

  // Auto-expand seder + masechet when selectedMasechet is set from context (e.g. sidebar click)
  useEffect(() => {
    if (!selectedMasechet) return;
    const masechet = MASECHTOT.find(m => m.hebrewName === selectedMasechet);
    if (!masechet) return;
    setSelectedSeder(masechet.seder);
    setSelectedMasechetLocal(masechet);
    setIsExpanded(false);
    // Switch to grid view (which shows dafim grid)
    if (viewMode === 'list' || viewMode === 'tree' || viewMode === 'explorer') {
      setViewMode('grid');
    }
    // Clear context so this effect doesn't re-fire on next render
    setSelectedMasechet(null);
  }, [selectedMasechet]);

  const enqueueJobRaw = useGemaraDownloadStore((s) => s.enqueueJob);

  const enqueueJob = async (job: Parameters<typeof enqueueJobRaw>[0]) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: 'נדרשת התחברות', description: 'יש להתחבר למערכת לפני הורדת דפים', variant: 'destructive' });
      return;
    }
    enqueueJobRaw(job);
  };

  const INITIAL_DAF_COUNT = 20;

  // Load recently viewed Psakei Din
  const { data: psakDinExamples = [] } = useQuery({
    queryKey: ['recently-viewed-psakim'],
    queryFn: async () => {
      try {
        const recentIds: string[] = JSON.parse(localStorage.getItem(RECENT_PSAKIM_KEY) || '[]');
        const TARGET = 6;
        let results: PsakDinExample[] = [];

        if (recentIds.length > 0) {
          // Fetch recently viewed by IDs preserving order
          const { data } = await supabase
            .from('psakei_din')
            .select('id, title, court, year, summary, source_url')
            .in('id', recentIds.slice(0, TARGET));
          if (data && data.length > 0) {
            const orderMap = new Map(recentIds.map((id, i) => [id, i]));
            results = (data as PsakDinExample[]).sort((a, b) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99));
          }
        }

        // Fill remaining slots with latest psakim (avoid duplicates)
        if (results.length < TARGET) {
          const existingIds = new Set(results.map(r => r.id));
          const { data: latest } = await supabase
            .from('psakei_din')
            .select('id, title, court, year, summary, source_url')
            .order('created_at', { ascending: false })
            .limit(TARGET - results.length + existingIds.size);
          if (latest) {
            for (const p of latest as PsakDinExample[]) {
              if (!existingIds.has(p.id) && results.length < TARGET) {
                results.push(p);
              }
            }
          }
        }

        return results;
      } catch {
        return [];
      }
    },
    staleTime: 30 * 1000,
  });

  // Load loaded pages counts from shas_download_progress (accurate, no row limit issues)
  const { data: loadedPagesMap = {} } = useQuery({
    queryKey: ['sedarim-loaded-pages'],
    queryFn: async () => {
      const map: LoadedPagesMap = {};
      const { data } = await supabase
        .from('shas_download_progress')
        .select('masechet, hebrew_name, loaded_pages, total_pages');
      if (data) {
        data.forEach((row: { masechet: string; hebrew_name?: string; loaded_pages?: number; total_pages?: number }) => {
          // Store under both keys for lookup
          const entry = { loaded: row.loaded_pages || 0, total: row.total_pages || 0 };
          map[row.masechet] = entry;
          if (row.hebrew_name) map[row.hebrew_name] = entry;
        });
      }
      return map;
    },
    staleTime: 30 * 1000,
  });

  const getLoadStatus = (masechet: Masechet) => {
    const fromMap = loadedPagesMap[masechet.sefariaName] || loadedPagesMap[masechet.hebrewName];
    if (fromMap) {
      return { loaded: fromMap.loaded, total: fromMap.total, percent: fromMap.total > 0 ? Math.round((fromMap.loaded / fromMap.total) * 100) : 0 };
    }
    const total = (masechet.maxDaf - 1) * 2;
    return { loaded: 0, total, percent: 0 };
  };

  // Delete all downloaded pages for a masechet
  const handleDeleteMasechet = async (masechet: Masechet) => {
    setDeleting(masechet.hebrewName);
    try {
      // Delete by sefariaName (how load-daf stores it)
      const { error: err1 } = await supabase
        .from('gemara_pages')
        .delete()
        .eq('masechet', masechet.sefariaName);
      // Also delete by hebrewName in case some were stored that way
      const { error: err2 } = await supabase
        .from('gemara_pages')
        .delete()
        .eq('masechet', masechet.hebrewName);

      if (err1 && err2) throw err1;

      await queryClient.invalidateQueries({ queryKey: ['sedarim-loaded-pages'] });
      toast({
        title: "נמחק בהצלחה",
        description: `כל הדפים של מסכת ${masechet.hebrewName} נמחקו`,
      });
    } catch (error) {
      console.error('Error deleting masechet:', error);
      toast({
        title: "שגיאה",
        description: "לא ניתן למחוק את הדפים",
        variant: "destructive",
      });
    } finally {
      setDeleting(null);
      setManagingMasechet(null);
    }
  };

  // Delete then re-download via engine
  const handleRedownloadMasechet = async (masechet: Masechet) => {
    setManagingMasechet(null);
    await handleDeleteMasechet(masechet);
    // Small delay to let queries refresh
    await new Promise(r => setTimeout(r, 500));
    enqueueJob(buildMasechetJob(masechet));
  };

  const handleSederClick = (seder: string) => {
    if (selectedSeder === seder) {
      setSelectedSeder(null);
      setSelectedMasechetLocal(null);
    } else {
      setSelectedSeder(seder);
      setSelectedMasechetLocal(null);
      setIsExpanded(false);
    }
  };

  const handleMasechetClick = (masechet: Masechet) => {
    if (selectedMasechetLocal?.englishName === masechet.englishName) {
      setSelectedMasechetLocal(null);
    } else {
      setSelectedMasechetLocal(masechet);
      setIsExpanded(false);
    }
  };

  const handleDafClick = (masechet: Masechet, dafNumber: number, amud: 'a' | 'b') => {
    const sugyaId = `${masechet.sefariaName.toLowerCase()}_${dafNumber}${amud}`;
    setSelectedMasechet(masechet.hebrewName);
    setActiveTab("gemara");
    navigate(`/sugya/${sugyaId}`);
  };

  const { open: openDocument } = useDocumentViewer();
  const handlePsakDinClick = (psak: PsakDinExample) => {
    trackRecentPsak(psak.id);
    queryClient.invalidateQueries({ queryKey: ['recently-viewed-psakim'] });
    openDocument({ id: psak.id, title: psak.title, source_url: psak.source_url });
  };

  const getMasechetCount = (seder: string) => {
    return getMasechtotBySeder(seder).length;
  };

  // Generate daf list for selected masechet
  const getAllDafim = () => {
    if (!selectedMasechetLocal) return [];
    const dafim = [];
    for (let daf = 2; daf <= selectedMasechetLocal.maxDaf; daf++) {
      dafim.push(daf);
    }
    return dafim;
  };

  const allDafim = getAllDafim();
  const displayedDafim = isExpanded ? allDafim : allDafim.slice(0, INITIAL_DAF_COUNT);
  const remainingCount = allDafim.length - INITIAL_DAF_COUNT;

  // Load psak counts per masechet for list view
  const { data: psakCounts = {} } = useQuery({
    queryKey: ['sedarim-psak-counts'],
    queryFn: async () => {
      const counts: Record<string, number> = {};
      const [sugyaRes, patternRes] = await Promise.all([
        supabase.from('sugya_psak_links').select('sugya_id'),
        supabase.from('pattern_sugya_links').select('masechet'),
      ]);

      (sugyaRes.data || []).forEach((link: { sugya_id?: string }) => {
        const sid = (link.sugya_id || '').toLowerCase();
        for (const m of MASECHTOT) {
          if (sid.startsWith(m.sefariaName.toLowerCase() + '_')) {
            counts[m.sefariaName] = (counts[m.sefariaName] || 0) + 1;
            break;
          }
        }
      });

      (patternRes.data || []).forEach((link: { masechet?: string }) => {
        const m = MASECHTOT.find(ms => ms.hebrewName === link.masechet);
        if (m) counts[m.sefariaName] = (counts[m.sefariaName] || 0) + 1;
      });
      return counts;
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className={cn("space-y-3 md:space-y-6 overflow-x-hidden", className)}>
      {/* Spacing from header */}
      <div className="pt-2 md:pt-4" />

      {/* View Mode Switcher */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              viewMode === 'grid' ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted text-muted-foreground'
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">רשת</span>
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              viewMode === 'list' ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted text-muted-foreground'
            )}
          >
            <List className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">רשימה</span>
          </button>
          <button
            onClick={() => setViewMode('tree')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              viewMode === 'tree' ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted text-muted-foreground'
            )}
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">עץ</span>
          </button>
          <button
            onClick={() => { useExplorerPanelStore.getState().open(); }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              'hover:bg-muted text-muted-foreground'
            )}
          >
            <Compass className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">סייר</span>
          </button>
        </div>
      </div>

      {/* ──── Grid View (original) ──── */}
      {viewMode === 'grid' && (
      <>
      {/* 6 Sedarim Cards - 3 columns on mobile for better fit */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 md:gap-3">
        {SEDARIM.map((seder) => (
          <button
            key={seder}
            onClick={() => handleSederClick(seder)}
            className={cn(
              "p-2.5 md:p-4 rounded-lg md:rounded-xl border transition-all duration-200 text-center min-h-[56px]",
              "hover:shadow-elegant active:scale-95",
              selectedSeder === seder
                ? "bg-primary text-primary-foreground border-accent shadow-gold"
                : "bg-card border-border hover:border-accent/50"
            )}
          >
            <BookOpen className="h-4 w-4 md:h-6 md:w-6 mx-auto mb-0.5 md:mb-1 text-foreground" />
            <span className="font-bold text-xs md:text-base block leading-tight">{seder}</span>
            <span className="text-[10px] md:text-xs opacity-70 hidden xs:inline">{getMasechetCount(seder)} מסכתות</span>
          </button>
        ))}
      </div>

      {/* Masechtot of Selected Seder */}
      {selectedSeder && (
        <div className="bg-card/50 rounded-lg md:rounded-xl border border-border p-2 md:p-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-1.5 md:gap-2 mb-2 md:mb-3">
            <button 
              onClick={() => setSelectedSeder(null)}
              className="p-0.5 md:p-1 hover:bg-muted rounded-lg transition-colors"
            >
              <ChevronLeft className="h-4 w-4 md:h-5 md:w-5 rtl-flip" />
            </button>
            <h3 className="font-bold text-sm md:text-lg">סדר {selectedSeder}</h3>
            <button
              onClick={() => enqueueJob(buildSederJob(selectedSeder))}
              className="mr-auto p-1.5 rounded-lg hover:bg-primary/10 transition-colors"
              title={`הורד סדר ${selectedSeder}`}
            >
              <Download className="h-4 w-4 text-primary" />
            </button>
          </div>
          
          <div className="flex flex-wrap gap-1.5 md:gap-2">
            {getMasechtotBySeder(selectedSeder).map((masechet) => {
              const status = getLoadStatus(masechet);
              const engineJobs = useGemaraDownloadStore.getState().jobs;
              const isDownloading = Object.values(engineJobs).some(j => j.status === 'downloading' && j.masechtot.includes(masechet.sefariaName));
              
              return (
                <div key={masechet.englishName} className="flex items-center gap-0.5 md:gap-1">
                  <Button
                    variant={selectedMasechetLocal?.englishName === masechet.englishName ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleMasechetClick(masechet)}
                    className={cn(
                      "transition-all text-xs md:text-sm h-8 md:h-9 px-2 md:px-3 min-h-[36px]",
                      selectedMasechetLocal?.englishName === masechet.englishName && "shadow-gold",
                      status.percent === 100 && "border-green-500/50"
                    )}
                  >
                    {masechet.hebrewName}
                    <span className={cn(
                      "text-[10px] md:text-xs mr-0.5 md:mr-1",
                      status.percent === 100 ? "text-green-600 font-semibold" : "opacity-70"
                    )}>
                      {status.loaded}/{status.total}
                    </span>
                  </Button>
                  
                  {/* Download button or green checkmark */}
                  {status.percent === 100 ? (
                    <div className="p-1 md:p-1.5 rounded-full bg-green-100 dark:bg-green-900/30 border border-green-400/50">
                      <Check className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600 dark:text-green-400" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        enqueueJob(buildMasechetJob(masechet));
                      }}
                      className={cn(
                        "p-1 md:p-1.5 rounded-md transition-all cursor-pointer",
                        "hover:bg-accent/20 text-accent hover:text-accent",
                        "border border-accent/30 hover:border-accent",
                      )}
                      title={`הורד מסכת ${masechet.hebrewName}`}
                    >
                      <Download className="h-3 w-3 md:h-4 md:w-4" />
                    </button>
                  )}

                  {/* Manage button (delete / re-download) — shown when masechet has loaded pages */}
                  {status.loaded > 0 && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setManagingMasechet(managingMasechet === masechet.hebrewName ? null : masechet.hebrewName);
                        }}
                        className="p-1 md:p-1.5 rounded-md transition-all cursor-pointer hover:bg-muted text-muted-foreground hover:text-foreground"
                        title={`ניהול מסכת ${masechet.hebrewName}`}
                      >
                        <MoreVertical className="h-3 w-3 md:h-4 md:w-4" />
                      </button>
                      {managingMasechet === masechet.hebrewName && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-lg shadow-lg p-1 min-w-[160px] animate-in fade-in slide-in-from-top-1 duration-150">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteMasechet(masechet);
                            }}
                            disabled={deleting === masechet.hebrewName}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                          >
                            {deleting === masechet.hebrewName ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            <span>מחק מידע</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRedownloadMasechet(masechet);
                            }}
                            disabled={deleting === masechet.hebrewName || isDownloading}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-md hover:bg-accent/10 text-accent transition-colors"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span>הורד מחדש</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {/* Download progress is shown via the floating GemaraDownloadFloat widget */}
        </div>
      )}

      {/* Dafim Grid of Selected Masechet - Golden buttons like reference image */}
      {selectedMasechetLocal && (
        <div className="bg-card rounded-lg md:rounded-xl border border-border p-2 md:p-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-1.5 md:gap-2 mb-2 md:mb-4">
            <button 
              onClick={() => setSelectedMasechetLocal(null)}
              className="p-0.5 md:p-1 hover:bg-muted rounded-lg transition-colors"
            >
              <ChevronLeft className="h-4 w-4 md:h-5 md:w-5 rtl-flip" />
            </button>
            <h3 className="font-bold text-sm md:text-lg">מסכת {selectedMasechetLocal.hebrewName}</h3>
            <span className="text-[10px] md:text-sm text-muted-foreground">({selectedMasechetLocal.maxDaf - 1} דפים)</span>
          </div>
          
          {/* Dafim grid with golden buttons — scrollable on mobile when expanded */}
          <div className={cn(
            "flex flex-wrap gap-1.5 md:gap-2 p-2 md:p-3 rounded-lg bg-secondary/30",
            isExpanded && "max-h-[50vh] overflow-y-auto"
          )}>
            {displayedDafim.map((daf) => (
              <div key={daf} className="flex gap-0.5">
                <button
                  onClick={() => handleDafClick(selectedMasechetLocal, daf, 'a')}
                  className={cn(
                    "px-1.5 py-1.5 md:px-2 md:py-2 text-xs md:text-sm rounded-r-md md:rounded-r-lg transition-all",
                    "min-w-[32px] min-h-[36px] md:min-w-[40px] font-medium",
                    "bg-accent text-accent-foreground",
                    "hover:brightness-110 hover:shadow-md",
                    "active:scale-95"
                  )}
                >
                  {toDafFormat(daf, 'a').replace(" ע\"א", "").replace("׳", "'")} ע״א
                </button>
                <button
                  onClick={() => handleDafClick(selectedMasechetLocal, daf, 'b')}
                  className={cn(
                    "px-1.5 py-1.5 md:px-2 md:py-2 text-xs md:text-sm rounded-l-md md:rounded-l-lg transition-all",
                    "min-w-[32px] min-h-[36px] md:min-w-[40px] font-medium",
                    "bg-accent/80 text-accent-foreground",
                    "hover:brightness-110 hover:shadow-md",
                    "active:scale-95"
                  )}
                >
                  ע״ב
                </button>
              </div>
            ))}
          </div>

          {/* Expand button */}
          {!isExpanded && remainingCount > 0 && (
            <button
              onClick={() => setIsExpanded(true)}
              className="flex items-center gap-1 mt-2 md:mt-4 mx-auto text-xs md:text-sm text-accent hover:text-accent/80 transition-colors min-h-[44px]"
            >
              <ChevronDown className="h-3 w-3 md:h-4 md:w-4" />
              <span>הרחב ({remainingCount} נוספים)</span>
            </button>
          )}
          
          {isExpanded && (
            <button
              onClick={() => setIsExpanded(false)}
              className="flex items-center gap-1 mt-2 md:mt-4 mx-auto text-xs md:text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
            >
              <ChevronDown className="h-3 w-3 md:h-4 md:w-4 rotate-180" />
              <span>צמצם</span>
            </button>
          )}
        </div>
      )}

      </>
      )}

      {/* ──── Tree View ──── */}
      {viewMode === 'tree' && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
          <TalmudTreeView psakCounts={psakCounts} loadedPages={Object.fromEntries(Object.entries(loadedPagesMap).map(([k, v]) => [k, Array.from({ length: v.loaded }, (_, i) => i)]))} />
        </Suspense>
      )}

      {/* ──── List View ──── */}
      {viewMode === 'list' && (
        <div className="space-y-2" dir="rtl">
          {SEDARIM.map((seder) => (
            <div key={seder} className="bg-card rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => handleSederClick(seder)}
                className={cn(
                  "w-full flex items-center justify-between p-3 md:p-4 transition-all",
                  selectedSeder === seder ? "bg-primary/10" : "hover:bg-muted/50"
                )}
                dir="rtl"
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <h3 className="font-bold text-sm md:text-base">סדר {seder}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{getMasechtotBySeder(seder).length} מסכתות</span>
                  <ChevronDown className={cn(
                    "h-4 w-4 transition-transform",
                    selectedSeder === seder ? "rotate-180" : ""
                  )} />
                </div>
              </button>

              {selectedSeder === seder && (
                <div className="border-t border-border divide-y divide-border/50">
                  {getMasechtotBySeder(seder).map((masechet) => {
                    const status = getLoadStatus(masechet);
                    const pCount = psakCounts[masechet.sefariaName] || 0;

                    return (
                      <button
                        key={masechet.englishName}
                        onClick={() => {
                          setSelectedMasechet(masechet.hebrewName);
                          setActiveTab("gemara");
                          navigate(`/sugya/${masechet.sefariaName.toLowerCase()}_2a`);
                        }}
                        className="w-full flex items-center justify-between p-3 md:p-4 hover:bg-accent/5 transition-all text-right"
                        dir="rtl"
                      >
                        <div>
                          <span className="font-medium text-sm">{masechet.hebrewName}</span>
                          <span className="text-xs text-muted-foreground mr-2">({masechet.maxDaf - 1} דפים)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Psak din indicator */}
                          {pCount > 0 && (
                            <div className="relative">
                              <Scale className={cn(
                                "h-4 w-4",
                                pCount >= 10 ? "text-primary" : "text-primary/60"
                              )} />
                              <span className="absolute -top-2 -left-2 bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                                {pCount}
                              </span>
                            </div>
                          )}
                          {/* Load status */}
                          {status.loaded > 0 && (
                            <Badge variant={status.percent === 100 ? "default" : "secondary"} className="text-[10px] h-5">
                              {status.percent === 100 ? <Check className="h-3 w-3" /> : `${status.loaded}/${status.total}`}
                            </Badge>
                          )}
                          <ChevronLeft className="h-4 w-4 text-muted-foreground/40" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {/* ──── פסקי דין אחרונים - shown in all view modes ──── */}
      {psakDinExamples.length > 0 && !selectedMasechetLocal && (
        <div className="bg-card rounded-lg md:rounded-xl border border-border p-2 md:p-4">
           <div className="flex items-center gap-1.5 md:gap-2 mb-2 md:mb-4 justify-end flex-row-reverse">
            <Scale className="h-3.5 w-3.5 md:h-5 md:w-5 text-foreground" />
            <h3 className="font-bold text-sm md:text-lg">פסקי דין אחרונים</h3>
          </div>
          
          <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
            {psakDinExamples.map((psak) => (
              <button
                key={psak.id}
                onClick={() => handlePsakDinClick(psak)}
                className={cn(
                  "p-2.5 md:p-3 rounded-md md:rounded-lg border text-right transition-all min-h-[48px]",
                  "bg-secondary/30 border-border hover:border-accent hover:shadow-sm",
                  "hover:bg-accent/10"
                )}
                dir="rtl"
              >
                <h4 className="font-medium text-xs md:text-sm line-clamp-2 mb-0.5 md:mb-1 flex items-center gap-1 justify-start" dir="rtl"><span className="text-right">{psak.title.replace(/^.*[/\\]/, '')}</span><FileTypeBadge url={psak.source_url} /><SummaryToggle summary={psak.summary} compact /></h4>
                {(psak.court && psak.court !== 'לא צוין') || psak.year ? (
                  <div className="flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs text-muted-foreground justify-end flex-row-reverse">
                    {psak.court && psak.court !== 'לא צוין' && <span className="truncate max-w-[100px] md:max-w-none">{psak.court}</span>}
                    {psak.court && psak.court !== 'לא צוין' && psak.year && <span>•</span>}
                    {psak.year && <span>{psak.year}</span>}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
          
          <button
            onClick={() => setActiveTab("psak-din")}
            className="flex items-center gap-1 mt-2 md:mt-4 mx-auto text-xs md:text-sm text-accent hover:text-accent/80 transition-colors min-h-[44px]"
          >
            <span>צפה בכל פסקי הדין</span>
            <ChevronLeft className="h-3 w-3 md:h-4 md:w-4 rtl-flip" />
          </button>
        </div>
      )}
    </div>
  );
};

export default SedarimNavigator;
