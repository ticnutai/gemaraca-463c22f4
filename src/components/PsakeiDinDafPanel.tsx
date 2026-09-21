import { useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense, startTransition } from "react";
import { usePsakimForDaf, DafPsak } from "@/hooks/usePsakimForDaf";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Scale,
  BookOpen,
  ExternalLink,
  Columns2,
  List,
  ChevronDown,
  ChevronUp,
  Brain,
  FileSearch,
  Eye,
  Star,
  Globe,
  FileText,
  X,
  RotateCcw,
  Grid3X3,
  LayoutGrid,
  Table,
  GalleryHorizontalEnd,
  Layers,
  Clock,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  Search,
  Building2,
  Tag,
  Hash,
  Sparkles,
  Loader2,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import FileTypeBadge from "./FileTypeBadge";
import SummaryToggle from "./SummaryToggle";
import { useDocumentViewer } from "./DocumentViewerProvider";
import { toast } from "sonner";

const GemaraTextPanel = lazy(() => import("@/components/GemaraTextPanel"));

const PSAK_VIEW_MODE_KEY = 'psak-din-view-mode';
const LAZY_BATCH = 12;

type ViewMode = "list" | "grid" | "compact" | "table" | "magazine" | "timeline" | "kanban" | "split";
type SortField = "title" | "year" | "court" | "references" | "relevance";
type SortDir = "asc" | "desc";

const VIEW_MODES: { key: ViewMode; icon: React.ElementType; label: string }[] = [
  { key: "list", icon: List, label: "רשימה" },
  { key: "grid", icon: LayoutGrid, label: "רשת" },
  { key: "compact", icon: Grid3X3, label: "קומפקט" },
  { key: "table", icon: Table, label: "טבלה" },
  { key: "magazine", icon: GalleryHorizontalEnd, label: "מגזין" },
  { key: "timeline", icon: Clock, label: "ציר זמן" },
  { key: "kanban", icon: Layers, label: "קנבן" },
  { key: "split", icon: Columns2, label: "מקבילה" },
];

const SORT_OPTIONS: { key: SortField; label: string; icon: React.ElementType }[] = [
  { key: "relevance", label: "רלוונטיות", icon: Sparkles },
  { key: "title", label: "כותרת", icon: FileText },
  { key: "year", label: "שנה", icon: Clock },
  { key: "court", label: "בית דין", icon: Building2 },
  { key: "references", label: "הפניות", icon: Hash },
];

interface PsakeiDinDafPanelProps {
  tractate: string;
  daf: string;
  sugyaId: string;
  dafYomi: string;
  masechet: string;
}

export default function PsakeiDinDafPanel({
  tractate, daf, sugyaId, dafYomi, masechet,
}: PsakeiDinDafPanelProps) {
  const { data: psakim, isLoading } = usePsakimForDaf(tractate, daf);

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(PSAK_VIEW_MODE_KEY) as ViewMode) || "list"
  );
  const [selectedPsak, setSelectedPsak] = useState<DafPsak | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterCourt, setFilterCourt] = useState<string | null>(null);

  // Sort
  const [sortField, setSortField] = useState<SortField>("relevance");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Lazy loading
  const [visibleCount, setVisibleCount] = useState(LAZY_BATCH);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const changeViewMode = useCallback((mode: ViewMode) => {
    startTransition(() => {
      setViewMode(mode);
      localStorage.setItem(PSAK_VIEW_MODE_KEY, mode);
      setVisibleCount(LAZY_BATCH);
    });
  }, []);

  useEffect(() => { setVisibleCount(LAZY_BATCH); }, [searchQuery, filterTag, filterCourt, sortField, sortDir]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisibleCount(prev => prev + LAZY_BATCH);
    }, { rootMargin: "200px" });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [viewMode, psakim]);

  // Derived data
  const allTags = useMemo(() => {
    if (!psakim) return [];
    const s = new Set<string>();
    psakim.forEach(p => p.tags?.forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [psakim]);

  const allCourts = useMemo(() => {
    if (!psakim) return [];
    const s = new Set<string>();
    psakim.forEach(p => { if (p.court) s.add(p.court); });
    return Array.from(s).sort();
  }, [psakim]);

  // Filtered + sorted
  const processedPsakim = useMemo(() => {
    if (!psakim) return [];
    let list = [...psakim];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q) ||
        p.court?.toLowerCase().includes(q) || p.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    if (filterTag) list = list.filter(p => p.tags?.includes(filterTag));
    if (filterCourt) list = list.filter(p => p.court === filterCourt);
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title": cmp = a.title.localeCompare(b.title, "he"); break;
        case "year": cmp = (a.year || 0) - (b.year || 0); break;
        case "court": cmp = (a.court || "").localeCompare(b.court || "", "he"); break;
        case "references": cmp = a.references.length - b.references.length; break;
        default:
          cmp = Math.max(0, ...b.references.map(r => r.confidence_score ?? 0)) -
                Math.max(0, ...a.references.map(r => r.confidence_score ?? 0));
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [psakim, searchQuery, filterTag, filterCourt, sortField, sortDir]);

  const visiblePsakim = useMemo(() => processedPsakim.slice(0, visibleCount), [processedPsakim, visibleCount]);
  const hasMore = visibleCount < processedPsakim.length;

  // Actions
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  const { open: openDocument } = useDocumentViewer();
  const handleOpenPsak = useCallback((psak: DafPsak) => {
    setSelectedPsak(psak);
    openDocument({ id: psak.id, title: psak.title, source_url: psak.source_url });
  }, [openDocument]);

  const handleSelectForSplit = useCallback((psak: DafPsak) => {
    setSelectedPsak(psak);
    changeViewMode("split");
  }, [changeViewMode]);

  // Kanban grouping
  const kanbanGroups = useMemo(() => {
    const map = new Map<string, DafPsak[]>();
    processedPsakim.forEach(p => {
      const key = p.court || "לא צוין";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    });
    return Array.from(map.entries());
  }, [processedPsakim]);

  /* ─── Loading ─── */
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (!psakim || psakim.length === 0) {
    return (
      <Card className="p-8 text-center">
        <Scale className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
        <h3 className="text-lg font-semibold text-muted-foreground mb-1">אין פסקי דין מקושרים</h3>
        <p className="text-sm text-muted-foreground">לא נמצאו פסקי דין שמפנים לדף זה באינדקס המתקדם.</p>
      </Card>
    );
  }

  const activeFilters = [filterTag, filterCourt, searchQuery.trim()].filter(Boolean).length;

  return (
    <div className="space-y-3">
      {/* ─── Toolbar ─── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">
              פסקי דין ({processedPsakim.length}{processedPsakim.length !== psakim.length ? ` / ${psakim.length}` : ""})
            </h3>
          </div>

          {/* View mode icons */}
          <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
            {VIEW_MODES.map(({ key, icon: Icon, label }) => (
              <TooltipProvider key={key}><Tooltip><TooltipTrigger asChild>
                <Button variant={viewMode === key ? "default" : "ghost"} size="sm"
                  className={cn("h-7 w-7 p-0", viewMode === key && "shadow-sm")}
                  onClick={() => changeViewMode(key)}>
                  <Icon className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger><TooltipContent side="bottom">{label}</TooltipContent></Tooltip></TooltipProvider>
            ))}
          </div>
        </div>

        {/* Search + Sort + Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="חיפוש פסקי דין..." className="h-8 pr-8 text-xs" dir="rtl" />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute left-2 top-1/2 -translate-y-1/2">
                <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <ArrowUpDown className="w-3 h-3" />
                {SORT_OPTIONS.find(s => s.key === sortField)?.label}
                {sortDir === "desc" ? <ArrowDown className="w-2.5 h-2.5" /> : <ArrowUp className="w-2.5 h-2.5" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>מיון לפי</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SORT_OPTIONS.map(({ key, label, icon: SIcon }) => (
                <DropdownMenuItem key={key} onClick={() => {
                  if (sortField === key) setSortDir(d => d === "asc" ? "desc" : "asc");
                  else { setSortField(key); setSortDir("desc"); }
                }} className="gap-2">
                  <SIcon className="w-3.5 h-3.5" />{label}
                  {sortField === key && (sortDir === "desc" ? <ArrowDown className="w-3 h-3 mr-auto" /> : <ArrowUp className="w-3 h-3 mr-auto" />)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {allTags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={filterTag ? "default" : "outline"} size="sm" className="h-8 text-xs gap-1.5">
                  <Tag className="w-3 h-3" />{filterTag || "תגיות"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-60 overflow-y-auto">
                <DropdownMenuItem onClick={() => setFilterTag(null)} className="gap-2"><X className="w-3 h-3" /> הכול</DropdownMenuItem>
                <DropdownMenuSeparator />
                {allTags.map(t => <DropdownMenuItem key={t} onClick={() => setFilterTag(t)}>{t}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {allCourts.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={filterCourt ? "default" : "outline"} size="sm" className="h-8 text-xs gap-1.5">
                  <Building2 className="w-3 h-3" />{filterCourt || "בית דין"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-60 overflow-y-auto">
                <DropdownMenuItem onClick={() => setFilterCourt(null)} className="gap-2"><X className="w-3 h-3" /> הכול</DropdownMenuItem>
                <DropdownMenuSeparator />
                {allCourts.map(c => <DropdownMenuItem key={c} onClick={() => setFilterCourt(c)}>{c}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-red-500 hover:text-red-600"
              onClick={() => { setSearchQuery(""); setFilterTag(null); setFilterCourt(null); }}>
              <X className="w-3 h-3" /> נקה סינון ({activeFilters})
            </Button>
          )}
        </div>
      </div>

      {/* No results */}
      {processedPsakim.length === 0 && (
        <Card className="p-6 text-center">
          <Search className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">לא נמצאו תוצאות</p>
        </Card>
      )}

      {/* ═══ LIST ═══ */}
      {viewMode === "list" && processedPsakim.length > 0 && (
        <div className="space-y-3">
          {visiblePsakim.map(psak => (
            <PsakCardList key={psak.id} psak={psak} expanded={expandedIds.has(psak.id)}
              onToggle={() => toggleExpand(psak.id)} onOpen={() => handleOpenPsak(psak)} onSplitView={() => handleSelectForSplit(psak)} />
          ))}
          {hasMore && <div ref={sentinelRef} className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        </div>
      )}

      {/* ═══ GRID ═══ */}
      {viewMode === "grid" && processedPsakim.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visiblePsakim.map(psak => (
            <PsakCardGrid key={psak.id} psak={psak} onOpen={() => handleOpenPsak(psak)} />
          ))}
          {hasMore && <div ref={sentinelRef} className="col-span-full flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        </div>
      )}

      {/* ═══ COMPACT ═══ */}
      {viewMode === "compact" && processedPsakim.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {visiblePsakim.map(psak => (
            <PsakCardCompact key={psak.id} psak={psak} onOpen={() => handleOpenPsak(psak)} />
          ))}
          {hasMore && <div ref={sentinelRef} className="col-span-full flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        </div>
      )}

      {/* ═══ TABLE ═══ */}
      {viewMode === "table" && processedPsakim.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-right px-3 py-2 font-semibold">#</th>
                  <th className="text-right px-3 py-2 font-semibold">כותרת</th>
                  <th className="text-right px-3 py-2 font-semibold">בית דין</th>
                  <th className="text-right px-3 py-2 font-semibold">שנה</th>
                  <th className="text-right px-3 py-2 font-semibold">הפניות</th>
                  <th className="text-right px-3 py-2 font-semibold">תגיות</th>
                  <th className="text-center px-3 py-2 font-semibold">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {visiblePsakim.map((psak, i) => (
                  <tr key={psak.id} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 font-medium max-w-[240px]"><span className="flex items-center gap-1 truncate"><SummaryToggle summary={psak.summary} compact /><FileTypeBadge url={psak.source_url} />{psak.title}</span></td>
                    <td className="px-3 py-2 text-muted-foreground">{psak.court}</td>
                    <td className="px-3 py-2">{psak.year}</td>
                    <td className="px-3 py-2"><Badge variant="secondary" className="text-[10px]">{psak.references.length}</Badge></td>
                    <td className="px-3 py-2 max-w-[140px]">
                      <div className="flex flex-wrap gap-0.5">
                        {psak.tags?.slice(0, 2).map((t, j) => <Badge key={j} variant="outline" className="text-[9px]">{t}</Badge>)}
                        {(psak.tags?.length ?? 0) > 2 && <Badge variant="outline" className="text-[9px]">+{psak.tags!.length - 2}</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex justify-center gap-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleOpenPsak(psak)}><Eye className="w-3 h-3" /></Button>
                        {psak.source_url && (
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" asChild>
                            <a href={psak.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3" /></a>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && <div ref={sentinelRef} className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
        </div>
      )}

      {/* ═══ MAGAZINE ═══ */}
      {viewMode === "magazine" && processedPsakim.length > 0 && (
        <div className="space-y-4">
          {visiblePsakim.length > 0 && <PsakCardMagazineFeatured psak={visiblePsakim[0]} onOpen={() => handleOpenPsak(visiblePsakim[0])} />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visiblePsakim.slice(1).map(psak => (
              <PsakCardMagazine key={psak.id} psak={psak} onOpen={() => handleOpenPsak(psak)} />
            ))}
          </div>
          {hasMore && <div ref={sentinelRef} className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        </div>
      )}

      {/* ═══ TIMELINE ═══ */}
      {viewMode === "timeline" && processedPsakim.length > 0 && (
        <div className="relative pr-6">
          <div className="absolute right-2.5 top-0 bottom-0 w-0.5 bg-border" />
          <div className="space-y-4">
            {visiblePsakim.map((psak, i) => (
              <PsakCardTimeline key={psak.id} psak={psak} index={i} onOpen={() => handleOpenPsak(psak)} />
            ))}
          </div>
          {hasMore && <div ref={sentinelRef} className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        </div>
      )}

      {/* ═══ KANBAN ═══ */}
      {viewMode === "kanban" && processedPsakim.length > 0 && (
        <ScrollArea dir="rtl">
          <div className="flex gap-3 pb-4 min-w-max">
            {kanbanGroups.map(([court, items]) => (
              <div key={court} className="w-72 shrink-0">
                <div className="bg-muted/50 rounded-t-lg px-3 py-2 border border-b-0 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-primary" />
                    <span className="font-semibold text-xs">{court}</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
                </div>
                <div className="border rounded-b-lg bg-background p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                  {items.map(psak => <PsakCardKanban key={psak.id} psak={psak} onOpen={() => handleOpenPsak(psak)} />)}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* ═══ SPLIT ═══ */}
      {viewMode === "split" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="overflow-hidden">
            <div className="p-3 border-b bg-muted/30 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">טקסט הגמרא — {dafYomi}</span>
            </div>
            <div className="h-[60vh] overflow-auto">
              <Suspense fallback={<div className="p-4 space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>}>
                <GemaraTextPanel sugyaId={sugyaId} dafYomi={dafYomi} masechet={masechet} />
              </Suspense>
            </div>
          </Card>
          <Card className="overflow-hidden">
            <div className="p-3 border-b bg-muted/30 flex items-center gap-2">
              <Scale className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm truncate">{selectedPsak?.title || "בחר פסק דין"}</span>
            </div>
            <ScrollArea className="border-b" dir="rtl">
              <div className="flex gap-1 p-2">
                {processedPsakim.map(p => (
                  <Button key={p.id} variant={selectedPsak?.id === p.id ? "default" : "ghost"} size="sm"
                    className="shrink-0 text-xs h-7 px-2" onClick={() => setSelectedPsak(p)}>
                    {p.title.length > 30 ? p.title.slice(0, 30) + "…" : p.title}
                  </Button>
                ))}
              </div>
            </ScrollArea>
            {selectedPsak ? (
              <ScrollArea className="h-[calc(60vh-80px)]" dir="rtl">
                <div className="p-4 space-y-4">
                  <div className="space-y-2">
                    <h3 className="text-base font-bold flex items-center gap-1.5 justify-end"><FileTypeBadge url={selectedPsak.source_url} size="sm" />{selectedPsak.title}</h3>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{selectedPsak.court}</span><span>•</span><span>{selectedPsak.year}</span>
                    </div>
                  </div>
                  <div className="bg-primary/5 rounded-lg p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-primary">הפניות לדף זה:</p>
                    {selectedPsak.references.map(ref => (
                      <div key={ref.id} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className={cn("text-[10px] shrink-0", ref.source === "ai" ? "border-blue-300 text-blue-700" : "border-amber-300 text-amber-700")}>
                          {ref.source === "ai" ? "AI" : "Regex"}
                        </Badge>
                        <span className="truncate">{ref.corrected_normalized || ref.normalized}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold mb-1">תקציר</h4>
                    <p className="text-sm leading-relaxed whitespace-pre-line">{selectedPsak.summary}</p>
                  </div>
                  <Button variant="default" size="sm" className="w-full gap-2" onClick={() => handleOpenPsak(selectedPsak)}>
                    <Eye className="w-3.5 h-3.5" /> פתח תצוגה מלאה
                  </Button>
                </div>
              </ScrollArea>
            ) : (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">בחר פסק דין מהרשימה למעלה</div>
            )}
          </Card>
        </div>
      )}

    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════ */

/* ─── List Card ─── */
function PsakCardList({ psak, expanded, onToggle, onOpen, onSplitView }: {
  psak: DafPsak; expanded: boolean; onToggle: () => void; onOpen: () => void; onSplitView: () => void;
}) {
  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <h4 className="text-sm font-bold leading-tight flex items-center gap-1.5 justify-end"><SummaryToggle summary={psak.summary} compact /><FileTypeBadge url={psak.source_url} />{psak.title}</h4>
            <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              <span>{psak.court}</span><span>•</span><span>{psak.year}</span>
              {psak.case_number && <><span>•</span><span className="font-mono">{psak.case_number}</span></>}
            </div>
          </div>
          <Badge variant="secondary" className="text-[10px] gap-1 shrink-0"><FileSearch className="w-3 h-3" />{psak.references.length} הפניות</Badge>
        </div>
        {psak.tags && psak.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {psak.tags.slice(0, 5).map((tag, i) => <Badge key={i} variant="outline" className="text-[10px]">{tag}</Badge>)}
            {psak.tags.length > 5 && <Badge variant="outline" className="text-[10px]">+{psak.tags.length - 5}</Badge>}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {psak.references.map(ref => (
            <Badge key={ref.id} variant="outline" className={cn("text-[10px]",
              ref.source === "ai" ? "border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300")}>
              {ref.source === "ai" ? <Brain className="w-2.5 h-2.5 mr-0.5" /> : <FileSearch className="w-2.5 h-2.5 mr-0.5" />}
              {ref.corrected_normalized || ref.normalized}
            </Badge>
          ))}
        </div>
        <div>
          <p className={cn("text-xs text-muted-foreground leading-relaxed", !expanded && "line-clamp-2")}>{psak.summary}</p>
          {psak.summary.length > 120 && (
            <button type="button" onClick={onToggle} className="text-xs text-primary hover:underline mt-0.5 flex items-center gap-0.5">
              {expanded ? <><ChevronUp className="w-3 h-3" /> פחות</> : <><ChevronDown className="w-3 h-3" /> עוד</>}
            </button>
          )}
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="default" size="sm" className="gap-1.5 text-xs h-8 flex-1" onClick={onOpen}><Eye className="w-3.5 h-3.5" />פתח פסק דין</Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8 flex-1" onClick={onSplitView}><Columns2 className="w-3.5 h-3.5" />תצוגה מקבילה</Button>
          {psak.source_url && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-8 px-2" asChild>
              <a href={psak.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5" /></a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Grid Card ─── */
function PsakCardGrid({ psak, onOpen }: { psak: DafPsak; onOpen: () => void }) {
  return (
    <Card className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group" onClick={onOpen}>
      <div className="h-1.5 bg-gradient-to-l from-primary/80 to-primary/30" />
      <CardContent className="p-3 space-y-2">
        <h4 className="text-xs font-bold leading-tight line-clamp-2 group-hover:text-primary transition-colors flex items-center gap-1 justify-end"><SummaryToggle summary={psak.summary} compact /><FileTypeBadge url={psak.source_url} />{psak.title}</h4>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Building2 className="w-3 h-3" /><span className="truncate">{psak.court}</span>
          <span>•</span><span>{psak.year}</span>
        </div>
        <p className="text-[10px] text-muted-foreground line-clamp-3 leading-relaxed">{psak.summary}</p>
        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-0.5">
            {psak.tags?.slice(0, 2).map((t, i) => <Badge key={i} variant="outline" className="text-[8px] px-1 py-0">{t}</Badge>)}
          </div>
          <Badge variant="secondary" className="text-[9px]">{psak.references.length} הפניות</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Compact Card ─── */
function PsakCardCompact({ psak, onOpen }: { psak: DafPsak; onOpen: () => void }) {
  return (
    <button onClick={onOpen}
      className="w-full text-right p-2.5 rounded-lg border hover:bg-muted/50 hover:border-primary/30 transition-all flex items-center gap-2 group">
      <FileTypeBadge url={psak.source_url} />
      <SummaryToggle summary={psak.summary} compact />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold truncate">{psak.title}</p>
        <p className="text-[9px] text-muted-foreground truncate">{psak.court} • {psak.year}</p>
      </div>
      <Badge variant="secondary" className="text-[8px] shrink-0">{psak.references.length}</Badge>
    </button>
  );
}

/* ─── Magazine Featured ─── */
function PsakCardMagazineFeatured({ psak, onOpen }: { psak: DafPsak; onOpen: () => void }) {
  return (
    <Card className="overflow-hidden hover:shadow-lg transition-all cursor-pointer" onClick={onOpen}>
      <div className="h-2 bg-gradient-to-l from-primary to-primary/40" />
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 flex-1 min-w-0">
            <Badge variant="default" className="text-[9px] mb-1">פסק מרכזי</Badge>
            <h3 className="text-base font-bold leading-tight flex items-center gap-1.5 justify-end"><SummaryToggle summary={psak.summary} /><FileTypeBadge url={psak.source_url} size="sm" />{psak.title}</h3>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{psak.court}</span>
              <span>{psak.year}</span>
              <Badge variant="secondary" className="text-[10px]">{psak.references.length} הפניות</Badge>
            </div>
          </div>
          <Scale className="w-10 h-10 text-primary/30 shrink-0" />
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">{psak.summary}</p>
        {psak.tags && psak.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {psak.tags.slice(0, 6).map((t, i) => <Badge key={i} variant="outline" className="text-[10px]">{t}</Badge>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Magazine Card ─── */
function PsakCardMagazine({ psak, onOpen }: { psak: DafPsak; onOpen: () => void }) {
  return (
    <Card className="overflow-hidden hover:shadow-md transition-all cursor-pointer group" onClick={onOpen}>
      <CardContent className="p-4 space-y-2">
        <h4 className="text-sm font-bold leading-tight group-hover:text-primary transition-colors line-clamp-2 flex items-center gap-1 justify-end"><SummaryToggle summary={psak.summary} compact /><FileTypeBadge url={psak.source_url} />{psak.title}</h4>
        <div className="flex gap-1.5 text-[10px] text-muted-foreground">
          <span>{psak.court}</span><span>•</span><span>{psak.year}</span>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">{psak.summary}</p>
        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-0.5">
            {psak.tags?.slice(0, 3).map((t, i) => <Badge key={i} variant="outline" className="text-[9px]">{t}</Badge>)}
          </div>
          <Badge variant="secondary" className="text-[9px]">{psak.references.length} הפניות</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Timeline Card ─── */
function PsakCardTimeline({ psak, index, onOpen }: { psak: DafPsak; index: number; onOpen: () => void }) {
  return (
    <div className="relative pr-6 cursor-pointer group" onClick={onOpen}>
      <div className={cn("absolute right-0 top-3 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[8px] font-bold z-10 transition-colors",
        index === 0 ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border group-hover:border-primary")}>
        {index + 1}
      </div>
      <Card className="overflow-hidden group-hover:shadow-md transition-all mr-4">
        <CardContent className="p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold leading-tight line-clamp-1 group-hover:text-primary transition-colors flex items-center gap-1"><SummaryToggle summary={psak.summary} compact /><FileTypeBadge url={psak.source_url} />{psak.title}</h4>
            <Badge variant="outline" className="text-[9px] shrink-0">{psak.year}</Badge>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Building2 className="w-3 h-3" /><span>{psak.court}</span>
            <span>•</span><span>{psak.references.length} הפניות</span>
          </div>
          <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">{psak.summary}</p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Kanban Card ─── */
function PsakCardKanban({ psak, onOpen }: { psak: DafPsak; onOpen: () => void }) {
  return (
    <button onClick={onOpen}
      className="w-full text-right p-2.5 rounded-lg border bg-background hover:shadow-sm hover:border-primary/30 transition-all space-y-1">
      <p className="text-[11px] font-semibold line-clamp-2 leading-tight flex items-center gap-1 justify-end"><SummaryToggle summary={psak.summary} compact /><FileTypeBadge url={psak.source_url} />{psak.title}</p>
      <div className="flex items-center justify-between text-[9px] text-muted-foreground">
        <span>{psak.year}</span>
        <Badge variant="secondary" className="text-[8px]">{psak.references.length}</Badge>
      </div>
      {psak.tags && psak.tags.length > 0 && (
        <div className="flex flex-wrap gap-0.5">
          {psak.tags.slice(0, 2).map((t, i) => <Badge key={i} variant="outline" className="text-[7px] px-1 py-0">{t}</Badge>)}
        </div>
      )}
    </button>
  );
}
