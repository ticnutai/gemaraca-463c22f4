import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  BookOpen, ChevronLeft, Scale, Sparkles, ArrowRight,
  Loader2, Crown, Star, Flame, TrendingUp,
  Building2, Calendar, Download, ExternalLink,
  X, Minus, Maximize2, Minimize2, Compass, GripVertical,
  CheckCircle2, BookOpenCheck, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SEDARIM, getMasechtotBySeder, MASECHTOT, Masechet } from "@/lib/masechtotData";
import { toHebrewNumeral } from "@/lib/hebrewNumbers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "@/contexts/AppContext";
import { useQuery } from "@tanstack/react-query";
import PsakDinViewDialog from "./PsakDinViewDialog";
import FileTypeBadge from "./FileTypeBadge";
import SummaryToggle from "./SummaryToggle";
import { useExplorerPanelStore, PanelLayout } from "@/stores/explorerPanelStore";
import { useGemaraDownloadStore } from "@/stores/gemaraDownloadStore";
import { buildMasechetJob, buildSederJob, buildShasJob } from "@/hooks/useGemaraDownloadEngine";
import { useToast } from "@/hooks/use-toast";

// ─── Types ──────────────────────────────────────────────
type Step = "sedarim" | "masechtot" | "dafim" | "amudim" | "psakim";

interface PsakCount {
  [masechetSefaria: string]: {
    total: number;
    byDaf: { [daf: number]: number };
    byAmud: { [key: string]: number };
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

// ─── Seder config ───────────────────────────────────────
const SEDER_META: Record<string, { icon: typeof BookOpen; gradient: string; glow: string }> = {
  "זרעים": { icon: Sparkles, gradient: "from-emerald-500/20 to-green-600/10", glow: "shadow-emerald-500/20" },
  "מועד":  { icon: Star,     gradient: "from-amber-500/20 to-yellow-600/10",  glow: "shadow-amber-500/20" },
  "נשים":  { icon: Crown,    gradient: "from-rose-500/20 to-pink-600/10",     glow: "shadow-rose-500/20" },
  "נזיקין": { icon: Scale,   gradient: "from-blue-500/20 to-indigo-600/10",   glow: "shadow-blue-500/20" },
  "קדשים": { icon: Flame,    gradient: "from-orange-500/20 to-red-600/10",    glow: "shadow-orange-500/20" },
  "טהרות": { icon: TrendingUp, gradient: "from-cyan-500/20 to-teal-600/10",   glow: "shadow-cyan-500/20" },
};

// ─── Constants ──────────────────────────────────────────
const MIN_W = 340;
const MIN_H = 300;

// ─── Component ──────────────────────────────────────────
export default function FloatingExplorerPanel() {
  const navigate = useNavigate();
  const { setSelectedMasechet, setActiveTab } = useAppContext();
  const { isOpen, toggle, close, layout, setLayout, syncFromCloud } = useExplorerPanelStore();

  // Navigation state
  const [step, setStep] = useState<Step>("sedarim");
  const [selectedSeder, setSelectedSeder] = useState<string | null>(null);
  const [selectedMasechetLocal, setSelectedMasechetLocal] = useState<Masechet | null>(null);
  const [selectedDaf, setSelectedDaf] = useState<number | null>(null);
  const [selectedAmud, setSelectedAmud] = useState<"a" | "b" | null>(null);
  const [dafPsakim, setDafPsakim] = useState<DafPsak[]>([]);
  const [loadingPsakim, setLoadingPsakim] = useState(false);
  const [viewPsak, setViewPsak] = useState<DafPsak | null>(null);
  const [viewPsakOpen, setViewPsakOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [showShasInfo, setShowShasInfo] = useState(false);

  // Download
  const enqueueJobRaw = useGemaraDownloadStore((s) => s.enqueueJob);
  const { toast: downloadToast } = useToast();
  const enqueueJob = async (job: Parameters<typeof enqueueJobRaw>[0]) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      downloadToast({ title: "נדרשת התחברות", description: "יש להתחבר למערכת לפני הורדת דפים", variant: "destructive" });
      return;
    }
    enqueueJobRaw(job);
  };

  // Refs
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; lx: number; ly: number; sl: PanelLayout } | null>(null);
  const resizeRef = useRef<{ dir: string; sx: number; sy: number; sl: PanelLayout } | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Cloud sync on mount
  useEffect(() => { syncFromCloud(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Center panel on first open if position is -1
  const isMobile = useIsMobile();
  const resolvedLayout = useMemo(() => {
    const l = { ...layout };
    // On a phone the saved desktop geometry never fits; use the whole width
    // and leave the bottom strip to the floating buttons.
    if (isMobile) {
      return { ...l, x: 0, y: 0, w: window.innerWidth, h: Math.max(320, window.innerHeight - 88) };
    }
    if (l.x < 0 || l.y < 0) {
      l.x = Math.max(20, (window.innerWidth - l.w) / 2);
      l.y = Math.max(20, (window.innerHeight - l.h) / 2);
    }
    return l;
  }, [layout, isMobile]);

  // ─── Loaded pages query (from gemara_pages + shas_download_progress) ──
  const { data: loadedPages = {} } = useQuery<Record<string, Set<string>>>({
    queryKey: ["explorer-loaded-pages"],
    queryFn: async () => {
      // Use shas_download_progress as source of truth for completion
      const { data: progressData } = await supabase
        .from("shas_download_progress")
        .select("masechet, loaded_pages, total_pages, status");

      const result: Record<string, Set<string>> = {};

      // For completed masechtot, mark all pages as loaded
      for (const row of (progressData || [])) {
        if (row.status === "completed" || row.status === "done") {
          const m = MASECHTOT.find(ms => ms.hebrewName === row.masechet || ms.sefariaName === row.masechet);
          if (m) {
            result[m.sefariaName] = new Set<string>();
            for (let daf = 2; daf <= m.maxDaf; daf++) {
              result[m.sefariaName].add(`${daf}a`);
              result[m.sefariaName].add(`${daf}b`);
            }
          }
        }
      }

      // Also query gemara_pages for specific loaded pages
      const { data: pages } = await supabase
        .from("gemara_pages")
        .select("sugya_id, masechet")
        .limit(1000);

      // If we hit limit, do batched fetch
      let allPages = pages || [];
      if (allPages.length === 1000) {
        let offset = 1000;
        let more = true;
        while (more) {
          const { data: batch } = await supabase
            .from("gemara_pages")
            .select("sugya_id, masechet")
            .range(offset, offset + 999);
          if (batch && batch.length > 0) {
            allPages = [...allPages, ...batch];
            offset += batch.length;
            if (batch.length < 1000) more = false;
          } else {
            more = false;
          }
        }
      }

      for (const page of allPages) {
        const m = MASECHTOT.find(ms =>
          ms.sefariaName === page.masechet ||
          ms.hebrewName === page.masechet ||
          page.sugya_id?.toLowerCase().startsWith(ms.sefariaName.toLowerCase() + "_")
        );
        if (m) {
          if (!result[m.sefariaName]) result[m.sefariaName] = new Set<string>();
          // Extract daf+amud from sugya_id like "bava_batra_2a"
          const prefix = m.sefariaName.toLowerCase() + "_";
          if (page.sugya_id?.toLowerCase().startsWith(prefix)) {
            const rest = page.sugya_id.slice(prefix.length);
            result[m.sefariaName].add(rest);
          }
        }
      }

      return result;
    },
    staleTime: 2 * 60 * 1000,
    enabled: isOpen,
  });

  // Compute loaded counts per masechet
  const masechetLoadedCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [key, pages] of Object.entries(loadedPages)) {
      counts[key] = pages.size;
    }
    return counts;
  }, [loadedPages]);

  // ─── Psak counts query ────────────────────────────────
  const { data: psakCounts = {} } = useQuery<PsakCount>({
    queryKey: ["floating-explorer-psak-counts"],
    queryFn: async () => {
      const counts: PsakCount = {};
      const [sugyaRes, patternRes] = await Promise.all([
        supabase.from("sugya_psak_links").select("sugya_id"),
        supabase.from("pattern_sugya_links").select("masechet, daf"),
      ]);

      (sugyaRes.data || []).forEach((link: { sugya_id?: string }) => {
        const sugyaId = link.sugya_id || "";
        for (const m of MASECHTOT) {
          const prefix = m.sefariaName.toLowerCase() + "_";
          if (sugyaId.toLowerCase().startsWith(prefix)) {
            const rest = sugyaId.slice(prefix.length);
            const match = rest.match(/^(\d+)([ab])?/);
            if (match) {
              const dafNum = parseInt(match[1]);
              const amud = match[2] || "a";
              if (!counts[m.sefariaName]) counts[m.sefariaName] = { total: 0, byDaf: {}, byAmud: {} };
              counts[m.sefariaName].total++;
              counts[m.sefariaName].byDaf[dafNum] = (counts[m.sefariaName].byDaf[dafNum] || 0) + 1;
              const amudKey = `${dafNum}${amud}`;
              counts[m.sefariaName].byAmud[amudKey] = (counts[m.sefariaName].byAmud[amudKey] || 0) + 1;
            }
            break;
          }
        }
      });

      (patternRes.data || []).forEach((link: { masechet?: string; daf?: string }) => {
        const m = MASECHTOT.find((ms) => ms.hebrewName === link.masechet);
        if (m && link.daf) {
          const dafNum = parseInt(link.daf);
          if (!counts[m.sefariaName]) counts[m.sefariaName] = { total: 0, byDaf: {}, byAmud: {} };
          counts[m.sefariaName].total++;
          counts[m.sefariaName].byDaf[dafNum] = (counts[m.sefariaName].byDaf[dafNum] || 0) + 1;
        }
      });

      return counts;
    },
    staleTime: 5 * 60 * 1000,
    enabled: isOpen,
  });

  const sederCounts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const seder of SEDARIM) {
      let total = 0;
      for (const m of getMasechtotBySeder(seder)) total += psakCounts[m.sefariaName]?.total || 0;
      result[seder] = total;
    }
    return result;
  }, [psakCounts]);

  // Loaded page counts per seder
  const sederLoadedCounts = useMemo(() => {
    const result: Record<string, { loaded: number; total: number }> = {};
    for (const seder of SEDARIM) {
      let loaded = 0;
      let total = 0;
      for (const m of getMasechtotBySeder(seder)) {
        loaded += masechetLoadedCount[m.sefariaName] || 0;
        total += (m.maxDaf - 1) * 2; // Each daf has 2 amudim
      }
      result[seder] = { loaded, total };
    }
    return result;
  }, [masechetLoadedCount]);

  // ─── Navigation handlers ─────────────────────────────
  const resetNav = () => {
    setStep("sedarim");
    setSelectedSeder(null);
    setSelectedMasechetLocal(null);
    setSelectedDaf(null);
    setSelectedAmud(null);
    setDafPsakim([]);
  };

  const goBack = () => {
    if (step === "psakim") { setStep("amudim"); setSelectedAmud(null); setDafPsakim([]); }
    else if (step === "amudim") { setStep("dafim"); setSelectedDaf(null); }
    else if (step === "dafim") { setStep("masechtot"); setSelectedMasechetLocal(null); }
    else if (step === "masechtot") { setStep("sedarim"); setSelectedSeder(null); }
    else close();
  };

  const handleSederSelect = (seder: string) => { setSelectedSeder(seder); setStep("masechtot"); };
  const handleMasechetSelect = (m: Masechet) => { setSelectedMasechetLocal(m); setStep("dafim"); };
  const handleDafSelect = (daf: number) => { setSelectedDaf(daf); setStep("amudim"); };

  // Navigate directly to gemara page
  const navigateToPage = useCallback((masechet: Masechet, daf: number, amud: "a" | "b") => {
    const sugyaId = `${masechet.sefariaName.toLowerCase()}_${daf}${amud}`;
    setSelectedMasechet(masechet.hebrewName);
    setActiveTab("gemara");
    navigate(`/sugya/${sugyaId}`);
  }, [navigate, setSelectedMasechet, setActiveTab]);

  const handleAmudSelect = useCallback(async (amud: "a" | "b") => {
    if (!selectedMasechetLocal || selectedDaf === null) return;
    setSelectedAmud(amud);

    // Check if there are psakim for this amud
    const masechet = selectedMasechetLocal;
    const amudKey = `${selectedDaf}${amud}`;
    const dafKey = selectedDaf;
    const hasPsakim = (psakCounts[masechet.sefariaName]?.byAmud[amudKey] || 0) > 0
      || (psakCounts[masechet.sefariaName]?.byDaf[dafKey] || 0) > 0;

    if (!hasPsakim) {
      // Navigate directly to the Gemara page
      navigateToPage(masechet, selectedDaf, amud);
      return;
    }

    // Load psakim for this amud
    setStep("psakim");
    setLoadingPsakim(true);
    try {
      const [sugyaRes, patternRes] = await Promise.all([
        supabase
          .from("sugya_psak_links")
          .select(`
            id, psak_din_id, sugya_id, connection_explanation, relevance_score,
            psakei_din (id, title, court, year, summary, tags, source_url)
          `)
          .like("sugya_id", `${masechet.sefariaName}_${selectedDaf}${amud}%`),
        supabase
          .from("pattern_sugya_links")
          .select(`
            id, psak_din_id, sugya_id, source_text, confidence,
            psakei_din:psak_din_id (id, title, court, year, summary, tags, source_url)
          `)
          .eq("masechet", masechet.hebrewName)
          .eq("daf", selectedDaf.toString()),
      ]);

      const seen = new Set<string>();
      const result: DafPsak[] = [];

      for (const link of (sugyaRes.data || []) as any[]) {
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
      }
      result.sort((a, b) => b.relevance_score - a.relevance_score);
      setDafPsakim(result);
    } catch (err) {
      console.error("Error loading psakim:", err);
    } finally {
      setLoadingPsakim(false);
    }
  }, [selectedMasechetLocal, selectedDaf, psakCounts, navigateToPage]);

  const navigateToAmud = () => {
    if (!selectedMasechetLocal || selectedDaf === null || !selectedAmud) return;
    navigateToPage(selectedMasechetLocal, selectedDaf, selectedAmud);
  };

  // ─── Escape key to close ───────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  // ─── Drag (document-level events for reliability) ─────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const dx = e.clientX - dragRef.current.sx;
      const dy = e.clientY - dragRef.current.sy;
      setLayout({ ...dragRef.current.sl, x: dragRef.current.lx + dx, y: dragRef.current.ly + dy });
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [setLayout]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Allow clicks on buttons (close, minimize, back)
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const cur = layoutRef.current;
    const rx = cur.x < 0 ? Math.max(20, (window.innerWidth - cur.w) / 2) : cur.x;
    const ry = cur.y < 0 ? Math.max(20, (window.innerHeight - cur.h) / 2) : cur.y;
    dragRef.current = { sx: e.clientX, sy: e.clientY, lx: rx, ly: ry, sl: { ...cur, x: rx, y: ry } };
  }, []);

  // ─── Resize (document-level events for reliability) ───
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!resizeRef.current) return;
      const { dir, sx, sy, sl } = resizeRef.current;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      const n: PanelLayout = { ...sl };

      if (dir.includes("e")) n.w = Math.max(MIN_W, sl.w + dx);
      if (dir.includes("w")) { n.w = Math.max(MIN_W, sl.w - dx); n.x = sl.x + (sl.w - n.w); }
      if (dir.includes("s")) n.h = Math.max(MIN_H, sl.h + dy);
      if (dir.includes("n")) { n.h = Math.max(MIN_H, sl.h - dy); n.y = sl.y + (sl.h - n.h); }
      setLayout(n);
    };
    const onUp = () => {
      resizeRef.current = null;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [setLayout]);

  const startResize = useCallback((dir: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = layoutRef.current;
    const resolved: PanelLayout = {
      x: cur.x < 0 ? Math.max(20, (window.innerWidth - cur.w) / 2) : cur.x,
      y: cur.y < 0 ? Math.max(20, (window.innerHeight - cur.h) / 2) : cur.y,
      w: cur.w,
      h: cur.h,
    };
    resizeRef.current = { dir, sx: e.clientX, sy: e.clientY, sl: resolved };
  }, []);

  // ─── Breadcrumb ───────────────────────────────────────
  const breadcrumbs = useMemo(() => {
    const items: { label: string; onClick?: () => void }[] = [
      { label: "סדרים", onClick: resetNav },
    ];
    if (selectedSeder) items.push({ label: selectedSeder, onClick: () => { setStep("masechtot"); setSelectedMasechetLocal(null); setSelectedDaf(null); setSelectedAmud(null); } });
    if (selectedMasechetLocal) items.push({ label: selectedMasechetLocal.hebrewName, onClick: () => { setStep("dafim"); setSelectedDaf(null); setSelectedAmud(null); } });
    if (selectedDaf) items.push({ label: `דף ${toHebrewNumeral(selectedDaf)}`, onClick: () => { setStep("amudim"); setSelectedAmud(null); } });
    if (selectedAmud) items.push({ label: selectedAmud === "a" ? "עמוד א׳" : "עמוד ב׳" });
    return items;
  }, [selectedSeder, selectedMasechetLocal, selectedDaf, selectedAmud]);

  const stepTitle = step === "sedarim" ? "ששת סדרי הש\"ס"
    : step === "masechtot" ? `סדר ${selectedSeder}`
    : step === "dafim" ? `${selectedMasechetLocal?.hebrewName}`
    : step === "amudim" ? `${selectedMasechetLocal?.hebrewName} דף ${toHebrewNumeral(selectedDaf || 0)}`
    : `${selectedMasechetLocal?.hebrewName} ${toHebrewNumeral(selectedDaf || 0)}${selectedAmud === "a" ? "א" : "ב"}`;

  // ─── FAB Button ───────────────────────────────────────
  const fabButton = (
    <button
      onClick={toggle}
      className={cn(
        "fixed bottom-4 left-4 w-12 h-12 md:bottom-6 md:left-6 md:w-14 md:h-14 z-50 rounded-full",
        "bg-primary text-primary-foreground shadow-lg",
        "flex items-center justify-center",
        "hover:scale-110 transition-transform duration-200",
        "hover:shadow-xl",
        isOpen && "ring-2 ring-primary/50 ring-offset-2"
      )}
      aria-label="ניווט מהיר"
      title="ניווט מהיר"
    >
      <BookOpen className="w-6 h-6" />
    </button>
  );

  if (!isOpen) return fabButton;

  // ─── Render Panel ─────────────────────────────────────
  return (
    <>
      {fabButton}

      <div
        ref={panelRef}
        className="fixed z-40 bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden select-none"
        style={{
          left: resolvedLayout.x,
          top: resolvedLayout.y,
          width: minimized ? resolvedLayout.w : resolvedLayout.w,
          height: minimized ? "auto" : resolvedLayout.h,
        }}
        dir="rtl"
      >
        {/* ─── Header (drag handle) ─── */}
        <div
          className="flex items-center justify-between px-3 py-2 bg-gradient-to-l from-primary/10 via-accent/5 to-transparent border-b border-border cursor-move"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-2 min-w-0">
            <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
            <Compass className="h-4 w-4 text-primary shrink-0" />
            <span className="font-bold text-sm truncate">{stepTitle}</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {step !== "sedarim" && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goBack} title="חזרה">
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowShasInfo(v => !v)} title="ניהול ש״ס">
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMinimized(!minimized)} title={minimized ? "הגדל" : "מזער"}>
              {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close} title="סגור">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Breadcrumb */}
        {!minimized && (
          <div className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-muted-foreground border-b border-border/50 overflow-x-auto">
            {breadcrumbs.map((bc, i) => (
              <span key={i} className="flex items-center gap-1 shrink-0">
                {i > 0 && <ChevronLeft className="h-3 w-3" />}
                {bc.onClick ? (
                  <button onClick={bc.onClick} className="hover:text-primary transition-colors hover:underline underline-offset-2">
                    {bc.label}
                  </button>
                ) : (
                  <span className="text-foreground font-medium">{bc.label}</span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* ─── Content ─── */}
        {!minimized && (
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3">
              {/* ──── Shas Info Panel ──── */}
              {showShasInfo && (
                <div className="space-y-3 mb-3 p-3 rounded-xl border border-primary/20 bg-primary/5 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between">
                    <button onClick={() => setShowShasInfo(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <h4 className="font-bold text-sm text-primary">ניהול ש״ס</h4>
                  </div>
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <BookOpenCheck className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-primary">
                      {Object.values(masechetLoadedCount).reduce((a, b) => a + b, 0).toLocaleString()} עמודים במסד הנתונים
                    </span>
                  </div>
                  <button
                    onClick={() => { enqueueJob(buildShasJob()); setShowShasInfo(false); }}
                    className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-primary/40 bg-background hover:bg-primary/10 transition-all text-primary text-sm font-semibold"
                  >
                    <Download className="h-4 w-4" />
                    הורד את כל הש״ס
                  </button>
                </div>
              )}

              {/* ──── Sedarim ──── */}
              {step === "sedarim" && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {SEDARIM.map((seder) => {
                      const meta = SEDER_META[seder] || SEDER_META["זרעים"];
                      const Icon = meta.icon;
                      const count = sederCounts[seder] || 0;
                      const masechtot = getMasechtotBySeder(seder);
                      const sederLoaded = sederLoadedCounts[seder];
                      const loadedPct = sederLoaded?.total ? Math.round((sederLoaded.loaded / sederLoaded.total) * 100) : 0;
                      return (
                        <button
                          key={seder}
                          onClick={() => handleSederSelect(seder)}
                          className={cn(
                            "relative p-4 rounded-xl border border-border transition-all duration-300 text-right",
                            "hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]",
                            `bg-gradient-to-br ${meta.gradient}`
                          )}
                        >
                          <div className="flex items-start justify-between">
                            <div className="p-1.5 rounded-lg bg-background/60 backdrop-blur">
                              <Icon className="h-4 w-4 text-primary" />
                            </div>
                            {count > 0 && (
                              <div className="flex items-center gap-1 bg-primary/15 text-primary rounded-full px-2 py-0.5">
                                <Scale className="h-3 w-3" />
                                <span className="text-xs font-bold">{count}</span>
                              </div>
                            )}
                          </div>
                          <h3 className="font-bold text-base mt-2">סדר {seder}</h3>
                          <div className="flex items-center justify-between mt-1">
                            {loadedPct === 100 ? (
                              <div className="flex items-center gap-1 text-green-600">
                                <CheckCircle2 className="h-3 w-3" />
                                <span className="text-[10px] font-medium">הושלם</span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">{sederLoaded?.loaded || 0} עמודים</span>
                            )}
                            <p className="text-xs text-muted-foreground">{masechtot.length} מסכתות</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ──── Masechtot ──── */}
              {step === "masechtot" && selectedSeder && (
                <div className="space-y-2">
                  <button
                    onClick={() => enqueueJob(buildSederJob(selectedSeder))}
                    className="w-full flex items-center justify-center gap-2 p-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 transition-all text-primary text-xs font-semibold"
                  >
                    <Download className="h-3.5 w-3.5" />
                    הורד את כל סדר {selectedSeder}
                  </button>
                  {getMasechtotBySeder(selectedSeder).map((m) => {
                    const count = psakCounts[m.sefariaName]?.total || 0;
                    const dafCount = Object.keys(psakCounts[m.sefariaName]?.byDaf || {}).length;
                    const coverage = Math.round((dafCount / (m.maxDaf - 1)) * 100);
                    const loaded = masechetLoadedCount[m.sefariaName] || 0;
                    const totalAmudim = (m.maxDaf - 1) * 2;
                    const loadedPct = Math.round((loaded / totalAmudim) * 100);
                    const isComplete = loadedPct >= 95;
                    return (
                      <div key={m.englishName} className="flex items-stretch gap-1.5">
                        <button
                          onClick={() => handleMasechetSelect(m)}
                          className="flex-1 flex items-center gap-3 p-3 rounded-xl border border-border hover:shadow-md hover:border-primary/30 hover:bg-primary/5 active:scale-[0.99] transition-all bg-card text-right"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-sm">{m.hebrewName}</h4>
                              <span className="text-[10px] text-muted-foreground">({m.maxDaf - 1} דפים)</span>
                              {isComplete && <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />}
                            </div>
                            {(count > 0 || loaded > 0) && (
                              <div className="mt-1.5">
                                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                                  <span>{loaded} עמודים טעונים</span>
                                  {count > 0 && <span>{dafCount} דפים עם פסקים ({coverage}%)</span>}
                                </div>
                                <Progress value={loadedPct} className="h-1" />
                              </div>
                            )}
                          </div>
                          {count > 0 && (
                            <div className="flex flex-col items-center gap-0.5 shrink-0">
                              <div className={cn("relative p-2 rounded-lg", count >= 10 ? "bg-primary/20 ring-1 ring-primary/30" : "bg-primary/10")}>
                                <Scale className={cn("h-4 w-4", count >= 10 ? "text-primary" : "text-primary/70")} />
                                <span className="absolute -top-1.5 -left-1.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-[18px] h-4 flex items-center justify-center px-0.5 shadow">
                                  {count}
                                </span>
                              </div>
                            </div>
                          )}
                          <ChevronLeft className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                        </button>
                        <button
                          onClick={() => enqueueJob(buildMasechetJob(m))}
                          className="shrink-0 p-2.5 rounded-xl border border-border hover:bg-primary/10 hover:border-primary/30 transition-all"
                          title={`הורד ${m.hebrewName}`}
                        >
                          <Download className="h-3.5 w-3.5 text-primary" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ──── Dafim ──── */}
              {step === "dafim" && selectedMasechetLocal && (() => {
                const loaded = masechetLoadedCount[selectedMasechetLocal.sefariaName] || 0;
                const totalAmudim = (selectedMasechetLocal.maxDaf - 1) * 2;
                const loadedPct = Math.round((loaded / totalAmudim) * 100);
                return (
                  <div>
                    {/* Status bar */}
                    <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg bg-primary/5 border border-primary/10">
                      <BookOpenCheck className="h-4 w-4 text-primary" />
                      <span className="text-xs font-medium flex-1">
                        {loaded} / {totalAmudim} עמודים ({loadedPct}%)
                      </span>
                      {(psakCounts[selectedMasechetLocal.sefariaName]?.total || 0) > 0 && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Scale className="h-3 w-3" />
                          {psakCounts[selectedMasechetLocal.sefariaName]?.total} פסקים
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => enqueueJob(buildMasechetJob(selectedMasechetLocal))}
                      className="w-full flex items-center justify-center gap-2 p-2 mb-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 transition-all text-primary text-xs font-semibold"
                    >
                      <Download className="h-3.5 w-3.5" />
                      הורד {selectedMasechetLocal.hebrewName}
                    </button>
                    <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5">
                      {Array.from({ length: selectedMasechetLocal.maxDaf - 1 }, (_, i) => i + 2).map((daf) => {
                        const pCount = psakCounts[selectedMasechetLocal.sefariaName]?.byDaf[daf] || 0;
                        const pageSet = loadedPages[selectedMasechetLocal.sefariaName];
                        const hasA = pageSet?.has(`${daf}a`);
                        const hasB = pageSet?.has(`${daf}b`);
                        const isLoaded = hasA || hasB;
                        const isFull = hasA && hasB;
                        return (
                          <button
                            key={daf}
                            onClick={() => handleDafSelect(daf)}
                            className={cn(
                              "relative p-2 rounded-lg text-sm font-medium transition-all duration-200",
                              "border min-h-[40px] flex flex-col items-center justify-center",
                              "hover:scale-105 active:scale-95",
                              pCount > 0
                                ? cn("bg-gradient-to-br from-accent to-accent/80 text-accent-foreground border-accent/50 hover:shadow-lg", pCount >= 5 && "ring-2 ring-primary/40")
                                : isLoaded
                                  ? "bg-green-500/10 border-green-500/30 hover:bg-green-500/20 text-foreground"
                                  : "bg-card border-border hover:border-accent/50 hover:bg-accent/5 text-foreground"
                            )}
                          >
                            <span>{toHebrewNumeral(daf)}</span>
                            {pCount > 0 && (
                              <span className="absolute -top-1 -left-1 bg-primary text-primary-foreground text-[8px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5 shadow">
                                {pCount}
                              </span>
                            )}
                            {isFull && !pCount && (
                              <CheckCircle2 className="absolute -top-1 -left-1 h-3.5 w-3.5 text-green-600" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ──── Amudim ──── */}
              {step === "amudim" && selectedMasechetLocal && selectedDaf !== null && (
                <div className="space-y-4">
                  <div className="text-center">
                    <h3 className="text-lg font-bold text-primary">
                      {selectedMasechetLocal.hebrewName} דף {toHebrewNumeral(selectedDaf)}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">בחר עמוד</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {(["a", "b"] as const).map((amud) => {
                      const amudKey = `${selectedDaf}${amud}`;
                      const amudCount = psakCounts[selectedMasechetLocal.sefariaName]?.byAmud[amudKey] || 0;
                      const label = amud === "a" ? "עמוד א׳" : "עמוד ב׳";
                      const isPageLoaded = loadedPages[selectedMasechetLocal.sefariaName]?.has(amudKey);
                      return (
                        <button
                          key={amud}
                          onClick={() => handleAmudSelect(amud)}
                          className={cn(
                            "flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 transition-all duration-200",
                            "hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]",
                            amudCount > 0
                              ? "border-primary/50 bg-primary/5 hover:bg-primary/10"
                              : isPageLoaded
                                ? "border-green-500/40 bg-green-500/5 hover:bg-green-500/10"
                                : "border-border hover:border-primary/30 bg-card hover:bg-accent/5"
                          )}
                        >
                          <span className="text-2xl font-bold">{label}</span>
                          {isPageLoaded && (
                            <span className="flex items-center gap-1 text-green-600 text-xs">
                              <CheckCircle2 className="h-3 w-3" />
                              במסד הנתונים
                            </span>
                          )}
                          {amudCount > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              <Scale className="h-3 w-3 mr-1" />
                              {amudCount} פסקים
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => navigateToPage(selectedMasechetLocal, selectedDaf, "a")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      פתח דף בגמרא
                    </Button>
                  </div>
                </div>
              )}

              {/* ──── Psakim ──── */}
              {step === "psakim" && selectedMasechetLocal && selectedDaf !== null && selectedAmud && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Button variant="outline" size="sm" onClick={navigateToAmud} className="gap-1">
                      <ExternalLink className="h-3.5 w-3.5" />
                      פתח בגמרא
                    </Button>
                    <Badge variant="secondary" className="text-xs">
                      {loadingPsakim ? "טוען..." : `${dafPsakim.length} פסקי דין`}
                    </Badge>
                  </div>
                  {loadingPsakim ? (
                    <div className="flex flex-col items-center py-10 gap-3">
                      <Loader2 className="h-7 w-7 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">טוען פסקי דין...</p>
                    </div>
                  ) : dafPsakim.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Scale className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">לא נמצאו פסקי דין לעמוד זה</p>
                      <Button variant="outline" size="sm" className="mt-3 gap-1" onClick={navigateToAmud}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        פתח עמוד בגמרא
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {dafPsakim.map((psak) => (
                        <button
                          key={psak.id}
                          onClick={() => { setViewPsak(psak); setViewPsakOpen(true); }}
                          className="w-full text-right p-3 rounded-xl border border-border hover:shadow-md hover:border-primary/30 hover:bg-primary/5 active:scale-[0.99] transition-all bg-card"
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-xs line-clamp-2 flex items-center gap-1 justify-end">
                                <SummaryToggle summary={psak.summary} compact />
                                <FileTypeBadge url={psak.source_url} />
                                {psak.title}
                              </h4>
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                                <span className="flex items-center gap-0.5"><Building2 className="h-2.5 w-2.5" />{psak.court}</span>
                                <span className="flex items-center gap-0.5"><Calendar className="h-2.5 w-2.5" />{psak.year}</span>
                              </div>
                              {psak.connection && <p className="text-[10px] text-foreground/70 mt-1 line-clamp-2">{psak.connection}</p>}
                              {psak.tags.length > 0 && (
                                <div className="flex flex-wrap gap-0.5 mt-1">
                                  {psak.tags.slice(0, 3).map((tag, i) => (
                                    <Badge key={i} variant="outline" className="text-[9px] h-4 px-1">{tag}</Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className={cn("shrink-0 flex flex-col items-center p-1.5 rounded-lg",
                              psak.relevance_score >= 7 ? "bg-green-500/10" : psak.relevance_score >= 5 ? "bg-yellow-500/10" : "bg-muted/50"
                            )}>
                              <span className={cn("text-sm font-bold",
                                psak.relevance_score >= 7 ? "text-green-600" : psak.relevance_score >= 5 ? "text-yellow-600" : "text-muted-foreground"
                              )}>
                                {psak.relevance_score}
                              </span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* ─── Footer drag bar ─── */}
        {!minimized && (
          <div
            className="flex items-center justify-center px-3 py-1.5 border-t border-border cursor-move bg-muted/30 hover:bg-muted/50 transition-colors"
            onMouseDown={handleDragStart}
          >
            <div className="w-8 h-1 rounded-full bg-border" />
          </div>
        )}

        {/* ─── Resize Handles ─── */}
        {!minimized && (
          <>
            {/* Edges */}
            <div className="absolute z-10 touch-none top-0 left-3 right-3 h-1.5" style={{ cursor: "ns-resize" }} onPointerDown={(e) => startResize("n", e)} />
            <div className="absolute z-10 touch-none bottom-0 left-3 right-3 h-1.5" style={{ cursor: "ns-resize" }} onPointerDown={(e) => startResize("s", e)} />
            <div className="absolute z-10 touch-none top-3 bottom-3 right-0 w-1.5" style={{ cursor: "ew-resize" }} onPointerDown={(e) => startResize("e", e)} />
            <div className="absolute z-10 touch-none top-3 bottom-3 left-0 w-1.5" style={{ cursor: "ew-resize" }} onPointerDown={(e) => startResize("w", e)} />
            {/* Corners */}
            <div className="absolute z-10 touch-none top-0 left-0 w-3 h-3" style={{ cursor: "nwse-resize" }} onPointerDown={(e) => startResize("nw", e)} />
            <div className="absolute z-10 touch-none top-0 right-0 w-3 h-3" style={{ cursor: "nesw-resize" }} onPointerDown={(e) => startResize("ne", e)} />
            <div className="absolute z-10 touch-none bottom-0 left-0 w-3 h-3" style={{ cursor: "nesw-resize" }} onPointerDown={(e) => startResize("sw", e)} />
            <div className="absolute z-10 touch-none bottom-0 right-0 w-3 h-3" style={{ cursor: "nwse-resize" }} onPointerDown={(e) => startResize("se", e)} />
            {/* Visible corner indicator (bottom-right) */}
            <div className="absolute bottom-1 right-1 pointer-events-none opacity-30">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" />
                <line x1="9" y1="4" x2="4" y2="9" stroke="currentColor" strokeWidth="1.5" />
                <line x1="9" y1="7" x2="7" y2="9" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
          </>
        )}
      </div>

      <PsakDinViewDialog
        psak={viewPsak}
        open={viewPsakOpen}
        onOpenChange={setViewPsakOpen}
      />
    </>
  );
}
