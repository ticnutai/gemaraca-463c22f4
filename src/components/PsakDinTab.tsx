import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { usePsakSources, enabledSourceKeys } from "@/hooks/usePsakSources";
import {
  Calendar, Building2, FileText, List, BookOpen, Sparkles, Brain, Loader2,
  Link, Plus, Pencil, Trash2, Download, Search, Filter, ArrowUpDown, FileSpreadsheet,
  Library,
  Paintbrush, FolderOpen,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import PsakDinViewDialog from "./PsakDinViewDialog";
import PsakPreviewPopover from "./PsakPreviewPopover";
import PsakDinEditDialog from "./PsakDinEditDialog";
import BulkActionsBar from "./BulkActionsBar";
import FileTypeBadge, { detectFileType } from "./FileTypeBadge";
import { FileType as LucideFileType } from "lucide-react";
import GemaraPsakDinIndex from "./GemaraPsakDinIndex";
import { getViewerPreference, setViewerPreference, type ViewerMode } from "./ViewerPreferenceDialog";
import { useToast } from "@/hooks/use-toast";
import { cachePsakim, getAllCachedPsakim, type CachedPsak } from "@/lib/psakCache";
import { exportPsakimToCsv } from "@/lib/csvExporter";
import { cn } from "@/lib/utils";
import { trackRecentPsak } from "@/lib/recentPsakim";
import type { PsakDinRow } from "@/types/psakDin";

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PAGE_SIZE = 50;
const SCROLL_POS_KEY = 'psak-list-scroll-pos';
const SCROLL_COUNT_KEY = 'psak-list-scroll-count';

const PsakDinTab = () => {
  const navigate = useNavigate();
  const [psakim, setPsakim] = useState<PsakDinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedPsak, setSelectedPsak] = useState<PsakDinRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedForAnalysis, setSelectedForAnalysis] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [psakLinks, setPsakLinks] = useState<Map<string, number>>(new Map());
  const [totalUnlinkedCount, setTotalUnlinkedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPsak, setEditingPsak] = useState<PsakDinRow | null>(null);
  const [isNewPsak, setIsNewPsak] = useState(false);
  const [selectedForBulk, setSelectedForBulk] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [courtFilter, setCourtFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const { data: psakSources } = usePsakSources();
  const [fileTypeFilter, setFileTypeFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<string>("year-desc");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [courts, setCourts] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const { toast } = useToast();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevSearchRef = useRef(searchQuery);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      // Only clear psakim when search actually changes (avoid race condition on mount)
      if (prevSearchRef.current !== searchQuery) {
        prevSearchRef.current = searchQuery;
        setPsakim([]);
        setHasMore(true);
      }
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset on filter/sort change
  useEffect(() => {
    setPsakim([]);
    setHasMore(true);
  }, [courtFilter, fileTypeFilter, sortOrder, categoryFilter, sourceFilter]);

  // Load courts for filter
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('psakei_din').select('court').order('court');
      if (data) setCourts([...new Set(data.map(r => r.court).filter(Boolean))].sort());
    })();
    // Load categories
    (async () => {
      const { data } = await supabase.from('psakei_din').select('category').not('category', 'is', null);
      if (data) setCategories([...new Set(data.map(r => r.category).filter(Boolean) as string[])].sort());
    })();
  }, []);

  const pendingScrollRestore = useRef<number | null>(null);
  const pendingScrollCount = useRef<number>(0);

  useEffect(() => {
    const savedPos = sessionStorage.getItem(SCROLL_POS_KEY);
    const savedCount = sessionStorage.getItem(SCROLL_COUNT_KEY);
    if (savedPos && savedCount) {
      pendingScrollRestore.current = Number(savedPos);
      const count = Math.max(PAGE_SIZE, Number(savedCount));
      pendingScrollCount.current = count;
      sessionStorage.removeItem(SCROLL_POS_KEY);
      sessionStorage.removeItem(SCROLL_COUNT_KEY);
      loadPsakim(0, true, count);
    } else {
      loadPsakim(0, true);
    }
    loadTotalUnlinkedCount();
  }, [debouncedSearch, courtFilter, fileTypeFilter, sortOrder, categoryFilter, sourceFilter, psakSources]);

  // Restore scroll position after returning from psak viewer
  useEffect(() => {
    if (!loading && pendingScrollRestore.current !== null && psakim.length >= pendingScrollCount.current) {
      const pos = pendingScrollRestore.current;
      pendingScrollRestore.current = null;
      pendingScrollCount.current = 0;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = pos;
          }
        });
      });
    }
  }, [loading, psakim.length]);

  // React Query for link counts
  const psakIds = psakim.map(p => p.id);
  const { data: linkCountsData } = useQuery({
    queryKey: ['psak-link-counts', psakIds],
    queryFn: async () => {
      if (psakIds.length === 0) return new Map<string, number>();
      const counts = new Map<string, number>();
      const { data, error } = await supabase
        .from('sugya_psak_links')
        .select('psak_din_id')
        .in('psak_din_id', psakIds);
      if (error) throw error;
      (data || []).forEach(link => {
        counts.set(link.psak_din_id, (counts.get(link.psak_din_id) || 0) + 1);
      });
      return counts;
    },
    enabled: psakIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (linkCountsData) {
      setPsakLinks(prev => {
        const merged = new Map(prev);
        linkCountsData.forEach((v, k) => merged.set(k, v));
        return merged;
      });
    }
  }, [linkCountsData]);

  const loadPsakim = useCallback(async (offset: number, isInitial: boolean, limitOverride?: number) => {
    if (isInitial) setLoading(true);
    else setLoadingMore(true);

    try {
      // Show cached data on first load (only without filters)
      if (isInitial && offset === 0 && !debouncedSearch && courtFilter === 'all') {
        const cached = await getAllCachedPsakim();
        if (cached.length > 0) {
          const sorted = cached.sort((a, b) => (b.year || 0) - (a.year || 0)).slice(0, PAGE_SIZE);
          setPsakim(sorted as unknown as PsakDinRow[]);
          setLoading(false);
        }
      }

      let ascending = false;
      let orderCol = 'year';
      switch (sortOrder) {
        case 'year-asc': orderCol = 'year'; ascending = true; break;
        case 'year-desc': orderCol = 'year'; ascending = false; break;
        case 'title-asc': orderCol = 'title'; ascending = true; break;
        case 'title-desc': orderCol = 'title'; ascending = false; break;
        case 'created-desc': orderCol = 'created_at'; ascending = false; break;
        case 'created-asc': orderCol = 'created_at'; ascending = true; break;
        case 'updated-desc': orderCol = 'updated_at'; ascending = false; break;
        case 'updated-asc': orderCol = 'updated_at'; ascending = true; break;
        case 'beautify-desc': orderCol = 'beautify_count'; ascending = false; break;
        case 'beautify-asc': orderCol = 'beautify_count'; ascending = true; break;
      }

      let query = supabase
        .from('psakei_din')
        .select('*', { count: 'exact' })
        .order(orderCol, { ascending });

      if (debouncedSearch) {
        query = query.or(`title.ilike.%${debouncedSearch}%,court.ilike.%${debouncedSearch}%,summary.ilike.%${debouncedSearch}%`);
      }
      if (courtFilter !== 'all') {
        query = query.eq('court', courtFilter);
      }
      // מקור הפסק: בחירה מפורשת, ואחרת רק המקורות שמסומנים להצגה במרשם
      if (sourceFilter !== 'all') {
        query = query.eq('source_key' as never, sourceFilter);
      } else {
        const allowed = enabledSourceKeys(psakSources);
        if (allowed) query = query.in('source_key' as never, allowed);
      }
      if (categoryFilter !== 'all') {
        if (categoryFilter === '__none__') {
          query = query.is('category', null);
        } else {
          query = query.eq('category', categoryFilter);
        }
      }

      // File type filter — done via source_url patterns
      if (fileTypeFilter === 'pdf') {
        query = query.like('source_url', '%.pdf%');
      } else if (fileTypeFilter === 'word') {
        query = query.or('source_url.like.%.doc%,source_url.like.%.docx%,source_url.like.%.rtf%,source_url.like.%.odt%');
      } else if (fileTypeFilter === 'text') {
        query = query.or('source_url.like.%.txt%,source_url.like.%.text%,source_url.like.%.md%,source_url.like.%.csv%');
      } else if (fileTypeFilter === 'html') {
        // HTML = has source_url but NOT pdf/doc/txt
        query = query.not('source_url', 'is', null)
          .not('source_url', 'like', '%.pdf%')
          .not('source_url', 'like', '%.doc%')
          .not('source_url', 'like', '%.txt%');
      } else if (fileTypeFilter === 'none') {
        query = query.is('source_url', null);
      }

      const limit = limitOverride || PAGE_SIZE;
      const { data, error, count } = await query.range(offset, offset + limit - 1);

      if (error) throw error;

      const newData = data || [];
      setTotalCount(count || 0);
      setHasMore(newData.length === limit);

      if (isInitial) {
        setPsakim(newData);
      } else {
        setPsakim(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          const unique = newData.filter(i => !existingIds.has(i.id));
          return [...prev, ...unique];
        });
      }

      // Cache
      if (newData.length > 0) {
        const toCache: CachedPsak[] = newData.map((p) => ({
          id: p.id, title: p.title, court: p.court || '', year: p.year || 0,
          summary: p.summary || '', full_text: p.full_text || null,
          source_url: p.source_url || null, case_number: p.case_number || null,
          tags: p.tags || [], _cachedAt: Date.now(),
        }));
        cachePsakim(toCache);
      }
    } catch (error) {
      console.error('Error loading psakim:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch, courtFilter, fileTypeFilter, sortOrder, categoryFilter]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          loadPsakim(psakim.length, false);
        }
      },
      { root: scrollContainerRef.current, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, psakim.length, loadPsakim]);

  const loadTotalUnlinkedCount = async () => {
    try {
      const { count: totalPsakim } = await supabase
        .from('psakei_din')
        .select('*', { count: 'exact', head: true });
      const { count: linkedCount } = await supabase
        .from('sugya_psak_links')
        .select('psak_din_id', { count: 'exact', head: true });
      setTotalUnlinkedCount(Math.max(0, (totalPsakim || 0) - (linkedCount || 0)));
    } catch (error) {
      console.error('Error loading unlinked count:', error);
    }
  };

  const handlePsakClick = (psak: PsakDinRow) => {
    // Save scroll position and loaded item count before navigating
    if (scrollContainerRef.current) {
      sessionStorage.setItem(SCROLL_POS_KEY, String(scrollContainerRef.current.scrollTop));
      sessionStorage.setItem(SCROLL_COUNT_KEY, String(psakim.length));
    }

    // Track as recently viewed for home page "פסקי דין אחרונים"
    trackRecentPsak(psak.id);

    const sourceUrl = psak.source_url;
    const preferred = getViewerPreference() ?? "embedpdf";

    if (preferred === "newwindow" && sourceUrl) {
      window.open(sourceUrl, "_blank");
      return;
    }

    if (preferred === "embedpdf") {
      navigate(`/embedpdf-viewer?${sourceUrl ? `url=${encodeURIComponent(sourceUrl)}&` : ''}psakId=${psak.id}`);
      return;
    }

    setSelectedPsak(psak);
    setDialogOpen(true);
  };

  const handleSwitchViewer = (psak: PsakDinRow, e: React.MouseEvent) => {
    e.stopPropagation();
    // Save scroll position and loaded item count before navigating
    if (scrollContainerRef.current) {
      sessionStorage.setItem(SCROLL_POS_KEY, String(scrollContainerRef.current.scrollTop));
      sessionStorage.setItem(SCROLL_COUNT_KEY, String(psakim.length));
    }
    const current = getViewerPreference() ?? "embedpdf";
    const next: ViewerMode = current === "dialog" ? "embedpdf" : "dialog";
    setViewerPreference(next);

    if (next === "embedpdf") {
      navigate(`/embedpdf-viewer?${psak.source_url ? `url=${encodeURIComponent(psak.source_url)}&` : ''}psakId=${psak.id}`);
      return;
    }

    setSelectedPsak(psak);
    setDialogOpen(true);
  };

  const handleEditPsak = (psakId: string) => {
    const psak = psakim.find(p => p.id === psakId);
    if (psak) {
      setEditingPsak(psak);
      setIsNewPsak(false);
      setEditDialogOpen(true);
    }
  };

  const handleAddNew = () => {
    setEditingPsak(null);
    setIsNewPsak(true);
    setEditDialogOpen(true);
  };

  const handleEditSaved = () => {
    loadPsakim(0, true);
    // Refresh categories list
    (async () => {
      const { data } = await supabase.from('psakei_din').select('category').not('category', 'is', null);
      if (data) setCategories([...new Set(data.map(r => r.category).filter(Boolean) as string[])].sort());
    })();
  };

  const handleDeletePsak = async (psakId?: string) => {
    if (psakId) {
      // Single delete
      try {
        await supabase.from('sugya_psak_links').delete().eq('psak_din_id', psakId);
        await supabase.from('pattern_sugya_links').delete().eq('psak_din_id', psakId);
        await supabase.from('talmud_references').delete().eq('psak_din_id', psakId);
        await supabase.from('psakei_din').delete().eq('id', psakId);
        setPsakim(prev => prev.filter(p => p.id !== psakId));
        setTotalCount(prev => prev - 1);
        toast({ title: 'פסק הדין נמחק בהצלחה' });
      } catch (err) {
        toast({ title: 'שגיאה במחיקה', variant: 'destructive' });
      }
    } else {
      loadPsakim(0, true);
      loadTotalUnlinkedCount();
    }
  };

  const handleDownloadSingle = (psak: PsakDinRow) => {
    const content = psak.full_text || psak.summary || '';
    const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"><title>${escapeHtml(psak.title)}</title>
<style>body{font-family:'David',serif;max-width:800px;margin:0 auto;padding:20px;direction:rtl;line-height:1.8}h1{color:#1a365d;border-bottom:2px solid #2b6cb0;padding-bottom:10px}.meta{background:#f7fafc;padding:12px;border-radius:8px;margin-bottom:20px;color:#4a5568}.content{white-space:pre-wrap}</style>
</head><body><h1>${escapeHtml(psak.title)}</h1><div class="meta"><span>בית דין: ${escapeHtml(psak.court)}</span>${psak.year > 0 ? ` <span>שנה: ${psak.year}</span>` : ''}</div><div class="content">${escapeHtml(content)}</div></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${psak.title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 80)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const toggleBulkSelect = (id: string) => {
    setSelectedForBulk(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const selectAllForBulk = async () => {
    setSelectingAll(true);
    try {
      const BATCH = 1000;
      const allIds: string[] = [];
      let offset = 0;
      while (true) {
        let query = supabase
          .from('psakei_din')
          .select('id')
          .range(offset, offset + BATCH - 1);
        if (debouncedSearch) {
          query = query.or(`title.ilike.%${debouncedSearch}%,court.ilike.%${debouncedSearch}%,summary.ilike.%${debouncedSearch}%`);
        }
        if (courtFilter !== 'all') query = query.eq('court', courtFilter);
        if (fileTypeFilter !== 'all') {
          if (fileTypeFilter === 'pdf') query = query.like('source_url', '%.pdf%');
          else if (fileTypeFilter === 'word') query = query.or('source_url.like.%.doc%,source_url.like.%.docx%,source_url.like.%.rtf%,source_url.like.%.odt%');
          else if (fileTypeFilter === 'text') query = query.or('source_url.like.%.txt%,source_url.like.%.text%,source_url.like.%.md%,source_url.like.%.csv%');
          else if (fileTypeFilter === 'html') query = query.not('source_url', 'is', null).not('source_url', 'like', '%.pdf%').not('source_url', 'like', '%.doc%').not('source_url', 'like', '%.txt%');
          else if (fileTypeFilter === 'none') query = query.is('source_url', null);
        }
        const { data } = await query;
        if (!data || data.length === 0) break;
        allIds.push(...data.map(d => d.id));
        if (data.length < BATCH) break;
        offset += BATCH;
      }
      setSelectedForBulk(new Set(allIds));
    } finally {
      setSelectingAll(false);
    }
  };

  const clearBulkSelection = () => {
    setSelectedForBulk(new Set());
  };

  const toggleSelectForAnalysis = useCallback((id: string) => {
    setSelectedForAnalysis(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  }, []);

  const selectAllForAnalysis = () => {
    const unlinkedPsakim = psakim.filter(p => !psakLinks.has(p.id));
    if (selectedForAnalysis.size === unlinkedPsakim.length) {
      setSelectedForAnalysis(new Set());
    } else {
      setSelectedForAnalysis(new Set(unlinkedPsakim.map(p => p.id)));
    }
  };

  const runAIAnalysis = async () => {
    if (selectedForAnalysis.size === 0) {
      toast({ title: "בחר פסקי דין לניתוח", variant: "destructive" });
      return;
    }
    setAnalyzing(true);
    const idsToAnalyze = Array.from(selectedForAnalysis);
    setAnalysisProgress({ current: 0, total: idsToAnalyze.length });
    let successCount = 0;
    let failedCount = 0;
    for (let i = 0; i < idsToAnalyze.length; i++) {
      setAnalysisProgress({ current: i + 1, total: idsToAnalyze.length });
      try {
        const { error } = await supabase.functions.invoke('analyze-psak-din', {
          body: { psakId: idsToAnalyze[i] }
        });
        if (!error) successCount++;
        else failedCount++;
      } catch (err) {
        console.error(`Error analyzing psak ${idsToAnalyze[i]}:`, err);
        failedCount++;
      }
      if (i < idsToAnalyze.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
    }
    setAnalyzing(false);
    setSelectedForAnalysis(new Set());
    await loadTotalUnlinkedCount();
    await loadPsakim(0, true);
    toast({
      title: "ניתוח AI הושלם",
      description: `נותחו ${successCount} פסקי דין בהצלחה${failedCount > 0 ? ` (${failedCount} נכשלו)` : ''}`,
      variant: failedCount > 0 ? 'destructive' : 'default',
    });
  };

  const displayedUnlinkedCount = psakim.filter(p => !psakLinks.has(p.id)).length;

  return (
    <div className="container mx-auto px-4 py-8" dir="rtl">
      <div className="max-w-6xl mx-auto">
        <Tabs defaultValue="recent" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2 ml-auto">
            <TabsTrigger value="recent" className="gap-2 flex-row-reverse">
              פסקי דין אחרונים
              <List className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger value="index" className="gap-2 flex-row-reverse">
              אינדקס לפי מסכתות
              <BookOpen className="w-4 h-4" />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="recent">
            {loading && psakim.length === 0 ? (
              <div className="space-y-4 py-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-4 border rounded-lg">
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                    <Skeleton className="h-8 w-20" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="max-w-4xl mx-auto space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-4 flex-row-reverse">
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold text-foreground">פסקי דין</h2>
                    <Badge variant="secondary">{totalCount.toLocaleString()} פסקים</Badge>
                    <Button size="sm" onClick={handleAddNew} className="gap-2">
                      <Plus className="w-4 h-4" />
                      הוסף
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => exportPsakimToCsv(psakim)}
                      disabled={psakim.length === 0}
                      className="gap-2"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      ייצא CSV
                    </Button>
                  </div>
                  {totalUnlinkedCount > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        {totalUnlinkedCount} פסקים ללא קישור
                      </span>
                      {selectedForAnalysis.size > 0 && (
                        <Button size="sm" onClick={runAIAnalysis} disabled={analyzing} className="gap-2 flex-row-reverse">
                          {analyzing ? (<><span>מנתח...</span><Loader2 className="w-4 h-4 animate-spin" /></>) : (<><span>נתח {selectedForAnalysis.size} פסקים</span><Sparkles className="w-4 h-4" /></>)}
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Search & Filter Bar */}
                <div className="flex flex-wrap gap-3 items-center bg-muted/30 rounded-lg p-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="חיפוש לפי כותרת, בית דין, תקציר..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pr-9"
                    />
                  </div>
                  <Select value={courtFilter} onValueChange={setCourtFilter}>
                    <SelectTrigger className="w-[170px]">
                      <Filter className="w-4 h-4 ml-2" />
                      <SelectValue placeholder="בית דין" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">כל בתי הדין</SelectItem>
                      {courts.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="w-[190px]">
                      <Library className="w-4 h-4 ml-2" />
                      <SelectValue placeholder="מקור" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">כל המקורות</SelectItem>
                      {(psakSources ?? []).filter(s => (s.count ?? 0) > 0).map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label} ({s.count?.toLocaleString('he-IL')})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={fileTypeFilter} onValueChange={setFileTypeFilter}>
                    <SelectTrigger className="w-[140px]">
                      <LucideFileType className="w-4 h-4 ml-2" />
                      <SelectValue placeholder="סוג קובץ" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">כל הסוגים</SelectItem>
                      <SelectItem value="pdf">PDF</SelectItem>
                      <SelectItem value="html">HTML</SelectItem>
                      <SelectItem value="word">Word</SelectItem>
                      <SelectItem value="text">טקסט</SelectItem>
                      <SelectItem value="none">ללא קובץ</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-[160px]">
                      <FolderOpen className="w-4 h-4 ml-2" />
                      <SelectValue placeholder="תיקייה" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">כל התיקיות</SelectItem>
                      <SelectItem value="__none__">ללא תיקייה</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={sortOrder} onValueChange={setSortOrder}>
                    <SelectTrigger className="w-[170px]">
                      <ArrowUpDown className="w-4 h-4 ml-2" />
                      <SelectValue placeholder="מיון" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="year-desc">שנה (חדש→ישן)</SelectItem>
                      <SelectItem value="year-asc">שנה (ישן→חדש)</SelectItem>
                      <SelectItem value="title-asc">שם (א-ת)</SelectItem>
                      <SelectItem value="title-desc">שם (ת-א)</SelectItem>
                      <SelectItem value="created-desc">העלאה (חדש→ישן)</SelectItem>
                      <SelectItem value="created-asc">העלאה (ישן→חדש)</SelectItem>
                      <SelectItem value="updated-desc">עדכון אחרון (חדש→ישן)</SelectItem>
                      <SelectItem value="updated-asc">עדכון אחרון (ישן→חדש)</SelectItem>
                      <SelectItem value="beautify-desc">עיצוב (הכי מעוצב)</SelectItem>
                      <SelectItem value="beautify-asc">עיצוב (הכי פחות)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Bulk Actions Bar */}
                <BulkActionsBar
                  selectedCount={selectedForBulk.size}
                  totalCount={totalCount}
                  onSelectAll={selectAllForBulk}
                  onClearSelection={clearBulkSelection}
                  selectedIds={Array.from(selectedForBulk)}
                  onDeleted={() => handleDeletePsak()}
                  selectingAll={selectingAll}
                />

                {/* Analysis Progress */}
                {analyzing && (
                  <Card className="border border-primary/30 bg-primary/5">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-2 flex-row-reverse">
                        <Brain className="w-5 h-5 text-primary animate-pulse" />
                        <span className="font-medium">מנתח פסקי דין באמצעות AI...</span>
                        <span className="ml-auto text-sm">{analysisProgress.current}/{analysisProgress.total}</span>
                      </div>
                      <Progress value={(analysisProgress.current / analysisProgress.total) * 100} className="h-2" />
                    </CardContent>
                  </Card>
                )}

                {/* Select All for Analysis */}
                {displayedUnlinkedCount > 0 && !analyzing && (
                  <Card className="border border-accent/30 bg-accent/5">
                    <CardContent className="p-3 flex items-center justify-between flex-row-reverse">
                      <div className="flex items-center gap-3 flex-row-reverse">
                        <Sparkles className="w-5 h-5 text-accent" />
                        <div className="text-right">
                          <p className="font-medium text-sm">ניתוח AI לפסקי דין קיימים</p>
                          <p className="text-xs text-muted-foreground">בחר פסקי דין לניתוח וקישור אוטומטי למקורות גמרא</p>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={selectAllForAnalysis}>
                        {selectedForAnalysis.size === displayedUnlinkedCount ? 'בטל בחירה' : `בחר הכל (${displayedUnlinkedCount})`}
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Items list - infinite scroll */}
                {psakim.length === 0 ? (
                  <Card className="border-dashed border-2">
                    <CardContent className="p-12 text-center">
                      <FileText className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                      <h3 className="text-lg font-medium text-muted-foreground mb-2">אין פסקי דין עדיין</h3>
                      <p className="text-sm text-muted-foreground mb-4">התחל בהעלאת פסקי דין כדי לראות אותם כאן</p>
                      <Button onClick={handleAddNew} className="gap-2">
                        <Plus className="w-4 h-4" />
                        הוסף פסק דין ראשון
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div
                    ref={scrollContainerRef}
                    className="max-h-[70vh] overflow-y-auto space-y-4 pr-1"
                  >
                    {psakim.map((psak) => {
                      const hasLinks = psakLinks.has(psak.id);
                      const linkCount = psakLinks.get(psak.id) || 0;
                      const isSelected = selectedForAnalysis.has(psak.id);
                      const isHovered = hoveredId === psak.id;

                      return (
                        <Card
                          key={psak.id}
                          className={cn(
                            "border shadow-sm hover:shadow-md transition-all relative",
                            isSelected && "border-accent ring-1 ring-accent",
                            selectedForBulk.has(psak.id) && "border-primary ring-1 ring-primary"
                          )}
                          onMouseEnter={() => setHoveredId(psak.id)}
                          onMouseLeave={() => setHoveredId(null)}
                        >
                          <CardContent className="p-4">
                            {/* Top Row: Title + Hover Actions */}
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div className="flex-1 cursor-pointer" onClick={() => handlePsakClick(psak)}>
                                <h3 className="text-lg font-semibold text-foreground text-right mb-2 leading-tight flex items-center gap-2 justify-end">
                                  {Number((psak as Record<string, unknown>).beautify_count) > 0 && (
                                    <Badge className="gap-1 text-[10px] px-1.5 py-0.5 bg-amber-500/15 text-amber-600 border border-amber-500/30 dark:text-amber-400">
                                      <Paintbrush className="w-3 h-3" />
                                      עוצב {Number((psak as Record<string, unknown>).beautify_count)}
                                    </Badge>
                                  )}
                                  {psak.tags?.includes('psakim.org') && (
                                    <Badge className="text-[10px] px-1.5 py-0.5 bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 dark:text-emerald-400">
                                      psakim.org
                                    </Badge>
                                  )}
                                  <FileTypeBadge url={psak.source_url} size="sm" />
                                  {psak.title}
                                </h3>
                                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground justify-end">
                                  <div className="flex items-center gap-1">
                                    <span>{psak.court}</span>
                                    <Building2 className="w-3.5 h-3.5 text-primary" />
                                  </div>
                                  {psak.year > 0 && (
                                  <div className="flex items-center gap-1">
                                    <span>{psak.year}</span>
                                    <Calendar className="w-3.5 h-3.5 text-primary" />
                                  </div>
                                  )}
                                  {psak.case_number && (
                                    <div className="flex items-center gap-1">
                                      <span>{psak.case_number}</span>
                                      <FileText className="w-3.5 h-3.5 text-primary" />
                                    </div>
                                  )}
                                  {psak.category && (
                                    <div className="flex items-center gap-1">
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-600 border-blue-500/30 dark:text-blue-400 gap-1">
                                        <FolderOpen className="w-3 h-3" />
                                        {psak.category}
                                      </Badge>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Hover action icons + checkbox */}
                              <div className="flex items-center gap-1 shrink-0">
                                {/* Hover icons - only visible on hover */}
                                <div className={cn(
                                  "flex items-center gap-0.5 transition-opacity duration-150",
                                  isHovered ? "opacity-100" : "opacity-0 pointer-events-none"
                                )}>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    title="החלף צפיין"
                                    onClick={(e) => handleSwitchViewer(psak, e)}
                                  >
                                    <ArrowUpDown className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    title="ערוך שם"
                                    onClick={(e) => { e.stopPropagation(); handleEditPsak(psak.id); }}
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    title="מחק"
                                    onClick={(e) => { e.stopPropagation(); handleDeletePsak(psak.id); }}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    title="הורד"
                                    onClick={(e) => { e.stopPropagation(); handleDownloadSingle(psak); }}
                                  >
                                    <Download className="w-4 h-4" />
                                  </Button>
                                </div>

                                <Checkbox
                                  checked={selectedForBulk.has(psak.id)}
                                  onCheckedChange={() => toggleBulkSelect(psak.id)}
                                  onClick={(e) => e.stopPropagation()}
                                />

                                {!hasLinks && !analyzing && (
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => toggleSelectForAnalysis(psak.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    title="בחר לניתוח AI"
                                  />
                                )}
                              </div>
                            </div>

                            {/* Summary */}
                            {(() => {
                              const cs = (psak as Record<string, unknown>).case_summary as string | null;
                              const displaySummary = (cs && cs.length > 10) ? cs :
                                (psak.summary && !psak.summary.startsWith('פסק דין שהועלה מהקובץ')) ? psak.summary : null;
                              return displaySummary ? (
                                <p
                                  className="text-foreground mb-4 line-clamp-2 text-right cursor-pointer"
                                  onClick={() => handlePsakClick(psak)}
                                >
                                  {displaySummary}
                                </p>
                              ) : null;
                            })()}

                            {/* Bottom Row: Status + Tags */}
                            <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
                              <div className="flex flex-wrap gap-1.5 flex-1 justify-end">
                                {psak.tags && psak.tags.slice(0, 4).map((tag: string, idx: number) => (
                                  <Badge key={idx} variant="secondary" className="text-xs px-2 py-0.5 bg-muted/60 text-muted-foreground">
                                    {tag}
                                  </Badge>
                                ))}
                                {psak.tags && psak.tags.length > 4 && (
                                  <Badge variant="outline" className="text-xs px-2 py-0.5">+{psak.tags.length - 4}</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <PsakPreviewPopover psakDinId={psak.id} psakTitle={psak.title} mode="facts" />
                                <PsakPreviewPopover psakDinId={psak.id} psakTitle={psak.title} mode="summary" />
                                {hasLinks ? (
                                  <Badge className="gap-1.5 text-xs px-2.5 py-1 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">
                                    <Link className="w-3 h-3" />
                                    <span>{linkCount} קישורים</span>
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs px-2.5 py-1 text-muted-foreground border-dashed">לא מנותח</Badge>
                                )}
                                {!hasLinks && !analyzing && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      setSelectedForAnalysis(new Set([psak.id]));
                                      await runAIAnalysis();
                                    }}
                                    className="h-7 px-2 gap-1 text-xs"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span>נתח</span>
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}

                    {/* Sentinel for infinite scroll */}
                    {hasMore && (
                      <div ref={sentinelRef} className="p-4 flex justify-center">
                        {loadingMore && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-sm">טוען עוד...</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Loaded count */}
                {psakim.length > 0 && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    מוצגים {psakim.length.toLocaleString()} מתוך {totalCount.toLocaleString()} פסקי דין
                  </p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="index">
            <GemaraPsakDinIndex />
          </TabsContent>
        </Tabs>

        <PsakDinViewDialog psak={selectedPsak} open={dialogOpen} onOpenChange={setDialogOpen} />
        <PsakDinEditDialog psak={editingPsak} open={editDialogOpen} onOpenChange={setEditDialogOpen} onSaved={handleEditSaved} isNew={isNewPsak} />
      </div>
    </div>
  );
};

export default PsakDinTab;
