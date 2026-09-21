import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { trackRecentPsak } from "@/lib/recentPsakim";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Search, Calendar, Building2, FileText, ExternalLink, Loader2, ArrowUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import FileTypeBadge from "./FileTypeBadge";
import SummaryToggle from "./SummaryToggle";
import { useDocumentViewer } from "./DocumentViewerProvider";

interface SearchResult {
  id: string;
  title: string;
  summary: string;
  court: string;
  year: number;
  caseNumber?: string;
  sourceUrl?: string;
  tags?: string[];
  source?: string;
  connection?: string;
}

const SearchPsakDinTab = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedPsak, setSelectedPsak] = useState<SearchResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  // AI search result cache (in-memory for session)
  const searchCacheRef = useRef<Map<string, SearchResult[]>>(new Map());

  // Local text search using full-text search (FTS) with ilike fallback
  const localSearch = async (searchQuery: string): Promise<SearchResult[]> => {
    // Build FTS query: split words, join with &
    const ftsQuery = searchQuery.trim().split(/\s+/).filter(Boolean).join(' & ');
    const pattern = `%${searchQuery}%`;

    const { data, error } = await supabase
      .from('psakei_din')
      .select('id, title, summary, court, year, case_number, source_url, tags')
      .or(`search_vector.fts.${ftsQuery},title.ilike.${pattern}`)
      .order('year', { ascending: false })
      .limit(30);

    if (error || !data) return [];
    return data.map(p => ({
      id: p.id,
      title: p.title,
      summary: p.summary,
      court: p.court,
      year: p.year,
      caseNumber: p.case_number,
      sourceUrl: p.source_url,
      tags: p.tags,
      source: 'local',
    }));
  };

  const handleSearch = async () => {
    if (!query.trim()) {
      toast({
        title: "הזן מילות חיפוש",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setResults([]);

    // Check AI search cache first
    const cacheKey = query.trim().toLowerCase();
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached) {
      setResults(cached);
      setHasSearched(true);
      setLoading(false);
      toast({ title: `נמצאו ${cached.length} תוצאות (מהמטמון)` });
      return;
    }
    
    try {
      // Try AI search first
      const { data, error } = await supabase.functions.invoke('search-psak-din', {
        body: { query: query.trim() }
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      const aiResults = data.results || [];

      if (aiResults.length > 0) {
        setResults(aiResults);
        setHasSearched(true);
        searchCacheRef.current.set(cacheKey, aiResults);
        toast({ title: `נמצאו ${aiResults.length} תוצאות` });
      } else {
        // Fallback: local text search
        const localResults = await localSearch(query.trim());
        setResults(localResults);
        setHasSearched(true);

        if (localResults.length > 0) {
          toast({ title: `נמצאו ${localResults.length} תוצאות (חיפוש מקומי)` });
        } else {
          toast({
            title: "לא נמצאו תוצאות",
            description: "נסה מילות חיפוש אחרות",
          });
        }
      }
    } catch (error) {
      console.error('AI search error, falling back to local:', error);
      // Fallback on any error: local text search
      try {
        const localResults = await localSearch(query.trim());
        setResults(localResults);
        setHasSearched(true);

        if (localResults.length > 0) {
          toast({ title: `נמצאו ${localResults.length} תוצאות (חיפוש מקומי)` });
        } else {
          toast({
            title: "לא נמצאו תוצאות",
            description: "נסה מילות חיפוש אחרות",
          });
        }
      } catch (localErr) {
        console.error('Local search also failed:', localErr);
        toast({
          title: "שגיאה בחיפוש",
          description: "נסה שוב מאוחר יותר",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const { open: openDocument } = useDocumentViewer();
  const handlePsakClick = (psak: SearchResult) => {
    trackRecentPsak(psak.id);
    openDocument({ id: psak.id, title: psak.title, source_url: psak.sourceUrl });
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card className="border border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-bold text-foreground">חיפוש פסקי דין</CardTitle>
            <p className="text-sm text-muted-foreground">
              חיפוש במאגרים: פסקדין, דין תורה, דעת, ספריא, בתי הדין הרבניים ועוד
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="הזן נושא לחיפוש... (לדוגמה: שכנים, נזיקין, קניין)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && handleSearch()}
                className="flex-1 bg-card border-border"
                disabled={loading}
              />
              <Button 
                onClick={handleSearch} 
                disabled={loading}
                className="gap-2"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                חפש
              </Button>
            </div>
          </CardContent>
        </Card>

        {loading && (
          <div className="space-y-4 py-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="border rounded-lg p-4 space-y-3">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        )}

        {!loading && hasSearched && results.length === 0 && (
          <div className="text-center py-12">
            <Search className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground font-medium">לא נמצאו תוצאות</p>
            <p className="text-sm text-muted-foreground mt-1">נסה מילות חיפוש אחרות או ניסוח שונה</p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="space-y-4">
            {results.map((psak, index) => (
              <Card 
                key={index} 
                className="border border-border shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => handlePsakClick(psak)}
              >
                <CardHeader>
                  <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2 justify-end">
                    <SummaryToggle summary={psak.summary} />
                    {psak.tags?.includes('psakim.org') && (
                      <Badge className="text-[10px] px-1.5 py-0.5 bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 dark:text-emerald-400">
                        psakim.org
                      </Badge>
                    )}
                    <FileTypeBadge url={psak.sourceUrl} size="sm" />
                    {psak.title}
                  </CardTitle>
                  <div className="flex flex-wrap gap-2 text-sm text-muted-foreground mt-2">
                    {psak.court && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                          <Building2 className="w-3 h-3 text-primary" />
                        </div>
                        {psak.court}
                      </div>
                    )}
                    {psak.year && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                          <Calendar className="w-3 h-3 text-primary" />
                        </div>
                        {psak.year}
                      </div>
                    )}
                    {psak.caseNumber && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                          <FileText className="w-3 h-3 text-primary" />
                        </div>
                        {psak.caseNumber}
                      </div>
                    )}
                    {psak.source && (
                      <Badge variant="outline" className="text-xs">
                        {psak.source}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-foreground mb-3 line-clamp-2">{psak.summary}</p>
                  {psak.connection && (
                    <p className="text-sm text-muted-foreground mb-3 italic line-clamp-1">
                      {psak.connection}
                    </p>
                  )}
                  {psak.tags && psak.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {psak.tags.map((tag: string, idx: number) => (
                        <Badge key={idx} variant="secondary" className="bg-muted text-muted-foreground">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {psak.sourceUrl && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-3 flex-wrap"
                    >
                      <a
                        href={psak.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-primary hover:underline text-sm"
                      >
                        <ExternalLink className="w-4 h-4" />
                        לפסק הדין המלא
                      </a>
                      <button
                        onClick={() => navigate(`/embedpdf-viewer?url=${encodeURIComponent(psak.sourceUrl)}&psakId=${psak.id}`)}
                        className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-[#D4AF37]/10 border border-[#D4AF37]/40 text-[#0B1F5B] hover:bg-[#D4AF37]/20 transition-colors"
                      >
                        <FileText className="w-3 h-3" />
                        EmbedPDF
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};

export default SearchPsakDinTab;
