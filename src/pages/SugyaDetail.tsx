import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, lazy, Suspense, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, BookOpen, Scale, ExternalLink, Lightbulb, FileText, HelpCircle, ChevronLeft, Home, Layers } from "lucide-react";
import DafAmudNavigator from "@/components/DafAmudNavigator";
import DafPickerDialog, { trackDafVisit } from "@/components/DafPickerDialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import FAQSection from "@/components/FAQSection";
import PsakDinSearchButton from "@/components/PsakDinSearchButton";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MASECHTOT } from "@/lib/masechtotData";
import { getCachedPage, setCachedPage } from "@/lib/pageCache";
import { toHebrewNumeral } from "@/lib/hebrewNumbers";
import { recordPageVisit, updateVisitDuration } from "@/components/LearningHistoryTab";

// Lazy-loaded heavy sub-panels
const GemaraTextPanel = lazy(() => import("@/components/GemaraTextPanel"));
const CommentariesPanel = lazy(() => import("@/components/CommentariesPanel"));
const LexiconSearch = lazy(() => import("@/components/LexiconSearch"));
const RelatedPsakimSidebar = lazy(() => import("@/components/RelatedPsakimSidebar"));
const LinkedPsakimSection = lazy(() => import("@/components/LinkedPsakimSection"));
const ModernExamplesPanel = lazy(() => import("@/components/ModernExamplesPanel").then(m => ({ default: m.ModernExamplesPanel })));
const PersonalNotes = lazy(() => import("@/components/PersonalNotes"));
const PsakeiDinDafPanel = lazy(() => import("@/components/PsakeiDinDafPanel"));
const SugyaSummary = lazy(() => import("@/components/SugyaSummary"));
const AskAboutDaf = lazy(() => import("@/components/AskAboutDaf"));
const CollaborativeNotes = lazy(() => import("@/components/CollaborativeNotes"));
const ShareSugyaDialog = lazy(() => import("@/components/ShareSugyaDialog"));

const PanelFallback = () => (
  <div className="space-y-3 p-4">
    <Skeleton className="h-6 w-40" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-24 w-full" />
  </div>
);

interface SugyaCase {
  title: string;
  court: string;
  year: number;
  summary: string;
  connection: string;
}

interface LoadedPageData {
  title: string;
  dafYomi: string;
  summary: string;
  tags: string[];
  masechet: string;
  gemaraText: string;
  fullText: string;
  cases: SugyaCase[];
}

interface RealCaseLink {
  id: string;
  psak_din_id: string;
  relevance_score: number;
  connection_explanation?: string;
  psakei_din: {
    id: string;
    title: string;
    court: string;
    year: number;
    summary: string;
    case_number?: string;
    tags?: string[];
    source_url?: string;
  };
}

interface FaqItem {
  id: string;
  psak_din_id: string;
  question: string;
  answer: string;
  order_index?: number;
}

// Helper function to get Hebrew name from Sefaria name
const getMasechetHebrewName = (sefariaName: string): string => {
  const masechet = MASECHTOT.find(m => m.sefariaName === sefariaName);
  return masechet?.hebrewName || sefariaName;
};

// Parse sugya_id like "bava_batra_2a" into masechet + daf + amud
const parseSugyaId = (sugyaId: string) => {
  for (const m of MASECHTOT) {
    const prefix = m.sefariaName.toLowerCase() + '_';
    if (sugyaId.startsWith(prefix)) {
      const rest = sugyaId.slice(prefix.length);
      const match = rest.match(/^(\d+)([ab])$/);
      if (match) {
        return { masechet: m, dafNumber: parseInt(match[1]), amud: match[2] as 'a' | 'b' };
      }
    }
  }
  return null;
};

const SugyaDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [realCases, setRealCases] = useState<RealCaseLink[]>([]);
  const [faqItems, setFaqItems] = useState<FaqItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedPage, setLoadedPage] = useState<LoadedPageData | null>(null);
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [mainTab, setMainTab] = useState("gemara");
  const [selectedGemaraText, setSelectedGemaraText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // מאיפה נפתח בורר הדפים. בלי זה הוא נפתח תמיד על רשימת הסדרים, גם כשהגיעו
  // אליו מפירורי הלחם של דף מסוים.
  const [pickerStart, setPickerStart] = useState<{ seder?: string; masechet?: string; daf?: number }>({});
  const openPicker = (at: { seder?: string; masechet?: string; daf?: number } = {}) => {
    setPickerStart(at);
    setPickerOpen(true);
  };

  // Keyboard shortcut: Cmd/Ctrl+K opens picker
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPickerOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Track recently visited daf for the picker
  useEffect(() => {
    if (id) trackDafVisit(id);
  }, [id]);
  
  const sugya = loadedPage;
  const enterTimeRef = useRef(Date.now());

  // Record learning history on mount/unmount
  useEffect(() => {
    enterTimeRef.current = Date.now();
    return () => {
      if (id) updateVisitDuration(id, Date.now() - enterTimeRef.current);
    };
  }, [id]);

  // Record page visit when data loads
  useEffect(() => {
    if (loadedPage && id) {
      recordPageVisit({
        sugyaId: id,
        title: loadedPage.title,
        dafYomi: loadedPage.dafYomi,
        masechet: loadedPage.masechet || "",
      });
    }
  }, [loadedPage, id]);

  useEffect(() => {
    if (id) {
      // Run both queries in parallel instead of sequentially
      Promise.all([loadPageFromDB(), fetchRealCases()]);
    }
  }, [id]);

  const loadPageFromDB = async () => {
    if (!id) return;
    
    // Check cache first
    const cached = getCachedPage(id);
    if (cached) {
      console.log('Using cached page for:', id);
      setLoadedPage(cached as LoadedPageData);
      setIsPageLoading(false);
      return;
    }

    setIsPageLoading(true);
    try {
      const { data, error } = await supabase
        .from('gemara_pages')
        .select('*')
        .eq('sugya_id', id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        // Extract masechet name from the data
        const masechetName = data.masechet || 'Bava_Batra';
        const hebrewMasechetName = getMasechetHebrewName(masechetName);
        
        // Cast to access columns not in generated types
        const ext = data as Record<string, unknown>;
        
        // Convert DB format to component format
        const pageData: LoadedPageData = {
          title: data.title,
          dafYomi: data.daf_yomi,
          summary: `דף ${data.daf_yomi}`,
          tags: (ext.tags as string[]) || ["גמרא", hebrewMasechetName],
          masechet: masechetName,
          gemaraText: (ext.gemara_text as string) || "",
          fullText: (ext.full_text as string) || "",
          cases: (ext.cases as SugyaCase[]) || []
        };
        
        // Save to cache
        setCachedPage(id, pageData);
        setLoadedPage(pageData);
      } else {
        // Page not in DB — create a fallback page from the sugya_id
        const parsed = parseSugyaId(id);
        if (parsed) {
          const { masechet, dafNumber, amud } = parsed;
          const amudStr = amud === 'a' ? 'ע"א' : 'ע"ב';
          const dafYomi = `${masechet.hebrewName} ${toHebrewNumeral(dafNumber)} ${amudStr}`;
          const fallbackPage = {
            title: `${masechet.hebrewName} דף ${toHebrewNumeral(dafNumber)}`,
            dafYomi,
            summary: `דף ${dafYomi}`,
            tags: ["גמרא", masechet.hebrewName],
            masechet: masechet.sefariaName,
            gemaraText: "",
            fullText: "",
            cases: []
          };
          setCachedPage(id, fallbackPage);
          setLoadedPage(fallbackPage);
        }
      }
    } catch (error) {
      console.error('Error loading page from DB:', error);
    } finally {
      setIsPageLoading(false);
    }
  };

  const fetchRealCases = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await (supabase as any)
        .from('sugya_psak_links')
        .select(`
          *,
          psakei_din:psak_din_id (*)
        `)
        .eq('sugya_id', id)
        .order('relevance_score', { ascending: false });

      if (error) {
        console.error('Error fetching real cases:', error);
      } else {
        setRealCases(data || []);
        // Fetch FAQ items in parallel — don't wait for cases to finish rendering
        if (data && data.length > 0) {
          const psakDinIds = data.map((link: RealCaseLink) => link.psak_din_id);
          // Fire and forget — don't cascade
          fetchFAQItems(psakDinIds);
        }
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFAQItems = async (psakDinIds: string[]) => {
    try {
      const { data, error } = await (supabase as any)
        .from('faq_items')
        .select('*')
        .in('psak_din_id', psakDinIds)
        .order('order_index', { ascending: true });

      if (error) {
        console.error('Error fetching FAQ items:', error);
      } else {
        setFaqItems(data || []);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Extract masechet info for LinkedPsakimSection
  const getMasechetInfo = () => {
    if (!id) return null;
    const parsed = parseSugyaId(id);
    if (parsed) {
      return { masechet: parsed.masechet.hebrewName, dafNumber: parsed.dafNumber };
    }
    return null;
  };

  const masechetInfo = getMasechetInfo();

  // Show loading state while page is being fetched
  if (isPageLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground">טוען דף...</p>
        </div>
      </div>
    );
  }

  if (!sugya) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">סוגיה לא נמצאה</h1>
          <Button onClick={() => navigate("/")}>חזרה לדף הבית</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-8">
        {/* Header - Single compact toolbar (back + unified share dialog) */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => {
              if (window.history.length > 1) {
                navigate(-1);
              } else {
                navigate('/');
              }
            }}
            className="gap-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="w-4 h-4 rotate-180" />
            חזרה
          </Button>
          <Suspense fallback={null}>
            <ShareSugyaDialog
              sugyaId={id || ""}
              masechet={sugya.masechet}
              daf={sugya.dafYomi}
              title={sugya.title}
              selectedText={selectedGemaraText}
              bodyText={sugya.gemaraText || sugya.fullText || sugya.summary}
              htmlContent={sugya.gemaraText || sugya.fullText}
            />
          </Suspense>
        </div>

        {/* Breadcrumb: Home > Seder > Masechet > Daf  + quick picker trigger */}
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <Breadcrumb>
            <BreadcrumbList className="text-xs sm:text-sm">
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <button onClick={() => navigate('/')} className="flex items-center gap-1">
                    <Home className="w-3.5 h-3.5" />
                    בית
                  </button>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {(() => {
                const masechetData = MASECHTOT.find(m => m.hebrewName === sugya.masechet || m.sefariaName === sugya.masechet);
                if (!masechetData) return null;
                return (
                  <>
                    <BreadcrumbSeparator><ChevronLeft className="w-3.5 h-3.5" /></BreadcrumbSeparator>
                    <BreadcrumbItem>
                      <BreadcrumbLink asChild>
                        <button onClick={() => openPicker({ seder: masechetData.seder })} className="hover:text-foreground transition-colors">
                          סדר {masechetData.seder}
                        </button>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator><ChevronLeft className="w-3.5 h-3.5" /></BreadcrumbSeparator>
                    <BreadcrumbItem>
                      <BreadcrumbLink asChild>
                        <button
                          onClick={() => openPicker({ seder: masechetData.seder, masechet: masechetData.hebrewName })}
                          className="hover:text-foreground transition-colors"
                        >
                          {masechetData.hebrewName}
                        </button>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                  </>
                );
              })()}
              {sugya.dafYomi && (
                <>
                  <BreadcrumbSeparator><ChevronLeft className="w-3.5 h-3.5" /></BreadcrumbSeparator>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <button
                        onClick={() => openPicker({ masechet: sugya.masechet, daf: parseSugyaId(id ?? '')?.dafNumber })}
                        className="hover:text-foreground transition-colors"
                      >
                        דף {sugya.dafYomi}
                      </button>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>

          <Button
            onClick={() => setPickerOpen(true)}
            variant="outline"
            size="sm"
            className="gap-1.5 h-8"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">בורר דפים</span>
            <kbd className="hidden md:inline text-[10px] bg-muted px-1.5 py-0.5 rounded">⌘K</kbd>
          </Button>
        </div>

        <DafPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} startAt={pickerStart} />

        {/* Breadcrumb-style header: masechet/daf navigator + single page title.
            DafAmudNavigator already shows masechet name + daf controls,
            and the breadcrumb above shows the full path.
            We removed the standalone <h1>{sugya.title}</h1> to avoid the "ברכות" duplication. */}
        <DafAmudNavigator className="mb-3" />

        {/* Main Tabs - flattened single row.
            "המחשה" lives only here (removed from inside the Gemara tab to avoid duplication). */}
        <Tabs value={mainTab} onValueChange={setMainTab} className="w-full" dir="rtl">
          {/* Phone: one scrollable row; desktop: seven equal columns */}
          <TabsList className="flex w-full justify-start overflow-x-auto scrollbar-hide md:grid md:grid-cols-7 mb-4 md:mb-6 h-auto sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 shadow-sm">
            <TabsTrigger value="gemara" className="flex items-center gap-1.5 py-2.5 px-3 shrink-0 text-xs sm:text-sm">
              <BookOpen className="w-4 h-4 hidden sm:block" />
              גמרא
            </TabsTrigger>
            <TabsTrigger value="commentaries" className="flex items-center gap-1.5 py-2.5 px-3 shrink-0 text-xs sm:text-sm">
              <BookOpen className="w-4 h-4 hidden sm:block" />
              מפרשים
            </TabsTrigger>
            <TabsTrigger value="lexicon" className="flex items-center gap-1.5 py-2.5 px-3 shrink-0 text-xs sm:text-sm">
              <FileText className="w-4 h-4 hidden sm:block" />
              מילון
            </TabsTrigger>
            <TabsTrigger value="illustration" className="flex items-center gap-1.5 py-2.5 px-3 shrink-0 text-xs sm:text-sm">
              <Lightbulb className="w-4 h-4 hidden sm:block" />
              המחשה
            </TabsTrigger>
            <TabsTrigger value="psakim" className="flex items-center gap-1.5 py-2.5 px-3 shrink-0 text-xs sm:text-sm">
              <Scale className="w-4 h-4 hidden sm:block" />
              פסקי דין
            </TabsTrigger>
            <TabsTrigger value="analysis" className="flex items-center gap-1.5 py-2.5 px-3 shrink-0 text-xs sm:text-sm">
              <HelpCircle className="w-4 h-4 hidden sm:block" />
              הסבר
            </TabsTrigger>
            <TabsTrigger value="ai-tools" className="flex items-center gap-1.5 py-2.5 px-3 shrink-0 text-xs sm:text-sm">
              <Lightbulb className="w-4 h-4 hidden sm:block" />
              AI כלים
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: גמרא - Gemara Text with nested tabs */}
          <TabsContent value="gemara" className="mt-0 space-y-6">
            {/* Single rendering of GemaraTextPanel — no duplicate "לשון הגמרא" card,
                no nested tabs (commentaries/lexicon/illustrations are now top-level). */}
            <SectionErrorBoundary section="טקסט גמרא">
              <Suspense fallback={<PanelFallback />}>
                <GemaraTextPanel sugyaId={id || ""} dafYomi={sugya.dafYomi} masechet={sugya.masechet} />
              </Suspense>
            </SectionErrorBoundary>
          </TabsContent>

          {/* Commentaries (was nested under Gemara) */}
          <TabsContent value="commentaries" className="mt-0 space-y-6">
            <Suspense fallback={<PanelFallback />}>
              <CommentariesPanel dafYomi={sugya.dafYomi} masechet={sugya.masechet} />
            </Suspense>
          </TabsContent>

          {/* Lexicon (was nested under Gemara) */}
          <TabsContent value="lexicon" className="mt-0 space-y-6">
            <Suspense fallback={<PanelFallback />}>
              <LexiconSearch dafYomi={sugya.dafYomi} />
            </Suspense>
          </TabsContent>

          {/* Tab 2: המחשה - Modern Examples */}
          <TabsContent value="illustration" className="mt-0 space-y-6">
            <Suspense fallback={<PanelFallback />}>
              <ModernExamplesPanel
                gemaraText={sugya.gemaraText || sugya.fullText}
                sugyaTitle={sugya.title}
                dafYomi={sugya.dafYomi}
                masechet={sugya.masechet || "בבא בתרא"}
                sugyaId={id}
              />
            </Suspense>

            {/* Sample Cases for illustration */}
            {sugya.cases && sugya.cases.length > 0 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <Scale className="w-5 h-5 text-muted-foreground" />
                    <h3 className="text-lg font-bold text-muted-foreground">
                      דוגמאות להמחשה ({sugya.cases.length})
                    </h3>
                  </div>
                  <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                    <p className="text-xs sm:text-sm text-yellow-800 dark:text-yellow-200">
                      💡 אלו דוגמאות להמחשה בלבד. להשגת פסקי דין אמיתיים, עבור לטאב "פסקי דין".
                    </p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  {sugya.cases.map((case_: SugyaCase, index: number) => (
                    <Card key={index} className="p-4 space-y-3 hover:shadow-lg transition-all">
                      <div className="space-y-1">
                        <h4 className="text-base font-bold text-foreground">{case_.title}</h4>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="font-medium">{case_.court}</span>
                          <span>•</span>
                          <span>{case_.year}</span>
                        </div>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">{case_.summary}</p>
                      <div className="pt-2 border-t border-border">
                        <p className="text-xs font-medium text-primary">
                          <span className="text-muted-foreground">קשר לגמרא: </span>
                          {case_.connection}
                        </p>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Tab 3: פסקי דין - Legal Rulings */}
          <TabsContent value="psakim" className="mt-0 space-y-6">
            {/* Psakei Din from Advanced Index (talmud_references) */}
            {masechetInfo && (
              <Suspense fallback={<PanelFallback />}>
                <PsakeiDinDafPanel
                  tractate={masechetInfo.masechet}
                  daf={masechetInfo.dafNumber.toString()}
                  sugyaId={id || ""}
                  dafYomi={sugya.dafYomi}
                  masechet={sugya.masechet}
                />
              </Suspense>
            )}

            {/* Search Button */}
            <PsakDinSearchButton
              sugyaId={id || ""}
              sugyaTitle={sugya.title}
              sugyaDescription={sugya.summary}
              onSearchComplete={fetchRealCases}
            />

            {/* Linked Psakim from Smart Index */}
            {masechetInfo && (
              <Suspense fallback={<PanelFallback />}>
                <LinkedPsakimSection 
                  sugyaId={id || ""} 
                  masechet={masechetInfo.masechet}
                  dafNumber={masechetInfo.dafNumber}
                />
              </Suspense>
            )}

            {/* Real Cases from Database */}
            {realCases.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Scale className="w-5 h-5 text-accent" />
                  <h3 className="text-lg font-bold text-foreground">
                    פסקי דין אמיתיים ({realCases.length})
                  </h3>
                </div>
                
                <div className="space-y-3">
                  {realCases.map((link: RealCaseLink) => {
                    const caseData = link.psakei_din;
                    const caseFaqItems = faqItems.filter(
                      (faq) => faq.psak_din_id === caseData.id
                    );
                    
                    return (
                      <Card key={link.id} className="p-4 space-y-3 hover:shadow-lg transition-all border-2 border-primary/20">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="default" className="bg-gradient-to-r from-primary to-secondary text-xs">
                              רלוונטיות: {link.relevance_score}/10
                            </Badge>
                          </div>
                          <h4 className="text-base font-bold text-foreground">{caseData.title}</h4>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span className="font-medium">{caseData.court}</span>
                            <span>•</span>
                            <span>{caseData.year}</span>
                            {caseData.case_number && (
                              <>
                                <span>•</span>
                                <span className="font-mono">{caseData.case_number}</span>
                              </>
                            )}
                          </div>
                          {caseData.tags && caseData.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {(caseData.tags as string[]).map((tag: string, i: number) => (
                                <Badge key={i} variant="secondary" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        
                        {caseData.source_url && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full gap-2 text-xs"
                            asChild
                          >
                            <a 
                              href={caseData.source_url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="w-3 h-3" />
                              צפייה בפסק הדין המלא
                            </a>
                          </Button>
                        )}
                        
                        <p className="text-sm text-foreground leading-relaxed">{caseData.summary}</p>
                        
                        <div className="pt-2 border-t border-border">
                          <p className="text-xs font-medium text-primary">
                            <span className="text-muted-foreground">קשר לגמרא: </span>
                            {link.connection_explanation || ''}
                          </p>
                        </div>

                        {caseFaqItems.length > 0 && (
                          <div className="pt-2 border-t border-border">
                            <FAQSection 
                              items={caseFaqItems.map(f => ({ ...f, order_index: f.order_index ?? 0 }))} 
                              title="שאלות ותשובות"
                            />
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {isLoading && (
              <div className="text-center py-8">
                <p className="text-muted-foreground">טוען פסקי דין...</p>
              </div>
            )}

            {/* Related Psakim Sidebar content */}
            <Suspense fallback={<PanelFallback />}>
              <RelatedPsakimSidebar sugyaId={id || ""} />
            </Suspense>
          </TabsContent>

          {/* Tab 4: הסבר וניתוח - Explanation and Analysis */}
          <TabsContent value="analysis" className="mt-0 space-y-6">
            {/* Personal Notes */}
            <Suspense fallback={<PanelFallback />}>
              <PersonalNotes sugyaId={id || ""} dafYomi={sugya.dafYomi} />
            </Suspense>

            {/* Full Text Explanation */}
            {sugya.fullText && (
              <Card className="p-4 sm:p-6 bg-gradient-to-br from-card to-card/80">
                <h2 className="text-lg sm:text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  הסבר וניתוח הסוגיה
                </h2>
                <div className="prose prose-sm max-w-none text-foreground leading-relaxed whitespace-pre-line">
                  {sugya.fullText}
                </div>
              </Card>
            )}

            {/* Tags */}
            {sugya.tags && sugya.tags.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">נושאים קשורים:</h3>
                <div className="flex flex-wrap gap-2">
                  {sugya.tags.map((tag: string, index: number) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* FAQ items if available */}
            {faqItems.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-primary" />
                  שאלות נפוצות
                </h3>
                <FAQSection items={faqItems.map(f => ({ ...f, order_index: f.order_index ?? 0 }))} />
              </div>
            )}
          </TabsContent>

          {/* Tab 5: AI כלים - AI Tools */}
          <TabsContent value="ai-tools" className="mt-0 space-y-6">
            {/* Sugya Summary */}
            <Suspense fallback={<PanelFallback />}>
              <SugyaSummary
                sugyaId={id || ""}
                masechet={sugya.masechet}
                daf={sugya.dafYomi}
                title={sugya.title}
                textHe={sugya.gemaraText || sugya.fullText}
              />
            </Suspense>

            {/* Ask About Daf */}
            <Suspense fallback={<PanelFallback />}>
              <AskAboutDaf
                masechet={sugya.masechet}
                daf={sugya.dafYomi}
                fullPageText={sugya.gemaraText || sugya.fullText}
                selectedText={selectedGemaraText}
              />
            </Suspense>

            {/* Collaborative Notes */}
            <Suspense fallback={<PanelFallback />}>
              <CollaborativeNotes
                sugyaId={id || ""}
                masechet={sugya.masechet}
                daf={sugya.dafYomi}
              />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default SugyaDetail;
