/**
 * Web Worker for heavy reference filtering & grouping.
 * Offloads CPU work from the main thread.
 */

interface TalmudReference {
  tractate: string;
  daf: string;
  source: string;
  validation_status?: string;
  normalized?: string;
  raw_reference?: string;
  psak_din_id?: string;
  psakei_din?: { title?: string };
}

interface FilterMessage {
  type: 'filter';
  refs: TalmudReference[];
  hideResolved: boolean;
  filterTractate: string;
  search: string;
  filterApproved: boolean;
  filterSource: 'all' | 'regex' | 'ai' | 'both' | 'site-index' | 'extracted';
}

interface GroupMessage {
  type: 'group';
  filtered: TalmudReference[];
}

type WorkerMessage = FilterMessage | GroupMessage;

const TRACTATES_ORDER: string[] = []; // Populated on first filter call

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'filter') {
    const { refs, hideResolved, filterTractate, search, filterApproved, filterSource } = msg;

    // Pre-compute "both" set if needed
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

    const filtered = refs.filter((r: TalmudReference) => {
      if (hideResolved && (r.validation_status === 'incorrect' || r.validation_status === 'ignored' || r.validation_status === 'correct')) return false;
      if (filterApproved && r.validation_status !== 'correct') return false;
      if (filterSource !== 'all' && filterSource !== 'both' && r.source !== filterSource) return false;
      if (filterSource === 'both' && bothSet && !bothSet.has(`${r.tractate}|${r.daf}`)) return false;
      if (filterTractate !== 'all' && r.tractate !== filterTractate) return false;
      if (search && !r.normalized?.includes(search) && !r.raw_reference?.includes(search) && !r.psakei_din?.title?.includes(search)) return false;
      return true;
    });

    // Also compute grouped
    const grouped: Record<string, TalmudReference[]> = {};
    for (const ref of filtered) {
      if (!grouped[ref.tractate]) grouped[ref.tractate] = [];
      grouped[ref.tractate].push(ref);
    }

    // Compute stats
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
      // כל מקור נספר בנפרד: ספירה של "כל מה שאינו regex" כ-AI מציגה מצג שווא
      if (r.source === 'regex') regex++;
      else if (r.source === 'ai') ai++;
      else if (r.source === 'site-index') siteIndex++;
      else other++;
    }

    self.postMessage({
      type: 'filterResult',
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
};
