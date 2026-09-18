import { useMemo, useState } from "react";
import { ChevronDown, FolderArchive, Table2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { bucketLabel, tableLabel, type BackupTopic } from "@/lib/backup/topics";
import { formatBytes } from "@/lib/backup/engine";

export interface SelectionItemInfo {
  /** main figure, e.g. "5,093 שורות" */
  primary: string;
  /** optional second figure, e.g. size or "כרגע: 5,100" */
  secondary?: string;
  bytes?: number;
  disabled?: boolean;
  disabledReason?: string;
}

/** Selection keys are "t:<table>" and "b:<bucket>". */
export const tableKey = (t: string) => `t:${t}`;
export const bucketKey = (b: string) => `b:${b}`;

interface Props {
  topics: BackupTopic[];
  info: Record<string, SelectionItemInfo>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export function SelectionTree({ topics, info, selected, onChange }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const keysOf = (t: BackupTopic) =>
    [...t.tables.map(tableKey), ...t.buckets.map(bucketKey)].filter((k) => !info[k]?.disabled);
  const allKeys = useMemo(() => topics.flatMap(keysOf), [topics, info]); // eslint-disable-line react-hooks/exhaustive-deps

  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const noneSelected = allKeys.every((k) => !selected.has(k));

  const setMany = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    onChange(next);
  };

  const toggleExpanded = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-2 border-b border-border">
        <Checkbox
          id="select-all"
          checked={allSelected ? true : noneSelected ? false : "indeterminate"}
          onCheckedChange={() => setMany(allKeys, !allSelected)}
          className="data-[state=indeterminate]:bg-primary/40"
        />
        <label htmlFor="select-all" className="font-semibold text-sm cursor-pointer whitespace-nowrap">
          בחר הכל
        </label>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          ({allKeys.filter((k) => selected.has(k)).length} מתוך {allKeys.length})
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded(new Set(topics.map((t) => t.id)))}>
          פתח הכל
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded(new Set())}>
          סגור הכל
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setMany(allKeys, false)} disabled={noneSelected}>
          נקה בחירה
        </Button>
      </div>

      {topics.map((topic) => {
        const keys = keysOf(topic);
        const count = keys.filter((k) => selected.has(k)).length;
        const state = keys.length === 0 ? false : count === keys.length ? true : count === 0 ? false : "indeterminate";
        const isOpen = expanded.has(topic.id);
        const topicBytes = [...topic.tables.map(tableKey), ...topic.buckets.map(bucketKey)].reduce(
          (s, k) => s + (info[k]?.bytes ?? 0),
          0,
        );

        return (
          <div key={topic.id} className="rounded-lg border border-border bg-card/50">
            <div className="flex items-center gap-2 p-2">
              <Checkbox
                id={`topic-${topic.id}`}
                checked={state}
                disabled={keys.length === 0}
                onCheckedChange={() => setMany(keys, state !== true)}
                className="data-[state=indeterminate]:bg-primary/40"
              />
              <button className="flex-1 flex items-center gap-2 text-right min-w-0" onClick={() => toggleExpanded(topic.id)}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{topic.label}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {keys.length === 0 ? "לא זמין" : `${count}/${keys.length}`}
                    </Badge>
                    {topicBytes > 0 && <span className="text-[11px] text-muted-foreground">{formatBytes(topicBytes)}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{topic.description}</div>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", isOpen && "rotate-180")} />
              </button>
            </div>

            {isOpen && (
              <div className="border-t border-border px-2 py-1.5 space-y-1">
                {[...topic.tables.map((t) => ({ key: tableKey(t), label: tableLabel(t), raw: t, icon: Table2 })),
                  ...topic.buckets.map((b) => ({ key: bucketKey(b), label: bucketLabel(b), raw: b, icon: FolderArchive })),
                ].map(({ key, label, raw, icon: Icon }) => {
                  const i = info[key];
                  return (
                    <label
                      key={key}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1 text-sm",
                        i?.disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50 cursor-pointer",
                      )}
                      title={i?.disabledReason}
                    >
                      <Checkbox
                        checked={selected.has(key)}
                        disabled={i?.disabled}
                        onCheckedChange={(v) => setMany([key], v === true)}
                      />
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 min-w-0 truncate">
                        {label}
                        {label !== raw && <span className="text-[10px] text-muted-foreground mr-1.5 font-mono" dir="ltr">{raw}</span>}
                      </span>
                      {i?.disabledReason && <span className="text-[11px] text-muted-foreground">{i.disabledReason}</span>}
                      {i && !i.disabledReason && (
                        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {i.primary}
                          {i.secondary && <span className="mr-2 opacity-75">{i.secondary}</span>}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
