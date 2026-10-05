// Cache for Gemara pages and Sefaria text — uses IndexedDB for larger storage (50MB+)
// Falls back to localStorage if IndexedDB is unavailable

import { get, set, del, keys, createStore } from 'idb-keyval';

const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days (text rarely changes)
const MAX_ENTRIES = 6000; // Enough for entire Shas (~5870 dafim)

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// Create separate IndexedDB stores for different data types
const pageStore = createStore('gemara-page-cache', 'pages');
const textStore = createStore('gemara-text-cache', 'texts');

// In-memory LRU for ultra-fast repeat access
const memoryCache = new Map<string, CacheEntry<unknown>>();

async function getFromIDB<T>(store: ReturnType<typeof createStore>, key: string): Promise<T | null> {
  // Check memory first
  const memKey = key;
  const memEntry = memoryCache.get(memKey);
  if (memEntry && Date.now() - memEntry.timestamp < CACHE_DURATION) {
    return memEntry.data as T;
  }

  try {
    const entry = await get<CacheEntry<T>>(key, store);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_DURATION) {
      // Expired — remove async
      del(key, store).catch(() => {});
      return null;
    }
    memoryCache.set(memKey, entry);
    return entry.data;
  } catch {
    // IndexedDB failed — try localStorage fallback
    return getFromLocalStorage<T>(key);
  }
}

async function saveToIDB<T>(store: ReturnType<typeof createStore>, key: string, data: T): Promise<void> {
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  memoryCache.set(key, entry);

  try {
    await set(key, entry, store);

    // Evict oldest entries if too many
    const allKeys = await keys(store);
    if (allKeys.length > MAX_ENTRIES) {
      const entries: { key: IDBValidKey; ts: number }[] = [];
      for (const k of allKeys) {
        const e = await get<CacheEntry<unknown>>(k, store);
        entries.push({ key: k, ts: e?.timestamp ?? 0 });
      }
      entries.sort((a, b) => a.ts - b.ts);
      const toDelete = entries.slice(0, entries.length - MAX_ENTRIES + 50);
      for (const e of toDelete) {
        await del(e.key, store);
      }
    }
  } catch {
    // Fallback: save to localStorage
    saveToLocalStorage(key, data);
  }
}

// localStorage fallback for browsers without IndexedDB
function getFromLocalStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`cache:${key}`);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_DURATION) {
      localStorage.removeItem(`cache:${key}`);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function saveToLocalStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(`cache:${key}`, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    // Storage full
  }
}

// Page cache functions
export function getCachedPage(sugyaId: string): unknown | null {
  // Sync check memory only (for backward compat)
  const entry = memoryCache.get(`page:${sugyaId}`);
  if (entry && Date.now() - entry.timestamp < CACHE_DURATION) return entry.data;
  // Trigger async load
  getFromIDB(pageStore, sugyaId).then(data => {
    if (data) memoryCache.set(`page:${sugyaId}`, { data, timestamp: Date.now() });
  });
  return getFromLocalStorage(sugyaId);
}

export function setCachedPage(sugyaId: string, pageData: unknown): void {
  saveToIDB(pageStore, sugyaId, pageData);
}

// טקסט הגמרא נטען היום מקבצים מקומיים (public/shas-ws וכו'), ולכן אין לו
// מטמון כאן. textStore נשאר רק כדי שניקוי המטמון ימחק נתונים ישנים שנשמרו בו.

// Clear all caches
export function clearAllCaches(): void {
  memoryCache.clear();
  keys(pageStore).then(ks => ks.forEach(k => del(k, pageStore))).catch(() => {});
  keys(textStore).then(ks => ks.forEach(k => del(k, textStore))).catch(() => {});
  try {
    localStorage.removeItem('gemara_pages_cache');
    localStorage.removeItem('gemara_text_cache');
  } catch {}
}

// Get cache stats for debugging
export function getCacheStats(): { pages: number; texts: number } {
  try {
    const pages = localStorage.getItem('gemara_pages_cache');
    const texts = localStorage.getItem('gemara_text_cache');
    return {
      pages: pages ? Object.keys(JSON.parse(pages)).length : 0,
      texts: texts ? Object.keys(JSON.parse(texts)).length : 0,
    };
  } catch {
    return { pages: 0, texts: 0 };
  }
}
