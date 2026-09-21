import { useState, useMemo, memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { Check, X, EyeOff, Pencil } from 'lucide-react';
import { TalmudRefWithPsak, TRACTATES, toHebrewDaf, toHebrewAmud, highlightRawInContext, extractContextLines, escapeHtml, ValidationStatus } from './types';
import { shortSourceLabel } from '@/lib/referenceSource';

interface Props {
  filtered: TalmudRefWithPsak[];
  onValidate: (id: string, status: ValidationStatus, autoDismissIds?: string[]) => void;
  onClickRef: (ref: TalmudRefWithPsak) => void;
  onCorrect?: (ref: TalmudRefWithPsak) => void;
  highlightColor?: string;
  highlightBg?: string;
}

const TableRowItem = memo(function TableRowItem({ data, onValidate, onClickRef, onCorrect, highlightColor, highlightBg }: {
  data: TalmudRefWithPsak;
  onValidate: Props['onValidate'];
  onClickRef: Props['onClickRef'];
  onCorrect?: Props['onCorrect'];
  highlightColor?: string;
  highlightBg?: string;
}) {
  const ctx = extractContextLines(data.context_snippet, data.raw_reference, 3);

  return (
    <TableRow
      className={`cursor-pointer ${data.validation_status === 'incorrect' ? 'opacity-50' : ''}`}
      onClick={() => onClickRef(data)}
    >
      <TableCell className="font-bold text-primary">{data.corrected_normalized || data.normalized}</TableCell>
      <TableCell>{data.tractate}</TableCell>
      <TableCell>{toHebrewDaf(data.daf)}{data.amud ? ` ${toHebrewAmud(data.amud)}` : ''}</TableCell>
      <TableCell>
        <Badge variant="secondary" className="text-[10px]">
          {shortSourceLabel(data.source)}
        </Badge>
      </TableCell>
      <TableCell className="max-w-[120px] truncate text-xs text-muted-foreground">
        {data.psakei_din?.title}
      </TableCell>
      <TableCell>
        {(() => {
          const score = data.confidence_score ?? (data.confidence === 'high' ? 75 : data.confidence === 'medium' ? 55 : 35);
          const colorClass = score >= 80
            ? 'border-green-500/50 text-green-700'
            : score >= 55
              ? 'border-yellow-500/50 text-yellow-700'
              : score >= 30
                ? 'border-orange-500/50 text-orange-700'
                : 'border-red-500/50 text-red-700';
          const label = score >= 80 ? 'גבוה' : score >= 55 ? 'בינוני' : score >= 30 ? 'נמוך' : 'נמוך מאוד';
          return (
            <Badge variant="outline" className={`text-[10px] ${colorClass}`} title={`ציון: ${score}/100`}>
              {label} ({score})
            </Badge>
          );
        })()}
      </TableCell>
      <TableCell>
        {data.validation_status === 'correct' && <Badge className="text-[10px] bg-green-600 text-white border-0">מאושר</Badge>}
        {data.validation_status === 'incorrect' && <Badge variant="destructive" className="text-[10px]">שגוי</Badge>}
        {data.validation_status === 'ignored' && <Badge variant="outline" className="text-[10px] text-muted-foreground">התעלם</Badge>}
        {data.validation_status === 'pending' && <Badge variant="outline" className="text-[10px]">ממתין</Badge>}
      </TableCell>
      <TableCell onClick={e => e.stopPropagation()}>
        <div className="flex gap-1">
          {data.validation_status === 'correct' ? (
            /* Approved: show only edit button */
            <Button
              size="sm" variant="ghost" className="h-6 w-6 p-0"
              onClick={() => onCorrect?.(data)}
              title="ערוך הקשר"
            >
              <Pencil className="w-3 h-3 text-blue-600" />
            </Button>
          ) : (
            /* Non-approved: show all action buttons */
            <>
              <Button
                size="sm" variant="ghost" className="h-6 w-6 p-0"
                onClick={() => onValidate(data.id, data.validation_status === 'correct' ? 'pending' : 'correct')}
                title="נכון"
              >
                <Check className="w-3 h-3 text-green-600" />
              </Button>
              <Button
                size="sm" variant="ghost" className="h-6 w-6 p-0"
                onClick={() => onValidate(data.id, data.validation_status === 'incorrect' ? 'pending' : 'incorrect')}
                title="שגוי"
              >
                <X className="w-3 h-3 text-red-600" />
              </Button>
              <Button
                size="sm" variant="ghost" className="h-6 w-6 p-0"
                onClick={() => onValidate(data.id, data.validation_status === 'ignored' ? 'pending' : 'ignored')}
                title="התעלם"
              >
                <EyeOff className="w-3 h-3 text-muted-foreground" />
              </Button>
              <Button
                size="sm" variant="ghost" className="h-6 w-6 p-0"
                onClick={() => onCorrect?.(data)}
                title="תקן"
              >
                <Pencil className="w-3 h-3 text-blue-600" />
              </Button>
            </>
          )}
        </div>
      </TableCell>
      <TableCell className="max-w-[200px]">
        {!ctx ? <span className="text-xs text-muted-foreground">—</span> : (
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <span
                className="text-xs text-muted-foreground truncate block cursor-default max-w-[200px]"
                dangerouslySetInnerHTML={{
                  __html: highlightRawInContext(ctx.matchLine, data.raw_reference, highlightColor, highlightBg)
                }}
              />
            </HoverCardTrigger>
            {ctx.surroundLines.length > 1 && (
              <HoverCardContent side="top" align="start" className="w-[400px] max-w-[90vw] p-3 text-right" dir="rtl">
                <div className="text-xs text-muted-foreground mb-1.5 font-semibold">הקשר מורחב (±3 שורות)</div>
                <div className="text-sm leading-relaxed space-y-1 whitespace-pre-wrap">
                  {ctx.surroundLines.map((line, i) => {
                    const isMatch = line === ctx.matchLine;
                    return (
                      <div
                        key={i}
                        className={isMatch ? 'rounded px-1.5 py-0.5' : 'text-muted-foreground'}
                        style={isMatch ? { background: highlightBg || 'hsl(var(--primary) / 0.1)' } : undefined}
                        dangerouslySetInnerHTML={{
                          __html: isMatch
                            ? highlightRawInContext(line, data.raw_reference, highlightColor, highlightBg)
                            : escapeHtml(line)
                        }}
                      />
                    );
                  })}
                </div>
              </HoverCardContent>
            )}
          </HoverCard>
        )}
      </TableCell>
    </TableRow>
  );
});

export default function IndexTableView({ filtered, onValidate, onClickRef, onCorrect, highlightColor, highlightBg }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const ia = TRACTATES.indexOf(a.tractate);
    const ib = TRACTATES.indexOf(b.tractate);
    if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    const dafDiff = Number(a.daf) - Number(b.daf);
    if (dafDiff !== 0) return dafDiff;
    return (a.amud ?? '').localeCompare(b.amud ?? '');
  }), [filtered]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 20,
  });

  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">
        מציג {sorted.length} הפניות
      </div>

      <div ref={parentRef} className="h-[calc(100vh-380px)] overflow-auto" dir="rtl">
        <Table className="text-right">
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">הפניה</TableHead>
              <TableHead className="text-right">מסכת</TableHead>
              <TableHead className="text-right">דף</TableHead>
              <TableHead className="text-right">מקור</TableHead>
              <TableHead className="text-right">פסק דין</TableHead>
              <TableHead className="text-right">ביטחון</TableHead>
              <TableHead className="text-right">סטטוס</TableHead>
              <TableHead className="text-right">פעולות</TableHead>
              <TableHead className="text-right">שורת הקשר</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Spacer for virtual scroll offset */}
            {virtualizer.getVirtualItems().length > 0 && (
              <tr style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0 }}>
                <td colSpan={9} />
              </tr>
            )}
            {virtualizer.getVirtualItems().map(virtualRow => (
              <TableRowItem
                key={sorted[virtualRow.index].id}
                data={sorted[virtualRow.index]}
                onValidate={onValidate}
                onClickRef={onClickRef}
                onCorrect={onCorrect}
                highlightColor={highlightColor}
                highlightBg={highlightBg}
              />
            ))}
            {/* Bottom spacer */}
            {virtualizer.getVirtualItems().length > 0 && (
              <tr style={{ height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0) }}>
                <td colSpan={9} />
              </tr>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
