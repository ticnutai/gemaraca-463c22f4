import { useEffect, useRef, useState, useCallback } from 'react';
import type { TalmudRefWithPsak } from '@/components/talmud-index/types';

interface WorkerResult {
  filtered: TalmudRefWithPsak[];
  grouped: Record<string, TalmudRefWithPsak[]>;
  stats: {
    uniqueTractates: string[];
    resolvedCount: number;
    pendingCount: number;
    regexCount: number;
    aiCount: number;
    siteIndexCount: number;
    otherCount: number;
    psakCount: number;
    approvedCount: number;
  };
}

const defaultStats: WorkerResult['stats'] = {
  uniqueTractates: [],
  resolvedCount: 0,
  pendingCount: 0,
  regexCount: 0,
  aiCount: 0,
  siteIndexCount: 0,
  otherCount: 0,
  psakCount: 0,
  approvedCount: 0,
};

/**
 * Hook that offloads heavy filtering/grouping of 13K+ talmud references to a Web Worker.
 * Falls back to main-thread computation if Workers are unavailable.
 */
export function useFilterWorker(
  refs: TalmudRefWithPsak[] | undefined,
  hideResolved: boolean,
  filterTractate: string,
  search: string,
  filterApproved: boolean = false,
  filterSource: 'all' | 'regex' | 'ai' | 'both' | 'site-index' | 'extracted' = 'all',
) {
  const workerRef = useRef<Worker | null>(null);
  const [result, setResult] = useState<WorkerResult>({ filtered: [], grouped: {}, stats: defaultStats });

  // Initialize worker
  useEffect(() => {
    try {
      workerRef.current = new Worker(
        new URL('../lib/indexWorker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'filterResult') {
          setResult({
            filtered: e.data.filtered,
            grouped: e.data.grouped,
            stats: e.data.stats,
          });
        }
      };
    } catch {
      // Workers not supported — will fallback
      workerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Post work to worker (or fallback on main thread)
  useEffect(() => {
    if (!refs?.length) {
      setResult({ filtered: [], grouped: {}, stats: defaultStats });
      return;
    }

    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'filter',
        refs,
        hideResolved,
        filterTractate,
        search,
        filterApproved,
        filterSource,
      });
    } else {
      // Build a set of tractate+daf combos that have both AI and regex sources
      let bothSet: Set<string> | null = null;
      if (filterSource === 'both') {
        const aiKeys = new Set<string>();
        const regexKeys = new Set<string>();
        for (const r of refs) {
          const key = `${r.tractate}|${r.daf}`;
          if (r.source === 'ai') aiKeys.add(key);
          else regexKeys.add(key);
        }
        bothSet = new Set([...aiKeys].filter(k => regexKeys.has(k)));
      }

      // Main-thread fallback
      const filtered = refs.filter(r => {
        if (hideResolved && (r.validation_status === 'incorrect' || r.validation_status === 'ignored' || r.validation_status === 'correct')) return false;
        if (filterApproved && r.validation_status !== 'correct') return false;
        if (filterSource !== 'all' && filterSource !== 'both' && r.source !== filterSource) return false;
        if (filterSource === 'both' && bothSet && !bothSet.has(`${r.tractate}|${r.daf}`)) return false;
        if (filterTractate !== 'all' && r.tractate !== filterTractate) return false;
        if (search && !r.normalized?.includes(search) && !r.raw_reference?.includes(search) && !r.psakei_din?.title?.includes(search)) return false;
        return true;
      });

      const grouped: Record<string, TalmudRefWithPsak[]> = {};
      for (const ref of filtered) {
        if (!grouped[ref.tractate]) grouped[ref.tractate] = [];
        grouped[ref.tractate].push(ref);
      }

      const tractateSet = new Set<string>();
      const psakSet = new Set<string>();
      let resolved = 0, pending = 0, regex = 0, ai = 0, approved = 0, siteIndex = 0, other = 0;
      for (const r of refs) {
        tractateSet.add(r.tractate);
        psakSet.add(r.psak_din_id);
        const s = r.validation_status;
        if (s === 'incorrect' || s === 'ignored' || s === 'correct') resolved++;
        else pending++;
        if (s === 'correct') approved++;
        if (r.source === 'regex') regex++;
        else if (r.source === 'ai') ai++;
        else if (r.source === 'site-index') siteIndex++;
        else other++;
      }

      setResult({
        filtered,
        grouped,
        stats: {
          uniqueTractates: [...tractateSet],
          resolvedCount: resolved,
          pendingCount: pending,
          regexCount: regex,
          aiCount: ai,
          siteIndexCount: siteIndex,
          otherCount: other,
          psakCount: psakSet.size,
          approvedCount: approved,
        },
      });
    }
  }, [refs, hideResolved, filterTractate, search, filterApproved, filterSource]);

  return result;
}
