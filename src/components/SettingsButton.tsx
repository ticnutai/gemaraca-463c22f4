import { useState, lazy, Suspense } from "react";
import { Settings, Check, Palette, ChevronRight, Pipette, Code2, Bug, Zap, Library, DatabaseBackup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const DevMigrationsPanel = lazy(() => import("@/components/DevMigrationsPanel"));
const DevConsoleMonitor = lazy(() => import("@/components/DevConsoleMonitor"));
const DevPerformanceMonitor = lazy(() => import("@/components/DevPerformanceMonitor"));
const DataBackupPanel = lazy(() => import("@/components/backup/DataBackupPanel"));
const PsakSourcesPanel = lazy(() => import("@/components/sources/PsakSourcesPanel"));
import { useIsAdmin } from "@/hooks/useIsAdmin";
const AutoBackupRunner = lazy(() => import("@/components/backup/AutoBackupRunner"));
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme, themes, Theme, CustomColors } from "./ThemeProvider";
import { cn } from "@/lib/utils";

const themeColors: Record<Exclude<Theme, "custom">, { bg: string; accent: string; text: string }> = {
  classic: { bg: "bg-amber-50", accent: "bg-amber-500", text: "text-slate-800" },
  midnight: { bg: "bg-slate-900", accent: "bg-amber-500", text: "text-amber-100" },
  royal: { bg: "bg-blue-950", accent: "bg-slate-300", text: "text-slate-100" },
  "navy-gold": { bg: "bg-white", accent: "bg-amber-500", text: "text-blue-950" },
};

const presetColors = [
  "#f5f5f0", "#faf7f2", "#f0f4f8", "#1a1a2e", "#0f172a", "#1e293b",
  "#1e3a5f", "#0d47a1", "#4a148c", "#1b5e20", "#b71c1c", "#e65100",
  "#d4a853", "#ffc107", "#8bc34a", "#00bcd4", "#e91e63", "#9c27b0",
];

export function SettingsButton() {
  const { theme, setTheme, customColors, setCustomColors } = useTheme();
  const navigate = useNavigate();
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [showDevTab, setShowDevTab] = useState(false);
  const [localColors, setLocalColors] = useState<CustomColors>(customColors);
  const [showBackupPanel, setShowBackupPanel] = useState(false);
  const [showSourcesPanel, setShowSourcesPanel] = useState(false);
  const isAdmin = useIsAdmin() === true;
  
  // Dev tools toggles — persisted in localStorage
  const [consoleMonitorEnabled, setConsoleMonitorEnabled] = useState(() => localStorage.getItem("dev-console-enabled") === "true");
  const [perfMonitorEnabled, setPerfMonitorEnabled] = useState(() => localStorage.getItem("dev-perf-enabled") === "true");
  const [shasManagerBtnEnabled, setShasManagerBtnEnabled] = useState(() => localStorage.getItem("dev-shas-manager-btn") === "true");
  const [devMigrationsBtnEnabled, setDevMigrationsBtnEnabled] = useState(() => localStorage.getItem("dev-migrations-btn") === "true");

  const toggleConsoleMonitor = () => {
    const next = !consoleMonitorEnabled;
    setConsoleMonitorEnabled(next);
    localStorage.setItem("dev-console-enabled", String(next));
  };

  const togglePerfMonitor = () => {
    const next = !perfMonitorEnabled;
    setPerfMonitorEnabled(next);
    localStorage.setItem("dev-perf-enabled", String(next));
  };

  const toggleShasManagerBtn = () => {
    const next = !shasManagerBtnEnabled;
    setShasManagerBtnEnabled(next);
    localStorage.setItem("dev-shas-manager-btn", String(next));
  };

  const toggleDevMigrationsBtn = () => {
    const next = !devMigrationsBtnEnabled;
    setDevMigrationsBtnEnabled(next);
    localStorage.setItem("dev-migrations-btn", String(next));
  };

  const handleColorChange = (key: keyof CustomColors, value: string) => {
    setLocalColors(prev => ({ ...prev, [key]: value }));
  };

  const applyCustomColors = () => {
    setCustomColors(localColors);
    setTheme("custom");
  };

  const colorLabels: Record<keyof CustomColors, string> = {
    background: "רקע",
    primary: "ראשי",
    accent: "הדגשה",
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {/* Shas Manager Button — dev-toggleable */}
      {shasManagerBtnEnabled && (
        <Button
          size="icon"
          variant="outline"
          className="h-10 w-10 rounded-full shadow-lg bg-card border-border hover:bg-muted"
          onClick={() => navigate("/shas-manager")}
          title={'ניהול סריקות ש"ס'}
        >
          <Library className="h-4 w-4" />
        </Button>
      )}

      {/* lassName="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {/* Dev Migrations Button — dev-toggleable */}
      {devMigrationsBtnEnabled && (
        <Button
          size="icon"
          variant="outline"
          className="h-10 w-10 rounded-full shadow-lg bg-card border-border hover:bg-muted"
          onClick={() => setShowDevPanel(true)}
          title="פיתוח - מיגרציות"
        >
          <Code2 className="h-4 w-4" />
        </Button>
      )}

      <Suspense fallback={null}>
        {showBackupPanel && <DataBackupPanel open={showBackupPanel} onOpenChange={setShowBackupPanel} />}
        {showSourcesPanel && <PsakSourcesPanel open={showSourcesPanel} onOpenChange={setShowSourcesPanel} />}
        {isAdmin && <AutoBackupRunner />}
      </Suspense>

      <Suspense fallback={null}>
        {showDevPanel && (
          <DevMigrationsPanel open={showDevPanel} onClose={() => setShowDevPanel(false)} />
        )}
      </Suspense>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            className="h-12 w-12 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent 
          side="top" 
          align="end" 
          className="w-72 p-3 bg-card border-border"
        >
          {!showCustomizer && !showDevTab ? (
            <>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                <Palette className="h-4 w-4 text-accent" />
                <span className="font-medium">ערכות נושא</span>
              </div>
              <div className="space-y-2">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (t.id === "custom") {
                        setShowCustomizer(true);
                      } else {
                        setTheme(t.id);
                      }
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 p-2 rounded-lg transition-all",
                      "hover:bg-muted/50",
                      theme === t.id && "bg-muted ring-1 ring-accent"
                    )}
                  >
                    {/* Theme preview circles */}
                    {t.id !== "custom" ? (
                      <div className="flex gap-1">
                        <div className={cn("w-4 h-4 rounded-full border border-border", themeColors[t.id as Exclude<Theme, "custom">].bg)} />
                        <div className={cn("w-4 h-4 rounded-full", themeColors[t.id as Exclude<Theme, "custom">].accent)} />
                        <div className={cn("w-4 h-4 rounded-full", themeColors[t.id as Exclude<Theme, "custom">].bg, themeColors[t.id as Exclude<Theme, "custom">].text, "flex items-center justify-center text-[8px] font-bold border border-border")}>
                          א
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <div className="w-4 h-4 rounded-full" style={{ background: `linear-gradient(135deg, ${customColors.background} 50%, ${customColors.primary} 50%)` }} />
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: customColors.accent }} />
                        <Pipette className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 text-right">
                      <div className="font-medium text-sm">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.description}</div>
                    </div>
                    {t.id === "custom" ? (
                      <ChevronRight className="h-4 w-4 text-muted-foreground rotate-180" />
                    ) : theme === t.id ? (
                      <Check className="h-4 w-4 text-accent" />
                    ) : null}
                  </button>
                ))}
              </div>

              {/* Data backup & restore — admins only */}
              {isAdmin && (
                <div className="mt-3 pt-2 border-t border-border">
                  <button
                    onClick={() => setShowSourcesPanel(true)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg transition-all hover:bg-muted/50"
                  >
                    <Library className="w-4 h-4 text-blue-600" />
                    <div className="flex-1 text-right">
                      <div className="font-medium text-sm">מקורות פסקי הדין</div>
                      <div className="text-xs text-muted-foreground">בחירה אילו מקורות יוצגו</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground rotate-180" />
                  </button>
                  <button
                    onClick={() => setShowBackupPanel(true)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg transition-all hover:bg-muted/50"
                  >
                    <DatabaseBackup className="w-4 h-4 text-green-600" />
                    <div className="flex-1 text-right">
                      <div className="font-medium text-sm">גיבוי ושחזור נתונים</div>
                      <div className="text-xs text-muted-foreground">גיבוי לפי נושאים, שחזור מלא או חלקי</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground rotate-180" />
                  </button>
                </div>
              )}

              {/* Dev Tools Section */}
              <div className="mt-3 pt-2 border-t border-border">
                <button
                  onClick={() => setShowDevTab(true)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg transition-all hover:bg-muted/50"
                >
                  <div className="flex gap-1">
                    <Bug className="w-4 h-4 text-orange-500" />
                    <Zap className="w-4 h-4 text-yellow-500" />
                  </div>
                  <div className="flex-1 text-right">
                    <div className="font-medium text-sm">כלי פיתוח</div>
                    <div className="text-xs text-muted-foreground">קונסול שגיאות וביצועים</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground rotate-180" />
                </button>
              </div>
            </>
          ) : showDevTab ? (
            <>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                <button
                  onClick={() => setShowDevTab(false)}
                  className="p-1 hover:bg-muted rounded"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <Code2 className="h-4 w-4 text-accent" />
                <span className="font-medium">כלי פיתוח</span>
              </div>

              <div className="space-y-3">
                {/* Console Monitor Toggle */}
                <button
                  onClick={toggleConsoleMonitor}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg transition-all border",
                    consoleMonitorEnabled
                      ? "bg-orange-500/10 border-orange-500/30"
                      : "bg-muted/30 border-border hover:bg-muted/50"
                  )}
                >
                  <Bug className={cn("h-5 w-5", consoleMonitorEnabled ? "text-orange-500" : "text-muted-foreground")} />
                  <div className="flex-1 text-right">
                    <div className="font-medium text-sm">מוניטור קונסול</div>
                    <div className="text-xs text-muted-foreground">שגיאות, אזהרות, ביצועים</div>
                  </div>
                  <div className={cn(
                    "w-10 h-5 rounded-full transition-colors relative",
                    consoleMonitorEnabled ? "bg-orange-500" : "bg-muted-foreground/30"
                  )}>
                    <div className={cn(
                      "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
                      consoleMonitorEnabled ? "left-0.5" : "right-0.5"
                    )} />
                  </div>
                </button>

                {/* Performance Monitor Toggle */}
                <button
                  onClick={togglePerfMonitor}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg transition-all border",
                    perfMonitorEnabled
                      ? "bg-yellow-500/10 border-yellow-500/30"
                      : "bg-muted/30 border-border hover:bg-muted/50"
                  )}
                >
                  <Zap className={cn("h-5 w-5", perfMonitorEnabled ? "text-yellow-500" : "text-muted-foreground")} />
                  <div className="flex-1 text-right">
                    <div className="font-medium text-sm">מוניטור ביצועים</div>
                    <div className="text-xs text-muted-foreground">FPS, זמני טעינה, זיכרון</div>
                  </div>
                  <div className={cn(
                    "w-10 h-5 rounded-full transition-colors relative",
                    perfMonitorEnabled ? "bg-yellow-500" : "bg-muted-foreground/30"
                  )}>
                    <div className={cn(
                      "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
                      perfMonitorEnabled ? "left-0.5" : "right-0.5"
                    )} />
                  </div>
                </button>

                {/* Shas Manager floating button toggle */}
                <button
                  onClick={toggleShasManagerBtn}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg transition-all border",
                    shasManagerBtnEnabled
                      ? "bg-accent/10 border-accent/30"
                      : "bg-muted/30 border-border hover:bg-muted/50"
                  )}
                >
                  <Library className={cn("h-5 w-5", shasManagerBtnEnabled ? "text-accent" : "text-muted-foreground")} />
                  <div className="flex-1 text-right">
                    <div className="font-medium text-sm">כפתור ניהול ש"ס</div>
                    <div className="text-xs text-muted-foreground">כפתור צף לניהול סריקות</div>
                  </div>
                  <div className={cn(
                    "w-10 h-5 rounded-full transition-colors relative",
                    shasManagerBtnEnabled ? "bg-accent" : "bg-muted-foreground/30"
                  )}>
                    <div className={cn(
                      "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
                      shasManagerBtnEnabled ? "left-0.5" : "right-0.5"
                    )} />
                  </div>
                </button>

                {/* Dev Migrations floating button toggle */}
                <button
                  onClick={toggleDevMigrationsBtn}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg transition-all border",
                    devMigrationsBtnEnabled
                      ? "bg-purple-500/10 border-purple-500/30"
                      : "bg-muted/30 border-border hover:bg-muted/50"
                  )}
                >
                  <Code2 className={cn("h-5 w-5", devMigrationsBtnEnabled ? "text-purple-500" : "text-muted-foreground")} />
                  <div className="flex-1 text-right">
                    <div className="font-medium text-sm">כפתור מיגרציות</div>
                    <div className="text-xs text-muted-foreground">כפתור צף לפאנל המיגרציות</div>
                  </div>
                  <div className={cn(
                    "w-10 h-5 rounded-full transition-colors relative",
                    devMigrationsBtnEnabled ? "bg-purple-500" : "bg-muted-foreground/30"
                  )}>
                    <div className={cn(
                      "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
                      devMigrationsBtnEnabled ? "left-0.5" : "right-0.5"
                    )} />
                  </div>
                </button>

                <p className="text-xs text-muted-foreground text-center pt-1">
                  הכפתורים הצפים יופיעו בכל דף
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                <button 
                  onClick={() => setShowCustomizer(false)}
                  className="p-1 hover:bg-muted rounded"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <Pipette className="h-4 w-4 text-accent" />
                <span className="font-medium">התאמה אישית</span>
              </div>
              
              <div className="space-y-4">
                {(Object.keys(colorLabels) as Array<keyof CustomColors>).map((key) => (
                  <div key={key} className="space-y-2">
                    <Label className="text-sm">{colorLabels[key]}</Label>
                    <div className="flex gap-2">
                      <div className="relative">
                        <Input
                          type="color"
                          value={localColors[key]}
                          onChange={(e) => handleColorChange(key, e.target.value)}
                          className="w-10 h-10 p-1 cursor-pointer border-border"
                        />
                      </div>
                      <Input
                        type="text"
                        value={localColors[key]}
                        onChange={(e) => handleColorChange(key, e.target.value)}
                        placeholder="#000000"
                        className="flex-1 font-mono text-sm bg-input border-border"
                        dir="ltr"
                      />
                    </div>
                    {/* Preset colors */}
                    <div className="flex flex-wrap gap-1">
                      {presetColors.map((color) => (
                        <button
                          key={color}
                          onClick={() => handleColorChange(key, color)}
                          className={cn(
                            "w-5 h-5 rounded border border-border hover:scale-110 transition-transform",
                            localColors[key] === color && "ring-2 ring-accent ring-offset-1"
                          )}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                
                {/* Preview */}
                <div className="p-3 rounded-lg border border-border" style={{ backgroundColor: localColors.background }}>
                  <div className="text-sm font-medium mb-1" style={{ color: localColors.primary }}>
                    תצוגה מקדימה
                  </div>
                  <div className="flex gap-2">
                    <div 
                      className="px-3 py-1 rounded text-xs text-white"
                      style={{ backgroundColor: localColors.primary }}
                    >
                      כפתור ראשי
                    </div>
                    <div 
                      className="px-3 py-1 rounded text-xs"
                      style={{ backgroundColor: localColors.accent, color: localColors.primary }}
                    >
                      הדגשה
                    </div>
                  </div>
                </div>

                <Button 
                  onClick={applyCustomColors}
                  className="w-full"
                >
                  <Check className="h-4 w-4 ml-2" />
                  החל ערכת נושא
                </Button>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      {/* Floating Dev Tools */}
      <Suspense fallback={null}>
        {consoleMonitorEnabled && <DevConsoleMonitor />}
        {perfMonitorEnabled && <DevPerformanceMonitor />}
      </Suspense>
    </div>
  );
}
