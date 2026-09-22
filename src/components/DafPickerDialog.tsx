import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Search,
  Clock,
  Star,
  BookOpen,
  Library,
  ScrollText,
  Home,
  X,
  Check,
} from "lucide-react";
import { MASECHTOT, type Masechet } from "@/lib/masechtotData";
import { toHebrewNumeral } from "@/lib/hebrewNumbers";
import { cn } from "@/lib/utils";

const SEDARIM = ["זרעים", "מועד", "נשים", "נזיקין", "קדשים", "טהרות"] as const;

const RECENT_KEY = "daf_picker_recent";
const FAV_KEY = "daf_picker_favorites";

interface RecentItem {
  sugyaId: string;
  masechetHe: string;
  daf: number;
  amud: "a" | "b";
  ts: number;
}

interface DafPickerDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  /**
   * מאיפה הבורר נפתח. כשנכנסים אליו מפירורי הלחם של דף מסוים, הוא אמור
   * להיפתח על אותו מקום ולא לחזור לרשימת הסדרים: לחיצה על "ברכות" פותחת את
   * בחירת הדפים של ברכות, ולחיצה על "דף ו׳ ע״ב" פותחת גם את בחירת העמוד.
   */
  startAt?: { seder?: string; masechet?: string; daf?: number };
}

const loadRecents = (): RecentItem[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
};
const loadFavs = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch {
    return [];
  }
};

export const trackDafVisit = (sugyaId: string) => {
  try {
    const m = MASECHTOT.find((x) =>
      sugyaId.startsWith(x.sefariaName.toLowerCase() + "_")
    );
    if (!m) return;
    const rest = sugyaId.slice(m.sefariaName.length + 1);
    const match = rest.match(/^(\d+)([ab])$/);
    if (!match) return;
    const item: RecentItem = {
      sugyaId,
      masechetHe: m.hebrewName,
      daf: parseInt(match[1]),
      amud: match[2] as "a" | "b",
      ts: Date.now(),
    };
    const existing = loadRecents().filter((r) => r.sugyaId !== sugyaId);
    const updated = [item, ...existing].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch {
    /* ignore */
  }
};

const DafPickerDialog = ({ trigger, open: controlledOpen, onOpenChange, startAt }: DafPickerDialogProps) => {
  const navigate = useNavigate();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [search, setSearch] = useState("");
  const [selectedSeder, setSelectedSeder] = useState<string | null>(null);
  const [selectedMasechet, setSelectedMasechet] = useState<Masechet | null>(null);
  const [selectedDaf, setSelectedDaf] = useState<number | null>(null);
  const [favs, setFavs] = useState<string[]>(loadFavs());
  const [recents, setRecents] = useState<RecentItem[]>(loadRecents());

  // Refs for auto-scrolling columns to selected items
  const masechetColRef = useRef<HTMLDivElement>(null);
  const dafColRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRecents(loadRecents());
      setFavs(loadFavs());
      // פתיחה מפירורי הלחם: מתמקמים על המסכת והדף שבהם המשתמש נמצא
      const m = startAt?.masechet
        ? MASECHTOT.find((x) => x.hebrewName === startAt.masechet || x.sefariaName === startAt.masechet)
        : null;
      if (m || startAt?.seder) {
        setSelectedSeder(m?.seder ?? startAt?.seder ?? null);
        setSelectedMasechet(m ?? null);
        setSelectedDaf(m && startAt?.daf ? startAt.daf : null);
        setSearch("");
      }
    } else {
      // Reset state on close
      setTimeout(() => {
        setSearch("");
        setSelectedSeder(null);
        setSelectedMasechet(null);
        setSelectedDaf(null);
      }, 200);
    }
    // גם שינוי של נקודת הפתיחה מתמקם מחדש, כדי שלחיצה על פירור אחר בזמן
    // שהבורר פתוח תעביר אותו לשם ולא תשאיר אותו במקום הקודם
  }, [open, startAt?.seder, startAt?.masechet, startAt?.daf]);

  const toggleFav = (heName: string) => {
    const next = favs.includes(heName) ? favs.filter((f) => f !== heName) : [...favs, heName];
    setFavs(next);
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  };

  const masechtotInSeder = useMemo(() => {
    if (!selectedSeder) return [];
    return MASECHTOT.filter((m) => m.seder === selectedSeder);
  }, [selectedSeder]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return MASECHTOT.filter(
      (m) =>
        m.hebrewName.includes(search.trim()) ||
        m.englishName.toLowerCase().includes(q) ||
        m.sefariaName.toLowerCase().includes(q)
    ).slice(0, 12);
  }, [search]);

  const dafs = useMemo(() => {
    if (!selectedMasechet) return [];
    return Array.from({ length: selectedMasechet.maxDaf - 1 }, (_, i) => i + 2);
  }, [selectedMasechet]);

  const goTo = (m: Masechet, daf: number, amud: "a" | "b") => {
    const sugyaId = `${m.sefariaName.toLowerCase()}_${daf}${amud}`;
    trackDafVisit(sugyaId);
    setOpen(false);
    navigate(`/sugya/${sugyaId}`);
  };

  const handleSederClick = (seder: string) => {
    setSelectedSeder(seder);
    setSelectedMasechet(null);
    setSelectedDaf(null);
  };

  const handleMasechetClick = (m: Masechet) => {
    setSelectedMasechet(m);
    setSelectedDaf(null);
    if (m.seder !== selectedSeder) setSelectedSeder(m.seder);
  };

  const handleDafClick = (d: number) => {
    setSelectedDaf(d);
  };

  const goHome = () => {
    setSelectedSeder(null);
    setSelectedMasechet(null);
    setSelectedDaf(null);
    setSearch("");
  };

  const favoritesMasechtot = MASECHTOT.filter((m) => favs.includes(m.hebrewName));

  // modal={false} — הבורר משמש לניווט תוך כדי לימוד, ולכן אינו נועל את הגלילה
  // ואינו לוכד את הפוקוס, והרקע המעומעם מוסר יחד איתו.
  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        overlay={false}
        className="max-w-6xl w-[95vw] h-[88vh] p-0 overflow-hidden flex flex-col gap-0 border-2 shadow-2xl"
        dir="rtl"
      >
        {/* Header bar - Navy gradient */}
        <div className="bg-gradient-to-l from-primary to-primary/85 text-primary-foreground px-5 py-3 flex items-center justify-between border-b-2 border-accent/40">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center ring-1 ring-accent/40">
              <BookOpen className="w-5 h-5 text-accent" />
            </div>
            <div>
              <div className="font-bold text-base leading-tight">בורר דפי גמרא</div>
              <div className="text-[11px] opacity-75">בחר סדר ← מסכת ← דף ← עמוד</div>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors"
            aria-label="סגור"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search + Breadcrumb bar */}
        <div className="px-5 py-2.5 border-b border-border bg-muted/30 flex items-center gap-3 flex-wrap">
          <Breadcrumb className="flex-shrink-0">
            <BreadcrumbList className="gap-1.5">
              <BreadcrumbItem>
                <button
                  onClick={goHome}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
                >
                  <Home className="w-3.5 h-3.5" />
                  בית
                </button>
              </BreadcrumbItem>
              {selectedSeder && (
                <>
                  <BreadcrumbSeparator className="rotate-180" />
                  <BreadcrumbItem>
                    {selectedMasechet || selectedDaf ? (
                      <BreadcrumbLink
                        onClick={() => {
                          setSelectedMasechet(null);
                          setSelectedDaf(null);
                        }}
                        className="text-xs font-medium cursor-pointer"
                      >
                        {selectedSeder}
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className="text-xs font-bold text-accent">
                        {selectedSeder}
                      </BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </>
              )}
              {selectedMasechet && (
                <>
                  <BreadcrumbSeparator className="rotate-180" />
                  <BreadcrumbItem>
                    {selectedDaf ? (
                      <BreadcrumbLink
                        onClick={() => setSelectedDaf(null)}
                        className="text-xs font-medium cursor-pointer"
                      >
                        {selectedMasechet.hebrewName}
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className="text-xs font-bold text-accent">
                        {selectedMasechet.hebrewName}
                      </BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </>
              )}
              {selectedDaf && (
                <>
                  <BreadcrumbSeparator className="rotate-180" />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="text-xs font-bold text-accent">
                      דף {toHebrewNumeral(selectedDaf)}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>

          <div className="relative flex-1 min-w-[220px] mr-auto max-w-md">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="חיפוש מסכת..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-8 h-8 text-sm"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Search results overlay */}
        {search.trim() && (
          <div className="px-5 py-3 border-b border-border bg-card">
            <div className="text-[11px] font-semibold text-muted-foreground mb-2">תוצאות חיפוש</div>
            {searchResults.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2">לא נמצאו מסכתות תואמות</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {searchResults.map((m) => (
                  <button
                    key={m.sefariaName}
                    onClick={() => {
                      setSearch("");
                      handleMasechetClick(m);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-border bg-card hover:border-accent hover:bg-accent/5 text-sm font-medium transition-all"
                  >
                    {m.hebrewName}
                    <span className="text-[10px] text-muted-foreground mr-1.5">{m.seder}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quick access: recents + favorites - only at root */}
        {!selectedSeder && !search.trim() && (recents.length > 0 || favoritesMasechtot.length > 0) && (
          <div className="px-5 py-3 border-b border-border bg-gradient-to-l from-accent/5 to-transparent space-y-2.5">
            {recents.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary mb-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  לאחרונה
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recents.slice(0, 10).map((r) => {
                    const m = MASECHTOT.find((x) => x.hebrewName === r.masechetHe);
                    if (!m) return null;
                    return (
                      <button
                        key={r.sugyaId}
                        onClick={() => goTo(m, r.daf, r.amud)}
                        className="px-2.5 py-1 text-xs rounded-md border border-border bg-card hover:border-primary hover:bg-primary/5 transition-all font-medium"
                      >
                        {r.masechetHe} <span className="text-accent font-bold">{toHebrewNumeral(r.daf)}{r.amud === "a" ? "." : ":"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {favoritesMasechtot.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-accent mb-1.5">
                  <Star className="w-3.5 h-3.5 fill-accent" />
                  מועדפים
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {favoritesMasechtot.map((m) => (
                    <button
                      key={m.sefariaName}
                      onClick={() => handleMasechetClick(m)}
                      className="px-2.5 py-1 text-xs rounded-md border border-accent/40 bg-accent/10 hover:bg-accent/20 transition-all font-medium"
                    >
                      {m.hebrewName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Miller Columns - 4 columns */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-border overflow-hidden bg-background">
          {/* Column 1: Sedarim */}
          <ColumnHeader icon={<Library className="w-4 h-4" />} title="סדרים" count={6} />
          <ColumnHeader icon={<BookOpen className="w-4 h-4" />} title="מסכתות" count={masechtotInSeder.length} disabled={!selectedSeder} />
          <ColumnHeader icon={<ScrollText className="w-4 h-4" />} title="דפים" count={dafs.length} disabled={!selectedMasechet} />
          <ColumnHeader icon={<Check className="w-4 h-4" />} title="עמוד" disabled={!selectedDaf} />

          {/* Column bodies */}
          <ScrollArea className="md:row-start-2 max-h-[55vh] md:max-h-none">
            <div className="p-2 space-y-1.5">
              {SEDARIM.map((seder) => {
                const count = MASECHTOT.filter((m) => m.seder === seder).length;
                const isActive = selectedSeder === seder;
                return (
                  <button
                    key={seder}
                    onClick={() => handleSederClick(seder)}
                    className={cn(
                      "w-full group flex items-center justify-between gap-2 px-3 py-3 rounded-xl border-2 transition-all text-right",
                      isActive
                        ? "border-accent bg-accent/15 shadow-md ring-1 ring-accent/30"
                        : "border-border bg-card hover:border-accent/60 hover:bg-accent/5 hover:shadow-sm"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
                        isActive ? "bg-accent text-accent-foreground" : "bg-primary/10 text-primary group-hover:bg-accent/20"
                      )}>
                        <Library className="w-4 h-4" />
                      </div>
                      <div>
                        <div className={cn("font-bold text-sm", isActive ? "text-primary" : "text-foreground")}>{seder}</div>
                        <div className="text-[10px] text-muted-foreground">{count} מסכתות</div>
                      </div>
                    </div>
                    {isActive && <div className="w-1.5 h-8 rounded-full bg-accent" />}
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          {/* Column 2: Masechtot */}
          <ScrollArea className="md:row-start-2 max-h-[55vh] md:max-h-none" ref={masechetColRef as never}>
            <div className="p-2 space-y-1.5">
              {!selectedSeder ? (
                <EmptyState text="בחר סדר תחילה" />
              ) : (
                masechtotInSeder.map((m) => {
                  const isActive = selectedMasechet?.sefariaName === m.sefariaName;
                  const isFav = favs.includes(m.hebrewName);
                  return (
                    <button
                      key={m.sefariaName}
                      onClick={() => handleMasechetClick(m)}
                      className={cn(
                        "w-full group flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border-2 transition-all text-right",
                        isActive
                          ? "border-accent bg-accent/15 shadow-md ring-1 ring-accent/30"
                          : "border-border bg-card hover:border-accent/60 hover:bg-accent/5"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <BookOpen className={cn(
                          "w-4 h-4 flex-shrink-0",
                          isActive ? "text-accent" : "text-primary/70"
                        )} />
                        <div className="text-right min-w-0">
                          <div className={cn("font-bold text-sm truncate", isActive ? "text-primary" : "text-foreground")}>
                            {m.hebrewName}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{m.maxDaf} דפים</div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFav(m.hebrewName);
                        }}
                        className="flex-shrink-0 p-1 hover:scale-110 transition-transform"
                        aria-label="הוסף למועדפים"
                      >
                        <Star className={cn(
                          "w-3.5 h-3.5",
                          isFav ? "fill-accent text-accent" : "text-muted-foreground/40 group-hover:text-muted-foreground"
                        )} />
                      </button>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>

          {/* Column 3: Dafs - grid of squares */}
          <ScrollArea className="md:row-start-2 max-h-[55vh] md:max-h-none" ref={dafColRef as never}>
            <div className="p-2">
              {!selectedMasechet ? (
                <EmptyState text="בחר מסכת תחילה" />
              ) : (
                <div className="grid grid-cols-3 gap-1.5" dir="rtl">
                  {dafs.map((d) => {
                    const isActive = selectedDaf === d;
                    return (
                      <button
                        key={d}
                        onClick={() => handleDafClick(d)}
                        className={cn(
                          "aspect-square flex flex-col items-center justify-center rounded-xl border-2 transition-all font-bold",
                          isActive
                            ? "border-accent bg-accent text-accent-foreground shadow-lg scale-105 ring-2 ring-accent/30"
                            : "border-border bg-card text-foreground hover:border-accent hover:bg-accent/10 hover:shadow-md hover:-translate-y-0.5"
                        )}
                      >
                        <span className="text-lg leading-none">{toHebrewNumeral(d)}</span>
                        <span className={cn(
                          "text-[9px] mt-0.5 font-medium",
                          isActive ? "text-accent-foreground/80" : "text-muted-foreground"
                        )}>
                          דף
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Column 4: Amud - 2 large buttons */}
          <ScrollArea className="md:row-start-2 max-h-[55vh] md:max-h-none">
            <div className="p-3">
              {!selectedDaf || !selectedMasechet ? (
                <EmptyState text="בחר דף תחילה" />
              ) : (
                <div className="space-y-3 pt-1">
                  <div className="text-center pb-1">
                    <div className="text-[11px] text-muted-foreground">בחר עמוד</div>
                    <div className="font-bold text-primary text-sm mt-0.5">
                      {selectedMasechet.hebrewName} {toHebrewNumeral(selectedDaf)}
                    </div>
                  </div>
                  <button
                    onClick={() => goTo(selectedMasechet, selectedDaf, "a")}
                    className="w-full group relative overflow-hidden rounded-2xl border-2 border-accent/40 bg-gradient-to-br from-accent/15 to-accent/5 hover:from-accent hover:to-accent/85 hover:border-accent hover:shadow-xl transition-all p-5 hover:-translate-y-0.5"
                  >
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="text-3xl font-black text-accent group-hover:text-accent-foreground transition-colors">
                        ע״א
                      </div>
                      <div className="text-xs font-medium text-muted-foreground group-hover:text-accent-foreground/80 transition-colors">
                        עמוד ראשון • {toHebrewNumeral(selectedDaf)}.
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => goTo(selectedMasechet, selectedDaf, "b")}
                    className="w-full group relative overflow-hidden rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/15 to-primary/5 hover:from-primary hover:to-primary/85 hover:border-primary hover:shadow-xl transition-all p-5 hover:-translate-y-0.5"
                  >
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="text-3xl font-black text-primary group-hover:text-primary-foreground transition-colors">
                        ע״ב
                      </div>
                      <div className="text-xs font-medium text-muted-foreground group-hover:text-primary-foreground/80 transition-colors">
                        עמוד שני • {toHebrewNumeral(selectedDaf)}:
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2 border-t border-border bg-muted/30 text-[11px] text-muted-foreground flex items-center justify-between">
          <span>טיפ: לחץ על ⭐ להוספת מסכת למועדפים</span>
          <kbd className="px-1.5 py-0.5 rounded bg-background border border-border text-[10px] font-mono">Esc</kbd>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ColumnHeader = ({
  icon,
  title,
  count,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  disabled?: boolean;
}) => (
  <div
    className={cn(
      "px-4 py-2.5 border-b border-border bg-gradient-to-l from-primary/5 to-transparent flex items-center justify-between",
      disabled && "opacity-50"
    )}
  >
    <div className="flex items-center gap-2">
      <div className="text-primary">{icon}</div>
      <div className="font-bold text-xs text-foreground">{title}</div>
    </div>
    {typeof count === "number" && (
      <div className="text-[10px] text-muted-foreground bg-background px-1.5 py-0.5 rounded border border-border">
        {count}
      </div>
    )}
  </div>
);

const EmptyState = ({ text }: { text: string }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground/60">
    <div className="w-10 h-10 rounded-full border-2 border-dashed border-muted-foreground/20 flex items-center justify-center mb-2">
      <BookOpen className="w-4 h-4" />
    </div>
    <div className="text-xs">{text}</div>
  </div>
);

export default DafPickerDialog;
