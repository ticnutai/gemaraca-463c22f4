import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Pencil, Save, X } from 'lucide-react';
import type { TalmudRefWithPsak } from './talmud-index/types';
import { sourceLabel } from '@/lib/referenceSource';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: TalmudRefWithPsak;
  onSave: (id: string, correctedNormalized: string) => void;
}

export default function RefCorrectionDialog({ open, onOpenChange, data, onSave }: Props) {
  const [corrected, setCorrected] = useState(data.corrected_normalized || data.normalized || '');

  const handleSave = () => {
    const value = corrected.trim();
    if (!value) return;
    onSave(data.id, value);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" />
            תיקון הפניה תלמודית
          </DialogTitle>
          <DialogDescription>
            תקן את ההפניה שזוהתה. התיקון יישמר בבסיס הנתונים וההפניה תסומן כמאושרת.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Original info */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">זוהה מקורית:</Label>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{data.raw_reference}</Badge>
              <span className="text-xs text-muted-foreground">→</span>
              <Badge variant="secondary" className="text-xs">{data.normalized}</Badge>
            </div>
          </div>

          {/* Source info */}
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>מקור: {sourceLabel(data.source)}</span>
            {data.psakei_din?.title && (
              <>
                <span>•</span>
                <span className="truncate max-w-[200px]">פסק: {data.psakei_din.title}</span>
              </>
            )}
          </div>

          {/* Correction field */}
          <div className="space-y-2">
            <Label htmlFor="corrected">הפניה מתוקנת:</Label>
            <Input
              id="corrected"
              value={corrected}
              onChange={(e) => setCorrected(e.target.value)}
              placeholder="למשל: בבא בתרא ב׳ ע״א"
              className="text-right"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              הזן את ההפניה הנכונה. התיקון יישמר וההפניה תסומן כמאושרת אוטומטית.
            </p>
          </div>

          {/* Context preview */}
          {data.context_snippet && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">הקשר:</Label>
              <div className="text-xs bg-muted/40 rounded p-2 max-h-20 overflow-auto leading-relaxed">
                {data.context_snippet}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="w-3.5 h-3.5 ml-1" />
            ביטול
          </Button>
          <Button onClick={handleSave} disabled={!corrected.trim()}>
            <Save className="w-3.5 h-3.5 ml-1" />
            שמור תיקון
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
