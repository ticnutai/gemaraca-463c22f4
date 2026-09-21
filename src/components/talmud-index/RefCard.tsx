import { memo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Check, X, RotateCcw, FileText, EyeOff, Minus, Plus, AlignJustify, Pencil } from 'lucide-react';
import { TalmudRefWithPsak, highlightRawInContext, extractContextLines, escapeHtml, ValidationStatus, ConfidenceFactors } from './types';
import PsakPreviewPopover from '../PsakPreviewPopover';
import { sourceLabel } from '@/lib/referenceSource';

interface Props {
  data: TalmudRefWithPsak;
  onValidate: (id: string, status: ValidationStatus, autoDismissIds?: string[]) => void;
  onClickRef: (ref: TalmudRefWithPsak) => void;
  onCorrect?: (ref: TalmudRefWithPsak) => void;
  highlightColor?: string;
  highlightBg?: string;
}

const CONTEXT_LABELS: Record<string, string> = {
  gemara_direct: 'גמרא ישירה',
  mefaresh: 'מפרש',
  direct_quote: 'ציטוט ישיר',
  ai_detected: 'זוהה ע"י AI',
  none: '—',
};

function ScoreBadge({ score, confidence, factors }: { score: number | null; confidence: string; factors: ConfidenceFactors | null }) {
  const displayScore = score ?? (confidence === 'high' ? 75 : confidence === 'medium' ? 55 : 35);
  const colorClass = displayScore >= 80
    ? 'border-green-500/50 text-green-700 dark:text-green-400'
    : displayScore >= 55
      ? 'border-yellow-500/50 text-yellow-700 dark:text-yellow-400'
      : displayScore >= 30
        ? 'border-orange-500/50 text-orange-700 dark:text-orange-400'
        : 'border-red-500/50 text-red-700 dark:text-red-400';

  const label = displayScore >= 80 ? 'גבוה' : displayScore >= 55 ? 'בינוני' : displayScore >= 30 ? 'נמוך' : 'נמוך מאוד';

  if (!factors) {
    return (
      <Badge variant="outline" className={`text-[10px] ${colorClass}`}>
        {label}
      </Badge>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-[10px] cursor-help ${colorClass}`}>
          {label} ({displayScore})
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-[280px] p-3 text-right" dir="rtl">
        <div className="text-xs font-bold mb-1.5">פירוט ציון ביטחון: {displayScore}/100</div>
        <div className="space-y-0.5 text-[11px]">
          <div className="flex justify-between"><span>ספציפיות הפניה</span><span className="font-mono">+{factors.base_specificity}</span></div>
          {factors.frequency_boost > 0 && (
            <div className="flex justify-between text-blue-600 dark:text-blue-400"><span>תדירות באותו מסמך</span><span className="font-mono">+{factors.frequency_boost}</span></div>
          )}
          {factors.context_boost > 0 && (
            <div className="flex justify-between text-purple-600 dark:text-purple-400"><span>הקשר: {CONTEXT_LABELS[factors.context_type] || factors.context_type}</span><span className="font-mono">+{factors.context_boost}</span></div>
          )}
          {factors.source_agreement && (
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400"><span>הסכמת regex+AI</span><span className="font-mono">+{factors.agreement_boost}</span></div>
          )}
          {factors.proximity_boost > 0 && (
            <div className="flex justify-between text-cyan-600 dark:text-cyan-400"><span>קרבה להפניות דומות</span><span className="font-mono">+{factors.proximity_boost}</span></div>
          )}
          <div className={`flex justify-between ${factors.range_boost < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
            <span>טווח דפים {factors.daf_range_valid ? '✓' : '✗'}</span>
            <span className="font-mono">{factors.range_boost > 0 ? '+' : ''}{factors.range_boost}</span>
          </div>
          <div className="border-t pt-1 mt-1 flex justify-between font-bold">
            <span>סה"כ</span><span className="font-mono">{displayScore}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default memo(function RefCard({ data, onValidate, onClickRef, onCorrect, highlightColor, highlightBg }: Props) {
  const [contextLines, setContextLines] = useState(0);

  const isApproved = data.validation_status === 'correct';
  const isRejected = data.validation_status === 'incorrect';
  const isIgnored = data.validation_status === 'ignored';

  const matchContext = extractContextLines(data.context_snippet, data.raw_reference, 0);
  const surroundContext = contextLines > 0
    ? extractContextLines(data.context_snippet, data.raw_reference, contextLines)
    : null;

  // Check max available lines
  const maxContext = extractContextLines(data.context_snippet, data.raw_reference, 10);
  const maxAvailable = maxContext ? Math.max(0, Math.floor((maxContext.surroundLines.length - 1) / 2)) : 0;

  const matchLineHtml = matchContext
    ? highlightRawInContext(matchContext.matchLine, data.raw_reference, highlightColor, highlightBg)
    : data.context_snippet
      ? highlightRawInContext(data.context_snippet, data.raw_reference, highlightColor, highlightBg)
      : null;

  return (
    <div
      className={`px-4 py-3 rounded-md border transition-all text-right cursor-pointer ${
        isApproved ? 'border-green-500/30 bg-green-50/50 dark:bg-green-950/20' :
        isRejected ? 'border-red-500/30 bg-red-50/50 dark:bg-red-950/20 opacity-60' :
        isIgnored ? 'border-muted bg-muted/30 opacity-40' :
        'border-border/50 hover:bg-muted/50'
      }`}
      onClick={() => onClickRef(data)}
    >
      <div className="flex items-center gap-3 mb-1">
        <span className="text-lg font-bold text-primary">{data.corrected_normalized || data.normalized}</span>
        {data.corrected_normalized && (
          <Badge variant="outline" className="text-[10px] border-blue-400 text-blue-600">מתוקן</Badge>
        )}
        <div className="flex items-center gap-2 mr-auto">
          <ScoreBadge score={data.confidence_score} confidence={data.confidence} factors={data.confidence_factors} />
          <Badge variant="secondary" className="text-[10px]">
            {sourceLabel(data.source)}
          </Badge>
          {data.psakei_din && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground max-w-[200px]" title={data.psakei_din.title}>
              <FileText className="w-3 h-3 shrink-0" />
              <span className="truncate">{data.psakei_din.title}</span>
              <PsakPreviewPopover psakDinId={data.psak_din_id} psakTitle={data.psakei_din.title} mode="summary" />
              <PsakPreviewPopover psakDinId={data.psak_din_id} psakTitle={data.psakei_din.title} mode="facts" />
            </span>
          )}
          {isApproved && (
            <Badge className="text-[10px] bg-green-600 text-white border-0">✓ מאושר</Badge>
          )}
          {isIgnored && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">התעלם</Badge>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground mb-1.5">
        זוהה: "<span className="font-semibold text-foreground">{data.raw_reference}</span>"
      </p>

      {/* Context area */}
      {matchLineHtml ? (
        <div className="relative">
          {/* Before lines */}
          {contextLines > 0 && surroundContext && surroundContext.surroundLines.map((line, i) => {
            if (line === matchContext?.matchLine) return null;
            const lineIdx = surroundContext.surroundLines.indexOf(line);
            const matchIdx = surroundContext.surroundLines.indexOf(matchContext?.matchLine ?? '');
            if (lineIdx >= matchIdx) return null;
            return (
              <div
                key={`before-${i}`}
                className="text-sm text-muted-foreground/70 bg-muted/20 rounded-t px-3 py-1 leading-relaxed border-r-2 border-muted-foreground/20"
                dangerouslySetInnerHTML={{ __html: escapeHtml(line) }}
              />
            );
          })}

          {/* Match line */}
          <div
            className="text-sm bg-muted/40 rounded px-3 py-2 leading-relaxed whitespace-pre-wrap"
            style={{ background: highlightBg ? `${highlightBg}` : undefined }}
            dangerouslySetInnerHTML={{ __html: matchLineHtml }}
          />

          {/* After lines */}
          {contextLines > 0 && surroundContext && surroundContext.surroundLines.map((line, i) => {
            if (line === matchContext?.matchLine) return null;
            const lineIdx = surroundContext.surroundLines.indexOf(line);
            const matchIdx = surroundContext.surroundLines.indexOf(matchContext?.matchLine ?? '');
            if (lineIdx <= matchIdx) return null;
            return (
              <div
                key={`after-${i}`}
                className="text-sm text-muted-foreground/70 bg-muted/20 rounded-b px-3 py-1 leading-relaxed border-r-2 border-muted-foreground/20"
                dangerouslySetInnerHTML={{ __html: escapeHtml(line) }}
              />
            );
          })}

          {/* Context lines control */}
          {maxAvailable > 0 && (
            <div
              className="absolute top-1 left-1 flex items-center gap-0.5 bg-background/90 backdrop-blur-sm border border-border/50 rounded-md shadow-sm"
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => setContextLines(prev => Math.max(0, prev - 1))}
                disabled={contextLines === 0}
                className="p-1 rounded-r hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                title="פחות שורות הקשר"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-[10px] font-medium text-muted-foreground min-w-[18px] text-center tabular-nums">
                {contextLines === 0 ? (
                  <AlignJustify className="w-3 h-3 mx-auto" />
                ) : (
                  `±${contextLines}`
                )}
              </span>
              <button
                onClick={() => setContextLines(prev => Math.min(maxAvailable, prev + 1))}
                disabled={contextLines >= maxAvailable}
                className="p-1 rounded-l hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                title="עוד שורות הקשר"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground/50 bg-muted/20 rounded px-3 py-1.5 italic">
          אין הקשר טקסטואלי זמין
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-2" onClick={e => e.stopPropagation()}>
        {isApproved ? (
          /* Approved refs: show only edit button */
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] gap-1 border-blue-400 text-blue-600 hover:bg-blue-50"
              onClick={() => onCorrect?.(data)}
            >
              <Pencil className="w-3 h-3" /> ערוך הקשר
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground"
              onClick={() => onValidate(data.id, 'pending')}
            >
              <RotateCcw className="w-3 h-3" /> איפוס
            </Button>
          </>
        ) : (
          /* Non-approved refs: show all action buttons */
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] gap-1"
              onClick={() => onValidate(data.id, 'correct')}
            >
              <Check className="w-3 h-3" /> נכון
            </Button>
            <Button
              size="sm"
              variant={isRejected ? 'destructive' : 'outline'}
              className="h-6 px-2 text-[11px] gap-1"
              onClick={() => onValidate(data.id, isRejected ? 'pending' : 'incorrect')}
            >
              <X className="w-3 h-3" /> שגוי
            </Button>
            <Button
              size="sm"
              variant={isIgnored ? 'secondary' : 'outline'}
              className="h-6 px-2 text-[11px] gap-1"
              onClick={() => onValidate(data.id, isIgnored ? 'pending' : 'ignored')}
            >
              <EyeOff className="w-3 h-3" /> התעלם
            </Button>
            {onCorrect && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px] gap-1 border-blue-400 text-blue-600 hover:bg-blue-50"
                onClick={() => onCorrect(data)}
              >
                <Pencil className="w-3 h-3" /> תקן
              </Button>
            )}
            {(isRejected || isIgnored) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px] gap-1 text-muted-foreground"
                onClick={() => onValidate(data.id, 'pending')}
              >
                <RotateCcw className="w-3 h-3" /> איפוס
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
});
