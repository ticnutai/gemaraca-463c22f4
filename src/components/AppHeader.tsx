import { Info, BookOpen, Scale, Search, Upload, Library, User, LogOut, LogIn, ArrowDownToLine, BookMarked, History, CalendarDays, GitCompareArrows, Share2, MoreHorizontal, Menu, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useNavigate } from "react-router-dom";
import { lazy, Suspense, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageTypography } from "@/hooks/usePageTypography";

const FONTS = [
  { value: "Arial", label: "אריאל" },
  { value: "David", label: "דוד" },
  { value: "'Frank Ruhl Libre', serif", label: "פרנק רוהל" },
  { value: "'Heebo', sans-serif", label: "חיבו" },
  { value: "'Rubik', sans-serif", label: "רוביק" },
  { value: "'Noto Serif Hebrew', serif", label: "נוטו סריף" },
  { value: "Georgia, serif", label: "ג'ורג'יה" },
  { value: "'Times New Roman', serif", label: "טיימס" },
];

interface AppHeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: "gemara", label: "גמרא", icon: BookOpen },
  { id: "psak-din", label: "פסקי דין", icon: Scale },
  { id: "smart-index", label: "אינדקס חכם", icon: Library },
  { id: "advanced-index", label: "אינדקס מתקדם", icon: BookMarked },
  { id: "global-search", label: "חיפוש", icon: Search },
  { id: "upload", label: "העלאה", icon: Upload },
  { id: "download", label: "הורדה", icon: ArrowDownToLine },
  { id: "learning-history", label: "היסטוריה", icon: History },
  { id: "daf-yomi", label: "דף יומי", icon: CalendarDays },
  { id: "compare", label: "השוואה", icon: GitCompareArrows },
  { id: "knowledge-graph", label: "גרף ידע", icon: Share2 },
];

const mainTabs = tabs.slice(0, 7);
const moreTabs = tabs.slice(7);
const mobileMainTabs = tabs.slice(0, 4);
const mobileMoreTabs = tabs.slice(4);

const AppHeader = ({ activeTab, onTabChange }: AppHeaderProps) => {
  const { user, isAuthenticated, signOut } = useAuth();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const { setOpen } = useSidebar();
  const { settings, updateSettings } = usePageTypography();
  const [typoOpen, setTypoOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-accent/30 bg-primary shadow-lg safe-area-top">
      <div className="flex h-16 items-center justify-between px-4 md:px-6">
        {/* Right side - Logo and title */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground hover:bg-primary-foreground/10 min-h-[44px] min-w-[44px] rounded-full border border-primary-foreground/20"
            onClick={() => setOpen(true)}
            title="פתח סיידבר"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-xl md:text-2xl font-bold text-accent tracking-wide">
            גמרא להלכה
          </h1>
        </div>

        {/* Center - Tabs */}
        <nav className="hidden md:flex flex-1 items-center gap-1 mx-2 min-w-0 overflow-x-auto scrollbar-hide">
          {mainTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap shrink-0",
                activeTab === tab.id
                  ? "bg-accent text-accent-foreground shadow-md"
                  : "text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
              )}
            >
              <tab.icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          ))}
          {moreTabs.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
                    moreTabs.some(t => t.id === activeTab)
                      ? "bg-accent text-accent-foreground shadow-md"
                      : "text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
                  )}
                >
                  <MoreHorizontal className="h-4 w-4" />
                  <span>עוד</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="text-right">
                {moreTabs.map((tab) => (
                  <DropdownMenuItem
                    key={tab.id}
                    onClick={() => onTabChange(tab.id)}
                    className={cn(
                      "flex items-center gap-2 cursor-pointer",
                      activeTab === tab.id && "bg-accent/20 font-bold"
                    )}
                  >
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </nav>

        {/* Left side - Actions */}
        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="text-primary-foreground hover:bg-primary-foreground/10 h-10 gap-1.5 px-2"
                  title={isAdmin ? "מחובר כמנהל" : "מחובר כמשתמש רגיל"}
                >
                  <User className="h-5 w-5" />
                  {isAdmin !== null && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-[10px] font-semibold leading-4",
                        isAdmin ? "bg-accent text-accent-foreground" : "bg-primary-foreground/15 text-primary-foreground/80",
                      )}
                    >
                      {isAdmin ? "מנהל" : "משתמש"}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="text-right">
                <DropdownMenuItem disabled className="flex-col items-end gap-0.5 text-xs text-muted-foreground opacity-100">
                  <span>{user?.email}</span>
                  {isAdmin !== null && (
                    <span className={cn("font-semibold", isAdmin ? "text-accent" : "")}>
                      {isAdmin ? "מנהל מערכת" : "משתמש רגיל"}
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                  <LogOut className="h-4 w-4 ms-2" />
                  התנתק
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-primary-foreground hover:bg-primary-foreground/10 gap-2"
              onClick={() => navigate("/auth")}
            >
              <LogIn className="h-4 w-4" />
              <span className="hidden md:inline">התחבר</span>
            </Button>
          )}
          {/* Typography settings */}
          <Popover open={typoOpen} onOpenChange={setTypoOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground hover:bg-primary-foreground/10 h-9 w-9"
                title="הגדרות טקסט"
              >
                <Type className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-72 p-4 space-y-4" dir="rtl">
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Type className="h-4 w-4 text-accent" />
                הגדרות טקסט
              </h4>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">גופן</label>
                <Select value={settings.fontFamily} onValueChange={(v) => updateSettings({ fontFamily: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FONTS.map((f) => (
                      <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">גודל גופן</label>
                  <span className="text-xs font-semibold text-foreground">{settings.fontSize}px</span>
                </div>
                <Slider value={[settings.fontSize]} onValueChange={([v]) => updateSettings({ fontSize: v })} min={12} max={28} step={1} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">מרווח שורות</label>
                  <span className="text-xs font-semibold text-foreground">{settings.lineHeight.toFixed(1)}</span>
                </div>
                <Slider value={[settings.lineHeight * 10]} onValueChange={([v]) => updateSettings({ lineHeight: v / 10 })} min={10} max={30} step={1} />
              </div>
              <div className="p-3 rounded-md border border-border bg-muted/30 text-foreground" style={{ fontFamily: settings.fontFamily, fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}>
                דוגמא לטקסט בהגדרות הנבחרות
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground hover:bg-primary-foreground/10"
          >
            <Info className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Mobile tabs - reduced and cleaner */}
      <nav className="md:hidden flex items-center gap-1.5 px-3 pb-3 overflow-x-auto scrollbar-hide border-t border-primary-foreground/15">
        {mobileMainTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap min-h-[40px]",
              activeTab === tab.id
                ? "bg-accent text-accent-foreground"
                : "bg-primary-foreground/10 text-primary-foreground/80"
            )}
          >
            <tab.icon className="h-4 w-4 shrink-0" />
            <span>{tab.label}</span>
          </button>
        ))}

        {mobileMoreTabs.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap min-h-[40px]",
                  mobileMoreTabs.some(t => t.id === activeTab)
                    ? "bg-accent text-accent-foreground"
                    : "bg-primary-foreground/10 text-primary-foreground/80"
                )}
              >
                <MoreHorizontal className="h-4 w-4" />
                <span>עוד</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-right">
              {mobileMoreTabs.map((tab) => (
                <DropdownMenuItem
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    "flex items-center gap-2 cursor-pointer",
                    activeTab === tab.id && "bg-accent/20 font-bold"
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
    </header>
  );
};

export default AppHeader;
