import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Cloud,
  DatabaseBackup,
  Download,
  FileArchive,
  HardDriveDownload,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress as ProgressBar } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  BackupCancelled,
  PROJECT_REF,
  backupFileName,
  canStreamToDisk,
  createBackup,
  deleteBackup,
  exportCloudBackupToZip,
  formatBytes,
  listBackups,
  listRestores,
  loadCatalog,
  openCloudSource,
  openZipSource,
  pickZipTarget,
  restoreBackup,
  type BackupRow,
  type BackupSource,
  type Catalog,
  type FileRestoreMode,
  type Progress,
  type RestoreMode,
  type RestoreResult,
  type RestoreRow,
} from "@/lib/backup/engine";
import { resolveTopics, tableLabel, bucketLabel, topicLabel } from "@/lib/backup/topics";
import { SelectionTree, bucketKey, tableKey, type SelectionItemInfo } from "./SelectionTree";

const n = (x: number) => x.toLocaleString("he-IL");
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });

const KIND_LABEL: Record<BackupRow["kind"], string> = {
  cloud: "ענן",
  download: "הורדה",
  both: "ענן + הורדה",
  safety: "גיבוי ביטחון",
};

const STATUS_LABEL: Record<BackupRow["status"], string> = {
  running: "רץ",
  completed: "הושלם",
  partial: "חלקי",
  failed: "נכשל",
  cancelled: "בוטל",
};

const MODE_LABEL: Record<RestoreMode, string> = {
  missing: "הוספת חסרים",
  upsert: "עדכון ודריסה",
  replace: "החלפה מלאה",
};

function StatusBadge({ status }: { status: BackupRow["status"] }) {
  const cls =
    status === "completed"
      ? "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30"
      : status === "partial"
        ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30"
        : status === "running"
          ? "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30"
          : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <Badge variant="outline" className={cn("text-[11px]", cls)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function ProgressCard({ progress, onCancel }: { progress: Progress; onCancel?: () => void }) {
  const rowsPct = progress.rowsTotal ? (progress.rowsDone / progress.rowsTotal) * 100 : 0;
  const filesPct = progress.filesTotal ? (progress.filesDone / progress.filesTotal) * 100 : 0;
  const done = progress.stage === "done";
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm">
        {done ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        <span className="flex-1 font-medium">{progress.message}</span>
        {onCancel && !done && (
          <Button variant="outline" size="sm" className="h-7" onClick={onCancel}>
            ביטול
          </Button>
        )}
      </div>
      {progress.rowsTotal > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>שורות</span>
            <span className="tabular-nums">
              {n(progress.rowsDone)} / {n(progress.rowsTotal)}
            </span>
          </div>
          <ProgressBar value={rowsPct} className="h-2" />
        </div>
      )}
      {progress.filesTotal > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>קבצים</span>
            <span className="tabular-nums">
              {n(progress.filesDone)} / {n(progress.filesTotal)}
            </span>
          </div>
          <ProgressBar value={filesPct} className="h-2" />
        </div>
      )}
    </div>
  );
}

// ─── Backup tab ────────────────────────────────────────────────────────────

type Destination = "download" | "cloud" | "both";

function BackupTab({ catalog, onDone, onBusy }: { catalog: Catalog; onDone: () => void; onBusy: (busy: boolean) => void }) {
  const topics = useMemo(
    () => resolveTopics(catalog.tables.map((t) => t.name), catalog.buckets.map((b) => b.id)),
    [catalog],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set([...catalog.tables.map((t) => tableKey(t.name)), ...catalog.buckets.map((b) => bucketKey(b.id))]),
  );
  const [destination, setDestination] = useState<Destination>("both");
  const [label, setLabel] = useState("גיבוי ידני");
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => onBusy(running), [running, onBusy]);

  const info = useMemo(() => {
    const out: Record<string, SelectionItemInfo> = {};
    catalog.tables.forEach((t) => {
      out[tableKey(t.name)] = { primary: `${n(t.rows)} שורות`, secondary: formatBytes(t.bytes), bytes: t.bytes };
    });
    catalog.buckets.forEach((b) => {
      out[bucketKey(b.id)] = { primary: `${n(b.files)} קבצים`, secondary: formatBytes(b.bytes), bytes: b.bytes };
    });
    return out;
  }, [catalog]);

  const selTables = catalog.tables.filter((t) => selected.has(tableKey(t.name)));
  const selBuckets = catalog.buckets.filter((b) => selected.has(bucketKey(b.id)));
  const rows = selTables.reduce((s, t) => s + t.rows, 0);
  const files = selBuckets.reduce((s, b) => s + b.files, 0);
  const fileBytes = selBuckets.reduce((s, b) => s + b.bytes, 0);
  const wantsZip = destination !== "cloud";
  const streaming = canStreamToDisk();

  const start = async () => {
    if (!selTables.length && !selBuckets.length) return;
    // The save dialog must open straight from the click, before any other await.
    let zip = null;
    if (wantsZip) {
      zip = await pickZipTarget(backupFileName(label));
      if (!zip) return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      const result = await createBackup({
        catalog,
        tables: selTables.map((t) => t.name),
        buckets: selBuckets.map((b) => b.id),
        toCloud: destination !== "download",
        zip,
        label: label.trim() || "גיבוי",
        notes,
        kind: destination,
        signal: controller.signal,
        onProgress: (p) => setProgress({ ...p }),
      });
      toast({
        title: result.status === "completed" ? "הגיבוי הושלם" : "הגיבוי הושלם חלקית",
        description:
          result.status === "completed"
            ? `${n(Object.values(result.manifest.tables).reduce((s, t) => s + t.rows, 0))} שורות גובו`
            : "חלק מהקבצים לא הורדו — הפרטים בהיסטוריה",
      });
      onDone();
    } catch (e) {
      if (e instanceof BackupCancelled) toast({ title: "הגיבוי בוטל" });
      else toast({ title: "הגיבוי נכשל", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      setProgress(null);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="space-y-4">
      <SelectionTree topics={topics} info={info} selected={selected} onChange={setSelected} />

      <div className="rounded-lg border border-border p-3 space-y-3">
        <Label className="font-semibold">לאן לשמור?</Label>
        <RadioGroup value={destination} onValueChange={(v) => setDestination(v as Destination)} className="gap-2">
          {([
            ["both", Cloud, "ענן + הורדה למחשב (מומלץ)", "עותק נתונים בענן לשחזור מהיר, וקובץ ZIP מלא עם כל הקבצים במחשב"],
            ["download", HardDriveDownload, "הורדה למחשב בלבד", "קובץ ZIP אחד עם הנתונים וכל הקבצים שנבחרו"],
            ["cloud", Cloud, "ענן בלבד", "הנתונים נשמרים בענן. מהקבצים עצמם נשמרת רק רשימה, בלי התוכן"],
          ] as const).map(([value, Icon, title, desc]) => (
            <label
              key={value}
              className={cn(
                "flex items-start gap-3 rounded-md border p-2.5 cursor-pointer",
                destination === value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
              )}
            >
              <RadioGroupItem value={value} className="mt-0.5" />
              <Icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
            </label>
          ))}
        </RadioGroup>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">שם הגיבוי</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">הערות (לא חובה)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[38px] h-[38px]" />
          </div>
        </div>

        {wantsZip && selBuckets.length > 0 && !streaming && (
          <div className="flex gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
            הדפדפן הזה לא תומך בשמירה ישירה לדיסק, ולכן גיבוי של {formatBytes(fileBytes)} קבצים ייבנה בזיכרון ועלול
            להיכשל. עדיף Chrome או Edge, או לבחור בלי הקבצים.
          </div>
        )}
        {destination === "cloud" && selBuckets.length > 0 && (
          <div className="flex gap-2 rounded-md border border-border bg-muted/40 p-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
            בגיבוי ענן בלבד נשמרת רק רשימת הקבצים. כדי לגבות גם את הקבצים עצמם ({formatBytes(fileBytes)}), בחר "הורדה
            למחשב".
          </div>
        )}
      </div>

      {progress && <ProgressCard progress={progress} onCancel={running ? () => abortRef.current?.abort() : undefined} />}

      <div className="flex items-center gap-3 sticky bottom-0 bg-background/95 backdrop-blur py-2 border-t border-border">
        <div className="text-xs text-muted-foreground flex-1">
          {selTables.length} טבלאות · {n(rows)} שורות
          {selBuckets.length > 0 && (
            <>
              {" "}
              · {n(files)} קבצים ({formatBytes(fileBytes)})
            </>
          )}
        </div>
        <Button onClick={start} disabled={running || (!selTables.length && !selBuckets.length)} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
          התחל גיבוי
        </Button>
      </div>
    </div>
  );
}

// ─── History tab ───────────────────────────────────────────────────────────

function HistoryTab({
  backups,
  restores,
  loading,
  onRefresh,
  onRestore,
}: {
  backups: BackupRow[];
  restores: RestoreRow[];
  loading: boolean;
  onRefresh: () => void;
  onRestore: (row: BackupRow) => void;
}) {
  const [toDelete, setToDelete] = useState<BackupRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<Progress | null>(null);
  const backupById = useMemo(() => new Map(backups.map((b) => [b.id, b])), [backups]);

  const download = async (row: BackupRow) => {
    const sink = await pickZipTarget(backupFileName(row.label));
    if (!sink) return;
    setBusyId(row.id);
    try {
      await exportCloudBackupToZip(row, sink, (p) => setExportProgress({ ...p }));
      toast({ title: "הקובץ נשמר במחשב" });
    } catch (e) {
      toast({ title: "ההורדה נכשלה", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
      setExportProgress(null);
    }
  };

  const confirmDelete = async () => {
    const row = toDelete;
    setToDelete(null);
    if (!row) return;
    setBusyId(row.id);
    try {
      await deleteBackup(row);
      toast({ title: "הגיבוי נמחק" });
      onRefresh();
    } catch (e) {
      toast({ title: "המחיקה נכשלה", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-sm flex-1">גיבויים ({backups.length})</h3>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-1">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          רענון
        </Button>
      </div>

      {exportProgress && <ProgressCard progress={exportProgress} />}

      {backups.length === 0 && !loading && (
        <div className="text-center text-sm text-muted-foreground py-8">עדיין אין גיבויים. אפשר ליצור גיבוי בלשונית "גיבוי חדש".</div>
      )}

      <div className="space-y-2">
        {backups.map((b) => (
          <div key={b.id} className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{b.label}</span>
                  <StatusBadge status={b.status} />
                  <Badge variant="secondary" className="text-[11px]">
                    {b.kind === "safety" && <ShieldCheck className="h-3 w-3 ml-1" />}
                    {KIND_LABEL[b.kind]}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {dateTime(b.created_at)} · {n(b.total_rows)} שורות · {Object.keys(b.tables ?? {}).length} טבלאות
                  {b.total_bytes > 0 && <> · בענן {formatBytes(b.total_bytes)}</>}
                </div>
                {b.notes && <div className="text-xs mt-1">{b.notes}</div>}
                {b.error_message && <div className="text-xs text-destructive mt-1">{b.error_message}</div>}
              </div>
              <div className="flex gap-1 shrink-0">
                {b.storage_path && (b.status === "completed" || b.status === "partial") && (
                  <>
                    <Button size="sm" variant="default" className="h-7 gap-1" onClick={() => onRestore(b)} disabled={!!busyId}>
                      <ArchiveRestore className="h-3.5 w-3.5" />
                      שחזור
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => download(b)} disabled={!!busyId}>
                      {busyId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      ZIP
                    </Button>
                  </>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => setToDelete(b)}
                  disabled={!!busyId || b.status === "running"}
                  title="מחיקה"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {b.topics?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {b.topics.map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px] font-normal">
                    {topicLabel(t)}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {restores.length > 0 && (
        <div className="space-y-2 pt-2">
          <h3 className="font-semibold text-sm">שחזורים אחרונים</h3>
          {restores.map((r) => {
            const t = Object.values(r.tables ?? {});
            return (
              <div key={r.id} className="rounded-lg border border-border p-2.5 text-xs flex items-center gap-2 flex-wrap">
                <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{r.source_name ?? backupById.get(r.backup_id ?? "")?.label ?? "—"}</span>
                <StatusBadge status={r.status} />
                <Badge variant="secondary" className="text-[10px]">
                  {MODE_LABEL[r.mode]}
                </Badge>
                <span className="text-muted-foreground">{dateTime(r.created_at)}</span>
                <span className="text-muted-foreground">
                  · נוספו {n(t.reduce((s, x) => s + x.inserted, 0))} · עודכנו {n(t.reduce((s, x) => s + x.updated, 0))}
                  {t.some((x) => x.deleted) && <> · הוסרו {n(t.reduce((s, x) => s + x.deleted, 0))}</>}
                  {t.some((x) => x.failed) && <span className="text-destructive"> · נכשלו {n(t.reduce((s, x) => s + x.failed, 0))}</span>}
                </span>
                {r.error_message && <span className="text-destructive w-full">{r.error_message}</span>}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את הגיבוי?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.label}" מ-{toDelete && dateTime(toDelete.created_at)} יימחק לצמיתות, כולל העותק בענן. אין דרך
              לשחזר אותו אחר כך. הנתונים עצמם במערכת לא משתנים.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              מחק
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Restore tab ───────────────────────────────────────────────────────────

function RestoreTab({
  catalog,
  backups,
  preselect,
  onDone,
  onBusy,
}: {
  catalog: Catalog;
  backups: BackupRow[];
  preselect: BackupRow | null;
  onDone: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [source, setSource] = useState<BackupSource | null>(null);
  const [opening, setOpening] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<RestoreMode>("missing");
  const [fileMode, setFileMode] = useState<FileRestoreMode>("missing");
  const [safety, setSafety] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => onBusy(running), [running, onBusy]);

  const cloudBackups = backups.filter((b) => b.storage_path && (b.status === "completed" || b.status === "partial"));

  const load = useCallback(async (open: () => Promise<BackupSource>) => {
    setOpening(true);
    setResult(null);
    setProgress(null);
    try {
      const s = await open();
      setSource((prev) => {
        prev?.close();
        return s;
      });
      setSelected(
        new Set([
          ...Object.keys(s.manifest.tables).map(tableKey),
          ...Object.keys(s.manifest.buckets).filter((b) => s.hasFileContent(b)).map(bucketKey),
        ]),
      );
    } catch (e) {
      toast({ title: "לא ניתן לפתוח את הגיבוי", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setOpening(false);
    }
  }, []);

  useEffect(() => {
    if (preselect) load(() => openCloudSource(preselect));
  }, [preselect, load]);

  const live = useMemo(() => new Map(catalog.tables.map((t) => [t.name, t])), [catalog]);
  const liveBuckets = useMemo(() => new Map(catalog.buckets.map((b) => [b.id, b])), [catalog]);

  const topics = useMemo(
    () => (source ? resolveTopics(Object.keys(source.manifest.tables), Object.keys(source.manifest.buckets)) : []),
    [source],
  );

  const info = useMemo(() => {
    const out: Record<string, SelectionItemInfo> = {};
    if (!source) return out;
    Object.entries(source.manifest.tables).forEach(([t, v]) => {
      const now = live.get(t);
      out[tableKey(t)] = now
        ? { primary: `${n(v.rows)} בגיבוי`, secondary: `כרגע ${n(now.rows)}` }
        : { primary: "", disabled: true, disabledReason: "הטבלה לא קיימת במסד הנוכחי" };
    });
    Object.entries(source.manifest.buckets).forEach(([b, v]) => {
      out[bucketKey(b)] = source.hasFileContent(b)
        ? { primary: `${n(v.files)} קבצים`, secondary: `כרגע ${n(liveBuckets.get(b)?.files ?? 0)}`, bytes: v.bytes }
        : { primary: "", disabled: true, disabledReason: "בגיבוי יש רק רשימת קבצים" };
    });
    return out;
  }, [source, live, liveBuckets]);

  const selTables = source ? Object.keys(source.manifest.tables).filter((t) => selected.has(tableKey(t)) && live.has(t)) : [];
  const selBuckets = source
    ? Object.keys(source.manifest.buckets).filter((b) => selected.has(bucketKey(b)) && source.hasFileContent(b))
    : [];
  const rows = source ? selTables.reduce((s, t) => s + source.manifest.tables[t].rows, 0) : 0;
  const refMismatch = source?.manifest.project_ref && PROJECT_REF && source.manifest.project_ref !== PROJECT_REF;

  // Children that ON DELETE CASCADE can reach in replace mode but were not selected.
  const cascadeChildren =
    mode === "replace"
      ? catalog.tables.filter((t) => !selTables.includes(t.name) && t.depends_on.some((p) => selTables.includes(p))).map((t) => t.name)
      : [];

  const run = async () => {
    if (!source) return;
    setConfirmOpen(false);
    setConfirmText("");
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResult(null);
    try {
      const r = await restoreBackup({
        source,
        catalog,
        tables: selTables,
        buckets: selBuckets,
        mode,
        fileMode,
        safetyBackup: safety,
        signal: controller.signal,
        onProgress: (p) => setProgress({ ...p }),
      });
      setResult(r);
      toast({ title: r.status === "completed" ? "השחזור הושלם" : "השחזור הושלם חלקית" });
      onDone();
    } catch (e) {
      if (e instanceof BackupCancelled) toast({ title: "השחזור בוטל", description: "מה שכבר שוחזר נשאר. גיבוי הביטחון שמור בהיסטוריה." });
      else toast({ title: "השחזור נכשל", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      setProgress(null);
      onDone();
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Cloud className="h-4 w-4" /> מגיבוי בענן
          </div>
          {cloudBackups.length === 0 ? (
            <div className="text-xs text-muted-foreground">אין גיבויי ענן זמינים</div>
          ) : (
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={source?.kind === "cloud" ? source.backupId ?? "" : ""}
              disabled={opening || running}
              onChange={(e) => {
                const row = cloudBackups.find((b) => b.id === e.target.value);
                if (row) load(() => openCloudSource(row));
              }}
            >
              <option value="" disabled>
                בחר גיבוי…
              </option>
              {cloudBackups.map((b) => (
                <option key={b.id} value={b.id}>
                  {dateTime(b.created_at)} · {b.label} · {n(b.total_rows)} שורות
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileArchive className="h-4 w-4" /> מקובץ ZIP במחשב
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(() => openZipSource(f));
              e.target.value = "";
            }}
          />
          <Button variant="outline" className="w-full gap-2" onClick={() => fileInput.current?.click()} disabled={opening || running}>
            <Upload className="h-4 w-4" /> בחר קובץ גיבוי
          </Button>
        </div>
      </div>

      {opening && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> פותח את הגיבוי…
        </div>
      )}

      {source && !opening && (
        <>
          <div className="rounded-lg bg-muted/40 border border-border p-3 text-sm space-y-1">
            <div>
              <span className="font-semibold">{source.manifest.label}</span>
              <span className="text-muted-foreground"> · נוצר {dateTime(source.manifest.created_at)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {Object.keys(source.manifest.tables).length} טבלאות ·{" "}
              {n(Object.values(source.manifest.tables).reduce((s, t) => s + t.rows, 0))} שורות
              {source.manifest.notes && <> · {source.manifest.notes}</>}
            </div>
            {refMismatch && (
              <div className="flex gap-2 text-xs text-yellow-700 dark:text-yellow-400 pt-1">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                הגיבוי נלקח מפרויקט אחר ({source.manifest.project_ref}). השחזור יכתוב לפרויקט הנוכחי ({PROJECT_REF}).
              </div>
            )}
          </div>

          <SelectionTree topics={topics} info={info} selected={selected} onChange={setSelected} />

          <div className="rounded-lg border border-border p-3 space-y-3">
            <Label className="font-semibold">איך לשחזר?</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as RestoreMode)} className="gap-2">
              {([
                ["missing", "הוספת חסרים בלבד (בטוח)", "מחזיר שורות שנמחקו. שורות קיימות לא משתנות"],
                ["upsert", "עדכון ודריסה", "מחזיר שורות שנמחקו, ושורות קיימות חוזרות לגרסה שבגיבוי. שורות חדשות נשארות"],
                ["replace", "החלפה מלאה", "הטבלאות שנבחרו יהיו בדיוק כמו בגיבוי: שורות שנוספו אחרי הגיבוי יימחקו"],
              ] as const).map(([value, title, desc]) => (
                <label
                  key={value}
                  className={cn(
                    "flex items-start gap-3 rounded-md border p-2.5 cursor-pointer",
                    mode === value
                      ? value === "replace"
                        ? "border-destructive bg-destructive/5"
                        : "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <RadioGroupItem value={value} className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium">{title}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                </label>
              ))}
            </RadioGroup>

            {cascadeChildren.length > 0 && (
              <div className="flex gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
                <span>
                  מחיקת שורות עודפות תמחק גם את השורות המקושרות אליהן בטבלאות שלא נבחרו:{" "}
                  {cascadeChildren.map(tableLabel).join(", ")}.
                </span>
              </div>
            )}

            {selBuckets.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">קבצים שכבר קיימים:</Label>
                <RadioGroup value={fileMode} onValueChange={(v) => setFileMode(v as FileRestoreMode)} className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <RadioGroupItem value="missing" /> לדלג (להחזיר רק חסרים)
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <RadioGroupItem value="overwrite" /> לדרוס בגרסה מהגיבוי
                  </label>
                </RadioGroup>
              </div>
            )}

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={safety} onCheckedChange={(v) => setSafety(v === true)} className="mt-0.5" />
              <div>
                <div className="font-medium flex items-center gap-1">
                  <ShieldCheck className="h-4 w-4 text-green-600" /> צור גיבוי ביטחון לפני השחזור
                </div>
                <div className="text-xs text-muted-foreground">
                  המצב הנוכחי של הטבלאות שנבחרו יישמר בענן, ואפשר יהיה לחזור אליו אם משהו ישתבש
                </div>
              </div>
            </label>
          </div>

          {progress && <ProgressCard progress={progress} onCancel={running ? () => abortRef.current?.abort() : undefined} />}

          {result && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr className="text-right">
                    <th className="p-2 font-medium">טבלה / תיקייה</th>
                    <th className="p-2 font-medium">נוספו</th>
                    <th className="p-2 font-medium">עודכנו</th>
                    <th className="p-2 font-medium">דולגו</th>
                    <th className="p-2 font-medium">הוסרו</th>
                    <th className="p-2 font-medium">נכשלו</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.tables).map(([t, r]) => (
                    <tr key={t} className="border-t border-border align-top">
                      <td className="p-2">
                        {tableLabel(t)}
                        {r.errors.length > 0 && (
                          <details className="text-destructive mt-1">
                            <summary className="cursor-pointer">שגיאות</summary>
                            {r.errors.map((er, i) => (
                              <div key={i} dir="ltr" className="font-mono text-[10px] break-all">
                                {er.id}: {er.error}
                              </div>
                            ))}
                          </details>
                        )}
                      </td>
                      <td className="p-2 tabular-nums">{n(r.inserted)}</td>
                      <td className="p-2 tabular-nums">{n(r.updated)}</td>
                      <td className="p-2 tabular-nums">{n(r.skipped)}</td>
                      <td className="p-2 tabular-nums">{n(r.deleted)}</td>
                      <td className={cn("p-2 tabular-nums", r.failed && "text-destructive font-semibold")}>{n(r.failed)}</td>
                    </tr>
                  ))}
                  {Object.entries(result.buckets).map(([b, r]) => (
                    <tr key={b} className="border-t border-border align-top">
                      <td className="p-2">
                        {bucketLabel(b)}
                        {r.errors.length > 0 && (
                          <details className="text-destructive mt-1">
                            <summary className="cursor-pointer">שגיאות</summary>
                            {r.errors.map((er, i) => (
                              <div key={i} dir="ltr" className="font-mono text-[10px] break-all">
                                {er.name}: {er.error}
                              </div>
                            ))}
                          </details>
                        )}
                      </td>
                      <td className="p-2 tabular-nums">{n(r.uploaded)}</td>
                      <td className="p-2">—</td>
                      <td className="p-2 tabular-nums">{n(r.skipped)}</td>
                      <td className="p-2">—</td>
                      <td className={cn("p-2 tabular-nums", r.failed && "text-destructive font-semibold")}>{n(r.failed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-3 sticky bottom-0 bg-background/95 backdrop-blur py-2 border-t border-border">
            <div className="text-xs text-muted-foreground flex-1">
              {selTables.length} טבלאות · {n(rows)} שורות
              {selBuckets.length > 0 && <> · {selBuckets.length} תיקיות קבצים</>}
            </div>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={running || (!selTables.length && !selBuckets.length)}
              variant={mode === "replace" ? "destructive" : "default"}
              className="gap-2"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />}
              שחזר
            </Button>
          </div>
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(o) => { setConfirmOpen(o); if (!o) setConfirmText(""); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>לאשר שחזור?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  שחזור מ-"{source?.manifest.label}" במצב <b>{MODE_LABEL[mode]}</b>: {selTables.length} טבלאות ({n(rows)} שורות)
                  {selBuckets.length > 0 && <> ו-{selBuckets.length} תיקיות קבצים</>}.
                </p>
                {!safety && <p className="text-destructive">בלי גיבוי ביטחון: לא תהיה דרך לחזור למצב הנוכחי.</p>}
                {mode === "replace" && (
                  <>
                    <p className="text-destructive">שורות שנוספו אחרי הגיבוי יימחקו מהטבלאות שנבחרו.</p>
                    <p>
                      כדי לאשר, הקלד <b>שחזר</b>:
                    </p>
                    <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus />
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={run}
              disabled={mode === "replace" && confirmText.trim() !== "שחזר"}
              className={cn(mode === "replace" && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            >
              התחל שחזור
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Panel ─────────────────────────────────────────────────────────────────

export default function DataBackupPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = useState("backup");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [restores, setRestores] = useState<RestoreRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [preselect, setPreselect] = useState<BackupRow | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const busy = backupBusy || restoreBusy;

  const refreshCatalog = useCallback(async () => {
    setError(null);
    try {
      setCatalog(await loadCatalog());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const [b, r] = await Promise.all([listBackups(), listRestores()]);
      setBackups(b);
      setRestores(r);
    } catch (e) {
      toast({ title: "טעינת ההיסטוריה נכשלה", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshCatalog();
    refreshHistory();
  }, [open, refreshCatalog, refreshHistory]);

  const afterChange = () => {
    refreshCatalog();
    refreshHistory();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy) {
          toast({ title: "יש פעולה שרצה", description: "בטל אותה או חכה שתסתיים לפני סגירת החלון" });
          return;
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0" dir="rtl">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border text-right">
          <DialogTitle className="flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5 text-primary" />
            גיבוי ושחזור נתונים
          </DialogTitle>
          <DialogDescription>
            גיבוי של כל המידע במערכת לפי נושאים, ושחזור מלא או חלקי מגיבוי בענן או מקובץ
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <XCircle className="h-8 w-8 text-destructive" />
            <div className="text-sm">
              {/Admin access required|permission denied/i.test(error) ? "רק מנהל מערכת יכול לגבות ולשחזר נתונים." : error}
            </div>
            <Button variant="outline" size="sm" onClick={refreshCatalog}>
              נסה שוב
            </Button>
          </div>
        ) : !catalog ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> טוען את מבנה הנתונים…
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="mx-5 mt-3 grid grid-cols-3">
              <TabsTrigger value="backup" className="gap-1.5">
                <DatabaseBackup className="h-4 w-4" /> גיבוי חדש
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="h-4 w-4" /> גיבויים שמורים
                {backups.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {backups.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="restore" className="gap-1.5">
                <ArchiveRestore className="h-4 w-4" /> שחזור
              </TabsTrigger>
            </TabsList>
            <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-3">
              <TabsContent value="backup" className="mt-0" forceMount hidden={tab !== "backup"}>
                <BackupTab catalog={catalog} onDone={afterChange} onBusy={setBackupBusy} />
              </TabsContent>
              <TabsContent value="history" className="mt-0 pb-4">
                <HistoryTab
                  backups={backups}
                  restores={restores}
                  loading={historyLoading}
                  onRefresh={refreshHistory}
                  onRestore={(row) => {
                    setPreselect(row);
                    setTab("restore");
                  }}
                />
              </TabsContent>
              <TabsContent value="restore" className="mt-0" forceMount hidden={tab !== "restore"}>
                <RestoreTab catalog={catalog} backups={backups} preselect={preselect} onDone={afterChange} onBusy={setRestoreBusy} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
