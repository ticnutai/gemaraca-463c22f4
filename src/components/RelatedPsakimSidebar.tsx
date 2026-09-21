import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { trackRecentPsak } from "@/lib/recentPsakim";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Scale, ExternalLink, Plus, ArrowUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { PsakDinRow } from "@/types/psakDin";
import PsakDinEditDialog from "./PsakDinEditDialog";
import PsakDinActions from "./PsakDinActions";
import FileTypeBadge from "./FileTypeBadge";
import SummaryToggle from "./SummaryToggle";
import { useDocumentViewer } from "./DocumentViewerProvider";

interface RelatedPsakimSidebarProps {
  sugyaId: string;
}

interface PsakLink {
  id: string;
  psak_din_id: string;
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

const RelatedPsakimSidebar = ({ sugyaId }: RelatedPsakimSidebarProps) => {
  const navigate = useNavigate();
  const [psakim, setPsakim] = useState<PsakLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPsak, setSelectedPsak] = useState<any | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPsak, setEditingPsak] = useState<PsakDinRow | null>(null);
  const [isNewPsak, setIsNewPsak] = useState(false);

  useEffect(() => {
    if (sugyaId) {
      loadRelatedPsakim();
    }
  }, [sugyaId]);

  const loadRelatedPsakim = useCallback(async () => {
    try {
      // חיפוש קישורים ישירים
      const { data: directLinks, error: directError } = await supabase
        .from('sugya_psak_links')
        .select(`
          id,
          psak_din_id,
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
        .eq('sugya_id', sugyaId)
        .order('relevance_score', { ascending: false });

      if (directError) throw directError;

      // גם חיפוש לפי תבנית דומה (למשל daf-2 יתאים ל bava_batra_2a)
      const dafMatch = sugyaId.match(/daf-(\d+)/);
      let additionalLinks: typeof directLinks = [];
      
      if (dafMatch) {
        const dafNum = dafMatch[1];
        const { data: patternLinks } = await supabase
          .from('sugya_psak_links')
          .select(`
            id,
            psak_din_id,
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
          .like('sugya_id', `%_${dafNum}%`)
          .order('relevance_score', { ascending: false });

        additionalLinks = patternLinks || [];
      }

      // מיזוג תוצאות ייחודיות
      const allLinks = [...(directLinks || []), ...additionalLinks];
      const uniqueLinks = allLinks.filter((link, index, self) => 
        index === self.findIndex(l => l.psak_din_id === link.psak_din_id)
      );

      setPsakim(uniqueLinks);
    } catch (error) {
      console.error('Error loading related psakim:', error);
    } finally {
      setLoading(false);
    }
  }, [sugyaId]);

  const { open: openDocument } = useDocumentViewer();
  const handlePsakClick = useCallback((psak: typeof psakim[number]) => {
    trackRecentPsak(psak.id);
    openDocument({ id: psak.id, title: (psak as any).title ?? (psak as any).psakei_din?.title, source_url: (psak as any).source_url as string | undefined });
  }, [openDocument]);

  const handleEditPsak = useCallback(async (psakId: string) => {
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
  }, []);

  const handleAddNew = useCallback(() => {
    setEditingPsak(null);
    setIsNewPsak(true);
    setEditDialogOpen(true);
  }, []);

  const handleSaved = useCallback(() => {
    loadRelatedPsakim();
  }, [loadRelatedPsakim]);

  if (loading) {
    return (
      <Card className="border border-border">
        <CardContent className="py-8 text-center text-muted-foreground">
          טוען פסקי דין קשורים...
        </CardContent>
      </Card>
    );
  }

  if (psakim.length === 0) {
    return (
      <Card className="border border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="w-4 h-4" />
            פסקי דין קשורים
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            לא נמצאו פסקי דין מקושרים לסוגיה זו
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border border-border" dir="rtl">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2 flex-row-reverse justify-start">
              <Scale className="w-4 h-4" />
              פסקי דין קשורים ({psakim.length})
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddNew}
              className="gap-1 h-7 px-2"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-300px)] max-h-[600px]">
            <div className="space-y-2 p-4 pt-2">
              {psakim.map((link) => (
                <div
                  key={link.id}
                  className="p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer text-right"
                  onClick={() => handlePsakClick(link.psakei_din as any)}
                >
                  <div className="flex items-start justify-between gap-2 flex-row-reverse">
                    <div className="flex-1 min-w-0 text-right">
                      <h4 className="font-medium text-sm text-foreground line-clamp-1 text-right flex items-center gap-1.5 justify-end">
                        <SummaryToggle summary={link.psakei_din?.summary} compact />
                        <FileTypeBadge url={link.psakei_din?.source_url} />
                        {link.psakei_din?.title}
                      </h4>
                      <p className="text-xs text-muted-foreground text-right">
                        {link.psakei_din?.court} • {link.psakei_din?.year}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {link.psakei_din?.id && (
                        <PsakDinActions
                          psakId={link.psakei_din.id}
                          onEdit={handleEditPsak}
                          onDelete={handleSaved}
                          compact
                        />
                      )}
                      <ExternalLink className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                  
                  <p className="text-xs text-foreground/70 mt-1 line-clamp-2 text-right">
                    {link.connection_explanation}
                  </p>
                  
                  {link.psakei_din?.tags && link.psakei_din.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 justify-start">
                      {link.psakei_din.tags.slice(0, 2).map((tag, idx) => (
                        <Badge key={idx} variant="outline" className="text-[10px] py-0">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
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

export default RelatedPsakimSidebar;
