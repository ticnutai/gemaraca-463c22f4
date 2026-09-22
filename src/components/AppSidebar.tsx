import { useState, useEffect, useRef, useMemo } from "react";
import { BookOpen, Scale, Search, Upload, Pin, PinOff, ChevronDown, ChevronLeft, ArrowDownToLine, BookMarked, FileText, Database, FileType, Calendar, BookA, Map, Layers, GraduationCap, BarChart3, Compass, Paintbrush, Globe, History, CalendarCheck, GitCompareArrows, Share2, Eye, FolderOpen } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MASECHTOT, SEDARIM } from "@/lib/masechtotData";

interface AppSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onMasechetSelect?: (masechetHebrewName: string) => void;
  isPinned?: boolean;
  onPinToggle?: () => void;
  isMobile?: boolean;
}

const menuItems = [
  {
    id: "gemara",
    title: "גמרא",
    icon: BookOpen,
    description: "לימוד מסכתות ודפים",
  },
  {
    id: "psak-din",
    title: "פסקי דין",
    icon: Scale,
    description: "צפייה בפסקי דין",
  },
  {
    id: "folders",
    title: "תיקיות",
    icon: FolderOpen,
    description: "ניהול תיקיות וסיווג פסקי דין",
    badge: "חדש",
  },
  {
    id: "search",
    title: "חיפוש פסקי דין",
    icon: Search,
    description: "חיפוש במאגר",
  },
  {
    id: "upload",
    title: "העלאה",
    icon: Upload,
    description: "העלאת מסמכים",
  },
  {
    id: "download",
    title: "הורדה",
    icon: ArrowDownToLine,
    description: "הורדת פסקי דין",
  },
  {
    // שלושה מסכים שונים הציגו את אותו דבר — מראה מקום מפסק דין אל דף בגמרא:
    // "אינדקס מתקדם" מן המסד המאומת, "אינדקס חכם" מטבלאות ניתוח מדצמבר 2025,
    // ו"מפתח המקורות" מצילום סטטי של אתר פסקים. מדידה של שלושתם באותן שלוש
    // בדיקות (דף בטווח המסכת, יש עמוד, הציטוט אינו שבר מילה) נתנה 81% / 39% /
    // 20%. כאן הם מאוחדים ליעד אחד, שברירת המחדל שלו היא העץ המאוחד מן המסד,
    // והשאר נשארים כתצוגות בתוכו.
    id: "sources-index",
    title: "מפתח המקורות",
    icon: BookOpen,
    description: "מראי מקומות מאומתים מפסקי דין אל הש\"ס",
  },
  {
    id: "bulk-shas",
    title: "הורדת ש\"ס",
    icon: Database,
    description: "הורדת כל הש\"ס לענן",
  },
  {
    id: "embedpdf-viewer",
    title: "צפיין מסמכים",
    icon: FileType,
    description: "צפיין PDF מתקדם עם הערות, סימניות ועיצוב",
  },
  {
    id: "weekly-planner",
    title: "לוח שבועי",
    icon: Calendar,
    description: "תכנון לימוד שבועי עם יעדים",
    badge: "חדש",
  },
  {
    id: "glossary",
    title: "מילון מונחים",
    icon: BookA,
    description: "מילון מונחים ארמיים ומשפטיים",
    badge: "חדש",
  },
  {
    id: "shas-heatmap",
    title: "מפת חום הש\"ס",
    icon: Map,
    description: "ויזואליזציה של מה שלמדת",
    badge: "חדש",
  },
  {
    id: "flashcards",
    title: "כרטיסיות חזרה",
    icon: Layers,
    description: "חזרה מרווחת עם כרטיסיות",
    badge: "חדש",
  },
  {
    id: "quiz",
    title: "מצב מבחן",
    icon: GraduationCap,
    description: "שאלות AI אוטומטיות",
    badge: "חדש",
  },
  {
    id: "stats",
    title: "סטטיסטיקות",
    icon: BarChart3,
    description: "דשבורד וגרפים של הלמידה",
    badge: "חדש",
  },
  {
    id: "recommendations",
    title: "המלצות למידה",
    icon: Compass,
    description: "מה ללמוד הלאה - AI",
    badge: "חדש",
  },
  {
    id: "beautify-psak",
    title: "עיצוב פסקי דין",
    icon: Paintbrush,
    description: "עיצוב מתקדם של פסקי דין מטקסט",
    badge: "חדש",
  },
  {
    id: "global-search",
    title: "חיפוש גלובלי",
    icon: Globe,
    description: "חיפוש בכל המקורות",
  },
  {
    id: "learning-history",
    title: "היסטוריית למידה",
    icon: History,
    description: "מעקב אחר דפים שנלמדו",
  },
  {
    id: "daf-yomi",
    title: "דף יומי",
    icon: CalendarCheck,
    description: "מעקב דף יומי",
  },
  {
    id: "compare",
    title: "השוואת פסקים",
    icon: GitCompareArrows,
    description: "השוואה בין פסקי דין",
  },
  {
    id: "knowledge-graph",
    title: "גרף ידע",
    icon: Share2,
    description: "ויזואליזציה של קשרים בין סוגיות",
  },
  {
    id: "ocr",
    title: "זיהוי טקסט (OCR)",
    icon: Eye,
    description: "זיהוי טקסט עברי מתמונות ו-PDF עם GPU",
    badge: "חדש",
  },
];

const AppSidebar = ({ 
  activeTab, 
  onTabChange, 
  onMasechetSelect,
  isPinned = true,
  onPinToggle,
  isMobile = false
}: AppSidebarProps) => {
  const { setOpen, open: sidebarOpen } = useSidebar();
  const [expandedSedarim, setExpandedSedarim] = useState<Set<string>>(new Set());
  const [isHovered, setIsHovered] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-hide: when unpinned, detect mouse at right edge to open sidebar
  useEffect(() => {
    if (isPinned || isMobile) return;

    const handleMouseMove = (e: MouseEvent) => {
      const windowWidth = window.innerWidth;
      const hoverZone = 30;
      
      if (windowWidth - e.clientX <= hoverZone) {
        if (!isHovered && !sidebarOpen) {
          if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
          }
          setIsHovered(true);
          setOpen(true);
        }
      }
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [isPinned, isHovered, sidebarOpen, setOpen, isMobile]);

  // Close sidebar after mouse leaves (with delay)
  const handleMouseLeave = () => {
    if (isPinned || isMobile) return;
    
    closeTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      setOpen(false);
    }, 1500);
  };

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const toggleSeder = (seder: string) => {
    const newExpanded = new Set(expandedSedarim);
    if (newExpanded.has(seder)) {
      newExpanded.delete(seder);
    } else {
      newExpanded.add(seder);
    }
    setExpandedSedarim(newExpanded);
  };

  const handlePinToggle = () => {
    if (onPinToggle) {
      onPinToggle();
    }
    if (!isPinned) {
      // Becoming pinned — open sidebar
      setOpen(true);
    }
  };

  const groupedMasechtot = useMemo(() => SEDARIM.map(seder => ({
    seder,
    masechtot: MASECHTOT.filter(m => m.seder === seder)
  })), []);

  const closeSidebarOnMobile = () => {
    if (isMobile || !isPinned) {
      setOpen(false);
      setIsHovered(false);
    }
  };

  // Determine if sidebar is visible (for reflow purposes)
  const sidebarVisible = isPinned || sidebarOpen || isHovered;

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div 
          className="fixed inset-0 top-[56px] z-40 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300"
          onClick={() => {
            setOpen(false);
            setIsHovered(false);
          }}
        />
      )}
      <Sidebar 
        side="right" 
        className={cn(
          "border border-border/50 !bg-sidebar",
          "overflow-hidden",
          "transition-all duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
          isMobile
            ? cn(
                "fixed !top-[56px] z-50 w-[80vw] max-w-[300px] shadow-2xl",
                "!h-[calc(100vh-56px)] !rounded-tl-2xl !rounded-bl-none !rounded-r-none",
                sidebarOpen ? "right-0" : "-right-[82vw]"
              )
            : cn(
                "fixed right-0 z-40",
                "!top-[64px] !h-[calc(100vh-64px-0.5rem)] !mr-2 !mb-2",
                "!rounded-2xl"
              ),
          !isMobile && !sidebarVisible && "translate-x-full",
          !isMobile && !isPinned && sidebarVisible && "shadow-2xl"
        )}
        collapsible="none"
        variant="sidebar"
        style={{ 
          backgroundColor: 'hsl(var(--sidebar-background, var(--background)))',
        }}
        onMouseEnter={isMobile ? undefined : handleMouseEnter}
        onMouseLeave={isMobile ? undefined : handleMouseLeave}
      >
      <SidebarHeader className="border-b border-border/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">ניווט ראשי</h2>
            <p className="text-xs text-muted-foreground">מסכתות ופסקי דין</p>
          </div>
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePinToggle}
              className="h-9 w-9 border border-border/50 rounded-lg"
              title={isPinned ? "אוטו-הייד" : "נעץ סיידבר"}
            >
              {isPinned ? (
                <Pin className="h-4 w-4 text-primary" />
              ) : (
                <PinOff className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          )}
        </div>
      </SidebarHeader>
      
      <SidebarContent className="px-2 overflow-y-auto">
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground text-xs mb-2 px-2">
            תפריט
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    onClick={() => { onTabChange(item.id); closeSidebarOnMobile(); }}
                    isActive={activeTab === item.id}
                    tooltip={item.description}
                    className={cn(
                      "rounded-xl py-2.5 px-3 transition-all duration-200",
                      activeTab === item.id 
                        ? "bg-primary text-primary-foreground shadow-md" 
                        : "hover:bg-secondary/80 text-foreground"
                    )}
                  >
                    <item.icon className={cn(
                      "h-4 w-4",
                      activeTab === item.id ? "text-accent" : "text-muted-foreground"
                    )} />
                    <span className="font-medium text-sm">{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="text-muted-foreground text-xs mb-2 px-2">
            מסכתות הגמרא
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="space-y-1">
              {groupedMasechtot.map((group) => (
                <div key={group.seder} className="rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleSeder(group.seder)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-3 text-sm font-medium transition-all min-h-[44px]",
                      "bg-secondary/50 hover:bg-secondary text-foreground rounded-lg",
                      expandedSedarim.has(group.seder) && "rounded-b-none"
                    )}
                  >
                    <span>סדר {group.seder}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {group.masechtot.length} מסכתות
                      </span>
                      {expandedSedarim.has(group.seder) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </button>

                  {expandedSedarim.has(group.seder) && (
                    <div className="bg-muted/30 rounded-b-lg border-x border-b border-border/30">
                      {group.masechtot.map((masechet, index) => (
                        <button
                          key={masechet.englishName}
                          type="button"
                          onClick={() => {
                            if (onMasechetSelect) {
                              onMasechetSelect(masechet.hebrewName);
                            } else {
                              onTabChange("gemara");
                            }
                            closeSidebarOnMobile();
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-4 py-3 text-sm transition-all min-h-[44px]",
                            "hover:bg-accent/10 text-foreground cursor-pointer",
                            index !== group.masechtot.length - 1 && "border-b border-border/20"
                          )}
                        >
                          <span>{masechet.hebrewName}</span>
                          <span className="text-xs text-muted-foreground">
                            {masechet.maxDaf - 1} דפים
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border/50 p-3">
        <div className="text-center text-xs text-muted-foreground">
          גמרא להלכה © {new Date().getFullYear()}
        </div>
      </SidebarFooter>
    </Sidebar>
    </>
  );
};

export default AppSidebar;
