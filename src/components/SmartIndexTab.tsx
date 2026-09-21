import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { trackRecentPsak } from "@/lib/recentPsakim";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import {
  Search, BookOpen, FileText, Sparkles, Brain, 
  Loader2, Library, Tag, BarChart3, Zap, Link2, 
  ExternalLink, Save, Database, RefreshCw, CheckCircle2,
  ArrowUpDown, ArrowUp, ArrowDown, Calendar, Filter, SlidersHorizontal,
  ScrollText, BookOpenCheck, TableIcon, LayoutGrid, List
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { 
  analyzePsakDin, 
  batchAnalyze, 
  generateIndexSummary,
  AnalysisResult,
  DetectedSource,
} from "@/lib/textAnalyzer";
import { useDocumentViewer } from "./DocumentViewerProvider";
import { toHebrewNumeral } from "@/lib/hebrewNumbers";
import { MASECHTOT } from "@/lib/masechtotData";

const BATCH_SIZE = 500;
const LOAD_PAGE_SIZE = 500;
const DISPLAY_PAGE_SIZE = 50;
const MAX_MEMORY_RESULTS = 2000;
const INITIAL_LOAD_SIZE = 200;
const STORAGE_KEY = 'smart_index_last_run';

const SmartIndexTab = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [selectedForAI, setSelectedForAI] = useState<Set<string>>(new Set());
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedMasechet, setSelectedMasechet] = useState<string | null>(null);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedPsak, setSelectedPsak] = useState<any | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [summaryDialog, setSummaryDialog] = useState<{ open: boolean; title: string; summary: string | null; loading: boolean }>({ open: false, title: '', summary: null, loading: false });
  
  // Sorting state
  const [sortBy, setSortBy] = useState<'daf-asc' | 'daf-desc' | 'date-asc' | 'date-desc' | 'links-asc' | 'links-desc' | 'confidence' | 'none'>('none');
  const [filterConfidence, setFilterConfidence] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [filterHasFullText, setFilterHasFullText] = useState<boolean | null>(null);
  const [displayPage, setDisplayPage] = useState(0);
  const [smartViewMode, setSmartViewMode] = useState<'cards' | 'table' | 'compact'>('cards');
  
  const { toast } = useToast();

  // Load saved results on mount
  useEffect(() => {
    loadSavedResults();
  }, []);

  // Load previously saved analysis results from database — initial fast load then background
  const loadSavedResults = async () => {
    setLoading(true);
    try {
      // Fast initial load — just the first page for immediate display
      const { data: initialData, error: initialError } = await supabase
        .from('smart_index_results')
        .select(`
          *,
          psakei_din:psak_din_id (id, title, summary, court, year)
        `)
        .range(0, INITIAL_LOAD_SIZE - 1);

      if (initialError) throw initialError;

      const mapRow = (row: Record<string, unknown>): AnalysisResult => ({
        id: (row.psak_din_id as string),
        title: ((row.psakei_din as Record<string, unknown>)?.title as string) || '',
        sources: row.sources as DetectedSource[],
        topics: row.topics as AnalysisResult['topics'],
        masechtot: (row.masechtot as string[]) || [],
        books: (row.books as string[]) || [],
        wordCount: row.word_count as number,
        hasFullText: row.has_full_text as boolean
      });

      const initialResults = (initialData || []).map(mapRow);
      setAnalysisResults(initialResults);
      setSavedCount(initialResults.length);
      setLoading(false);

      // Load remaining in background if there are more
      if (initialData && initialData.length === INITIAL_LOAD_SIZE) {
        let allResults = [...initialResults];
        let page = 1;
        let hasMore = true;

        while (hasMore && allResults.length < MAX_MEMORY_RESULTS) {
          const from = page * LOAD_PAGE_SIZE;
          const to = from + LOAD_PAGE_SIZE - 1;

          const { data, error } = await supabase
            .from('smart_index_results')
            .select(`
              *,
              psakei_din:psak_din_id (id, title, summary, court, year)
            `)
            .range(from, to);

          if (error) throw error;

          if (data && data.length > 0) {
            allResults = [...allResults, ...data.map(mapRow)];
            setAnalysisResults(allResults);
            setSavedCount(allResults.length);
          }

          hasMore = data?.length === LOAD_PAGE_SIZE && allResults.length < MAX_MEMORY_RESULTS;
          page++;
        }
      }
    } catch (error) {
      console.error('Error loading saved results:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate summary statistics
  const summary = useMemo(() => {
    return generateIndexSummary(analysisResults);
  }, [analysisResults]);

  // Filter results based on search and filters
  const filteredResults = useMemo(() => {
    let results = analysisResults.filter(result => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = result.title.toLowerCase().includes(query);
        const matchesTopic = result.topics.some(t => t.topic.includes(query));
        const matchesMasechet = result.masechtot.some(m => m.includes(query));
        if (!matchesTitle && !matchesTopic && !matchesMasechet) return false;
      }

      if (selectedCategory) {
        if (!result.topics.some(t => t.category === selectedCategory)) return false;
      }

      if (selectedMasechet) {
        if (!result.masechtot.includes(selectedMasechet)) return false;
      }

      if (selectedBook) {
        if (!result.books.includes(selectedBook)) return false;
      }

      // Filter by confidence
      if (filterConfidence !== 'all') {
        const gemaraSources = result.sources.filter(s => s.type === 'gemara' && s.sugyaId);
        if (gemaraSources.length === 0) return false;
        const hasMatchingConfidence = gemaraSources.some(s => s.confidence === filterConfidence);
        if (!hasMatchingConfidence) return false;
      }

      // Filter by full text
      if (filterHasFullText !== null) {
        if (result.hasFullText !== filterHasFullText) return false;
      }

      return true;
    });

    // Sort results
    if (sortBy !== 'none') {
      results = [...results].sort((a, b) => {
        // Get first gemara source for each
        const aGemara = a.sources.find(s => s.type === 'gemara' && s.dafNumber);
        const bGemara = b.sources.find(s => s.type === 'gemara' && s.dafNumber);
        
        switch (sortBy) {
          case 'daf-asc':
            // Sort by daf number ascending
            if (!aGemara?.dafNumber && !bGemara?.dafNumber) return 0;
            if (!aGemara?.dafNumber) return 1;
            if (!bGemara?.dafNumber) return -1;
            return aGemara.dafNumber - bGemara.dafNumber;
          
          case 'daf-desc':
            // Sort by daf number descending
            if (!aGemara?.dafNumber && !bGemara?.dafNumber) return 0;
            if (!aGemara?.dafNumber) return 1;
            if (!bGemara?.dafNumber) return -1;
            return bGemara.dafNumber - aGemara.dafNumber;
          
          case 'links-asc':
            // Sort by number of gemara links ascending
            const aLinks = a.sources.filter(s => s.type === 'gemara' && s.sugyaId).length;
            const bLinks = b.sources.filter(s => s.type === 'gemara' && s.sugyaId).length;
            return aLinks - bLinks;
          
          case 'links-desc':
            // Sort by number of gemara links descending
            const aLinksD = a.sources.filter(s => s.type === 'gemara' && s.sugyaId).length;
            const bLinksD = b.sources.filter(s => s.type === 'gemara' && s.sugyaId).length;
            return bLinksD - aLinksD;
          
          case 'confidence':
            // Sort by confidence (high > medium > low)
            const confidenceOrder = { high: 3, medium: 2, low: 1 };
            const aConf = aGemara?.confidence || 'low';
            const bConf = bGemara?.confidence || 'low';
            return (confidenceOrder[bConf as keyof typeof confidenceOrder] || 0) - 
                   (confidenceOrder[aConf as keyof typeof confidenceOrder] || 0);
          
          default:
            return 0;
        }
      });
    }

    return results;
  }, [analysisResults, searchQuery, selectedCategory, selectedMasechet, selectedBook, sortBy, filterConfidence, filterHasFullText]);

  // Group results by category
  const groupedByCategory = useMemo(() => {
    const groups: Record<string, AnalysisResult[]> = {};
    for (const result of filteredResults) {
      for (const topic of result.topics) {
        if (!groups[topic.category]) {
          groups[topic.category] = [];
        }
        if (!groups[topic.category].find(r => r.id === result.id)) {
          groups[topic.category].push(result);
        }
      }
    }
    return groups;
  }, [filteredResults]);

  // Group results by masechet
  const groupedByMasechet = useMemo(() => {
    const groups: Record<string, AnalysisResult[]> = {};
    for (const result of filteredResults) {
      for (const masechet of result.masechtot) {
        if (!groups[masechet]) {
          groups[masechet] = [];
        }
        groups[masechet].push(result);
      }
    }
    return groups;
  }, [filteredResults]);

  // Get IDs of psakim already indexed in the database
  const getIndexedPsakIds = async (): Promise<Set<string>> => {
    const ids = new Set<string>();
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const from = page * 1000;
      const { data, error } = await supabase
        .from('smart_index_results')
        .select('psak_din_id')
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      for (const row of data) ids.add(row.psak_din_id);
      hasMore = data.length === 1000;
      page++;
    }
    return ids;
  };

  // Save a single batch of analysis results to db immediately
  const saveBatchToDatabase = async (results: AnalysisResult[]) => {
    const insertData = results.map(result => ({
      psak_din_id: result.id,
      sources: JSON.parse(JSON.stringify(result.sources)),
      topics: JSON.parse(JSON.stringify(result.topics)),
      masechtot: result.masechtot,
      books: result.books,
      word_count: result.wordCount,
      has_full_text: result.hasFullText,
      analysis_method: 'pattern_matching'
    }));

    // Upsert in sub-batches of 50
    for (let i = 0; i < insertData.length; i += 50) {
      const chunk = insertData.slice(i, i + 50);
      const { error } = await (supabase as any)
        .from('smart_index_results')
        .upsert(chunk, { onConflict: 'psak_din_id' });
      if (error) {
        console.error('Error saving index batch:', error);
      }
    }
  };

  // Save pattern links for a batch (delete old links for these psakim, then insert new)
  const saveBatchPatternLinks = async (results: AnalysisResult[]) => {
    const psakIds = results.map(r => r.id);

    // Delete old pattern links for these specific psakim
    await supabase
      .from('pattern_sugya_links')
      .delete()
      .in('psak_din_id', psakIds);

    // Collect all new links
    const allLinks: Array<{
      psak_din_id: string;
      sugya_id: string;
      masechet: string;
      daf: string;
      amud: string | null;
      source_text: string;
      confidence: string;
    }> = [];
    for (const result of results) {
      const gemaraSources = result.sources.filter(
        s => s.type === 'gemara' && s.sugyaId && s.masechet
      );
      for (const source of gemaraSources) {
        allLinks.push({
          psak_din_id: result.id,
          sugya_id: source.sugyaId,
          masechet: source.masechet,
          daf: source.daf,
          amud: source.amud === 'a' ? 'א' : source.amud === 'b' ? 'ב' : null,
          source_text: source.text,
          confidence: source.confidence
        });
      }
    }

    // Insert in sub-batches
    for (let i = 0; i < allLinks.length; i += 100) {
      const batch = allLinks.slice(i, i + 100);
      const { error } = await supabase
        .from('pattern_sugya_links')
        .insert(batch);
      if (error) {
        console.error('Error saving pattern links batch:', error);
      }
    }
  };

  // Run text analysis with incremental save and resume
  const runTextAnalysis = async (forceRefresh = false) => {
    setAnalyzing(true);
    
    try {
      // 1. Get already-indexed IDs (unless force refresh)
      let alreadyIndexedIds = new Set<string>();
      if (!forceRefresh) {
        alreadyIndexedIds = await getIndexedPsakIds();
      }

      // 2. Get all psak IDs
      const { count } = await supabase
        .from('psakei_din')
        .select('*', { count: 'exact', head: true });
      
      const totalPsakim = count || 0;

      // Keep already-loaded results for non-refreshed items
      const existingResults = forceRefresh ? [] : [...analysisResults];
      let newSavedCount = forceRefresh ? 0 : savedCount;
      let processedSoFar = 0;

      // Calculate how many need processing
      let totalToProcess = totalPsakim;
      if (!forceRefresh && alreadyIndexedIds.size > 0) {
        // We'll count as we go (can't know exact un-indexed count without fetching)
        totalToProcess = totalPsakim - alreadyIndexedIds.size;
      }
      setAnalysisProgress({ current: 0, total: Math.max(totalToProcess, 1) });

      let offset = 0;

      while (offset < totalPsakim) {
        const { data: psakim, error } = await supabase
          .from('psakei_din')
          .select('id, title, summary, full_text, tags')
          .range(offset, offset + BATCH_SIZE - 1);

        if (error) throw error;
        if (!psakim || psakim.length === 0) break;

        // Filter out already-indexed psakim (unless force refresh)
        const toAnalyze = forceRefresh
          ? psakim
          : psakim.filter(p => !alreadyIndexedIds.has(p.id));

        if (toAnalyze.length > 0) {
          // 3. Analyze this batch
          const batchResults = batchAnalyze(toAnalyze);

          // 4. Immediately save to database (cloud)
          await saveBatchToDatabase(batchResults);
          await saveBatchPatternLinks(batchResults);

          // 5. Update UI state incrementally
          existingResults.push(...batchResults);
          newSavedCount += batchResults.length;
          processedSoFar += toAnalyze.length;

          setAnalysisResults([...existingResults]);
          setSavedCount(newSavedCount);
          setAnalysisProgress({ current: processedSoFar, total: Math.max(totalToProcess, 1) });
        } else {
          // All items in this batch are already indexed — skip
          processedSoFar += 0; // no change, but advance offset
        }

        offset += BATCH_SIZE;
        await new Promise(r => setTimeout(r, 30));
      }

      toast({
        title: "ניתוח ושמירה הושלמו",
        description: processedSoFar > 0
          ? `נותחו ונשמרו ${processedSoFar} פסקי דין חדשים (סה"כ ${newSavedCount})`
          : "כל פסקי הדין כבר מאונדקסים",
      });
    } catch (error) {
      console.error('Error analyzing:', error);
      toast({
        title: "שגיאה בניתוח",
        description: "האינדקס שנשמר עד כה לא אבד — ניתן להמשיך שוב",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  // Navigate to Gemara page
  const navigateToGemara = (source: DetectedSource) => {
    if (source.sugyaId) {
      navigate(`/sugya/${source.sugyaId}`);
    }
  };

  // Extract case summary from psak full text
  const extractCaseSummary = (text: string): string | null => {
    // Try to find a case summary section
    const patterns = [
      /(?:תקציר(?:\s+ה?מקרה)?|רקע\s+עובדתי|העובדות|תמצית\s+ה?עובדות|נושא\s+ה?תביעה|עניינו\s+של\s+פסק|תיאור\s+ה?מקרה|רקע\s+כללי|ה?סוגיה\s+שלפנינו|תקציר)\s*[:.\-–—]?\s*([\s\S]{20,800}?)(?:\n\s*\n|\n(?:[א-ת]+\s*[:.\-])|$)/i,
      /(?:^|\n)\s*(?:א\.|1\.)\s*([\s\S]{20,500}?)(?:\n\s*(?:ב\.|2\.))/,
    ];

    for (const pat of patterns) {
      const match = text.match(pat);
      if (match?.[1]) {
        return match[1].trim().replace(/\s+/g, ' ');
      }
    }

    // Fallback: first meaningful paragraph (skip header/metadata lines)
    const lines = text.split('\n').filter(l => l.trim().length > 30);
    if (lines.length > 0) {
      const firstParagraph = lines.slice(0, 3).join(' ').trim();
      if (firstParagraph.length > 50) {
        return firstParagraph.slice(0, 500) + (firstParagraph.length > 500 ? '...' : '');
      }
    }

    return null;
  };

  // Open case summary dialog
  const handleShowSummary = async (id: string, title: string) => {
    setSummaryDialog({ open: true, title, summary: null, loading: true });

    const { data } = await supabase
      .from('psakei_din')
      .select('summary, full_text')
      .eq('id', id)
      .maybeSingle();

    if (data) {
      const fullTextSummary = data.full_text ? extractCaseSummary(data.full_text) : null;
      const displaySummary = fullTextSummary || data.summary || null;
      setSummaryDialog(prev => ({ ...prev, summary: displaySummary, loading: false }));
    } else {
      setSummaryDialog(prev => ({ ...prev, summary: null, loading: false }));
    }
  };

  // Toggle selection for AI analysis
  const toggleAISelection = (id: string) => {
    setSelectedForAI(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Select all filtered results for AI
  const selectAllForAI = () => {
    if (selectedForAI.size === filteredResults.length) {
      setSelectedForAI(new Set());
    } else {
      setSelectedForAI(new Set(filteredResults.map(r => r.id)));
    }
  };

  // Run AI analysis on selected items
  const runAIAnalysis = async () => {
    if (selectedForAI.size === 0) {
      toast({
        title: "בחר פסקי דין לניתוח AI",
        variant: "destructive",
      });
      return;
    }

    setAiAnalyzing(true);
    const idsToAnalyze = Array.from(selectedForAI);
    setAiProgress({ current: 0, total: idsToAnalyze.length });

    let successCount = 0;
    
    for (let i = 0; i < idsToAnalyze.length; i++) {
      setAiProgress({ current: i + 1, total: idsToAnalyze.length });
      
      try {
        const { error } = await supabase.functions.invoke('analyze-psak-din', {
          body: { psakId: idsToAnalyze[i] }
        });
        
        if (!error) {
          successCount++;
        }
      } catch (err) {
        console.error(`Error analyzing psak ${idsToAnalyze[i]}:`, err);
      }
      
      if (i < idsToAnalyze.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    setAiAnalyzing(false);
    setSelectedForAI(new Set());
    
    toast({
      title: "ניתוח AI הושלם",
      description: `נותחו ${successCount} פסקי דין בהצלחה`,
    });
  };

  // Load psak for dialog
  const { open: openDocument } = useDocumentViewer();
  const handlePsakClick = async (id: string) => {
    trackRecentPsak(id);
    const { data } = await supabase
      .from('psakei_din')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    
    if (!data) return;

    openDocument({ id: data.id, title: data.title, source_url: data.source_url as string | null });
  };

  // Render source badge with link
  const renderSourceBadge = (source: DetectedSource, index: number) => {
    if (source.type === 'gemara' && source.sugyaId) {
      const dafDisplay = source.dafNumber ? toHebrewNumeral(source.dafNumber) : '';
      const amudDisplay = source.amud === 'a' ? 'א' : source.amud === 'b' ? 'ב' : '';
      
      return (
        <Badge
          key={index}
          variant="default"
          className="cursor-pointer gap-1 hover:bg-primary/80 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            navigateToGemara(source);
          }}
        >
          <Link2 className="w-3 h-3" />
          {source.masechet} {dafDisplay}{amudDisplay ? ` ע"${amudDisplay}` : ''}
        </Badge>
      );
    }
    
    return (
      <Badge key={index} variant="outline" className="text-xs">
        {source.text.slice(0, 30)}...
      </Badge>
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8" dir="rtl">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-10 w-32" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
    <div className="container mx-auto px-4 py-8" dir="rtl">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-row-reverse flex-wrap gap-4">
          <div className="text-right">
            <h2 className="text-2xl font-bold text-foreground flex items-center gap-2 flex-row-reverse">
              אינדקס חכם
              <Library className="w-6 h-6 text-primary" />
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              זיהוי אוטומטי של מקורות תלמודיים והלכתיים • קישור ישיר לדפי גמרא
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            {savedCount > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Database className="w-3 h-3" />
                {savedCount} שמורים בענן
              </Badge>
            )}
            
            {!analyzing && (
              <>
                <Button onClick={() => runTextAnalysis()} className="gap-2 flex-row-reverse">
                  {analysisResults.length === 0 ? 'התחל ניתוח' : 'המשך אינדקוס'}
                  <Zap className="w-4 h-4" />
                </Button>
                {analysisResults.length > 0 && (
                  <Button 
                    variant="outline" 
                    onClick={() => runTextAnalysis(true)} 
                    className="gap-2 flex-row-reverse"
                  >
                    רענן הכול
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Analysis Progress */}
        {analyzing && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-2 flex-row-reverse">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
                <span className="font-medium">
                  מנתח ושומר פסקי דין...
                </span>
                <span className="mr-auto text-sm">
                  {analysisProgress.current}/{analysisProgress.total}
                </span>
              </div>
              <Progress 
                value={(analysisProgress.current / Math.max(analysisProgress.total, 1)) * 100} 
                className="h-2" 
              />
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <Save className="w-3 h-3" />
                כל תוצאה נשמרת מיד לענן • ניתן לעצור ולהמשיך מאוחר יותר
              </p>
            </CardContent>
          </Card>
        )}

        {/* Summary Stats */}
        {analysisResults.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold text-primary">{summary.totalAnalyzed}</div>
                <div className="text-sm text-muted-foreground">פסקי דין</div>
              </CardContent>
            </Card>
            <Card className="bg-accent/5 border-accent/20">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold text-accent">{summary.withSources}</div>
                <div className="text-sm text-muted-foreground">עם מקורות</div>
              </CardContent>
            </Card>
            <Card className="bg-green-500/10 border-green-500/20">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold text-green-600">{summary.withGemaraLinks}</div>
                <div className="text-sm text-muted-foreground">מקושרים לגמרא</div>
              </CardContent>
            </Card>
            <Card className="bg-secondary border-secondary/50">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold">{summary.totalGemaraLinks}</div>
                <div className="text-sm text-muted-foreground">קישורים</div>
              </CardContent>
            </Card>
            <Card className="bg-secondary border-secondary/50">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold">{summary.topMasechtot.length}</div>
                <div className="text-sm text-muted-foreground">מסכתות</div>
              </CardContent>
            </Card>
            <Card className="bg-secondary border-secondary/50">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold">{summary.topBooks.length}</div>
                <div className="text-sm text-muted-foreground">ספרים</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main Content */}
        {analysisResults.length > 0 && (
          <Tabs defaultValue="gemara-links" className="space-y-4">
            <TabsList className="grid w-full max-w-2xl grid-cols-4 mx-auto">
              <TabsTrigger value="gemara-links" className="gap-2 flex-row-reverse">
                קישורי גמרא
                <Link2 className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger value="browse" className="gap-2 flex-row-reverse">
                לפי נושא
                <Tag className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger value="masechtot" className="gap-2 flex-row-reverse">
                לפי מסכתות
                <BookOpen className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger value="stats" className="gap-2 flex-row-reverse">
                סטטיסטיקות
                <BarChart3 className="w-4 h-4" />
              </TabsTrigger>
            </TabsList>

            {/* Search and Filters */}
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-3 items-center flex-row-reverse">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="חיפוש בכותרת, נושא או מסכת..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pr-10 text-right"
                    />
                  </div>
                  
                  {/* Sort Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2 flex-row-reverse">
                        <ArrowUpDown className="w-4 h-4" />
                        מיון
                        {sortBy !== 'none' && (
                          <Badge variant="secondary" className="text-xs px-1">פעיל</Badge>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 text-right">
                      <DropdownMenuLabel className="text-right">מיון לפי</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => setSortBy('none')}
                        className={`flex-row-reverse justify-end gap-2 ${sortBy === 'none' ? 'bg-accent' : ''}`}
                      >
                        ללא מיון
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-right text-xs text-muted-foreground">לפי דף גמרא</DropdownMenuLabel>
                      <DropdownMenuItem 
                        onClick={() => setSortBy('daf-asc')}
                        className={`flex-row-reverse justify-end gap-2 ${sortBy === 'daf-asc' ? 'bg-accent' : ''}`}
                      >
                        <ArrowUp className="w-4 h-4" />
                        דף ב׳ → דף ק׳
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => setSortBy('daf-desc')}
                        className={`flex-row-reverse justify-end gap-2 ${sortBy === 'daf-desc' ? 'bg-accent' : ''}`}
                      >
                        <ArrowDown className="w-4 h-4" />
                        דף ק׳ → דף ב׳
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-right text-xs text-muted-foreground">לפי קישורים</DropdownMenuLabel>
                      <DropdownMenuItem 
                        onClick={() => setSortBy('links-desc')}
                        className={`flex-row-reverse justify-end gap-2 ${sortBy === 'links-desc' ? 'bg-accent' : ''}`}
                      >
                        <ArrowDown className="w-4 h-4" />
                        הרבה קישורים קודם
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => setSortBy('links-asc')}
                        className={`flex-row-reverse justify-end gap-2 ${sortBy === 'links-asc' ? 'bg-accent' : ''}`}
                      >
                        <ArrowUp className="w-4 h-4" />
                        מעט קישורים קודם
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => setSortBy('confidence')}
                        className={`flex-row-reverse justify-end gap-2 ${sortBy === 'confidence' ? 'bg-accent' : ''}`}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        לפי רמת ודאות
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>


                  {/* Filter Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2 flex-row-reverse">
                        <SlidersHorizontal className="w-4 h-4" />
                        סינון
                        {(filterConfidence !== 'all' || filterHasFullText !== null) && (
                          <Badge variant="secondary" className="text-xs px-1">פעיל</Badge>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52 text-right">
                      <DropdownMenuLabel className="text-right">סינון לפי</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-right text-xs text-muted-foreground">רמת ודאות</DropdownMenuLabel>
                      <DropdownMenuCheckboxItem 
                        checked={filterConfidence === 'all'}
                        onCheckedChange={() => setFilterConfidence('all')}
                        className="flex-row-reverse"
                      >
                        הכל
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem 
                        checked={filterConfidence === 'high'}
                        onCheckedChange={() => setFilterConfidence('high')}
                        className="flex-row-reverse"
                      >
                        ודאות גבוהה בלבד
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem 
                        checked={filterConfidence === 'medium'}
                        onCheckedChange={() => setFilterConfidence('medium')}
                        className="flex-row-reverse"
                      >
                        ודאות בינונית
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem 
                        checked={filterConfidence === 'low'}
                        onCheckedChange={() => setFilterConfidence('low')}
                        className="flex-row-reverse"
                      >
                        ודאות נמוכה
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-right text-xs text-muted-foreground">טקסט מלא</DropdownMenuLabel>
                      <DropdownMenuCheckboxItem 
                        checked={filterHasFullText === null}
                        onCheckedChange={() => setFilterHasFullText(null)}
                        className="flex-row-reverse"
                      >
                        הכל
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem 
                        checked={filterHasFullText === true}
                        onCheckedChange={() => setFilterHasFullText(true)}
                        className="flex-row-reverse"
                      >
                        עם טקסט מלא
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem 
                        checked={filterHasFullText === false}
                        onCheckedChange={() => setFilterHasFullText(false)}
                        className="flex-row-reverse"
                      >
                        ללא טקסט מלא
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => {
                          setFilterConfidence('all');
                          setFilterHasFullText(null);
                        }}
                        className="text-destructive flex-row-reverse justify-end"
                      >
                        נקה סינונים
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  
                  <div className="flex flex-wrap gap-2">
                    {selectedCategory && (
                      <Badge 
                        variant="secondary" 
                        className="cursor-pointer gap-1"
                        onClick={() => setSelectedCategory(null)}
                      >
                        {selectedCategory} ✕
                      </Badge>
                    )}
                    {selectedMasechet && (
                      <Badge 
                        variant="secondary" 
                        className="cursor-pointer gap-1"
                        onClick={() => setSelectedMasechet(null)}
                      >
                        {selectedMasechet} ✕
                      </Badge>
                    )}
                    {selectedBook && (
                      <Badge 
                        variant="secondary" 
                        className="cursor-pointer gap-1"
                        onClick={() => setSelectedBook(null)}
                      >
                        {selectedBook} ✕
                      </Badge>
                    )}
                    {sortBy !== 'none' && (
                      <Badge 
                        variant="outline" 
                        className="cursor-pointer gap-1 border-primary text-primary"
                        onClick={() => setSortBy('none')}
                      >
                        {sortBy === 'daf-asc' ? 'דף ב׳→ק׳' : 
                         sortBy === 'daf-desc' ? 'דף ק׳→ב׳' : 
                         sortBy === 'links-desc' ? 'הרבה קישורים' : 
                         sortBy === 'links-asc' ? 'מעט קישורים' : 
                         sortBy === 'confidence' ? 'לפי ודאות' : ''} ✕
                      </Badge>
                    )}
                    {filterConfidence !== 'all' && (
                      <Badge 
                        variant="outline" 
                        className="cursor-pointer gap-1 border-accent text-accent"
                        onClick={() => setFilterConfidence('all')}
                      >
                        ודאות: {filterConfidence === 'high' ? 'גבוהה' : filterConfidence === 'medium' ? 'בינונית' : 'נמוכה'} ✕
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground">
                      {filteredResults.length} תוצאות
                    </div>
                    <div className="flex gap-0.5 bg-background rounded-md p-0.5 border border-border/50">
                      <Button variant={smartViewMode === "cards" ? "default" : "ghost"} size="sm" className="h-6 px-2 text-[11px]" onClick={() => setSmartViewMode("cards")} title="כרטיסיות">
                        <LayoutGrid className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant={smartViewMode === "table" ? "default" : "ghost"} size="sm" className="h-6 px-2 text-[11px]" onClick={() => setSmartViewMode("table")} title="טבלה">
                        <TableIcon className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant={smartViewMode === "compact" ? "default" : "ghost"} size="sm" className="h-6 px-2 text-[11px]" onClick={() => setSmartViewMode("compact")} title="רשימה">
                        <List className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* AI Analysis Selection */}
            {filteredResults.length > 0 && (
              <Card className="border-accent/30 bg-accent/5">
                <CardContent className="p-3 flex items-center justify-between flex-row-reverse flex-wrap gap-3">
                  <div className="flex items-center gap-3 flex-row-reverse">
                    <Brain className="w-5 h-5 text-accent" />
                    <div className="text-right">
                      <p className="font-medium text-sm">ניתוח AI מעמיק</p>
                      <p className="text-xs text-muted-foreground">
                        ניתוח מתקדם עם AI לזיהוי מקורות מדויק יותר
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={selectAllForAI}
                    >
                      {selectedForAI.size === filteredResults.length ? 'בטל הכל' : `בחר הכל (${filteredResults.length})`}
                    </Button>
                    {selectedForAI.size > 0 && (
                      <Button
                        size="sm"
                        onClick={runAIAnalysis}
                        disabled={aiAnalyzing}
                        className="gap-2 flex-row-reverse"
                      >
                        {aiAnalyzing ? (
                          <>
                            מנתח...
                            <Loader2 className="w-4 h-4 animate-spin" />
                          </>
                        ) : (
                          <>
                            נתח {selectedForAI.size} פסקים ב-AI
                            <Sparkles className="w-4 h-4" />
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* AI Analysis Progress */}
            {aiAnalyzing && (
              <Card className="border-accent/30 bg-accent/5">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-2 flex-row-reverse">
                    <Brain className="w-5 h-5 text-accent animate-pulse" />
                    <span className="font-medium">מנתח באמצעות AI...</span>
                    <span className="mr-auto text-sm">
                      {aiProgress.current}/{aiProgress.total}
                    </span>
                  </div>
                  <Progress 
                    value={(aiProgress.current / Math.max(aiProgress.total, 1)) * 100} 
                    className="h-2" 
                  />
                </CardContent>
              </Card>
            )}

            {/* Gemara Links Tab */}
            <TabsContent value="gemara-links">
              <ScrollArea className="h-[600px]">
                <div className="space-y-3">
                  {(() => {
                    const gemaraFiltered = filteredResults.filter(r => r.sources.some(s => s.type === 'gemara' && s.sugyaId));
                    const totalDisplayPages = Math.ceil(gemaraFiltered.length / DISPLAY_PAGE_SIZE);
                    const pageItems = gemaraFiltered.slice(displayPage * DISPLAY_PAGE_SIZE, (displayPage + 1) * DISPLAY_PAGE_SIZE);
                    return (
                      <>
                        {pageItems.map(result => {
                      const gemaraSources = result.sources.filter(s => s.type === 'gemara' && s.sugyaId);
                      const firstGemaraSource = gemaraSources[0];
                      return (
                        <Card 
                          key={result.id}
                          className={`cursor-pointer hover:shadow-md transition-shadow ${
                            selectedForAI.has(result.id) ? 'border-accent ring-1 ring-accent' : ''
                          }`}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3 flex-row-reverse">
                              <Checkbox
                                checked={selectedForAI.has(result.id)}
                                onCheckedChange={() => toggleAISelection(result.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div className="flex-1 text-right">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div 
                                      className="font-medium line-clamp-1 cursor-pointer hover:text-primary"
                                      onClick={() => handlePsakClick(result.id)}
                                    >
                                      {result.title}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-sm text-right">
                                    <p>{result.title}</p>
                                  </TooltipContent>
                                </Tooltip>
                                
                                {/* Gemara Links */}
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {gemaraSources.slice(0, 5).map((source, idx) => 
                                    renderSourceBadge(source, idx)
                                  )}
                                  {gemaraSources.length > 5 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{gemaraSources.length - 5} נוספים
                                    </Badge>
                                  )}
                                </div>

                                {/* Topics */}
                                {result.topics.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {result.topics.slice(0, 3).map((t, idx) => (
                                      <Badge key={idx} variant="secondary" className="text-xs">
                                        {t.topic}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                              
                              <div className="flex flex-col items-center gap-2">
                                <Badge variant="default" className="text-xs">
                                  {gemaraSources.length} קישורים
                                </Badge>
                                <Badge 
                                  variant={gemaraSources[0]?.confidence === 'high' ? 'default' : 'outline'}
                                  className="text-xs"
                                >
                                  {gemaraSources[0]?.confidence === 'high' ? 'גבוה' : 
                                   gemaraSources[0]?.confidence === 'medium' ? 'בינוני' : 'נמוך'}
                                </Badge>
                                <div className="flex items-center gap-1 mt-1">
                                  {/* Case summary button */}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleShowSummary(result.id, result.title);
                                        }}
                                      >
                                        <ScrollText className="w-4 h-4 text-muted-foreground" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">תקציר המקרה</TooltipContent>
                                  </Tooltip>
                                  {/* Navigate directly to first gemara source */}
                                  {firstGemaraSource?.sugyaId && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            navigateToGemara(firstGemaraSource);
                                          }}
                                        >
                                          <BookOpenCheck className="w-4 h-4 text-primary" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        פתח גמרא - {firstGemaraSource.masechet} {firstGemaraSource.daf}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                        {totalDisplayPages > 1 && (
                          <div className="flex items-center justify-center gap-2 py-3">
                            <Button variant="outline" size="sm" disabled={displayPage === 0} onClick={() => setDisplayPage(p => p - 1)}>הקודם</Button>
                            <span className="text-sm text-muted-foreground">עמוד {displayPage + 1} מתוך {totalDisplayPages}</span>
                            <Button variant="outline" size="sm" disabled={displayPage >= totalDisplayPages - 1} onClick={() => setDisplayPage(p => p + 1)}>הבא</Button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Browse by Topic Tab */}
            <TabsContent value="browse">
              <ScrollArea className="h-[600px]">
                <Accordion type="multiple" className="space-y-2">
                  {Object.entries(groupedByCategory)
                    .sort((a, b) => b[1].length - a[1].length)
                    .map(([category, results]) => (
                      <AccordionItem key={category} value={category} className="border rounded-lg px-4">
                        <AccordionTrigger className="flex-row-reverse">
                          <div className="flex items-center gap-3 flex-row-reverse flex-1">
                            <Tag className="w-4 h-4 text-primary" />
                            <span className="font-medium">{category}</span>
                            <Badge variant="secondary">{results.length}</Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-2 pt-2">
                            {results.slice(0, 20).map(result => {
                              const firstGemara = result.sources.find(s => s.type === 'gemara' && s.sugyaId);
                              return (
                              <Card 
                                key={result.id}
                                className={`cursor-pointer hover:shadow-md transition-shadow ${
                                  selectedForAI.has(result.id) ? 'border-accent ring-1 ring-accent' : ''
                                }`}
                              >
                                <CardContent className="p-3 flex items-start gap-3 flex-row-reverse">
                                  <Checkbox
                                    checked={selectedForAI.has(result.id)}
                                    onCheckedChange={() => toggleAISelection(result.id)}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <div 
                                    className="flex-1 text-right"
                                    onClick={() => handlePsakClick(result.id)}
                                  >
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="font-medium text-sm line-clamp-1">{result.title}</div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-sm text-right">
                                        <p>{result.title}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {result.sources
                                        .filter(s => s.type === 'gemara' && s.sugyaId)
                                        .slice(0, 2)
                                        .map((source, idx) => renderSourceBadge(source, idx))}
                                      {result.books.slice(0, 2).map(b => (
                                        <Badge key={b} variant="secondary" className="text-xs">
                                          {b}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleShowSummary(result.id, result.title); }}>
                                          <ScrollText className="w-3.5 h-3.5 text-muted-foreground" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">תקציר המקרה</TooltipContent>
                                    </Tooltip>
                                    {firstGemara?.sugyaId && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); navigateToGemara(firstGemara); }}>
                                            <BookOpenCheck className="w-3.5 h-3.5 text-primary" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">פתח גמרא - {firstGemara.masechet} {firstGemara.daf}</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                              );
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                </Accordion>
              </ScrollArea>
            </TabsContent>

            {/* Masechtot Tab */}
            <TabsContent value="masechtot">
              <ScrollArea className="h-[600px]">
                <Accordion type="multiple" className="space-y-2">
                  {Object.entries(groupedByMasechet)
                    .sort((a, b) => b[1].length - a[1].length)
                    .map(([masechet, results]) => {
                      // Get masechet info for max daf
                      const masechetInfo = MASECHTOT.find(m => m.hebrewName === masechet);
                      const maxDaf = masechetInfo?.maxDaf || 100;
                      
                      // Count psakim per daf
                      const dafCounts: Record<number, number> = {};
                      results.forEach(result => {
                        result.sources
                          .filter(s => s.type === 'gemara' && s.masechet === masechet && s.dafNumber)
                          .forEach(source => {
                            if (source.dafNumber) {
                              dafCounts[source.dafNumber] = (dafCounts[source.dafNumber] || 0) + 1;
                            }
                          });
                      });
                      
                      const totalPsakim = Object.values(dafCounts).reduce((sum, c) => sum + c, 0);
                      const coveredDafim = Object.keys(dafCounts).length;
                      const coveragePercent = Math.round((coveredDafim / (maxDaf - 1)) * 100);
                      
                      return (
                        <AccordionItem key={masechet} value={masechet} className="border rounded-lg px-4">
                          <AccordionTrigger className="flex-row-reverse">
                            <div className="flex items-center gap-3 flex-row-reverse flex-1">
                              <BookOpen className="w-4 h-4 text-primary" />
                              <span className="font-medium">{masechet}</span>
                              <span className="text-muted-foreground text-sm">(כיסוי {coveragePercent}%)</span>
                              <Badge variant="secondary">פסקים {totalPsakim}</Badge>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="pt-4 pb-2">
                              {/* Visual daf grid */}
                              <div 
                                className="grid gap-1" 
                                style={{ 
                                  gridTemplateColumns: 'repeat(auto-fill, minmax(42px, 1fr))',
                                  direction: 'rtl' 
                                }}
                              >
                                {Array.from({ length: maxDaf - 1 }, (_, i) => i + 2).map(dafNum => {
                                  const count = dafCounts[dafNum] || 0;
                                  const hasLinks = count > 0;
                                  const isHot = count >= 10;
                                  const isMedium = count >= 3 && count < 10;
                                  
                                  return (
                                    <div
                                      key={dafNum}
                                      onClick={() => {
                                        if (hasLinks && masechetInfo) {
                                          const sugyaId = `${masechetInfo.sefariaName.toLowerCase()}_${dafNum}a`;
                                          navigate(`/sugya/${sugyaId}`);
                                        }
                                      }}
                                      className={`
                                        relative flex items-center justify-center h-10 rounded text-sm font-medium
                                        transition-all cursor-pointer
                                        ${hasLinks 
                                          ? isHot 
                                            ? 'bg-primary text-primary-foreground hover:bg-primary/90' 
                                            : isMedium
                                              ? 'bg-primary/70 text-primary-foreground hover:bg-primary/80'
                                              : 'bg-muted-foreground/60 text-background hover:bg-muted-foreground/70'
                                          : 'bg-muted/50 text-muted-foreground/50 cursor-default'
                                        }
                                      `}
                                      title={hasLinks ? `${count} פסקי דין` : 'אין פסקי דין'}
                                    >
                                      {toHebrewNumeral(dafNum)}
                                      {count > 1 && (
                                        <span className="absolute -top-1 -right-1 bg-background text-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center border shadow-sm">
                                          {count}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              
                              {/* Legend */}
                              <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground justify-end flex-wrap">
                                <div className="flex items-center gap-1">
                                  <div className="w-4 h-4 rounded bg-primary"></div>
                                  <span>10+ פסקים</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <div className="w-4 h-4 rounded bg-primary/70"></div>
                                  <span>3-9 פסקים</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <div className="w-4 h-4 rounded bg-muted-foreground/60"></div>
                                  <span>1-2 פסקים</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <div className="w-4 h-4 rounded bg-muted/50"></div>
                                  <span>ללא פסקים</span>
                                </div>
                              </div>
                              
                              {/* Psakim list */}
                              {results.length > 0 && (
                                <div className="mt-4 border-t pt-4">
                                  <p className="text-sm text-muted-foreground mb-2 text-right">
                                    רשימת פסקי דין ({results.length})
                                  </p>
                                  <div className="space-y-2 max-h-60 overflow-y-auto">
                                    {results.slice(0, 15).map(result => {
                                      const firstGemara = result.sources.find(s => s.type === 'gemara' && s.sugyaId);
                                      return (
                                      <Card 
                                        key={result.id}
                                        className={`cursor-pointer hover:shadow-md transition-shadow ${
                                          selectedForAI.has(result.id) ? 'border-accent ring-1 ring-accent' : ''
                                        }`}
                                      >
                                        <CardContent className="p-3 flex items-start gap-3 flex-row-reverse">
                                          <Checkbox
                                            checked={selectedForAI.has(result.id)}
                                            onCheckedChange={() => toggleAISelection(result.id)}
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                          <div 
                                            className="flex-1 text-right"
                                            onClick={() => handlePsakClick(result.id)}
                                          >
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <div className="font-medium text-sm line-clamp-1">{result.title}</div>
                                              </TooltipTrigger>
                                              <TooltipContent side="top" className="max-w-sm text-right">
                                                <p>{result.title}</p>
                                              </TooltipContent>
                                            </Tooltip>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                              {result.sources
                                                .filter(s => s.type === 'gemara' && s.masechet === masechet && s.sugyaId)
                                                .slice(0, 3)
                                                .map((source, idx) => renderSourceBadge(source, idx))}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-1">
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleShowSummary(result.id, result.title); }}>
                                                  <ScrollText className="w-3.5 h-3.5 text-muted-foreground" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent side="top">תקציר המקרה</TooltipContent>
                                            </Tooltip>
                                            {firstGemara?.sugyaId && (
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); navigateToGemara(firstGemara); }}>
                                                    <BookOpenCheck className="w-3.5 h-3.5 text-primary" />
                                                  </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="top">פתח גמרא - {firstGemara.masechet} {firstGemara.daf}</TooltipContent>
                                              </Tooltip>
                                            )}
                                          </div>
                                        </CardContent>
                                      </Card>
                                      );
                                    })}
                                    {results.length > 15 && (
                                      <p className="text-xs text-muted-foreground text-center py-2">
                                        +{results.length - 15} נוספים
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                </Accordion>
              </ScrollArea>
            </TabsContent>

            {/* Stats Tab */}
            <TabsContent value="stats">
              <div className="grid md:grid-cols-3 gap-6">
                {/* Top Masechtot */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2 flex-row-reverse">
                      מסכתות מובילות
                      <BookOpen className="w-5 h-5 text-primary" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {summary.topMasechtot.map((m, i) => (
                        <div 
                          key={m.name} 
                          className="flex items-center justify-between cursor-pointer hover:bg-muted/50 p-2 rounded"
                          onClick={() => setSelectedMasechet(m.name)}
                        >
                          <Badge variant={i < 3 ? "default" : "secondary"}>{m.count}</Badge>
                          <span className="text-sm">{m.name}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Top Books */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2 flex-row-reverse">
                      ספרים מובילים
                      <Library className="w-5 h-5 text-primary" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {summary.topBooks.map((b, i) => (
                        <div 
                          key={b.name} 
                          className="flex items-center justify-between cursor-pointer hover:bg-muted/50 p-2 rounded"
                          onClick={() => setSelectedBook(b.name)}
                        >
                          <Badge variant={i < 3 ? "default" : "secondary"}>{b.count}</Badge>
                          <span className="text-sm">{b.name}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Top Categories */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2 flex-row-reverse">
                      קטגוריות מובילות
                      <Tag className="w-5 h-5 text-primary" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {summary.topCategories.map((c, i) => (
                        <div 
                          key={c.name} 
                          className="flex items-center justify-between cursor-pointer hover:bg-muted/50 p-2 rounded"
                          onClick={() => setSelectedCategory(c.name)}
                        >
                          <Badge variant={i < 3 ? "default" : "secondary"}>{c.count}</Badge>
                          <span className="text-sm">{c.name}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* Empty State */}
        {!analyzing && analysisResults.length === 0 && (
          <Card className="border-dashed border-2">
            <CardContent className="p-12 text-center">
              <Library className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">אינדקס חכם</h3>
              <p className="text-muted-foreground mb-4">
                סריקה וזיהוי אוטומטי של מקורות תלמודיים והלכתיים בפסקי הדין
              </p>
              <div className="flex flex-wrap gap-2 justify-center mb-6">
                <Badge variant="outline">זיהוי מסכתות ודפים</Badge>
                <Badge variant="outline">קישור ישיר לגמרא</Badge>
                <Badge variant="outline">זיהוי שולחן ערוך</Badge>
                <Badge variant="outline">זיהוי רמב"ם</Badge>
                <Badge variant="outline">שמירה בדאטאבייס</Badge>
              </div>
              <Button onClick={() => runTextAnalysis()} size="lg" className="gap-2 flex-row-reverse">
                התחל ניתוח
                <Zap className="w-5 h-5" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Psak Dialog */}

        {/* Case Summary Dialog */}
        <Dialog open={summaryDialog.open} onOpenChange={(open) => setSummaryDialog(prev => ({ ...prev, open }))}>
          <DialogContent className="max-w-lg bg-card" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-right text-lg">{summaryDialog.title}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh]">
              {summaryDialog.loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : summaryDialog.summary ? (
                <div className="text-right leading-relaxed whitespace-pre-wrap p-1">
                  {summaryDialog.summary}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <ScrollText className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>לא נמצא תקציר מקרה לפסק דין זה</p>
                </div>
              )}
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </div>
    </TooltipProvider>
  );
};

export default SmartIndexTab;
