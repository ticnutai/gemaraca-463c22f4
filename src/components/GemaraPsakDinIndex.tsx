import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { trackRecentPsak } from "@/lib/recentPsakim";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import FileTypeBadge from "./FileTypeBadge";
import SummaryToggle from "./SummaryToggle";
import { MASECHTOT, SEDARIM, Masechet } from "@/lib/masechtotData";
import { toHebrewNumeral } from "@/lib/hebrewNumbers";
import { 
  Search, BookOpen, Scale, ChevronRight, TrendingUp, 
  Database, Tag, Filter, BarChart3, Sparkles, Building2, Calendar,
  List, LayoutGrid, TableIcon, ArrowUpDown
} from "lucide-react";
import { useDocumentViewer } from "./DocumentViewerProvider";
import { getMeta, setMeta } from "@/lib/psakCache";

interface PsakLink {
  id: string;
  psak_din_id: string;
  sugya_id: string;
  connection_explanation: string;
  relevance_score: number;
  psakei_din?: {
    id: string;
    title: string;
    court: string;
    year: number;
    summary: string;
    tags: string[];
    source_url?: string;
  };
}

interface PatternLink {
  id: string;
  psak_din_id: string;
  sugya_id: string;
  masechet: string;
  daf: string;
  source_text: string;
  confidence: string;
  psakei_din?: PsakLink['psakei_din'];
}

interface IndexEntry {
  masechet: Masechet;
  dafim: {
    dafNumber: number;
    sugya_id: string;
    psakimCount: number;
  }[];
  totalPsakim: number;
}

interface Statistics {
  totalPsakim: number;
  totalLinks: number;
  masechtotWithLinks: number;
  topTags: { tag: string; count: number }[];
  topCourts: { court: string; count: number }[];
  yearRange: { min: number; max: number };
}

const GemaraPsakDinIndex = () => {
  const navigate = useNavigate();
  const [indexData, setIndexData] = useState<IndexEntry[]>([]);
  const [allLinks, setAllLinks] = useState<PsakLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSeder, setSelectedSeder] = useState<string>("all");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [expandedMasechet, setExpandedMasechet] = useState<string | null>(null);
  const [selectedDafPsakim, setSelectedDafPsakim] = useState<PsakLink[]>([]);
  const [selectedDafInfo, setSelectedDafInfo] = useState<{ masechet: string; daf: number } | null>(null);
  const [viewMode, setViewMode] = useState<"tree" | "stats" | "table" | "cards">("tree");
  const [psakimView, setPsakimView] = useState<"list" | "table" | "compact">("list");

  const statistics = useMemo<Statistics>(() => {
    const tagCounts = new Map<string, number>();
    const courtCounts = new Map<string, number>();
    const years: number[] = [];
    const uniquePsakim = new Set<string>();

    allLinks.forEach(link => {
      if (link.psakei_din) {
        uniquePsakim.add(link.psak_din_id);
        
        link.psakei_din.tags?.forEach(tag => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
        
        const court = link.psakei_din.court;
        courtCounts.set(court, (courtCounts.get(court) || 0) + 1);
        
        if (link.psakei_din.year) {
          years.push(link.psakei_din.year);
        }
      }
    });

    const topTags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topCourts = Array.from(courtCounts.entries())
      .map(([court, count]) => ({ court, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalPsakim: uniquePsakim.size,
      totalLinks: allLinks.length,
      masechtotWithLinks: indexData.length,
      topTags,
      topCourts,
      yearRange: {
        min: years.length > 0 ? Math.min(...years) : 0,
        max: years.length > 0 ? Math.max(...years) : 0,
      }
    };
  }, [allLinks, indexData]);

  const allTags = useMemo(() => {
    return statistics.topTags.map(t => t.tag);
  }, [statistics]);

  useEffect(() => {
    loadIndexData();
  }, []);

  const loadIndexData = async () => {
    try {
      // Try loading from IndexedDB cache first for instant display
      const cachedIndex = await getMeta('indexData') as IndexEntry[] | undefined;
      const cachedLinks = await getMeta('allLinks') as PsakLink[] | undefined;
      if (cachedIndex && cachedLinks && cachedIndex.length > 0) {
        setIndexData(cachedIndex);
        setAllLinks(cachedLinks);
        setLoading(false);
      }

      // Load from both tables: sugya_psak_links (AI-based) and pattern_sugya_links (pattern-based)
      const [sugyaLinksResult, patternLinksResult] = await Promise.all([
        supabase
          .from('sugya_psak_links')
          .select(`
            id,
            psak_din_id,
            sugya_id,
            connection_explanation,
            relevance_score,
            psakei_din (
              id,
              title,
              court,
              year,
              summary,
              tags,
              source_url
            )
          `),
        supabase
          .from('pattern_sugya_links')
          .select(`
            id,
            psak_din_id,
            sugya_id,
            masechet,
            daf,
            amud,
            source_text,
            confidence,
            psakei_din:psak_din_id (
              id,
              title,
              court,
              year,
              summary,
              tags,
              source_url
            )
          `)
      ]);

      if (sugyaLinksResult.error) throw sugyaLinksResult.error;
      if (patternLinksResult.error) throw patternLinksResult.error;

      const sugyaLinks = sugyaLinksResult.data || [];
      const patternLinks = patternLinksResult.data || [];
      
      console.log('sugya_psak_links count:', sugyaLinks.length);
      console.log('pattern_sugya_links count:', patternLinks.length);

      // Combine both sources, converting pattern_sugya_links format to PsakLink format
      const combinedLinks: PsakLink[] = [];
      const seenIds = new Set<string>();

      // Add sugya_psak_links first
      sugyaLinks.forEach((link: PsakLink) => {
        if (link.psakei_din && !seenIds.has(link.id)) {
          seenIds.add(link.id);
          combinedLinks.push(link);
        }
      });

      // Add pattern_sugya_links, converting format
      patternLinks.forEach((link: PatternLink) => {
        const uniqueKey = `pattern_${link.id}`;
        if (link.psakei_din && !seenIds.has(uniqueKey)) {
          seenIds.add(uniqueKey);
          combinedLinks.push({
            id: link.id,
            psak_din_id: link.psak_din_id,
            sugya_id: link.sugya_id,
            connection_explanation: link.source_text || '',
            relevance_score: link.confidence === 'high' ? 8 : link.confidence === 'medium' ? 6 : 4,
            psakei_din: link.psakei_din
          });
        }
      });

      setAllLinks(combinedLinks);
      
      console.log('Total combined links:', combinedLinks.length);

      // בניית אינדקס ישירות מהמסכתות
      const index: IndexEntry[] = [];
      
      for (const masechet of MASECHTOT) {
        const sefariaName = masechet.sefariaName;
        const hebrewName = masechet.hebrewName;
        
        // חיפוש כל הקישורים - כולל מ-pattern_sugya_links שמשתמש בשמות עבריים
        const masechetLinks = combinedLinks.filter((link: PsakLink) => {
          const sugyaId = link.sugya_id || '';
          
          // Check Sefaria format (sefariaName_number)
          if (sugyaId.toLowerCase().startsWith(sefariaName.toLowerCase() + '_')) {
            const afterMasechet = sugyaId.slice(sefariaName.length + 1);
            return /^\d+/.test(afterMasechet);
          }
          
          // Check Hebrew format (from pattern links)
          if (sugyaId.includes(hebrewName.toLowerCase().replace(/ /g, '_'))) {
            return true;
          }
          
          return false;
        });
        
        // Also search by pattern_sugya_links that use Hebrew masechet names
        const patternMasechetLinks = patternLinks.filter((link: PatternLink) => 
          link.masechet === hebrewName
        );
        
        // Add pattern links that weren't caught by sugya_id matching
        patternMasechetLinks.forEach((link: PatternLink) => {
          const exists = masechetLinks.some(ml => ml.id === link.id);
          if (!exists && link.psakei_din) {
            masechetLinks.push({
              id: link.id,
              psak_din_id: link.psak_din_id,
              sugya_id: link.sugya_id,
              connection_explanation: link.source_text || '',
              relevance_score: link.confidence === 'high' ? 8 : link.confidence === 'medium' ? 6 : 4,
              psakei_din: link.psakei_din
            });
          }
        });
        
        if (masechetLinks.length === 0) continue;
        
        console.log(`Found ${masechetLinks.length} links for ${sefariaName} (${hebrewName})`);
        
        // קיבוץ לפי דף
        const dafMap = new Map<number, { sugya_id: string; count: number }>();
        
        masechetLinks.forEach((link: PsakLink) => {
          let dafNumber: number | null = null;
          const sugyaId = link.sugya_id || '';
          
          // Try to extract daf from sugya_id (Sefaria format)
          const afterMasechet = sugyaId.slice(sefariaName.length + 1);
          const dafMatch = afterMasechet.match(/^(\d+)/);
          if (dafMatch) {
            dafNumber = parseInt(dafMatch[1]);
          }
          
          // If not found, try from pattern_sugya_links daf field
          if (!dafNumber) {
            const patternLink = patternLinks.find(pl => pl.id === link.id);
            if (patternLink?.daf) {
              dafNumber = parseInt(patternLink.daf);
            }
          }
          
          if (dafNumber && dafNumber >= 2 && dafNumber <= masechet.maxDaf) {
            if (!dafMap.has(dafNumber)) {
              dafMap.set(dafNumber, { sugya_id: sugyaId || `${sefariaName.toLowerCase()}_${dafNumber}a`, count: 0 });
            }
            dafMap.get(dafNumber)!.count++;
          }
        });
        
        if (dafMap.size > 0) {
          const dafim = Array.from(dafMap.entries())
            .map(([dafNumber, data]) => ({
              dafNumber,
              sugya_id: data.sugya_id,
              psakimCount: data.count
            }))
            .sort((a, b) => a.dafNumber - b.dafNumber);
          
          const totalPsakim = dafim.reduce((sum, d) => sum + d.psakimCount, 0);
          index.push({ masechet, dafim, totalPsakim });
        }
      }

      // מיון לפי כמות פסקים (יורד)
      index.sort((a, b) => b.totalPsakim - a.totalPsakim);
      
      console.log('Index built:', index.length, 'masechtot with', 
        index.reduce((sum, e) => sum + e.totalPsakim, 0), 'total links');
      
      setIndexData(index);
      
      // Cache the built index and links to IndexedDB for fast next load
      setMeta('indexData', index);
      setMeta('allLinks', combinedLinks);
    } catch (error) {
      console.error('Error loading index:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDafPsakim = async (sugyaId: string, masechet: string, daf: number) => {
    try {
      // Try loading from cache first
      const cacheKey = `dafPsakim::${masechet}::${daf}`;
      const cachedData = await getMeta(cacheKey) as PsakLink[] | undefined;
      if (cachedData && cachedData.length > 0) {
        let filteredCached = cachedData;
        if (selectedTag !== "all") {
          filteredCached = filteredCached.filter((link: PsakLink) => 
            link.psakei_din?.tags?.includes(selectedTag)
          );
        }
        setSelectedDafPsakim(filteredCached);
        setSelectedDafInfo({ masechet, daf });
      }

      // מציאת שם המסכת ב-sefaria format
      const masechetObj = MASECHTOT.find(m => m.hebrewName === masechet);
      const sefariaName = masechetObj?.sefariaName || '';
      
      // חיפוש בשתי הטבלאות במקביל
      const [sugyaLinksResult, patternLinksResult] = await Promise.all([
        supabase
          .from('sugya_psak_links')
          .select(`
            id,
            psak_din_id,
            sugya_id,
            connection_explanation,
            relevance_score,
            psakei_din (
              id,
              title,
              court,
              year,
              summary,
              tags,
              source_url
            )
          `)
          .like('sugya_id', `${sefariaName}_${daf}%`),
        supabase
          .from('pattern_sugya_links')
          .select(`
            id,
            psak_din_id,
            sugya_id,
            source_text,
            confidence,
            psakei_din:psak_din_id (
              id,
              title,
              court,
              year,
              summary,
              tags,
              source_url
            )
          `)
          .eq('masechet', masechet)
          .eq('daf', daf.toString())
      ]);

      if (sugyaLinksResult.error) throw sugyaLinksResult.error;
      if (patternLinksResult.error) throw patternLinksResult.error;

      // Combine and deduplicate
      const combined: PsakLink[] = [];
      const seenPsakIds = new Set<string>();

      // Add sugya_psak_links
      (sugyaLinksResult.data || []).forEach((link: PsakLink) => {
        if (link.psakei_din && !seenPsakIds.has(link.psak_din_id)) {
          seenPsakIds.add(link.psak_din_id);
          combined.push(link);
        }
      });

      // Add pattern_sugya_links, converting format
      (patternLinksResult.data || []).forEach((link: any) => {
        if (link.psakei_din && !seenPsakIds.has(link.psak_din_id)) {
          seenPsakIds.add(link.psak_din_id);
          combined.push({
            id: link.id,
            psak_din_id: link.psak_din_id,
            sugya_id: link.sugya_id,
            connection_explanation: link.source_text || `מקור: ${masechet} דף ${daf}`,
            relevance_score: link.confidence === 'high' ? 8 : link.confidence === 'medium' ? 6 : 4,
            psakei_din: link.psakei_din
          });
        }
      });

      // סינון לפי תגית אם נבחרה
      let filteredData = combined;
      if (selectedTag !== "all") {
        filteredData = filteredData.filter((link: PsakLink) => 
          link.psakei_din?.tags?.includes(selectedTag)
        );
      }

      setSelectedDafPsakim(filteredData);
      setSelectedDafInfo({ masechet, daf });

      // Cache the unfiltered combined result for next time
      const dafCacheKey = `dafPsakim::${masechet}::${daf}`;
      setMeta(dafCacheKey, combined);
    } catch (error) {
      console.error('Error loading daf psakim:', error);
    }
  };

  const { open: openDocument } = useDocumentViewer();
  const handlePsakClick = useCallback((psak: any) => {
    if (!psak) return;
    const id = psak.psak_din_id || psak.psakei_din?.id || psak.id || '';
    trackRecentPsak(id);
    openDocument({
      id,
      title: psak.psakei_din?.title || psak.title,
      source_url: psak.source_url || psak.sourceUrl || psak.psakei_din?.source_url,
    });
  }, [openDocument]);

  const handleTagClick = useCallback((tag: string) => {
    setSelectedTag(tag === selectedTag ? "all" : tag);
  }, [selectedTag]);

  const filteredIndex = indexData.filter(entry => {
    const matchesSearch = searchQuery === "" || 
      entry.masechet.hebrewName.includes(searchQuery);
    const matchesSeder = selectedSeder === "all" || 
      entry.masechet.seder === selectedSeder;
    return matchesSearch && matchesSeder;
  });

  // חישוב אחוז כיסוי לכל מסכת
  const getCoveragePercent = (entry: IndexEntry) => {
    return Math.round((entry.dafim.length / entry.masechet.maxDaf) * 100);
  };

  // צבע לפי כמות פסקים
  const getHeatColor = (count: number) => {
    if (count >= 5) return "bg-primary text-primary-foreground";
    if (count >= 3) return "bg-primary/80 text-primary-foreground";
    if (count >= 2) return "bg-primary/60 text-primary-foreground";
    return "bg-primary/40 text-primary-foreground";
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Sparkles className="w-8 h-8 animate-pulse text-primary" />
        <p className="text-muted-foreground">טוען אינדקס חכם...</p>
      </div>
    );
  }

return (
    <div className="space-y-6 text-right" dir="rtl">
      {/* כותרת וסטטיסטיקות ראשיות */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Scale className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{statistics.totalPsakim}</p>
                <p className="text-xs text-muted-foreground">פסקי דין</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-border bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Database className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{statistics.totalLinks}</p>
                <p className="text-xs text-muted-foreground">קישורים</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-border bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <BookOpen className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{statistics.masechtotWithLinks}</p>
                <p className="text-xs text-muted-foreground">מסכתות</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-border bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {statistics.yearRange.min > 0 ? `${statistics.yearRange.min}-${statistics.yearRange.max}` : '-'}
                </p>
                <p className="text-xs text-muted-foreground">טווח שנים</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* תגיות פופולריות */}
      {statistics.topTags.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Tag className="w-4 h-4" />
              תגיות פופולריות (לחץ לסינון)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {statistics.topTags.map(({ tag, count }) => (
                <Badge 
                  key={tag} 
                  variant={selectedTag === tag ? "default" : "secondary"}
                  className="cursor-pointer hover:bg-primary/20 transition-colors"
                  onClick={() => handleTagClick(tag)}
                >
                  {tag}
                  <span className="mr-1 text-xs opacity-70">({count})</span>
                </Badge>
              ))}
              {selectedTag !== "all" && (
                <Badge 
                  variant="outline" 
                  className="cursor-pointer"
                  onClick={() => setSelectedTag("all")}
                >
                  נקה סינון ×
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* סינון וחיפוש */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="חפש מסכת..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-10"
          />
        </div>
        <Select value={selectedSeder} onValueChange={setSelectedSeder}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="כל הסדרים" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסדרים</SelectItem>
            {SEDARIM.map(seder => (
              <SelectItem key={seder} value={seder}>סדר {seder}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          <Button variant={viewMode === "tree" ? "default" : "ghost"} size="sm" className="h-7 px-2 gap-1 text-xs" onClick={() => setViewMode("tree")} title="עץ">
            <BookOpen className="w-4 h-4" /><span className="hidden sm:inline">עץ</span>
          </Button>
          <Button variant={viewMode === "table" ? "default" : "ghost"} size="sm" className="h-7 px-2 gap-1 text-xs" onClick={() => setViewMode("table")} title="טבלה">
            <TableIcon className="w-4 h-4" /><span className="hidden sm:inline">טבלה</span>
          </Button>
          <Button variant={viewMode === "cards" ? "default" : "ghost"} size="sm" className="h-7 px-2 gap-1 text-xs" onClick={() => setViewMode("cards")} title="כרטיסיות">
            <LayoutGrid className="w-4 h-4" /><span className="hidden sm:inline">כרטיסיות</span>
          </Button>
          <Button variant={viewMode === "stats" ? "default" : "ghost"} size="sm" className="h-7 px-2 gap-1 text-xs" onClick={() => setViewMode("stats")} title="סטטיסטיקות">
            <BarChart3 className="w-4 h-4" /><span className="hidden sm:inline">סטטיסטיקות</span>
          </Button>
        </div>
      </div>

      {viewMode === "stats" && (
        /* תצוגת סטטיסטיקות */
        <div className="grid md:grid-cols-2 gap-6">
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <BookOpen className="w-5 h-5" />
                מסכתות מובילות
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {filteredIndex.slice(0, 8).map((entry) => (
                  <div key={entry.masechet.englishName} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{entry.masechet.hebrewName}</span>
                      <span className="text-muted-foreground">{entry.totalPsakim} פסקים</span>
                    </div>
                    <Progress value={(entry.totalPsakim / (filteredIndex[0]?.totalPsakim || 1)) * 100} className="h-2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                בתי דין מובילים
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {statistics.topCourts.map((court) => (
                  <div key={court.court} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium truncate max-w-[200px]">{court.court}</span>
                      <span className="text-muted-foreground">{court.count}</span>
                    </div>
                    <Progress value={(court.count / (statistics.topCourts[0]?.count || 1)) * 100} className="h-2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {viewMode === "table" && (
        /* תצוגת טבלה */
        <Card className="border-border">
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              <table className="w-full text-sm" dir="rtl">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="text-right p-3 font-semibold">מסכת</th>
                    <th className="text-right p-3 font-semibold">דפים מקושרים</th>
                    <th className="text-right p-3 font-semibold">סה"כ פסקים</th>
                    <th className="text-right p-3 font-semibold">כיסוי</th>
                    <th className="text-right p-3 font-semibold">סדר</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIndex.map((entry) => (
                    <tr 
                      key={entry.masechet.englishName} 
                      className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => {
                        setExpandedMasechet(entry.masechet.englishName);
                        if (entry.dafim.length > 0) {
                          loadDafPsakim(entry.dafim[0].sugya_id, entry.masechet.hebrewName, entry.dafim[0].dafNumber);
                        }
                      }}
                    >
                      <td className="p-3 font-medium text-foreground">{entry.masechet.hebrewName}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {entry.dafim.slice(0, 10).map(d => (
                            <Badge key={d.dafNumber} variant="secondary" className="text-[10px]">
                              {toHebrewNumeral(d.dafNumber)}
                            </Badge>
                          ))}
                          {entry.dafim.length > 10 && (
                            <Badge variant="outline" className="text-[10px]">+{entry.dafim.length - 10}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge>{entry.totalPsakim}</Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Progress value={getCoveragePercent(entry)} className="h-2 w-20" />
                          <span className="text-xs text-muted-foreground">{getCoveragePercent(entry)}%</span>
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">{entry.masechet.seder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {viewMode === "cards" && (
        /* תצוגת כרטיסיות */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredIndex.map((entry) => (
            <Card 
              key={entry.masechet.englishName}
              className="border-border hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => {
                setExpandedMasechet(entry.masechet.englishName);
                setViewMode("tree");
              }}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <Badge variant="secondary">{entry.totalPsakim} פסקים</Badge>
                  <h3 className="text-lg font-bold text-foreground">{entry.masechet.hebrewName}</h3>
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                  <span>{entry.dafim.length} דפים</span>
                  <span>סדר {entry.masechet.seder}</span>
                </div>
                <Progress value={getCoveragePercent(entry)} className="h-2 mb-2" />
                <p className="text-xs text-muted-foreground text-left">{getCoveragePercent(entry)}% כיסוי</p>
                <div className="flex flex-wrap gap-1 mt-3">
                  {entry.dafim.slice(0, 8).map(d => (
                    <Badge key={d.dafNumber} variant="outline" className="text-[10px]">
                      {toHebrewNumeral(d.dafNumber)}
                    </Badge>
                  ))}
                  {entry.dafim.length > 8 && (
                    <Badge variant="outline" className="text-[10px]">+{entry.dafim.length - 8}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {viewMode === "tree" && (
        /* תצוגת עץ */
        <div className="grid md:grid-cols-2 gap-6">
          {/* עץ המסכתות */}
          <Card className="border border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <BookOpen className="w-5 h-5" />
                מסכתות ({filteredIndex.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                {filteredIndex.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    אין פסקי דין מקושרים
                  </div>
                ) : (
                  <Accordion 
                    type="single" 
                    collapsible
                    value={expandedMasechet || undefined}
                    onValueChange={setExpandedMasechet}
                  >
                    {filteredIndex.map((entry) => (
                      <AccordionItem key={entry.masechet.englishName} value={entry.masechet.englishName}>
                        <AccordionTrigger className="hover:no-underline flex-row-reverse">
                          <div className="flex items-center justify-between w-full pr-4">
                            <Badge variant="secondary" className="mr-2">
                              {entry.totalPsakim} פסקים
                            </Badge>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                ({getCoveragePercent(entry)}% כיסוי)
                              </span>
                              <span className="font-medium">{entry.masechet.hebrewName}</span>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="grid grid-cols-6 gap-2 p-2">
                            {entry.dafim.map((daf) => (
                              <Button
                                key={daf.dafNumber}
                                variant={
                                  selectedDafInfo?.masechet === entry.masechet.hebrewName && 
                                  selectedDafInfo?.daf === daf.dafNumber 
                                    ? "default" 
                                    : "outline"
                                }
                                size="sm"
                                className={`relative ${
                                  selectedDafInfo?.masechet !== entry.masechet.hebrewName || 
                                  selectedDafInfo?.daf !== daf.dafNumber 
                                    ? getHeatColor(daf.psakimCount) 
                                    : ''
                                }`}
                                onClick={() => loadDafPsakim(daf.sugya_id, entry.masechet.hebrewName, daf.dafNumber)}
                              >
                                {toHebrewNumeral(daf.dafNumber)}
                                {daf.psakimCount > 1 && (
                                  <span className="absolute -top-1 -left-1 bg-background text-foreground border rounded-full w-4 h-4 text-[10px] flex items-center justify-center">
                                    {daf.psakimCount}
                                  </span>
                                )}
                              </Button>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* רשימת פסקי דין לדף נבחר */}
          <Card className="border border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  <Button variant={psakimView === "list" ? "default" : "ghost"} size="sm" className="h-6 px-2 text-[11px]" onClick={() => setPsakimView("list")} title="רשימה">
                    <List className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant={psakimView === "table" ? "default" : "ghost"} size="sm" className="h-6 px-2 text-[11px]" onClick={() => setPsakimView("table")} title="טבלה">
                    <TableIcon className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant={psakimView === "compact" ? "default" : "ghost"} size="sm" className="h-6 px-2 text-[11px]" onClick={() => setPsakimView("compact")} title="קומפקטי">
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Scale className="w-5 h-5" />
                  {selectedDafInfo 
                    ? `פסקי דין - ${selectedDafInfo.masechet} דף ${toHebrewNumeral(selectedDafInfo.daf)}`
                    : 'בחר דף לצפייה בפסקי דין'
                  }
                  {selectedTag !== "all" && (
                    <Badge variant="outline" className="mr-2">
                      <Filter className="w-3 h-3 ml-1" />
                      {selectedTag}
                    </Badge>
                  )}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                {!selectedDafInfo ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Scale className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>לחץ על דף באחת המסכתות כדי לראות את פסקי הדין המקושרים</p>
                  </div>
                ) : selectedDafPsakim.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {selectedTag !== "all" 
                      ? `אין פסקי דין עם התגית "${selectedTag}" לדף זה`
                      : 'אין פסקי דין לדף זה'
                    }
                  </div>
                ) : psakimView === "table" ? (
                  /* תצוגת טבלה לפסקים */
                  <table className="w-full text-sm" dir="rtl">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-right p-2 font-semibold">כותרת</th>
                        <th className="text-right p-2 font-semibold">בית דין</th>
                        <th className="text-right p-2 font-semibold">שנה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDafPsakim.map((link) => (
                        <tr 
                          key={link.id}
                          className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => handlePsakClick(link.psakei_din)}
                        >
                          <td className="p-2">
                            <div className="flex items-center gap-1.5">
                              <FileTypeBadge url={link.psakei_din?.source_url} />
                              <span className="font-medium line-clamp-1">{link.psakei_din?.title}</span>
                            </div>
                          </td>
                          <td className="p-2 text-muted-foreground">{link.psakei_din?.court}</td>
                          <td className="p-2 text-muted-foreground">{link.psakei_din?.year || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : psakimView === "compact" ? (
                  /* תצוגה קומפקטית */
                  <div className="grid grid-cols-2 gap-2">
                    {selectedDafPsakim.map((link) => (
                      <div
                        key={link.id}
                        className="p-3 rounded-lg border border-border/50 hover:bg-accent/50 cursor-pointer transition-colors text-right"
                        onClick={() => handlePsakClick(link.psakei_din)}
                      >
                        <div className="flex items-center gap-1 mb-1">
                          <FileTypeBadge url={link.psakei_din?.source_url} />
                          <span className="font-medium text-sm line-clamp-1">{link.psakei_din?.title}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{link.psakei_din?.court}{link.psakei_din?.year ? ` • ${link.psakei_din.year}` : ''}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* תצוגת רשימה רגילה */
                  <div className="space-y-3">
                    {selectedDafPsakim.map((link) => (
                      <Card 
                        key={link.id} 
                        className="p-4 cursor-pointer hover:bg-accent/50 transition-colors border-r-4 border-r-primary/50"
                        onClick={() => handlePsakClick(link.psakei_din)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0 mt-1" />
                          <div className="flex-1 text-right">
                            <h4 className="font-medium text-foreground line-clamp-1 flex items-center gap-1.5 justify-end">
                              <SummaryToggle summary={link.psakei_din?.summary} compact />
                              <FileTypeBadge url={link.psakei_din?.source_url} />
                              {link.psakei_din?.title}
                            </h4>
                            <div className="flex items-center justify-end gap-3 text-sm text-muted-foreground mt-1">
                              <span className="flex items-center gap-1">
                                {link.psakei_din?.court}
                                <Building2 className="w-3 h-3" />
                              </span>
                              {link.psakei_din?.year > 0 && (
                              <span className="flex items-center gap-1">
                                {link.psakei_din?.year}
                                <Calendar className="w-3 h-3" />
                              </span>
                              )}
                            </div>
                            <p className="text-sm text-foreground/80 mt-2 line-clamp-2 text-right">
                              {link.connection_explanation}
                            </p>
                          </div>
                        </div>
                        {link.psakei_din?.tags && link.psakei_din.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {link.psakei_din.tags.slice(0, 4).map((tag, idx) => (
                              <Badge 
                                key={idx} 
                                variant={tag === selectedTag ? "default" : "outline"} 
                                className="text-xs"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}


    </div>
  );
};

export default GemaraPsakDinIndex;
