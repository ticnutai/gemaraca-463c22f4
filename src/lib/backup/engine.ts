// Data backup / restore engine.
//
// Server side lives in supabase/migrations/20260918120000_data_backup_system.sql
// (backup_catalog, backup_export_rows, backup_restore_rows, backup_delete_missing,
// backup_storage_manifest). Everything here runs in the browser as the admin user.
//
// Backup layout (same paths in a ZIP and in the cloud folder system-backups/<id>/):
//   manifest.json                     what is in the backup (tables, row counts, buckets)
//   data/<table>/00001.json           rows as a JSON array, one file per batch
//   files-index/<bucket>.json         list of every file in the bucket at backup time
//   files/<bucket>/<path>             file contents (ZIP only)
// In the cloud, data/ and files-index/ are gzipped (.json.gz).

import { supabase } from "@/integrations/supabase/client";
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";
import { topicsFor } from "./topics";

export const BACKUP_FORMAT = "gemaraca-data-backup";
export const BACKUP_VERSION = 1;
export const CLOUD_BUCKET = "system-backups";
export const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;

const TARGET_BATCH_BYTES = 2_000_000; // raw JSON per exported batch
const RESTORE_BATCH_BYTES = 1_000_000; // JSON per restore request
const FILE_CONCURRENCY = 6;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CatalogTable {
  name: string;
  rows: number;
  bytes: number;
  pk: string[] | null;
  columns: string[];
  depends_on: string[];
}

export interface CatalogBucket {
  id: string;
  public: boolean;
  files: number;
  bytes: number;
}

export interface Catalog {
  generated_at: string;
  tables: CatalogTable[];
  buckets: CatalogBucket[];
}

export interface ManifestTable {
  rows: number;
  chunks: number;
  pk: string;
  columns: string[];
  depends_on: string[];
}

export interface ManifestBucket {
  files: number;
  bytes: number;
  /** true when the file contents themselves are in the backup (ZIP), not just the index */
  content: boolean;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  created_at: string;
  label: string;
  notes: string | null;
  project_ref: string | null;
  topics: string[];
  tables: Record<string, ManifestTable>;
  buckets: Record<string, ManifestBucket>;
  missing_files?: Record<string, string[]>;
}

export interface FileIndexEntry {
  name: string;
  size: number | null;
  mimetype: string | null;
  updated_at: string | null;
}

export interface BackupRow {
  id: string;
  label: string;
  notes: string | null;
  kind: "cloud" | "download" | "both" | "safety" | "auto";
  status: "running" | "completed" | "partial" | "failed" | "cancelled";
  topics: string[];
  tables: Record<string, number>;
  buckets: Record<string, { files: number; bytes: number; content: boolean }>;
  total_rows: number;
  total_bytes: number;
  storage_path: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface RestoreRow {
  id: string;
  backup_id: string | null;
  source: string;
  source_name: string | null;
  mode: RestoreMode;
  status: BackupRow["status"];
  tables: Record<string, TableRestoreResult>;
  buckets: Record<string, FileRestoreResult>;
  safety_backup_id: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export type RestoreMode = "missing" | "upsert" | "replace";
export type FileRestoreMode = "missing" | "overwrite";

export interface Progress {
  stage: "prepare" | "safety" | "tables" | "files" | "cleanup" | "finalize" | "done";
  message: string;
  rowsDone: number;
  rowsTotal: number;
  filesDone: number;
  filesTotal: number;
}

export type ProgressFn = (p: Progress) => void;

export interface TableRestoreResult {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  deleted: number;
  errors: { id: string; error: string }[];
}

export interface FileRestoreResult {
  uploaded: number;
  skipped: number;
  failed: number;
  errors: { name: string; error: string }[];
}

// ─── Small helpers ─────────────────────────────────────────────────────────

export class BackupCancelled extends Error {
  constructor() {
    super("הפעולה בוטלה");
  }
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new BackupCancelled();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The backup_* functions are not in the generated Database types.
const rpcAny = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function rpc<T>(fn: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    checkAbort(signal);
    try {
      const { data, error } = await rpcAny(fn, args);
      if (!error) return data as T;
      // Server-side errors (bad table, permission) will not fix themselves.
      if (!/fetch|network|timeout|502|503|504|Failed to fetch/i.test(error.message)) {
        throw new Error(error.message);
      }
      lastError = new Error(error.message);
    } catch (e) {
      if (e instanceof BackupCancelled) throw e;
      if (e instanceof Error && !/fetch|network|timeout|502|503|504/i.test(e.message)) throw e;
      lastError = e;
    }
    await sleep(800 * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// Tables not in the generated types either.
const db = supabase as unknown as {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const pad = (n: number) => String(n).padStart(5, "0");
const chunkPath = (table: string, n: number) => `data/${table}/${pad(n)}.json`;

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).blob();
}

async function gunzipText(blob: Blob): Promise<string> {
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>, signal?: AbortSignal) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      checkAbort(signal);
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

/** Wrapped in LTR isolates so "58.0 MB" does not flip to "MB 58.0" inside Hebrew text. */
export function formatBytes(bytes: number): string {
  if (!bytes) return "\u20660 B\u2069";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `\u2066${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}\u2069`;
}

/** Parents before children, using the FK list; cycles fall back to name order. */
export function orderByDependencies(tables: string[], deps: Record<string, string[]>): string[] {
  const set = new Set(tables);
  const out: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (t: string) => {
    if (state.get(t) === "done" || state.get(t) === "visiting") return;
    state.set(t, "visiting");
    for (const p of deps[t] ?? []) if (set.has(p)) visit(p);
    state.set(t, "done");
    out.push(t);
  };
  [...tables].sort().forEach(visit);
  return out;
}

// ─── Catalog / history ─────────────────────────────────────────────────────

export async function loadCatalog(signal?: AbortSignal): Promise<Catalog> {
  return await rpc<Catalog>("backup_catalog", undefined, signal);
}

export { isCurrentUserAdmin } from "./admin";

export async function listBackups(): Promise<BackupRow[]> {
  const { data, error } = await db.from("data_backups").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return data as BackupRow[];
}

export async function listRestores(): Promise<RestoreRow[]> {
  const { data, error } = await db.from("data_restores").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data as RestoreRow[];
}

async function listCloudFolder(prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(CLOUD_BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(error.message);
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      if (item.id === null) out.push(...(await listCloudFolder(path)));
      else out.push(path);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function deleteCloudFolder(prefix: string) {
  const paths = await listCloudFolder(prefix);
  for (let i = 0; i < paths.length; i += 500) {
    const { error } = await supabase.storage.from(CLOUD_BUCKET).remove(paths.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
}

export async function deleteBackup(row: BackupRow) {
  if (row.storage_path) await deleteCloudFolder(row.storage_path);
  const { error } = await db.from("data_backups").delete().eq("id", row.id);
  if (error) throw new Error(error.message);
}

// ─── Save target for ZIP files ─────────────────────────────────────────────

export interface ZipSink {
  /** what ZipWriter writes into */
  writer: WritableStream<Uint8Array> | BlobWriter;
  /** true when writing straight to disk (large backups are safe) */
  streaming: boolean;
  finish: () => Promise<void>;
  abort: () => Promise<void>;
}

type SaveFilePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array> & { abort?: () => Promise<void> }> }>;

export const canStreamToDisk = () => typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";

/**
 * Must be called directly from a click handler (before any other await) so the
 * browser allows the save dialog. Returns null if the user closed the dialog.
 */
export async function pickZipTarget(fileName: string): Promise<ZipSink | null> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }],
      });
      const writable = await handle.createWritable();
      return {
        writer: writable,
        streaming: true,
        finish: async () => {
          try { await writable.close(); } catch { /* zip.js already closed it */ }
        },
        abort: async () => {
          try { await writable.abort?.(); } catch { /* ignore */ }
        },
      };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      throw e;
    }
  }
  const blobWriter = new BlobWriter("application/zip");
  return {
    writer: blobWriter,
    streaming: false,
    finish: async () => {
      const blob = await blobWriter.getData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    abort: async () => {},
  };
}

export function backupFileName(label: string) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const safe = label.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 40);
  return `gemaraca-backup-${stamp}${safe ? "-" + safe : ""}.zip`;
}

// ─── Backup ────────────────────────────────────────────────────────────────

export interface BackupOptions {
  catalog: Catalog;
  tables: string[];
  /** buckets whose file contents go into the ZIP (all selected buckets get an index) */
  buckets: string[];
  toCloud: boolean;
  zip: ZipSink | null;
  label: string;
  notes?: string;
  kind: BackupRow["kind"];
  signal?: AbortSignal;
  onProgress?: ProgressFn;
}

export interface BackupResult {
  backupId: string;
  manifest: BackupManifest;
  status: BackupRow["status"];
}

function batchLimit(t: CatalogTable) {
  const avg = t.rows > 0 ? t.bytes / t.rows : 500;
  return Math.max(25, Math.min(2000, Math.floor(TARGET_BATCH_BYTES / Math.max(avg, 1))));
}

async function listBucketFiles(bucket: string, signal?: AbortSignal): Promise<FileIndexEntry[]> {
  const out: FileIndexEntry[] = [];
  let after: string | null = null;
  for (;;) {
    const res = await rpc<{ files: FileIndexEntry[]; last: string | null }>(
      "backup_storage_manifest",
      { p_bucket: bucket, p_after: after, p_limit: 2000 },
      signal,
    );
    out.push(...res.files);
    if (res.files.length < 2000 || !res.last) return out;
    after = res.last;
  }
}

async function downloadStorageFile(bucket: string, name: string): Promise<Blob> {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.storage.from(bucket).download(name);
    if (data) return data;
    lastError = error?.message ?? "download failed";
    await sleep(600 * 2 ** attempt);
  }
  throw new Error(lastError);
}

async function uploadCloud(path: string, body: Blob, contentType: string) {
  const { error } = await supabase.storage.from(CLOUD_BUCKET).upload(path, body, { upsert: true, contentType });
  if (error) throw new Error(`${path}: ${error.message}`);
}

export async function createBackup(opts: BackupOptions): Promise<BackupResult> {
  const { catalog, signal, onProgress, zip, toCloud } = opts;
  const tables = catalog.tables.filter((t) => opts.tables.includes(t.name));
  const indexBuckets = catalog.buckets.filter((b) => opts.buckets.includes(b.id));
  const contentBuckets = zip ? indexBuckets : [];

  const progress: Progress = {
    stage: "prepare",
    message: "מכין גיבוי…",
    rowsDone: 0,
    rowsTotal: tables.reduce((s, t) => s + t.rows, 0),
    filesDone: 0,
    filesTotal: contentBuckets.reduce((s, b) => s + b.files, 0),
  };
  const emit = (patch: Partial<Progress>) => onProgress?.(Object.assign(progress, patch));
  emit({});

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    label: opts.label,
    notes: opts.notes || null,
    project_ref: PROJECT_REF ?? null,
    topics: topicsFor(tables.map((t) => t.name), indexBuckets.map((b) => b.id)),
    tables: {},
    buckets: {},
  };

  const { data: inserted, error: insertError } = await db
    .from("data_backups")
    .insert({ label: opts.label, notes: opts.notes || null, kind: opts.kind, status: "running", topics: manifest.topics })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);
  const backupId = inserted.id as string;
  const cloudPrefix = toCloud ? backupId : null;
  if (cloudPrefix) await db.from("data_backups").update({ storage_path: cloudPrefix }).eq("id", backupId);

  const zipWriter = zip ? new ZipWriter(zip.writer, { bufferedWrite: true }) : null;
  let cloudBytes = 0;
  let status: BackupRow["status"] = "completed";

  const addJson = async (path: string, value: unknown, level = 6) => {
    const text = JSON.stringify(value);
    if (zipWriter) await zipWriter.add(path, new TextReader(text), { level });
    if (cloudPrefix) {
      const gz = await gzip(text);
      cloudBytes += gz.size;
      await uploadCloud(`${cloudPrefix}/${path}${path === "manifest.json" ? "" : ".gz"}`, path === "manifest.json" ? new Blob([text], { type: "application/json" }) : gz, path === "manifest.json" ? "application/json" : "application/gzip");
    }
  };

  try {
    // Tables
    emit({ stage: "tables" });
    for (const t of tables) {
      checkAbort(signal);
      const pk = t.pk?.[0];
      if (!pk || (t.pk?.length ?? 0) !== 1) throw new Error(`לטבלה ${t.name} אין מפתח ראשי יחיד`);
      emit({ message: `מגבה ${t.name}…` });

      const limit = batchLimit(t);
      let after: string | null = null;
      let chunks = 0;
      let rows = 0;
      for (;;) {
        const res = await rpc<{ rows: unknown[]; last: string | null }>(
          "backup_export_rows",
          { p_table: t.name, p_after: after, p_limit: limit },
          signal,
        );
        if (!res.rows.length) break;
        chunks++;
        rows += res.rows.length;
        await addJson(chunkPath(t.name, chunks), res.rows);
        emit({ rowsDone: progress.rowsDone + res.rows.length });
        if (res.rows.length < limit || !res.last) break;
        after = res.last;
      }
      manifest.tables[t.name] = { rows, chunks, pk, columns: t.columns, depends_on: t.depends_on };
    }

    // Storage: an index for every selected bucket, contents only into the ZIP
    for (const b of indexBuckets) {
      checkAbort(signal);
      emit({ stage: "files", message: `קורא רשימת קבצים: ${b.id}…` });
      const files = await listBucketFiles(b.id, signal);
      await addJson(`files-index/${b.id}.json`, files);
      const content = contentBuckets.some((x) => x.id === b.id);
      manifest.buckets[b.id] = { files: files.length, bytes: files.reduce((s, f) => s + (f.size ?? 0), 0), content };

      if (content && zipWriter) {
        const missing: string[] = [];
        await pool(
          files,
          FILE_CONCURRENCY,
          async (f) => {
            try {
              const blob = await downloadStorageFile(b.id, f.name);
              await zipWriter.add(`files/${b.id}/${f.name}`, new BlobReader(blob), { level: 0 });
            } catch {
              missing.push(f.name);
            }
            emit({ filesDone: progress.filesDone + 1, message: `מוריד קבצים: ${b.id}` });
          },
          signal,
        );
        if (missing.length) {
          status = "partial";
          manifest.missing_files = { ...(manifest.missing_files ?? {}), [b.id]: missing };
        }
      }
    }

    emit({ stage: "finalize", message: "שומר את קובץ התיאור…" });
    await addJson("manifest.json", manifest);
    if (zipWriter) {
      emit({ message: "סוגר את קובץ ה-ZIP…" });
      await zipWriter.close();
      await zip!.finish();
    }

    await db
      .from("data_backups")
      .update({
        status,
        tables: Object.fromEntries(Object.entries(manifest.tables).map(([k, v]) => [k, v.rows])),
        buckets: manifest.buckets,
        total_rows: Object.values(manifest.tables).reduce((s, v) => s + v.rows, 0),
        total_bytes: cloudBytes,
        error_message: manifest.missing_files
          ? `${Object.values(manifest.missing_files).flat().length} קבצים לא הורדו`
          : null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", backupId);

    emit({ stage: "done", message: status === "completed" ? "הגיבוי הושלם" : "הגיבוי הושלם חלקית" });
    return { backupId, manifest, status };
  } catch (e) {
    const cancelled = e instanceof BackupCancelled;
    try { await zipWriter?.close(); } catch { /* ignore */ }
    await zip?.abort();
    if (cloudPrefix) {
      try { await deleteCloudFolder(cloudPrefix); } catch { /* keep going */ }
    }
    await db
      .from("data_backups")
      .update({
        status: cancelled ? "cancelled" : "failed",
        storage_path: null,
        error_message: e instanceof Error ? e.message : String(e),
        completed_at: new Date().toISOString(),
      })
      .eq("id", backupId);
    throw e;
  }
}

// ─── Sources for restore ───────────────────────────────────────────────────

export interface BackupSource {
  kind: "cloud" | "zip";
  name: string;
  backupId: string | null;
  manifest: BackupManifest;
  readChunk: (table: string, n: number) => Promise<Record<string, unknown>[]>;
  readFileIndex: (bucket: string) => Promise<FileIndexEntry[]>;
  hasFileContent: (bucket: string) => boolean;
  readFile: (bucket: string, name: string) => Promise<Blob>;
  close: () => Promise<void>;
}

function validateManifest(m: unknown): BackupManifest {
  const manifest = m as BackupManifest;
  if (!manifest || manifest.format !== BACKUP_FORMAT) throw new Error("זה לא קובץ גיבוי של המערכת");
  if (manifest.version > BACKUP_VERSION) throw new Error("קובץ הגיבוי נוצר בגרסה חדשה יותר של המערכת");
  return manifest;
}

export async function openCloudSource(row: BackupRow): Promise<BackupSource> {
  if (!row.storage_path) throw new Error("לגיבוי הזה אין עותק בענן");
  const prefix = row.storage_path;
  const download = async (path: string) => {
    const { data, error } = await supabase.storage.from(CLOUD_BUCKET).download(`${prefix}/${path}`);
    if (error || !data) throw new Error(`${path}: ${error?.message ?? "not found"}`);
    return data;
  };
  const manifest = validateManifest(JSON.parse(await (await download("manifest.json")).text()));
  return {
    kind: "cloud",
    name: row.label,
    backupId: row.id,
    manifest,
    readChunk: async (table, n) => JSON.parse(await gunzipText(await download(`${chunkPath(table, n)}.gz`))),
    readFileIndex: async (bucket) => JSON.parse(await gunzipText(await download(`files-index/${bucket}.json.gz`))),
    hasFileContent: () => false,
    readFile: async () => {
      throw new Error("גיבוי ענן לא מכיל את תוכן הקבצים");
    },
    close: async () => {},
  };
}

export async function openZipSource(file: File): Promise<BackupSource> {
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const byName = new Map<string, FileEntry>();
  entries.forEach((e: Entry) => {
    if (!e.directory) byName.set(e.filename, e as FileEntry);
  });
  const entry = (path: string) => {
    const e = byName.get(path);
    if (!e) throw new Error(`חסר בקובץ: ${path}`);
    return e;
  };
  const readText = async (path: string) => await entry(path).getData(new TextWriter());
  const manifest = validateManifest(JSON.parse(await readText("manifest.json")));
  return {
    kind: "zip",
    name: file.name,
    backupId: null,
    manifest,
    readChunk: async (table, n) => JSON.parse(await readText(chunkPath(table, n))),
    readFileIndex: async (bucket) => JSON.parse(await readText(`files-index/${bucket}.json`)),
    hasFileContent: (bucket) => !!manifest.buckets[bucket]?.content,
    readFile: async (bucket, name) => await entry(`files/${bucket}/${name}`).getData(new BlobWriter()),
    close: async () => {
      await reader.close();
    },
  };
}

/** Rewrites a cloud backup as a ZIP on this computer. */
export async function exportCloudBackupToZip(row: BackupRow, sink: ZipSink, onProgress?: ProgressFn, signal?: AbortSignal) {
  const source = await openCloudSource(row);
  const m = source.manifest;
  const writer = new ZipWriter(sink.writer, { bufferedWrite: true });
  const progress: Progress = {
    stage: "tables",
    message: "",
    rowsDone: 0,
    rowsTotal: Object.values(m.tables).reduce((s, t) => s + t.rows, 0),
    filesDone: 0,
    filesTotal: 0,
  };
  try {
    for (const [table, info] of Object.entries(m.tables)) {
      for (let n = 1; n <= info.chunks; n++) {
        checkAbort(signal);
        const rows = await source.readChunk(table, n);
        await writer.add(chunkPath(table, n), new TextReader(JSON.stringify(rows)));
        progress.rowsDone += rows.length;
        progress.message = `מעתיק ${table}…`;
        onProgress?.({ ...progress });
      }
    }
    for (const bucket of Object.keys(m.buckets)) {
      await writer.add(`files-index/${bucket}.json`, new TextReader(JSON.stringify(await source.readFileIndex(bucket))));
    }
    await writer.add("manifest.json", new TextReader(JSON.stringify(m)));
    await writer.close();
    await sink.finish();
    onProgress?.({ ...progress, stage: "done", message: "הקובץ נשמר" });
  } catch (e) {
    try { await writer.close(); } catch { /* ignore */ }
    await sink.abort();
    throw e;
  }
}

// ─── Restore ───────────────────────────────────────────────────────────────

export interface RestoreOptions {
  source: BackupSource;
  catalog: Catalog;
  tables: string[];
  buckets: string[];
  mode: RestoreMode;
  fileMode: FileRestoreMode;
  safetyBackup: boolean;
  signal?: AbortSignal;
  onProgress?: ProgressFn;
}

export interface RestoreResult {
  restoreId: string;
  status: BackupRow["status"];
  safetyBackupId: string | null;
  tables: Record<string, TableRestoreResult>;
  buckets: Record<string, FileRestoreResult>;
}

function splitBySize<T>(rows: T[], maxBytes: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const r of rows) {
    const s = JSON.stringify(r).length;
    if (cur.length && size + s > maxBytes) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function restoreBackup(opts: RestoreOptions): Promise<RestoreResult> {
  const { source, catalog, signal, onProgress, mode } = opts;
  const m = source.manifest;
  const liveTables = new Set(catalog.tables.map((t) => t.name));
  const tables = opts.tables.filter((t) => m.tables[t]);
  const unknown = tables.filter((t) => !liveTables.has(t));
  if (unknown.length) throw new Error(`הטבלאות האלה לא קיימות במסד הנוכחי: ${unknown.join(", ")}`);
  const buckets = opts.buckets.filter((b) => m.buckets[b] && source.hasFileContent(b));

  const progress: Progress = {
    stage: "prepare",
    message: "מכין שחזור…",
    rowsDone: 0,
    rowsTotal: tables.reduce((s, t) => s + m.tables[t].rows, 0),
    filesDone: 0,
    filesTotal: buckets.reduce((s, b) => s + m.buckets[b].files, 0),
  };
  const emit = (patch: Partial<Progress>) => onProgress?.(Object.assign(progress, patch));
  emit({});

  // 1. Safety copy of what is about to be overwritten
  let safetyBackupId: string | null = null;
  if (opts.safetyBackup && tables.length) {
    emit({ stage: "safety", message: "יוצר גיבוי ביטחון של המצב הנוכחי…" });
    const safety = await createBackup({
      catalog,
      tables,
      buckets: [],
      toCloud: true,
      zip: null,
      label: `גיבוי ביטחון (לפני שחזור של ${source.name})`,
      kind: "safety",
      signal,
      onProgress: (p) => emit({ message: `גיבוי ביטחון: ${p.message}` }),
    });
    safetyBackupId = safety.backupId;
  }

  const { data: inserted, error: insertError } = await db
    .from("data_restores")
    .insert({
      backup_id: source.backupId,
      source: source.kind === "cloud" ? "cloud" : "file",
      source_name: source.name,
      mode,
      status: "running",
      safety_backup_id: safetyBackupId,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);
  const restoreId = inserted.id as string;

  const tableResults: Record<string, TableRestoreResult> = {};
  const bucketResults: Record<string, FileRestoreResult> = {};
  const saveResults = (patch: Record<string, unknown>) =>
    db.from("data_restores").update({ tables: tableResults, buckets: bucketResults, ...patch }).eq("id", restoreId);

  try {
    // 2. Rows, parents before children
    const deps = Object.fromEntries(tables.map((t) => [t, m.tables[t].depends_on]));
    const ordered = orderByDependencies(tables, deps);
    const keep: Record<string, string[]> = {};
    emit({ stage: "tables" });

    for (const table of ordered) {
      const info = m.tables[table];
      const result: TableRestoreResult = { inserted: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, errors: [] };
      tableResults[table] = result;
      if (mode === "replace") keep[table] = [];
      emit({ message: `משחזר ${table}…` });

      for (let n = 1; n <= info.chunks; n++) {
        checkAbort(signal);
        const rows = await source.readChunk(table, n);
        if (mode === "replace") rows.forEach((r) => keep[table].push(String(r[info.pk])));
        for (const batch of splitBySize(rows, RESTORE_BATCH_BYTES)) {
          const r = await rpc<Omit<TableRestoreResult, "deleted">>(
            "backup_restore_rows",
            { p_table: table, p_rows: batch, p_mode: mode === "missing" ? "missing" : "upsert" },
            signal,
          );
          result.inserted += r.inserted;
          result.updated += r.updated;
          result.skipped += r.skipped;
          result.failed += r.failed;
          if (result.errors.length < 20) result.errors.push(...r.errors.slice(0, 20 - result.errors.length));
          emit({ rowsDone: progress.rowsDone + batch.length });
        }
      }
    }

    // 3. Replace: drop rows the backup does not have, children first
    if (mode === "replace") {
      emit({ stage: "cleanup", message: "מסיר שורות שלא היו בגיבוי…" });
      for (const table of [...ordered].reverse()) {
        checkAbort(signal);
        const r = await rpc<{ deleted: number }>("backup_delete_missing", { p_table: table, p_keep: keep[table] }, signal);
        tableResults[table].deleted = r.deleted;
      }
    }
    await saveResults({});

    // 4. Files
    for (const bucket of buckets) {
      checkAbort(signal);
      emit({ stage: "files", message: `משחזר קבצים: ${bucket}…` });
      const result: FileRestoreResult = { uploaded: 0, skipped: 0, failed: 0, errors: [] };
      bucketResults[bucket] = result;
      const index = await source.readFileIndex(bucket);
      const existing =
        opts.fileMode === "missing" ? new Set((await listBucketFiles(bucket, signal)).map((f) => f.name)) : new Set<string>();

      await pool(
        index,
        4,
        async (f) => {
          try {
            if (existing.has(f.name)) {
              result.skipped++;
            } else {
              const blob = await source.readFile(bucket, f.name);
              const { error } = await supabase.storage.from(bucket).upload(f.name, blob, {
                upsert: opts.fileMode === "overwrite",
                contentType: f.mimetype ?? undefined,
              });
              if (error) throw new Error(error.message);
              result.uploaded++;
            }
          } catch (e) {
            result.failed++;
            if (result.errors.length < 20) result.errors.push({ name: f.name, error: e instanceof Error ? e.message : String(e) });
          }
          emit({ filesDone: progress.filesDone + 1 });
        },
        signal,
      );
    }

    const anyFailed =
      Object.values(tableResults).some((r) => r.failed > 0) || Object.values(bucketResults).some((r) => r.failed > 0);
    const status: BackupRow["status"] = anyFailed ? "partial" : "completed";
    await saveResults({ status, completed_at: new Date().toISOString() });
    emit({ stage: "done", message: anyFailed ? "השחזור הושלם חלקית" : "השחזור הושלם" });
    return { restoreId, status, safetyBackupId, tables: tableResults, buckets: bucketResults };
  } catch (e) {
    await saveResults({
      status: e instanceof BackupCancelled ? "cancelled" : "failed",
      error_message: e instanceof Error ? e.message : String(e),
      completed_at: new Date().toISOString(),
    });
    throw e;
  }
}

// ─── Integrity check ───────────────────────────────────────────────────────

export interface VerifyResult {
  ok: boolean;
  tables: number;
  rows: number;
  problems: string[];
}

/** Reads every chunk of a cloud backup back and checks it against its manifest. */
export async function verifyCloudBackup(row: BackupRow, onProgress?: ProgressFn, signal?: AbortSignal): Promise<VerifyResult> {
  const source = await openCloudSource(row);
  const m = source.manifest;
  const problems: string[] = [];
  const progress: Progress = {
    stage: "tables",
    message: "בודק תקינות…",
    rowsDone: 0,
    rowsTotal: Object.values(m.tables).reduce((s, t) => s + t.rows, 0),
    filesDone: 0,
    filesTotal: 0,
  };
  let rows = 0;
  for (const [table, info] of Object.entries(m.tables)) {
    let count = 0;
    const ids = new Set<string>();
    for (let n = 1; n <= info.chunks; n++) {
      checkAbort(signal);
      try {
        const chunk = await source.readChunk(table, n);
        chunk.forEach((r) => ids.add(String(r[info.pk])));
        count += chunk.length;
        progress.rowsDone += chunk.length;
        onProgress?.({ ...progress, message: `בודק ${table}…` });
      } catch (e) {
        problems.push(`${table}: חלק ${n} לא נקרא (${e instanceof Error ? e.message : e})`);
      }
    }
    if (count !== info.rows) problems.push(`${table}: בגיבוי ${info.rows} שורות, נקראו ${count}`);
    if (ids.size !== count) problems.push(`${table}: ${count - ids.size} מפתחות כפולים`);
    rows += count;
  }
  for (const [bucket, info] of Object.entries(m.buckets)) {
    try {
      const index = await source.readFileIndex(bucket);
      if (index.length !== info.files) problems.push(`${bucket}: ברשימה ${index.length} קבצים במקום ${info.files}`);
    } catch (e) {
      problems.push(`${bucket}: רשימת הקבצים לא נקראה (${e instanceof Error ? e.message : e})`);
    }
  }
  onProgress?.({ ...progress, stage: "done", message: problems.length ? "נמצאו בעיות" : "הגיבוי תקין" });
  return { ok: problems.length === 0, tables: Object.keys(m.tables).length, rows, problems };
}

// ─── Automatic backups & retention ─────────────────────────────────────────

export interface AutoBackupSettings {
  enabled: boolean;
  intervalDays: number;
  /** how many automatic backups to keep; older ones are deleted */
  keepAuto: number;
  /** how many safety backups (made before restores) to keep */
  keepSafety: number;
}

const SETTINGS_KEY = "gemaraca-auto-backup";
const LOCK_KEY = "gemaraca-auto-backup-lock";
const LOCK_MS = 30 * 60_000;

export const DEFAULT_AUTO_SETTINGS: AutoBackupSettings = { enabled: true, intervalDays: 7, keepAuto: 6, keepSafety: 5 };

export function getAutoBackupSettings(): AutoBackupSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_AUTO_SETTINGS, ...JSON.parse(raw) } : DEFAULT_AUTO_SETTINGS;
  } catch {
    return DEFAULT_AUTO_SETTINGS;
  }
}

export function saveAutoBackupSettings(s: AutoBackupSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings just won't persist */
  }
}

/** The newest backup that holds a restorable copy of the data in the cloud. */
export function lastCloudBackup(backups: BackupRow[]): BackupRow | null {
  return (
    backups
      .filter((b) => b.storage_path && (b.status === "completed" || b.status === "partial") && b.kind !== "safety")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

export const daysSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

/** Deletes the oldest automatic and safety backups beyond the limits. Manual backups are never touched. */
export function backupsToPrune(backups: BackupRow[], settings: AutoBackupSettings): BackupRow[] {
  const newestFirst = [...backups].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return [
    ...newestFirst.filter((b) => b.kind === "auto" && b.status !== "running").slice(settings.keepAuto),
    ...newestFirst.filter((b) => b.kind === "safety" && b.status !== "running").slice(settings.keepSafety),
  ];
}

export async function applyRetention(settings: AutoBackupSettings, backups?: BackupRow[]): Promise<number> {
  const excess = backupsToPrune(backups ?? (await listBackups()), settings);
  for (const b of excess) await deleteBackup(b);
  return excess.length;
}

/**
 * Runs a cloud backup of all data if automatic backups are on and the last one
 * is older than the interval. Returns the result, or null when nothing was due.
 * A localStorage lock keeps two open tabs from running it at the same time.
 */
export async function runAutoBackupIfDue(onProgress?: ProgressFn, signal?: AbortSignal): Promise<BackupResult | null> {
  const settings = getAutoBackupSettings();
  if (!settings.enabled) return null;

  const backups = await listBackups();
  const last = lastCloudBackup(backups);
  if (last && daysSince(last.created_at) < settings.intervalDays) return null;
  if (backups.some((b) => b.status === "running" && daysSince(b.created_at) * 86_400_000 < LOCK_MS)) return null;

  try {
    const lock = Number(localStorage.getItem(LOCK_KEY) ?? 0);
    if (Date.now() - lock < LOCK_MS) return null;
    localStorage.setItem(LOCK_KEY, String(Date.now()));
  } catch {
    /* no storage: rely on the "running" check above */
  }

  try {
    const catalog = await loadCatalog(signal);
    const result = await createBackup({
      catalog,
      tables: catalog.tables.map((t) => t.name),
      buckets: catalog.buckets.map((b) => b.id),
      toCloud: true,
      zip: null,
      label: "גיבוי אוטומטי",
      kind: "auto",
      signal,
      onProgress,
    });
    await applyRetention(settings);
    return result;
  } finally {
    try {
      localStorage.removeItem(LOCK_KEY);
    } catch {
      /* ignore */
    }
  }
}
