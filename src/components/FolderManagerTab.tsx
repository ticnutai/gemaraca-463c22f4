import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";
import {
  FolderOpen, FolderPlus, Pencil, Trash2, Search, FileText,
  Loader2, Check, X, ChevronDown, ChevronLeft, Plus, GripVertical,
  Eye, Star, MessageSquare, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useNavigate } from "react-router-dom";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentViewer } from "./DocumentViewerProvider";

interface FolderInfo {
  name: string;
  count: number;
}

interface PsakMinimal {
  id: string;
  title: string;
  court: string;
  year: number;
  category: string | null;
}

const FolderManagerTab = () => {
  const navigate = useNavigate();
  const { open: openDocument } = useDocumentViewer();
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [folderPsakim, setFolderPsakim] = useState<PsakMinimal[]>([]);
  const [loadingPsakim, setLoadingPsakim] = useState(false);

  // View psak dialog
  const [loadingViewPsak, setLoadingViewPsak] = useState(false);

  // Notes dialog
  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [notesPsakId, setNotesPsakId] = useState<string>("");
  const [notesPsakTitle, setNotesPsakTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  // Favorites (local state, persisted in localStorage)
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("folder-psak-favorites");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  // Delete psak dialog
  const [deletePsakDialogOpen, setDeletePsakDialogOpen] = useState(false);
  const [deletingPsakId, setDeletingPsakId] = useState<string>("");
  const [deletingPsakTitle, setDeletingPsakTitle] = useState("");
  const [deletingPsak, setDeletingPsak] = useState(false);

  // Add folder
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Edit folder
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState("");
  const [editNewName, setEditNewName] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Delete folder
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Assign psakim dialog
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignTargetFolder, setAssignTargetFolder] = useState("");
  const [assignSearch, setAssignSearch] = useState("");
  const [assignAllPsakim, setAssignAllPsakim] = useState<PsakMinimal[]>([]);
  const [assignSelected, setAssignSelected] = useState<Set<string>>(new Set());
  const [loadingAssign, setLoadingAssign] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignPage, setAssignPage] = useState(0);
  const [assignHasMore, setAssignHasMore] = useState(true);
  const [loadingMoreAssign, setLoadingMoreAssign] = useState(false);
  const assignScrollRef = useRef<HTMLDivElement>(null);

  // Drag & Drop state
  const [draggedPsak, setDraggedPsak] = useState<PsakMinimal | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [selectedPsakim, setSelectedPsakim] = useState<Set<string>>(new Set());
  const [folderSearch, setFolderSearch] = useState("");

  const { toast } = useToast();

  const filteredFolderPsakim = useMemo(() => {
    const q = folderSearch.trim().toLowerCase();
    if (!q) return folderPsakim;
    return folderPsakim.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.court.toLowerCase().includes(q) ||
        String(p.year).includes(q)
    );
  }, [folderPsakim, folderSearch]);

  const loadFolders = useCallback(async () => {
    setLoading(true);
    try {
      // Get folder names from dedicated table + paginated counts from psakei_din
      const [{ data: folderRows }] = await Promise.all([
        supabase.from("folder_categories").select("name"),
      ]);

      // Paginate psakei_din categories to bypass Supabase 1000-row limit
      const CHUNK = 1000;
      let allCategoryRows: { category: string | null }[] = [];
      let pg = 0;
      let more = true;
      while (more) {
        const { data: chunk, error: chunkErr } = await supabase
          .from("psakei_din")
          .select("category")
          .range(pg * CHUNK, (pg + 1) * CHUNK - 1);
        if (chunkErr) throw chunkErr;
        const rows = chunk || [];
        allCategoryRows = [...allCategoryRows, ...rows];
        more = rows.length === CHUNK;
        pg++;
      }

      const countMap = new Map<string, number>();
      let noCategory = 0;
      (allCategoryRows).forEach((r) => {
        if (r.category) {
          countMap.set(r.category, (countMap.get(r.category) || 0) + 1);
        } else {
          noCategory++;
        }
      });

      // Merge: all persisted folder names + any categories found in psakei_din
      const allNames = new Set<string>();
      (folderRows || []).forEach((r: { name: string }) => allNames.add(r.name));
      countMap.forEach((_, name) => allNames.add(name));

      const folderList: FolderInfo[] = [];
      allNames.forEach((name) => folderList.push({ name, count: countMap.get(name) || 0 }));
      folderList.sort((a, b) => a.name.localeCompare(b.name, "he"));

      setFolders(folderList);
      setUncategorizedCount(noCategory);
    } catch (err) {
      console.error("Error loading folders:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  const loadFolderPsakim = async (folderName: string | null) => {
    setLoadingPsakim(true);
    try {
      let query = supabase
        .from("psakei_din")
        .select("id, title, court, year, category")
        .order("year", { ascending: false })
        .limit(200);

      if (folderName === null) {
        query = query.is("category", null);
      } else {
        query = query.eq("category", folderName);
      }

      const { data, error } = await query;
      if (error) throw error;
      setFolderPsakim(data || []);
    } catch (err) {
      console.error("Error loading folder psakim:", err);
    } finally {
      setLoadingPsakim(false);
    }
  };

  const handleExpandFolder = (folderName: string | null) => {
    const key = folderName ?? "__uncategorized__";
    if (expandedFolder === key) {
      setExpandedFolder(null);
      setFolderPsakim([]);
    } else {
      setExpandedFolder(key);
      loadFolderPsakim(folderName);
    }
    setSelectedPsakim(new Set());
    setFolderSearch("");
  };

  // ─── Add Folder ────────────────────────────
  const handleAddFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    if (folders.some((f) => f.name === name)) {
      toast({ title: "תיקייה בשם זה כבר קיימת", variant: "destructive" });
      return;
    }
    try {
      // Persist to folder_categories table
      const { error } = await supabase.from("folder_categories").insert({ name });
      if (error && !error.message.includes("duplicate")) throw error;
      setFolders((prev) => [...prev, { name, count: 0 }].sort((a, b) => a.name.localeCompare(b.name, "he")));
      setNewFolderName("");
      setAddDialogOpen(false);
      toast({ title: `תיקייה "${name}" נוצרה` });
    } catch (err) {
      console.error("Error creating folder:", err);
      toast({ title: "שגיאה ביצירת תיקייה", variant: "destructive" });
    }
  };

  // ─── Edit Folder ───────────────────────────
  const handleEditFolder = async () => {
    const newName = editNewName.trim();
    if (!newName || newName === editingFolder) {
      setEditDialogOpen(false);
      return;
    }
    if (folders.some((f) => f.name === newName)) {
      toast({ title: "תיקייה בשם זה כבר קיימת", variant: "destructive" });
      return;
    }
    setRenaming(true);
    try {
      // Update both folder_categories and psakei_din
      await Promise.all([
        supabase.from("folder_categories").update({ name: newName }).eq("name", editingFolder),
        supabase.from("psakei_din").update({ category: newName }).eq("category", editingFolder),
      ]);

      toast({ title: `שם התיקייה שונה ל"${newName}"` });
      setEditDialogOpen(false);
      await loadFolders();
    } catch (err) {
      console.error("Error renaming folder:", err);
      toast({ title: "שגיאה בשינוי שם", variant: "destructive" });
    } finally {
      setRenaming(false);
    }
  };

  // ─── Delete Folder ─────────────────────────
  const handleDeleteFolder = async () => {
    setDeleting(true);
    try {
      // Delete from folder_categories and clear category on psakei_din
      await Promise.all([
        supabase.from("folder_categories").delete().eq("name", deletingFolder),
        supabase.from("psakei_din").update({ category: null }).eq("category", deletingFolder),
      ]);
      toast({ title: `תיקייה "${deletingFolder}" נמחקה, הפסקים הוחזרו לללא תיקייה` });
      setDeleteDialogOpen(false);
      setExpandedFolder(null);
      await loadFolders();
    } catch (err) {
      console.error("Error deleting folder:", err);
      toast({ title: "שגיאה במחיקת תיקייה", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  // ─── Assign Psakim ─────────────────────────
  const ASSIGN_PAGE_SIZE = 500;

  const loadAssignPsakim = useCallback(async (_folder: string, page: number, reset: boolean) => {
    if (page === 0) setLoadingAssign(true);
    else setLoadingMoreAssign(true);
    try {
      const from = page * ASSIGN_PAGE_SIZE;
      const to = from + ASSIGN_PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from("psakei_din")
        .select("id, title, court, year, category")
        .order("title", { ascending: true })
        .range(from, to);

      if (error) throw error;
      const rows = data || [];
      if (reset) {
        setAssignAllPsakim(rows);
      } else {
        setAssignAllPsakim((prev) => [...prev, ...rows]);
      }
      setAssignHasMore(rows.length === ASSIGN_PAGE_SIZE);
      setAssignPage(page);
    } catch (err) {
      console.error("Error loading psakim for assign:", err);
    } finally {
      setLoadingAssign(false);
      setLoadingMoreAssign(false);
    }
  }, []);

  const openAssignDialog = async (folderName: string) => {
    setAssignTargetFolder(folderName);
    setAssignSearch("");
    setAssignSelected(new Set());
    setAssignAllPsakim([]);
    setAssignHasMore(true);
    setAssignDialogOpen(true);
    // Load first 2 pages in parallel for instant feel
    setLoadingAssign(true);
    try {
      const [res0, res1] = await Promise.all([
        supabase.from("psakei_din").select("id, title, court, year, category").order("title", { ascending: true }).range(0, ASSIGN_PAGE_SIZE - 1),
        supabase.from("psakei_din").select("id, title, court, year, category").order("title", { ascending: true }).range(ASSIGN_PAGE_SIZE, ASSIGN_PAGE_SIZE * 2 - 1),
      ]);
      const rows0 = res0.data || [];
      const rows1 = res1.data || [];
      setAssignAllPsakim([...rows0, ...rows1]);
      setAssignPage(rows1.length === ASSIGN_PAGE_SIZE ? 1 : 0);
      setAssignHasMore(rows1.length === ASSIGN_PAGE_SIZE);
    } catch (err) {
      console.error("Error loading initial psakim:", err);
    } finally {
      setLoadingAssign(false);
    }
  };

  const loadMoreAssignPsakim = useCallback(() => {
    if (loadingMoreAssign || !assignHasMore) return;
    loadAssignPsakim(assignTargetFolder, assignPage + 1, false);
  }, [loadingMoreAssign, assignHasMore, assignTargetFolder, assignPage, loadAssignPsakim]);

  // Filter by search
  const filteredAssignPsakim = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    if (!q) return assignAllPsakim;
    return assignAllPsakim.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.court.toLowerCase().includes(q) ||
        String(p.year).includes(q) ||
        (p.category && p.category.toLowerCase().includes(q))
    );
  }, [assignAllPsakim, assignSearch]);

  // Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredAssignPsakim.length,
    getScrollElement: () => assignScrollRef.current,
    estimateSize: () => 64,
    overscan: 15,
  });

  // Infinite scroll — load more when nearing the bottom
  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastVirtualItem = virtualItems[virtualItems.length - 1];
  const lastVirtualItemIndex = lastVirtualItem?.index ?? -1;
  useEffect(() => {
    if (
      lastVirtualItemIndex >= 0 &&
      lastVirtualItemIndex >= assignAllPsakim.length - 30 &&
      assignHasMore &&
      !loadingMoreAssign &&
      !assignSearch.trim()
    ) {
      loadMoreAssignPsakim();
    }
  }, [lastVirtualItemIndex, assignAllPsakim.length, assignHasMore, loadingMoreAssign, assignSearch, loadMoreAssignPsakim]);

  const toggleAssignSelect = (id: string) => {
    setAssignSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAssignPsakim = async () => {
    if (assignSelected.size === 0) return;
    setAssigning(true);
    try {
      const ids = Array.from(assignSelected);
      const { error } = await supabase
        .from("psakei_din")
        .update({ category: assignTargetFolder })
        .in("id", ids);

      if (error) throw error;
      toast({ title: `${ids.length} פסקים הועברו לתיקייה "${assignTargetFolder}"` });
      setAssignDialogOpen(false);
      await loadFolders();
      // Refresh expanded folder if it's the target
      if (expandedFolder === assignTargetFolder) {
        loadFolderPsakim(assignTargetFolder);
      }
    } catch (err) {
      console.error("Error assigning psakim:", err);
      toast({ title: "שגיאה בהעברת פסקים", variant: "destructive" });
    } finally {
      setAssigning(false);
    }
  };

  // ─── View Psak ─────────────────────────
  const reloadExpandedFolder = () => {
    if (expandedFolder === "__uncategorized__") loadFolderPsakim(null);
    else if (expandedFolder) loadFolderPsakim(expandedFolder);
  };

  const handleViewPsak = async (psakId: string) => {
    setLoadingViewPsak(true);
    try {
      const { data, error } = await supabase.from("psakei_din").select("id, title, source_url").eq("id", psakId).single();
      if (error) throw error;
      openDocument({ id: data.id, title: data.title, source_url: data.source_url }, { onSaved: reloadExpandedFolder });
    } catch (err) {
      console.error("Error loading psak:", err);
      toast({ title: "שגיאה בטעינת פסק הדין", variant: "destructive" });
    } finally {
      setLoadingViewPsak(false);
    }
  };

  // ─── Open in EmbedPDF ──────────────────────
  const handleOpenEmbedPdf = async (psakId: string) => {
    try {
      const { data, error } = await supabase
        .from("psakei_din")
        .select("id, title, source_url")
        .eq("id", psakId)
        .single();
      if (error) throw error;
      const sourceUrl = data.source_url || "";
      navigate(`/embedpdf-viewer?${sourceUrl ? `url=${encodeURIComponent(sourceUrl)}&` : ""}title=${encodeURIComponent(data.title)}&psakId=${data.id}`);
    } catch (err) {
      console.error("Error opening embedpdf:", err);
      toast({ title: "שגיאה בפתיחת EmbedPDF", variant: "destructive" });
    }
  };

  // ─── Toggle Favorite ───────────────────────
  const toggleFavorite = (psakId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(psakId)) next.delete(psakId);
      else next.add(psakId);
      localStorage.setItem("folder-psak-favorites", JSON.stringify([...next]));
      return next;
    });
  };

  // ─── Notes ─────────────────────────────────
  const handleOpenNotes = async (psakId: string, psakTitle: string) => {
    setNotesPsakId(psakId);
    setNotesPsakTitle(psakTitle);
    setNoteText("");
    setNotesDialogOpen(true);
    setLoadingNotes(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("psak_din_notes")
        .select("note_text")
        .eq("psak_din_id", psakId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setNoteText(data?.note_text || "");
    } catch (err) {
      console.error("Error loading notes:", err);
    } finally {
      setLoadingNotes(false);
    }
  };

  const handleSaveNote = async () => {
    setSavingNote(true);
    try {
      // Check if note exists
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (supabase as any)
        .from("psak_din_notes")
        .select("id")
        .eq("psak_din_id", notesPsakId)
        .limit(1)
        .maybeSingle();

      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("psak_din_notes")
          .update({ note_text: noteText, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("psak_din_notes")
          .insert({ psak_din_id: notesPsakId, note_text: noteText });
      }
      toast({ title: "ההערה נשמרה" });
      setNotesDialogOpen(false);
    } catch (err) {
      console.error("Error saving note:", err);
      toast({ title: "שגיאה בשמירת הערה", variant: "destructive" });
    } finally {
      setSavingNote(false);
    }
  };

  // ─── Delete Psak ───────────────────────────
  const handleDeletePsak = async () => {
    setDeletingPsak(true);
    try {
      const { error } = await supabase
        .from("psakei_din")
        .delete()
        .eq("id", deletingPsakId);
      if (error) throw error;
      toast({ title: `פסק הדין "${deletingPsakTitle}" נמחק` });
      setDeletePsakDialogOpen(false);
      setFolderPsakim((prev) => prev.filter((p) => p.id !== deletingPsakId));
      await loadFolders();
    } catch (err) {
      console.error("Error deleting psak:", err);
      toast({ title: "שגיאה במחיקת פסק הדין", variant: "destructive" });
    } finally {
      setDeletingPsak(false);
    }
  };

  // Remove single psak from folder
  const handleRemoveFromFolder = async (psakId: string) => {
    try {
      const { error } = await supabase
        .from("psakei_din")
        .update({ category: null })
        .eq("id", psakId);

      if (error) throw error;
      setFolderPsakim((prev) => prev.filter((p) => p.id !== psakId));
      await loadFolders();
    } catch (err) {
      console.error("Error removing psak from folder:", err);
    }
  };

  // ─── Drag & Drop Handlers ────────────────────
  const toggleSelectPsak = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedPsakim((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, psak: PsakMinimal) => {
    // If this psak isn't selected, make it the only dragged item
    const dragIds = selectedPsakim.has(psak.id) && selectedPsakim.size > 0
      ? Array.from(selectedPsakim)
      : [psak.id];
    const dragTitles = selectedPsakim.has(psak.id) && selectedPsakim.size > 1
      ? folderPsakim.filter(p => selectedPsakim.has(p.id)).map(p => p.title)
      : [psak.title];

    setDraggedPsak(psak);
    e.dataTransfer.setData("text/plain", JSON.stringify({ ids: dragIds, titles: dragTitles }));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, folderKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverFolder(folderKey);
  };

  const handleDragLeave = () => {
    setDragOverFolder(null);
  };

  const handleDrop = async (e: React.DragEvent, targetFolder: string | null) => {
    e.preventDefault();
    setDragOverFolder(null);
    setDraggedPsak(null);

    try {
      const data = JSON.parse(e.dataTransfer.getData("text/plain"));
      const ids: string[] = data.ids || [data.id];
      const titles: string[] = data.titles || [data.title];

      const { error } = await supabase
        .from("psakei_din")
        .update({ category: targetFolder })
        .in("id", ids);

      if (error) throw error;

      const targetName = targetFolder ?? "ללא תיקייה";
      const msg = ids.length > 1
        ? `${ids.length} פסקים הועברו ל"${targetName}"`
        : `"${titles[0]}" הועבר ל"${targetName}"`;
      toast({ title: msg });

      // Remove from currently displayed list
      const idSet = new Set(ids);
      setFolderPsakim((prev) => prev.filter((p) => !idSet.has(p.id)));
      setSelectedPsakim(new Set());
      await loadFolders();

      // If target folder is expanded, reload it
      if (expandedFolder === targetFolder || expandedFolder === (targetFolder ?? "__uncategorized__")) {
        loadFolderPsakim(targetFolder);
      }
    } catch (err) {
      console.error("Error moving psak via drag:", err);
      toast({ title: "שגיאה בהעברת פסק דין", variant: "destructive" });
    }
  };

  const handleDragEnd = () => {
    setDraggedPsak(null);
    setDragOverFolder(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <FolderOpen className="w-7 h-7 text-primary" />
            ניהול תיקיות
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            סווג את פסקי הדין לתיקיות, ערוך שמות ומחק תיקיות
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
          <FolderPlus className="w-4 h-4" />
          תיקייה חדשה
        </Button>
      </div>

      {/* Stats */}
      <div className="flex gap-4 flex-wrap">
        <Card className="flex-1 min-w-[140px]">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-primary">{folders.length}</p>
            <p className="text-sm text-muted-foreground">תיקיות</p>
          </CardContent>
        </Card>
        <Card className="flex-1 min-w-[140px]">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-amber-500">{uncategorizedCount}</p>
            <p className="text-sm text-muted-foreground">ללא תיקייה</p>
          </CardContent>
        </Card>
        <Card className="flex-1 min-w-[140px]">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-emerald-500">
              {folders.reduce((sum, f) => sum + f.count, 0)}
            </p>
            <p className="text-sm text-muted-foreground">מסווגים</p>
          </CardContent>
        </Card>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      )}

      {/* Folders List */}
      {!loading && (
        <div className="space-y-3">
          {/* Uncategorized section */}
          <Card
            className={cn(
              "border shadow-sm hover:shadow-md transition-all cursor-pointer",
              expandedFolder === "__uncategorized__" && "ring-1 ring-amber-500/50 border-amber-500/30",
              dragOverFolder === "__uncategorized__" && "ring-2 ring-primary border-primary/50 bg-primary/5"
            )}
            onDragOver={(e) => handleDragOver(e, "__uncategorized__")}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, null)}
          >
            <CardContent className="p-0">
              <button
                type="button"
                className="w-full flex items-center justify-between p-4"
                onClick={() => handleExpandFolder(null)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-foreground">ללא תיקייה</p>
                    <p className="text-xs text-muted-foreground">{uncategorizedCount} פסקי דין</p>
                  </div>
                </div>
                {expandedFolder === "__uncategorized__" ? (
                  <ChevronDown className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <ChevronLeft className="w-5 h-5 text-muted-foreground" />
                )}
              </button>

              {expandedFolder === "__uncategorized__" && (
                <div className="border-t border-border/50 px-4 pb-4">
                  {loadingPsakim ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[300px] mt-3">
                      <div className="relative mb-2">
                        <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          placeholder="חיפוש פסקים..."
                          value={folderSearch}
                          onChange={(e) => setFolderSearch(e.target.value)}
                          className="pr-8 h-8 text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <Checkbox
                          checked={filteredFolderPsakim.length > 0 && selectedPsakim.size === filteredFolderPsakim.length}
                          onCheckedChange={() => {
                            if (selectedPsakim.size === filteredFolderPsakim.length) {
                              setSelectedPsakim(new Set());
                            } else {
                              setSelectedPsakim(new Set(filteredFolderPsakim.map(p => p.id)));
                            }
                          }}
                          className="flex-shrink-0"
                        />
                        <span className="text-xs text-muted-foreground">
                          {selectedPsakim.size === filteredFolderPsakim.length && filteredFolderPsakim.length > 0 ? "בטל הכל" : "בחר הכל"}
                        </span>
                        {selectedPsakim.size > 0 && (
                          <>
                            <Badge variant="default" className="gap-1 text-xs">{selectedPsakim.size} נבחרו לגרירה</Badge>
                            <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => setSelectedPsakim(new Set())}>נקה</Button>
                          </>
                        )}
                      </div>
                      <div className="space-y-2">
                        {filteredFolderPsakim.map((p) => {
                          const isSelected = selectedPsakim.has(p.id);
                          return (
                            <div
                              key={p.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, p)}
                              onDragEnd={handleDragEnd}
                              className={cn(
                                "flex items-center justify-between py-2 px-3 rounded-lg transition-colors group cursor-grab active:cursor-grabbing",
                                isSelected ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/30 hover:bg-muted/60"
                              )}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleSelectPsak(p.id)}
                                  className="flex-shrink-0"
                                />
                                <GripVertical className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
                                <div className="text-right flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{p.title}</p>
                                  <p className="text-xs text-muted-foreground">{p.court} · {p.year}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-0.5">
                                {isSelected && selectedPsakim.size > 1 && (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 mr-1">{selectedPsakim.size}</Badge>
                                )}
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary" title="צפייה" onClick={() => handleViewPsak(p.id)}>
                                    <Eye className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary" title="עריכה" onClick={() => handleViewPsak(p.id)}>
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-blue-500" title="EmbedPDF" onClick={() => handleOpenEmbedPdf(p.id)}>
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-amber-500" title="הערות" onClick={() => handleOpenNotes(p.id, p.title)}>
                                    <MessageSquare className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className={cn("h-7 w-7 transition-colors", favorites.has(p.id) ? "text-yellow-500" : "text-muted-foreground hover:text-yellow-500")} title="מועדף" onClick={() => toggleFavorite(p.id)}>
                                    <Star className={cn("w-3.5 h-3.5", favorites.has(p.id) && "fill-current")} />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="מחק" onClick={() => { setDeletingPsakId(p.id); setDeletingPsakTitle(p.title); setDeletePsakDialogOpen(true); }}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {filteredFolderPsakim.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            {folderSearch.trim() ? "לא נמצאו תוצאות" : "אין פסקים ללא תיקייה"}
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Named folders */}
          {folders.map((folder) => {
            const isExpanded = expandedFolder === folder.name;
            return (
              <Card
                key={folder.name}
                className={cn(
                  "border shadow-sm hover:shadow-md transition-all",
                  isExpanded && "ring-1 ring-primary/50 border-primary/30",
                  dragOverFolder === folder.name && "ring-2 ring-primary border-primary/50 bg-primary/5"
                )}
                onDragOver={(e) => handleDragOver(e, folder.name)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, folder.name)}
              >
                <CardContent className="p-0">
                  <div className="flex items-center justify-between p-4">
                    <button
                      type="button"
                      className="flex items-center gap-3 flex-1 cursor-pointer"
                      onClick={() => handleExpandFolder(folder.name)}
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <FolderOpen className="w-5 h-5 text-primary" />
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-foreground">{folder.name}</p>
                        <p className="text-xs text-muted-foreground">{folder.count} פסקי דין</p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        title="הוסף פסקים"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAssignDialog(folder.name);
                        }}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        title="שנה שם"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingFolder(folder.name);
                          setEditNewName(folder.name);
                          setEditDialogOpen(true);
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        title="מחק תיקייה"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingFolder(folder.name);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronLeft className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border/50 px-4 pb-4">
                      {loadingPsakim ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <ScrollArea className="max-h-[400px] mt-3">
                          <div className="relative mb-2">
                            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                              placeholder="חיפוש פסקים..."
                              value={folderSearch}
                              onChange={(e) => setFolderSearch(e.target.value)}
                              className="pr-8 h-8 text-sm"
                            />
                          </div>
                          <div className="flex items-center gap-2 mb-2 px-1">
                            <Checkbox
                              checked={filteredFolderPsakim.length > 0 && selectedPsakim.size === filteredFolderPsakim.length}
                              onCheckedChange={() => {
                                if (selectedPsakim.size === filteredFolderPsakim.length) {
                                  setSelectedPsakim(new Set());
                                } else {
                                  setSelectedPsakim(new Set(filteredFolderPsakim.map(p => p.id)));
                                }
                              }}
                              className="flex-shrink-0"
                            />
                            <span className="text-xs text-muted-foreground">
                              {selectedPsakim.size === filteredFolderPsakim.length && filteredFolderPsakim.length > 0 ? "בטל הכל" : "בחר הכל"}
                            </span>
                            {selectedPsakim.size > 0 && (
                              <>
                                <Badge variant="default" className="gap-1 text-xs">{selectedPsakim.size} נבחרו לגרירה</Badge>
                                <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => setSelectedPsakim(new Set())}>נקה</Button>
                              </>
                            )}
                          </div>
                          <div className="space-y-2">
                            {filteredFolderPsakim.map((p) => {
                              const isSelected = selectedPsakim.has(p.id);
                              return (
                                <div
                                  key={p.id}
                                  draggable
                                  onDragStart={(e) => handleDragStart(e, p)}
                                  onDragEnd={handleDragEnd}
                                  className={cn(
                                    "flex items-center justify-between py-2 px-3 rounded-lg transition-colors group cursor-grab active:cursor-grabbing",
                                    isSelected ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/30 hover:bg-muted/60"
                                  )}
                                >
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <Checkbox
                                      checked={isSelected}
                                      onCheckedChange={() => toggleSelectPsak(p.id)}
                                      className="flex-shrink-0"
                                    />
                                    <GripVertical className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
                                    <div className="text-right flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">{p.title}</p>
                                      <p className="text-xs text-muted-foreground">{p.court} · {p.year}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-0.5">
                                    {isSelected && selectedPsakim.size > 1 && (
                                      <Badge variant="secondary" className="text-[10px] px-1.5 mr-1">{selectedPsakim.size}</Badge>
                                    )}
                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary" title="צפייה" onClick={() => handleViewPsak(p.id)}>
                                        <Eye className="w-3.5 h-3.5" />
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary" title="עריכה" onClick={() => handleViewPsak(p.id)}>
                                        <Pencil className="w-3.5 h-3.5" />
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-blue-500" title="EmbedPDF" onClick={() => handleOpenEmbedPdf(p.id)}>
                                        <ExternalLink className="w-3.5 h-3.5" />
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-amber-500" title="הערות" onClick={() => handleOpenNotes(p.id, p.title)}>
                                        <MessageSquare className="w-3.5 h-3.5" />
                                      </Button>
                                      <Button size="icon" variant="ghost" className={cn("h-7 w-7 transition-colors", favorites.has(p.id) ? "text-yellow-500" : "text-muted-foreground hover:text-yellow-500")} title="מועדף" onClick={() => toggleFavorite(p.id)}>
                                        <Star className={cn("w-3.5 h-3.5", favorites.has(p.id) && "fill-current")} />
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="הסר מתיקייה" onClick={() => handleRemoveFromFolder(p.id)}>
                                        <X className="w-3.5 h-3.5" />
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="מחק" onClick={() => { setDeletingPsakId(p.id); setDeletingPsakTitle(p.title); setDeletePsakDialogOpen(true); }}>
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            {filteredFolderPsakim.length === 0 && (
                              <div className="text-center py-6">
                                <p className="text-sm text-muted-foreground mb-3">
                                  {folderSearch.trim() ? "לא נמצאו תוצאות" : "התיקייה ריקה"}
                                </p>
                                {!folderSearch.trim() && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-2"
                                    onClick={() => openAssignDialog(folder.name)}
                                  >
                                    <Plus className="w-4 h-4" />
                                    הוסף פסקים
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </ScrollArea>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {folders.length === 0 && !loading && (
            <Card className="border-dashed border-2">
              <CardContent className="p-12 text-center">
                <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground mb-2">אין תיקיות עדיין</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  צור תיקיות כדי לסווג את פסקי הדין שלך
                </p>
                <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
                  <FolderPlus className="w-4 h-4" />
                  צור תיקייה ראשונה
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ─── Add Folder Dialog ─── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="w-5 h-5 text-primary" />
              תיקייה חדשה
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>שם התיקייה</Label>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="למשל: דיני שכירות, דיני נזיקין..."
                className="text-right"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddFolder();
                  }
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button onClick={handleAddFolder} disabled={!newFolderName.trim()} className="gap-2">
              <FolderPlus className="w-4 h-4" />
              צור
            </Button>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit Folder Dialog ─── */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" />
              שינוי שם תיקייה
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>שם חדש</Label>
              <Input
                value={editNewName}
                onChange={(e) => setEditNewName(e.target.value)}
                className="text-right"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleEditFolder();
                  }
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button onClick={handleEditFolder} disabled={renaming || !editNewName.trim()} className="gap-2">
              {renaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {renaming ? "משנה..." : "שמור"}
            </Button>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={renaming}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Folder Dialog ─── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              מחיקת תיקייה
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              האם למחוק את התיקייה <strong>"{deletingFolder}"</strong>?
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              פסקי הדין שבתיקייה לא יימחקו — הם יועברו ל"ללא תיקייה".
            </p>
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button
              variant="destructive"
              onClick={handleDeleteFolder}
              disabled={deleting}
              className="gap-2"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {deleting ? "מוחק..." : "מחק"}
            </Button>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Assign Psakim Dialog ─── */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              הוסף פסקים לתיקייה "{assignTargetFolder}"
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            {/* Search */}
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="חפש פסקי דין לפי שם, בית דין, שנה..."
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                className="pr-9"
                autoFocus
              />
            </div>

            {/* Selection info + select all */}
            <div className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {filteredAssignPsakim.length} פסקים
                  {assignSearch.trim() && ` (מסוננים מתוך ${assignAllPsakim.length})`}
                </span>
                {assignSelected.size > 0 && (
                  <Badge variant="default" className="gap-1">
                    {assignSelected.size} נבחרו
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                {filteredAssignPsakim.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7"
                    onClick={() => {
                      const allIds = new Set(filteredAssignPsakim.map((p) => p.id));
                      const allSelected = filteredAssignPsakim.every((p) => assignSelected.has(p.id));
                      if (allSelected) {
                        setAssignSelected((prev) => {
                          const next = new Set(prev);
                          allIds.forEach((id) => next.delete(id));
                          return next;
                        });
                      } else {
                        setAssignSelected((prev) => new Set([...prev, ...allIds]));
                      }
                    }}
                  >
                    {filteredAssignPsakim.every((p) => assignSelected.has(p.id))
                      ? "בטל בחירת הכל"
                      : "בחר הכל"}
                  </Button>
                )}
                {assignSelected.size > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7"
                    onClick={() => setAssignSelected(new Set())}
                  >
                    נקה בחירה
                  </Button>
                )}
              </div>
            </div>

            {/* Virtual scrolling results */}
            {loadingAssign ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div
                ref={assignScrollRef}
                className="flex-1 min-h-0 overflow-auto rounded-lg border"
                style={{ maxHeight: "50vh" }}
              >
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const p = filteredAssignPsakim[virtualRow.index];
                    if (!p) return null;
                    const isSelected = assignSelected.has(p.id);
                    return (
                      <div
                        key={p.id}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <div
                          className={cn(
                            "flex items-center gap-3 py-3 px-3 transition-colors cursor-pointer border-b border-border/30",
                            isSelected
                              ? "bg-primary/10"
                              : "hover:bg-muted/60"
                          )}
                          onClick={() => toggleAssignSelect(p.id)}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleAssignSelect(p.id)}
                          />
                          <div className="text-right flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{p.title}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{p.court}</span>
                              <span>·</span>
                              <span>{p.year}</span>
                              {p.category && (
                                <>
                                  <span>·</span>
                                  <Badge variant="outline" className="text-[10px] px-1">
                                    {p.category}
                                  </Badge>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {loadingMoreAssign && (
                  <div className="flex justify-center py-3">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {filteredAssignPsakim.length === 0 && !loadingAssign && (
                  <p className="text-sm text-muted-foreground text-center py-12">
                    {assignSearch.trim() ? "לא נמצאו פסקי דין" : "אין פסקי דין זמינים"}
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-row-reverse gap-2 pt-4 border-t">
            <Button
              onClick={handleAssignPsakim}
              disabled={assigning || assignSelected.size === 0}
              className="gap-2"
            >
              {assigning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {assigning ? "מעביר..." : `העבר ${assignSelected.size} פסקים`}
            </Button>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)} disabled={assigning}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* ─── Notes Dialog ─── */}
      <Dialog open={notesDialogOpen} onOpenChange={setNotesDialogOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-amber-500" />
              הערות
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground truncate">
              {notesPsakTitle}
            </p>
            {loadingNotes ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="הקלד הערות כאן..."
                className="min-h-[150px] text-right"
                dir="rtl"
              />
            )}
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button onClick={handleSaveNote} disabled={savingNote || loadingNotes} className="gap-2">
              {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {savingNote ? "שומר..." : "שמור"}
            </Button>
            <Button variant="outline" onClick={() => setNotesDialogOpen(false)} disabled={savingNote}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Psak Dialog ─── */}
      <Dialog open={deletePsakDialogOpen} onOpenChange={setDeletePsakDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              מחיקת פסק דין
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              האם למחוק את פסק הדין <strong>"{deletingPsakTitle}"</strong>?
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              פעולה זו אינה ניתנת לביטול.
            </p>
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button
              variant="destructive"
              onClick={handleDeletePsak}
              disabled={deletingPsak}
              className="gap-2"
            >
              {deletingPsak ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {deletingPsak ? "מוחק..." : "מחק"}
            </Button>
            <Button variant="outline" onClick={() => setDeletePsakDialogOpen(false)} disabled={deletingPsak}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FolderManagerTab;
