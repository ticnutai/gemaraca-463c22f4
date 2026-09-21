import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { trackRecentPsak } from "@/lib/recentPsakim";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Brain, Loader2, ChevronDown, ChevronUp, ExternalLink, Sparkles, Plus, Trash2, ArrowUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import PsakDinEditDialog from "./PsakDinEditDialog";
import PsakDinActions from "./PsakDinActions";
import FileTypeBadge from "./FileTypeBadge";
import SummaryToggle from "./SummaryToggle";
import { useDocumentViewer } from "./DocumentViewerProvider";

interface LinkedPsakimSectionProps {
  sugyaId: string;
  masechet: string;
  dafNumber: number;
}

interface LinkedPsak {
  id: string;
  title: string;
  summary: string;
  court: string;
  year: number;
  source_url?: string;
  source_text?: string;
  confidence?: string;
  connection_explanation?: string;
}

const LinkedPsakimSection = ({ sugyaId, masechet, dafNumber }: LinkedPsakimSectionProps) => {
  const navigate = useNavigate();
  const [psakim, setPsakim] = useState<LinkedPsak[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [selectedPsak, setSelectedPsak] = useState<LinkedPsak | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPsak, setEditingPsak] = useState<any | null>(null);
  const [isNewPsak, setIsNewPsak] = useState(false);
  const [selectedForBulk, setSelectedForBulk] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    loadLinkedPsakim();
  }, [sugyaId, masechet, dafNumber]);

  const loadLinkedPsakim = async () => {
    setLoading(true);
    try {
      // pattern_sugya_links stores masechet in Hebrew, so search by Hebrew name
      // Also try with the provided masechet value in case it's already Hebrew
      const { data: patternLinks } = await supabase
        .from('pattern_sugya_links')
        .select(`
          source_text,
          confidence,
          psakei_din:psak_din_id (id, title, summary, court, year, source_url)
        `)
        .eq('masechet', masechet)
        .eq('daf', dafNumber.toString());

      // Also check by sugya_id pattern which includes the daf
      const sugyaPatternA = sugyaId.endsWith('a') ? sugyaId : `${sugyaId.replace(/[ab]$/, '')}a`;
      const sugyaPatternB = sugyaId.endsWith('b') ? sugyaId : `${sugyaId.replace(/[ab]$/, '')}b`;
      
      const { data: patternLinksBySugya } = await supabase
        .from('pattern_sugya_links')
        .select(`
          source_text,
          confidence,
          psakei_din:psak_din_id (id, title, summary, court, year, source_url)
        `)
        .or(`sugya_id.eq.${sugyaPatternA},sugya_id.eq.${sugyaPatternB}`);

      // Get AI-based links (sugya_psak_links)
      const { data: aiLinks } = await supabase
        .from('sugya_psak_links')
        .select(`
          connection_explanation,
          relevance_score,
          psakei_din:psak_din_id (id, title, summary, court, year)
        `)
        .eq('sugya_id', sugyaId);

      // Combine and deduplicate
      const combined: LinkedPsak[] = [];
      const seenIds = new Set<string>();

      // Add pattern links by masechet/daf
      patternLinks?.forEach((link: { psakei_din?: LinkedPsak; source_text?: string; confidence?: string }) => {
        if (link.psakei_din && !seenIds.has(link.psakei_din.id)) {
          seenIds.add(link.psakei_din.id);
          combined.push({
            ...link.psakei_din,
            source_text: link.source_text,
            confidence: link.confidence
          });
        }
      });

      // Add pattern links by sugya_id
      patternLinksBySugya?.forEach((link: { psakei_din?: LinkedPsak; source_text?: string; confidence?: string }) => {
        if (link.psakei_din && !seenIds.has(link.psakei_din.id)) {
          seenIds.add(link.psakei_din.id);
          combined.push({
            ...link.psakei_din,
            source_text: link.source_text,
            confidence: link.confidence
          });
        }
      });

      aiLinks?.forEach((link: { psakei_din?: LinkedPsak; connection_explanation?: string }) => {
        if (link.psakei_din && !seenIds.has(link.psakei_din.id)) {
          seenIds.add(link.psakei_din.id);
          combined.push({
            ...link.psakei_din,
            connection_explanation: link.connection_explanation
          });
        }
      });

      setPsakim(combined);
    } catch (error) {
      console.error('Error loading linked psakim:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAIAnalysis = async (psakId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAnalyzingId(psakId);
    
    try {
      const { error } = await supabase.functions.invoke('analyze-psak-din', {
        body: { psakId }
      });

      if (error) throw error;

      toast({
        title: "ניתוח AI הושלם",
        description: "פסק הדין נותח והקישורים עודכנו",
      });

      // Reload to get updated links
      await loadLinkedPsakim();
    } catch (error) {
      console.error('Error analyzing psak:', error);
      toast({
        title: "שגיאה בניתוח",
        variant: "destructive",
      });
    } finally {
      setAnalyzingId(null);
    }
  };

  const { open: openDocument } = useDocumentViewer();
  const handlePsakClick = async (psakId: string) => {
    trackRecentPsak(psakId);
    const { data } = await supabase
      .from('psakei_din')
      .select('*')
      .eq('id', psakId)
      .maybeSingle();
    
    if (!data) return;

    openDocument({ id: data.id, title: data.title, source_url: data.source_url });
  };

  const handleEditPsak = async (psakId: string) => {
    const { data } = await supabase
      .from('psakei_din')
      .select('*')
      .eq('id', psakId)
      .maybeSingle();
    
    if (data) {
      setEditingPsak(data);
      setIsNewPsak(false);
      setEditDialogOpen(true);
    }
  };

  const handleAddNew = () => {
    setEditingPsak(null);
    setIsNewPsak(true);
    setEditDialogOpen(true);
  };

  const handleSaved = () => {
    loadLinkedPsakim();
  };

  if (loading) {
    return (
      <Card className="border-accent/30">
        <CardContent className="p-4 space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (psakim.length === 0) {
    return null;
  }

  const displayedPsakim = expanded ? psakim : psakim.slice(0, 3);

  return (
    <>
      <Card className="border-accent/30 bg-accent/5" dir="rtl">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3 flex-row-reverse">
            <h3 className="font-semibold text-foreground flex items-center gap-2 flex-row-reverse">
              <FileText className="w-5 h-5 text-accent" />
              פסקי דין מקושרים
              <Badge variant="secondary" className="text-xs">
                {psakim.length}
              </Badge>
            </h3>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAddNew}
                className="gap-1 h-7 px-2"
              >
                <Plus className="w-4 h-4" />
                הוסף
              </Button>
              {psakim.length > 3 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded(!expanded)}
                  className="gap-1 flex-row-reverse"
                >
                  {expanded ? (
                    <>
                      הסתר
                      <ChevronUp className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      הצג הכל ({psakim.length})
                      <ChevronDown className="w-4 h-4" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          <ScrollArea className={expanded ? "h-[300px]" : ""}>
            <div className="space-y-2">
              {displayedPsakim.map((psak) => (
                <div
                  key={psak.id}
                  className="p-3 rounded-lg bg-card border border-border hover:shadow-md transition-shadow cursor-pointer group"
                  onClick={() => handlePsakClick(psak.id)}
                >
                  <div className="flex items-start gap-3 flex-row-reverse">
                    {/* Right side: Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <PsakDinActions
                        psakId={psak.id}
                        onEdit={handleEditPsak}
                        onDelete={handleSaved}
                        compact
                      />
                      {psak.confidence && (
                        <Badge 
                          variant={psak.confidence === 'high' ? 'default' : 'outline'}
                          className="text-xs"
                        >
                          {psak.confidence === 'high' ? 'גבוה' : psak.confidence === 'medium' ? 'בינוני' : 'נמוך'}
                        </Badge>
                      )}
                      
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-accent hover:bg-accent/20"
                        onClick={(e) => handleAIAnalysis(psak.id, e)}
                        disabled={analyzingId === psak.id}
                        title="נתח עם AI"
                      >
                        {analyzingId === psak.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                      </Button>
                      
                      <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    
                    {/* Left side: Content */}
                    <div className="flex-1 text-right">
                      <div className="font-medium line-clamp-1 group-hover:text-primary transition-colors text-right flex items-center gap-1.5 justify-end">
                        <SummaryToggle summary={psak.summary} compact />
                        <FileTypeBadge url={psak.source_url} />
                        {psak.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 text-right">
                        {psak.court}{psak.year > 0 ? ` • ${psak.year}` : ''}
                      </div>
                      {psak.source_text && (
                        <div className="text-xs text-accent mt-1 line-clamp-1 text-right">
                          מקור: {psak.source_text}
                        </div>
                      )}
                      {psak.connection_explanation && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-1 text-right">
                          {psak.connection_explanation}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>


      <PsakDinEditDialog
        psak={editingPsak}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSaved={handleSaved}
        isNew={isNewPsak}
      />
    </>
  );
};

export default LinkedPsakimSection;
