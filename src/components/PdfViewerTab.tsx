import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Monitor,
  X,
  Star,
  StarOff,
  Upload,
  Link as LinkIcon,
  Maximize2,
  Minimize2,
  ChevronDown,
  Eye,
  Columns2,
  SplitSquareHorizontal,
  Palette,
  RotateCcw,
  Download,
  Printer,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Globe,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ─── Constants ─── */
const STORAGE_KEYS = {
  defaultViewer: "pdf-viewer-default-v1",
  theme: "pdf-viewer-theme-v1",
  viewMode: "pdf-viewer-mode-v1",
  recentUrls: "pdf-viewer-recent-urls-v1",
} as const;

type ViewerEngine = "browser";
type ViewMode = "single" | "split" | "compare";
type ThemeKey = "cobalt" | "sand" | "noir";

interface ViewerOption {
  id: ViewerEngine;
  label: string;
  description: string;
  icon: typeof FileText;
  available: boolean;
  badge?: string;
}

const VIEWER_OPTIONS: ViewerOption[] = [
  {
    id: "browser",
    label: "צפיין מובנה",
    description: "מנוע PDF מובנה בדפדפן — מהיר ואמין",
    icon: Monitor,
    available: true,
  },
];

const THEMES: Record<ThemeKey, { label: string; bg: string; text: string; accent: string }> = {
  cobalt: { label: "Cobalt", bg: "bg-[#0B1F5B]", text: "text-white", accent: "border-[#D4AF37]" },
  sand: { label: "Sand", bg: "bg-amber-50", text: "text-amber-950", accent: "border-amber-400" },
  noir: { label: "Noir", bg: "bg-zinc-900", text: "text-zinc-100", accent: "border-zinc-500" },
};

/* ─── Helpers ─── */
function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota exceeded — ignore */ }
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/* ─── Component ─── */
const PdfViewerTab = () => {
  const navigate = useNavigate();
  // Viewer engine
  const [defaultViewer, setDefaultViewer] = useState<ViewerEngine | null>(() =>
    loadFromStorage<ViewerEngine | null>(STORAGE_KEYS.defaultViewer, null)
  );
  const [activeViewer, setActiveViewer] = useState<ViewerEngine>(
    () => defaultViewer ?? "browser"
  );

  // View mode & theme
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    loadFromStorage<ViewMode>(STORAGE_KEYS.viewMode, "single")
  );
  const [theme, setTheme] = useState<ThemeKey>(() =>
    loadFromStorage<ThemeKey>(STORAGE_KEYS.theme, "cobalt")
  );

  // PDF source
  const [urlInput, setUrlInput] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [secondPdfUrl, setSecondPdfUrl] = useState<string | null>(null);
  const [secondUrlInput, setSecondUrlInput] = useState("");
  const [recentUrls, setRecentUrls] = useState<string[]>(() =>
    loadFromStorage<string[]>(STORAGE_KEYS.recentUrls, [])
  );

  // UI state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const secondFileInputRef = useRef<HTMLInputElement>(null);

  // Persist preferences
  useEffect(() => saveToStorage(STORAGE_KEYS.defaultViewer, defaultViewer), [defaultViewer]);
  useEffect(() => saveToStorage(STORAGE_KEYS.viewMode, viewMode), [viewMode]);
  useEffect(() => saveToStorage(STORAGE_KEYS.theme, theme), [theme]);
  useEffect(() => saveToStorage(STORAGE_KEYS.recentUrls, recentUrls), [recentUrls]);

  // Sync active viewer when default changes
  useEffect(() => { if (defaultViewer) setActiveViewer(defaultViewer); }, [defaultViewer]);

  /* ─── Actions ─── */
  const handleSetDefault = useCallback(
    (id: ViewerEngine) => {
      setDefaultViewer(id);
      toast.success(`ברירת מחדל: ${VIEWER_OPTIONS.find((v) => v.id === id)?.label}`);
    },
    []
  );

  const handleClearDefault = useCallback(() => {
    setDefaultViewer(null);
    toast("ברירת המחדל נוקתה");
  }, []);

  const handleLoadUrl = useCallback(
    (url: string, target: "primary" | "secondary" = "primary") => {
      const trimmed = url.trim();
      if (!trimmed) return;
      if (!isValidUrl(trimmed)) {
        toast.error("כתובת לא תקינה — יש להזין כתובת מלאה (https://...)");
        return;
      }
      if (target === "primary") {
        setPdfUrl(trimmed);
        setUrlInput("");
      } else {
        setSecondPdfUrl(trimmed);
        setSecondUrlInput("");
      }
      setRecentUrls((prev) => {
        const next = [trimmed, ...prev.filter((u) => u !== trimmed)].slice(0, 10);
        return next;
      });
    },
    []
  );

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, target: "primary" | "secondary" = "primary") => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.type !== "application/pdf") {
        toast.error("ניתן לטעון קבצי PDF בלבד");
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      if (target === "primary") {
        setPdfUrl(objectUrl);
      } else {
        setSecondPdfUrl(objectUrl);
      }
      toast.success(`נטען: ${file.name}`);
    },
    []
  );

  const toggleFullscreen = useCallback(() => {
    if (!viewerContainerRef.current) return;
    if (!document.fullscreenElement) {
      viewerContainerRef.current.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  /* ─── Render helpers ─── */
  const renderPdfFrame = (url: string | null, engine: ViewerEngine) => {
    if (!url) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
          <FileText className="h-16 w-16 opacity-30" />
          <p className="text-lg font-medium">לא נבחר מסמך</p>
          <p className="text-sm">טען קובץ PDF או הדבק קישור למעלה</p>
        </div>
      );
    }

    // Browser native viewer (default)
    return (
      <iframe
        src={`${url}#zoom=${zoom}`}
        className="w-full h-full border-0 rounded-lg"
        title="PDF Viewer"
        style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
      />
    );
  };

  const currentTheme = THEMES[theme];

  return (
    <div className="p-3 md:p-6 space-y-4">
      {/* Banner — suggest full EmbedPDF page */}
      <div className="bg-[#0B1F5B]/5 border border-[#D4AF37]/40 rounded-xl p-3 flex items-center justify-between gap-3">
        <p className="text-sm text-[#0B1F5B]/80">לחוויה מתקדמת יותר עם הערות, סימניות, ערכות נושא ועוד</p>
        <Button size="sm" className="bg-[#0B1F5B] text-white border border-[#D4AF37] whitespace-nowrap gap-1" onClick={() => navigate('/embedpdf-viewer')}>
          <FileText className="h-4 w-4" /> פתח צפיין מתקדם
        </Button>
      </div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            צפיין PDF
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            קרא, השווה והוסף הערות למסמכי PDF
          </p>
        </div>

        {/* View mode + theme controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode buttons */}
          <div className="flex items-center border border-border rounded-lg overflow-hidden">
            {([
              { mode: "single" as ViewMode, icon: Eye, label: "יחיד" },
              { mode: "split" as ViewMode, icon: Columns2, label: "מפוצל" },
              { mode: "compare" as ViewMode, icon: SplitSquareHorizontal, label: "השוואה" },
            ] as const).map(({ mode, icon: Icon, label }) => (
              <Button
                key={mode}
                variant={viewMode === mode ? "default" : "ghost"}
                size="sm"
                className={cn(
                  "rounded-none h-8 px-3 text-xs",
                  viewMode === mode && "shadow-sm"
                )}
                onClick={() => setViewMode(mode)}
              >
                <Icon className="h-3.5 w-3.5 ml-1" />
                {label}
              </Button>
            ))}
          </div>

          {/* Theme selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Palette className="h-3.5 w-3.5" />
                {THEMES[theme].label}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.entries(THEMES) as [ThemeKey, typeof THEMES["cobalt"]][]).map(
                ([key, t]) => (
                  <DropdownMenuItem key={key} onClick={() => setTheme(key)}>
                    <div className={cn("w-4 h-4 rounded-full ml-2 border", t.bg, t.accent)} />
                    {t.label}
                    {theme === key && <Badge variant="secondary" className="mr-auto text-[10px]">פעיל</Badge>}
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Fullscreen */}
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>


      {/* PDF source input */}
      <Card>
        <CardContent className="pt-4">
          <Tabs defaultValue="url" className="w-full">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="url" className="gap-1.5">
                <LinkIcon className="h-3.5 w-3.5" />
                קישור
              </TabsTrigger>
              <TabsTrigger value="upload" className="gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                העלאת קובץ
              </TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-3 mt-3">
              <div className="flex gap-2">
                <Input
                  placeholder="הדבק קישור ל-PDF (https://...)"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLoadUrl(urlInput)}
                  className="flex-1"
                  dir="ltr"
                />
                <Button onClick={() => handleLoadUrl(urlInput)} disabled={!urlInput.trim()}>
                  טען
                </Button>
              </div>

              {/* Second PDF URL (for split/compare) */}
              {viewMode !== "single" && (
                <div className="flex gap-2">
                  <Input
                    placeholder="קישור ל-PDF שני (השוואה)"
                    value={secondUrlInput}
                    onChange={(e) => setSecondUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLoadUrl(secondUrlInput, "secondary")}
                    className="flex-1"
                    dir="ltr"
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleLoadUrl(secondUrlInput, "secondary")}
                    disabled={!secondUrlInput.trim()}
                  >
                    טען
                  </Button>
                </div>
              )}

              {/* Recent URLs */}
              {recentUrls.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">קישורים אחרונים</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {recentUrls.slice(0, 5).map((u) => {
                      let hostname: string;
                      try { hostname = new URL(u).hostname; } catch { hostname = u.slice(0, 30); }
                      return (
                        <Badge
                          key={u}
                          variant="outline"
                          className="cursor-pointer text-[10px] hover:bg-muted/80 transition-colors gap-1"
                          onClick={() => handleLoadUrl(u)}
                        >
                          <Globe className="h-2.5 w-2.5" />
                          {hostname}
                        </Badge>
                      );
                    })}
                    <Badge
                      variant="secondary"
                      className="cursor-pointer text-[10px] text-destructive hover:bg-destructive/10"
                      onClick={() => { setRecentUrls([]); toast("ההיסטוריה נוקתה"); }}
                    >
                      <X className="h-2.5 w-2.5" />
                      נקה
                    </Badge>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="upload" className="mt-3 space-y-3">
              <div
                className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">לחץ או גרור קובץ PDF לכאן</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e, "primary")}
                />
              </div>

              {viewMode !== "single" && (
                <div
                  className="border-2 border-dashed border-border rounded-xl p-4 text-center hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => secondFileInputRef.current?.click()}
                >
                  <Columns2 className="h-6 w-6 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">קובץ PDF שני (להשוואה)</p>
                  <input
                    ref={secondFileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => handleFileUpload(e, "secondary")}
                  />
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Viewer area */}
      <div
        ref={viewerContainerRef}
        className={cn(
          "rounded-xl border-2 overflow-hidden transition-all",
          currentTheme.accent,
          isFullscreen && "fixed inset-0 z-50 rounded-none border-0"
        )}
      >
        {/* Viewer toolbar */}
        <div className={cn(
          "flex items-center justify-between px-3 py-2 border-b",
          currentTheme.bg, currentTheme.text, currentTheme.accent
        )}>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px] gap-1">
              {VIEWER_OPTIONS.find((v) => v.id === activeViewer)?.icon &&
                (() => {
                  const Icon = VIEWER_OPTIONS.find((v) => v.id === activeViewer)!.icon;
                  return <Icon className="h-3 w-3" />;
                })()}
              {VIEWER_OPTIONS.find((v) => v.id === activeViewer)?.label}
            </Badge>
            {viewMode !== "single" && (
              <Badge variant="outline" className="text-[10px]">
                {viewMode === "split" ? "מפוצל" : "השוואה"}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Zoom controls (browser & embedpdf viewers) */}
            {activeViewer === "browser" && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", currentTheme.text)}
                  onClick={() => setZoom((z) => Math.max(50, z - 10))}
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs min-w-[3rem] text-center">{zoom}%</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", currentTheme.text)}
                  onClick={() => setZoom((z) => Math.min(200, z + 10))}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", currentTheme.text)}
                  onClick={() => setZoom(100)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <div className="w-px h-4 bg-current opacity-20 mx-1" />
              </>
            )}

            {/* Download & Print */}
            {pdfUrl && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", currentTheme.text)}
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = pdfUrl;
                    a.download = "document.pdf";
                    a.click();
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", currentTheme.text)}
                  onClick={() => window.print()}
                >
                  <Printer className="h-3.5 w-3.5" />
                </Button>
              </>
            )}

            {/* Fullscreen */}
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", currentTheme.text)}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* Viewer content */}
        <div
          className={cn(
            "transition-all",
            isFullscreen ? "h-[calc(100vh-44px)]" : "h-[70vh] min-h-[400px]",
            viewMode !== "single" ? "grid grid-cols-2 gap-0.5 bg-border/50" : ""
          )}
        >
          {/* Primary viewer */}
          <div className={cn("bg-background", viewMode !== "single" ? "h-full" : "h-full")}>
            {renderPdfFrame(pdfUrl, activeViewer)}
          </div>

          {/* Secondary viewer (split/compare) */}
          {viewMode !== "single" && (
            <div className="bg-background h-full">
              {renderPdfFrame(secondPdfUrl, activeViewer)}
            </div>
          )}
        </div>
      </div>

      {/* Keyboard shortcuts help */}
      <div className="text-xs text-muted-foreground text-center py-2">
        <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] mx-1">Enter</kbd> טען קישור
        {" · "}
        <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] mx-1">F11</kbd> מסך מלא
      </div>
    </div>
  );
};

export default PdfViewerTab;
