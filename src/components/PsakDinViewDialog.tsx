import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import DOMPurify from "dompurify";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import FileTypeBadge from "./FileTypeBadge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Calendar, Building2, FileText, ExternalLink, Download, Eye, FileIcon, 
  Maximize2, Minimize2, AlignRight, AlignCenter, AlignLeft, AlignJustify,
  Type, Bold, Italic, Underline, Highlighter, AArrowUp, AArrowDown, Palette, Edit, Save, X,
  Search, ChevronUp, ChevronDown, CaseSensitive, WholeWord, Sparkles, Loader2, Printer,
  ScrollText, BookOpen, ListOrdered, Copy
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getCachedBeautified, cacheBeautified, cachePsak } from "@/lib/psakCache";
import { parsePsakDinText } from "@/lib/psakDinParser";
import { toHouseStyledHtml } from "@/lib/psakDinHtmlTemplate";
import { TEMPLATES, generateFromTemplate } from "@/lib/psakDinTemplates";

const VIEWER_TEXT_SETTINGS_KEY = 'psak-din-viewer-text-settings';

const FONTS = [
  { value: 'font-sans', label: 'אריאל' },
  { value: 'font-serif', label: 'טיימס' },
  { value: 'font-david', label: 'דוד' },
  { value: 'font-frank', label: 'פרנק רוהל' },
  { value: 'font-heebo', label: 'חיבו' },
  { value: 'font-rubik', label: 'רוביק' },
  { value: 'font-noto-serif', label: 'נוטו סריף' },
];

const TEXT_COLORS = [
  { value: 'text-foreground', label: 'ברירת מחדל', color: 'currentColor' },
  { value: 'text-blue-700', label: 'כחול', color: '#1d4ed8' },
  { value: 'text-red-700', label: 'אדום', color: '#b91c1c' },
  { value: 'text-green-700', label: 'ירוק', color: '#15803d' },
  { value: 'text-purple-700', label: 'סגול', color: '#7e22ce' },
  { value: 'text-amber-700', label: 'כתום', color: '#b45309' },
];

const BG_COLORS = [
  { value: 'bg-transparent', label: 'ללא', color: 'transparent' },
  { value: 'bg-yellow-100', label: 'צהוב', color: '#fef9c3' },
  { value: 'bg-green-100', label: 'ירוק', color: '#dcfce7' },
  { value: 'bg-blue-100', label: 'כחול', color: '#dbeafe' },
  { value: 'bg-pink-100', label: 'ורוד', color: '#fce7f3' },
  { value: 'bg-orange-100', label: 'כתום', color: '#ffedd5' },
];

interface TextSettings {
  fontSize: number;
  fontFamily: string;
  textAlign: 'right' | 'center' | 'left' | 'justify';
  isBold: boolean;
  isItalic: boolean;
  textColor: string;
  bgColor: string;
  showLineNumbers: boolean;
}

const defaultTextSettings: TextSettings = {
  fontSize: 16,
  fontFamily: 'font-serif',
  textAlign: 'right',
  isBold: false,
  isItalic: false,
  textColor: 'text-foreground',
  bgColor: 'bg-transparent',
  showLineNumbers: true,
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const plainTextToHtml = (value: string) => {
  if (!value) return "";
  return escapeHtml(value).replace(/\n/g, "<br>");
};

const stripHtmlToText = (input: string): string => {
  if (!/<[a-z][\s\S]*>/i.test(input)) return input;
  const doc = new DOMParser().parseFromString(input, "text/html");
  doc.querySelectorAll("style, script, link, meta, title, head").forEach(el => el.remove());
  doc.querySelectorAll("p, div, br, h1, h2, h3, h4, h5, h6, li, tr, hr, blockquote").forEach(el => {
    el.insertAdjacentText("beforebegin", "\n");
  });
  const text = doc.body?.textContent || "";
  return text.replace(/[ \t]+/g, " ").replace(/\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
};

interface PsakDinViewDialogProps {
  psak: {
    id?: string;
    title: string;
    court?: string;
    year?: number;
    case_number?: string;
    caseNumber?: string;
    summary: string;
    full_text?: string;
    fullText?: string;
    source_url?: string;
    sourceUrl?: string;
    tags?: string[];
    source?: string;
    connection?: string;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: () => void;
}

const PsakDinViewDialog = ({ psak, open, onOpenChange, onSave }: PsakDinViewDialogProps) => {
  const navigate = useNavigate();
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [activeTab, setActiveTab] = useState("preview");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [lineJumpInput, setLineJumpInput] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const infoScrollAreaRef = useRef<HTMLDivElement>(null);
  const richEditorRef = useRef<HTMLDivElement>(null);
  const [richHtml, setRichHtml] = useState("");
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number } | null>(null);

  const [textSettings, setTextSettings] = useState<TextSettings>(() => {
    const saved = localStorage.getItem(VIEWER_TEXT_SETTINGS_KEY);
    return saved ? JSON.parse(saved) : defaultTextSettings;
  });

  // Editable fields
  const [editTitle, setEditTitle] = useState("");
  const [editCourt, setEditCourt] = useState("");
  const [editYear, setEditYear] = useState<number | "">("");
  const [editCaseNumber, setEditCaseNumber] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editFullText, setEditFullText] = useState("");
  const [editTags, setEditTags] = useState("");

  // Fetched HTML preview state (for rendering html files with srcDoc)
  const [fetchedHtmlPreview, setFetchedHtmlPreview] = useState<string | null>(null);
  const [fetchingHtmlPreview, setFetchingHtmlPreview] = useState(false);

  // Beautify state
  const [beautifiedHtml, setBeautifiedHtml] = useState<string | null>(null);
  const [isBeautifying, setIsBeautifying] = useState(false);
  const [isSavingBeautified, setIsSavingBeautified] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("classic");
  const beautifyIframeRef = useRef<HTMLIFrameElement>(null);
  const selectedTemplateInfo = useMemo(
    () => TEMPLATES.find(t => t.id === selectedTemplate) ?? TEMPLATES[0],
    [selectedTemplate],
  );

  useEffect(() => {
    localStorage.setItem(VIEWER_TEXT_SETTINGS_KEY, JSON.stringify(textSettings));
  }, [textSettings]);

  // Reset to preview tab and load edit values when dialog opens
  useEffect(() => {
    if (open && psak) {
      const sourceUrl = psak.source_url || psak.sourceUrl;
      const storedText = psak.full_text || psak.fullText || "";
      // A plain web page (gov.il, psakim.org) refuses to be framed; when we hold the
      // ruling ourselves, open straight on the styled copy instead of a blank frame.
      const isWebPage = !!sourceUrl && !/\.(pdf|docx?|txt|rtf|html?)(\?|#|$)/i.test(sourceUrl);
      setActiveTab(sourceUrl && !(isWebPage && storedText.trim()) ? "preview" : storedText.trim() ? "beautified" : "info");
      setIsEditing(false);
      setSelectedTemplate("classic");
      // Try loading cached beautified HTML
      setBeautifiedHtml(null);
      if (psak.id) {
        getCachedBeautified(psak.id).then(cached => {
          if (cached) setBeautifiedHtml(cached);
        });
        // Cache the psak itself for faster future loads
        cachePsak({
          id: psak.id,
          title: psak.title,
          court: psak.court || '',
          year: psak.year || 0,
          summary: psak.summary,
          full_text: psak.full_text || psak.fullText || null,
          source_url: psak.source_url || psak.sourceUrl || null,
          case_number: psak.case_number || psak.caseNumber || null,
          tags: psak.tags,
          _cachedAt: Date.now(),
        });
      }
      // Initialize edit fields
      setEditTitle(psak.title || "");
      setEditCourt(psak.court || "");
      setEditYear(psak.year || "");
      setEditCaseNumber(psak.case_number || psak.caseNumber || "");
      setEditSummary(psak.summary || "");
      setEditFullText(psak.full_text || psak.fullText || "");
      const ft = psak.full_text || psak.fullText || "";
      const isHtmlContent = /<[a-z][\s\S]*>/i.test(ft);
      setRichHtml(isHtmlContent ? ft : plainTextToHtml(ft));
      // If full_text already contains beautified HTML, auto-load it; plain text
      // gets the house template so the "מעוצב" tab always has something to show
      if (isHtmlContent && !beautifiedHtml) {
        setBeautifiedHtml(ft);
      } else if (!isHtmlContent && ft.trim() && isWebPage) {
        setBeautifiedHtml(toHouseStyledHtml(ft, {
          title: psak.title, court: psak.court, year: psak.year || undefined,
          caseNumber: psak.case_number || psak.caseNumber, summary: psak.summary, sourceUrl,
        }));
      }
      setEditTags((psak.tags || []).join(", "));
    }
  }, [open, psak]);

  const fullText = psak?.full_text || psak?.fullText;
  const sourceUrl = psak?.source_url || psak?.sourceUrl;
  const caseNumber = psak?.case_number || psak?.caseNumber;

  // Fetch HTML content for preview when fileType is html
  useEffect(() => {
    if (!open || !sourceUrl) { setFetchedHtmlPreview(null); return; }
    const lower = sourceUrl.toLowerCase();
    const isHtml = lower.includes('.html') || lower.includes('.htm');
    if (!isHtml) { setFetchedHtmlPreview(null); return; }
    let cancelled = false;
    setFetchingHtmlPreview(true);
    fetch(sourceUrl)
      .then(r => r.text())
      .then(html => { if (!cancelled) setFetchedHtmlPreview(html); })
      .catch(() => { if (!cancelled) setFetchedHtmlPreview(null); })
      .finally(() => { if (!cancelled) setFetchingHtmlPreview(false); });
    return () => { cancelled = true; };
  }, [open, sourceUrl]);

  const factualCaseText = useMemo(() => {
    const base = (fullText || psak?.summary || "").trim();
    if (!base) return "";
    const lines = base
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.slice(0, 8).join("\n");
  }, [fullText, psak?.summary]);

  const handleSave = async () => {
    if (!psak?.id) {
      toast.error("לא ניתן לשמור - חסר מזהה");
      return;
    }

    setIsSaving(true);
    try {
      const tagsArray = editTags
        .split(",")
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const { error } = await supabase
        .from("psakei_din")
        .update({
          title: editTitle.trim(),
          court: editCourt.trim(),
          year: editYear || null,
          case_number: editCaseNumber.trim() || null,
          summary: editSummary.trim(),
          full_text: editFullText.trim() || null,
          tags: tagsArray,
        })
        .eq("id", psak!.id);

      if (error) throw error;

      toast.success("פסק הדין עודכן בהצלחה");
      setIsEditing(false);
      onSave?.();
    } catch (error: unknown) {
      console.error("Error saving psak din:", error);
      toast.error("שגיאה בשמירת פסק הדין");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setSelectionMenu(null);
    // Reset to original values
    setEditTitle(psak?.title || "");
    setEditCourt(psak?.court || "");
    setEditYear(psak?.year || "");
    setEditCaseNumber(psak?.case_number || psak?.caseNumber || "");
    setEditSummary(psak?.summary || "");
    setEditFullText(psak?.full_text || psak?.fullText || "");
    setRichHtml(plainTextToHtml(psak?.full_text || psak?.fullText || ""));
    setEditTags((psak?.tags || []).join(", "));
  };

  const syncRichEditorToState = useCallback(() => {
    if (!richEditorRef.current) return;
    const html = richEditorRef.current.innerHTML;
    const text = richEditorRef.current.innerText;
    setRichHtml(html);
    setEditFullText(text);
  }, []);

  // Auto-save full text on blur (works in both edit and view modes)
  // Preserves HTML formatting if the content was beautified
  const autoSaveFullText = useCallback(async () => {
    if (!richEditorRef.current || !psak?.id) return;
    const html = richEditorRef.current.innerHTML;
    const originalFt = psak?.full_text || psak?.fullText || "";
    // If content hasn't changed, skip
    const isOriginalHtml = /<[a-z][\s\S]*>/i.test(originalFt);
    const currentContent = isOriginalHtml ? html : richEditorRef.current.innerText;
    if (currentContent === originalFt) return;
    try {
      await supabase
        .from("psakei_din")
        .update({ full_text: currentContent.trim() || null })
        .eq("id", psak.id);
      toast.success("הטקסט נשמר אוטומטית");
      onSave?.();
    } catch {
      toast.error("שגיאה בשמירה אוטומטית");
    }
  }, [psak?.id, psak?.full_text, psak?.fullText, onSave]);

  const handleRichSelection = useCallback(() => {
    if (!richEditorRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setSelectionMenu(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!richEditorRef.current.contains(range.commonAncestorContainer)) {
      setSelectionMenu(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelectionMenu({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
  }, []);

  const applyFormatCommand = useCallback((command: string, value?: string) => {
    if (command === 'hiliteColor') {
      document.execCommand('styleWithCSS', false, 'true');
    }
    document.execCommand(command, false, value);
    syncRichEditorToState();
    setSelectionMenu(null);
  }, [syncRichEditorToState]);

  // ── Beautify psak din (streaming) ──
  const handleBeautify = useCallback(async (mode: "full" | "summary" = "full") => {
    if (!psak) return;
    setIsBeautifying(true);
    setActiveTab("beautified");
    setBeautifiedHtml("");

    try {
      // Use fetch directly for SSE streaming
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const session = (await supabase.auth.getSession()).data.session;

      const response = await fetch(`${supabaseUrl}/functions/v1/beautify-psak-din`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token || supabaseKey}`,
          "apikey": supabaseKey,
        },
        body: JSON.stringify({
          title: psak.title,
          court: psak.court,
          year: psak.year,
          caseNumber: psak.case_number || psak.caseNumber,
          summary: psak.summary,
          fullText: psak.full_text || psak.fullText,
          tags: psak.tags,
          ...(mode === "summary" ? { mode: "summary" } : {}),
        }),
      });

      if (!response.ok) throw new Error(`שגיאה: ${response.status}`);

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream") && response.body) {
        // Stream mode: read chunks as they arrive
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.chunk) {
                accumulated += evt.chunk;
                setBeautifiedHtml(accumulated);
              }
              if (evt.done && evt.html) {
                accumulated = evt.html;
                setBeautifiedHtml(evt.html);
              }
              if (evt.error) throw new Error(evt.error);
            } catch (e: unknown) {
              if (e instanceof Error && e.message && !e.message.includes("JSON")) throw e;
            }
          }
        }

        if (psak.id && accumulated) cacheBeautified(psak.id, accumulated);
        toast.success("פסק הדין עוצב בהצלחה!");
      } else {
        // Fallback: non-streaming JSON response
        const data = await response.json();
        if (!data?.success) throw new Error(data?.error || "שגיאה בעיצוב");
        setBeautifiedHtml(data.html);
        if (psak.id) cacheBeautified(psak.id, data.html);
        toast.success("פסק הדין עוצב בהצלחה!");
      }
    } catch (err: unknown) {
      console.error("Beautify error:", err);
      toast.error(err instanceof Error ? err.message : "שגיאה בעיצוב פסק הדין");
    } finally {
      setIsBeautifying(false);
    }
  }, [psak]);

  const applyLocalTemplate = useCallback((templateId: string) => {
    if (!psak) return;
    const baseText = stripHtmlToText(psak.full_text || psak.fullText || psak.summary || "");
    if (!baseText.trim()) {
      toast.error("לא נמצא טקסט לעיצוב");
      return;
    }

    try {
      const parsed = parsePsakDinText(baseText);
      if (!parsed.title) parsed.title = psak.title;
      if (!parsed.court && psak.court) parsed.court = psak.court;
      if (!parsed.year && psak.year) parsed.year = psak.year;
      if (!parsed.caseNumber && (psak.case_number || psak.caseNumber)) {
        parsed.caseNumber = psak.case_number || psak.caseNumber;
      }
      if ((!parsed.summary || parsed.summary.length < 20) && psak.summary) {
        parsed.summary = psak.summary;
      }

      const html = generateFromTemplate(templateId, parsed);
      setBeautifiedHtml(html);
      setActiveTab("beautified");
      toast.success(`התבנית הוחלפה ל-${TEMPLATES.find(t => t.id === templateId)?.name || "קלאסי"}`);
    } catch {
      toast.error("שגיאה בהחלת תבנית על פסק הדין");
    }
  }, [psak]);

  const applySelectedTemplate = useCallback(async (templateId: string) => {
    const tmpl = TEMPLATES.find(t => t.id === templateId);
    if (tmpl?.requiresAi) {
      await handleBeautify(templateId === "ai-summary" ? "summary" : "full");
      return;
    }
    applyLocalTemplate(templateId);
  }, [applyLocalTemplate, handleBeautify]);

  const handleTemplateSelection = useCallback((templateId: string) => {
    setSelectedTemplate(templateId);
    void applySelectedTemplate(templateId);
  }, [applySelectedTemplate]);

  const handlePrintBeautified = useCallback(() => {
    if (!beautifyIframeRef.current?.contentWindow) return;
    beautifyIframeRef.current.contentWindow.print();
  }, []);

  // Save beautified: overwrite the original psak din's full_text
  const handleSaveBeautified = useCallback(async () => {
    if (!psak?.id || !beautifiedHtml) return;
    setIsSavingBeautified(true);
    try {
      // Read current content from the editable iframe
      const doc = beautifyIframeRef.current?.contentDocument;
      const currentHtml = doc?.documentElement?.outerHTML || beautifiedHtml;
      // Upload beautified HTML to storage
      const fileName = `beautified/${psak.id}-${Date.now()}.html`;
      const blob = new Blob([currentHtml], { type: "text/html;charset=utf-8" });
      const { error: uploadError } = await supabase.storage
        .from("psakei-din-files")
        .upload(fileName, blob, { contentType: "text/html", upsert: true });
      if (uploadError) console.warn("Storage upload warning:", uploadError);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("psakei-din-files")
        .getPublicUrl(fileName);

      // Update the original record
      const { error } = await supabase
        .from("psakei_din")
        .update({
          full_text: currentHtml,
          source_url: urlData?.publicUrl || undefined,
        })
        .eq("id", psak.id);
      if (error) throw error;

      toast.success("פסק הדין המעוצב נשמר בהצלחה");
      onSave?.();
    } catch (err: unknown) {
      console.error("Save beautified error:", err);
      toast.error("שגיאה בשמירת פסק הדין המעוצב");
    } finally {
      setIsSavingBeautified(false);
    }
  }, [psak, beautifiedHtml, onSave]);

  // Copy & Save: keep original, create a new record with the beautified version
  const handleCopyAndSaveBeautified = useCallback(async () => {
    if (!psak || !beautifiedHtml) return;
    setIsSavingBeautified(true);
    try {
      // Read current content from the editable iframe
      const doc = beautifyIframeRef.current?.contentDocument;
      const currentHtml = doc?.documentElement?.outerHTML || beautifiedHtml;
      // Upload beautified HTML to storage
      const newId = crypto.randomUUID();
      const fileName = `beautified/${newId}.html`;
      const blob = new Blob([currentHtml], { type: "text/html;charset=utf-8" });
      const { error: uploadError } = await supabase.storage
        .from("psakei-din-files")
        .upload(fileName, blob, { contentType: "text/html", upsert: true });
      if (uploadError) console.warn("Storage upload warning:", uploadError);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("psakei-din-files")
        .getPublicUrl(fileName);

      // Create a new psak din record
      const { error } = await supabase
        .from("psakei_din")
        .insert({
          id: newId,
          title: `${psak.title} (מעוצב)`,
          court: psak.court || "",
          year: psak.year || new Date().getFullYear(),
          case_number: psak.case_number || psak.caseNumber || null,
          summary: psak.summary || "",
          full_text: currentHtml,
          source_url: urlData?.publicUrl || null,
          tags: [...(psak.tags || []), "מעוצב"],
        });
      if (error) throw error;

      toast.success("פסק הדין המעוצב הועתק ונשמר כפריט חדש");
      onSave?.();
    } catch (err: unknown) {
      console.error("Copy & save beautified error:", err);
      toast.error("שגיאה בהעתקה ושמירה");
    } finally {
      setIsSavingBeautified(false);
    }
  }, [psak, beautifiedHtml, onSave]);

  // Determine file type from URL
  const getFileType = (url: string | undefined): string => {
    if (!url) return 'unknown';
    const lower = url.toLowerCase();
    if (lower.includes('.pdf')) return 'pdf';
    if (lower.includes('.doc') || lower.includes('.docx')) return 'doc';
    if (lower.includes('.txt')) return 'txt';
    if (lower.includes('.rtf')) return 'rtf';
    if (lower.includes('.html') || lower.includes('.htm')) return 'html';
    // Default: try loading as HTML/iframe (most web URLs serve viewable content)
    return 'auto';
  };

  const fileType = getFileType(sourceUrl);

  // For Google Docs Viewer for Word files
  const getPreviewUrl = (url: string, type: string): string => {
    return url;
  };

  const updateTextSetting = <K extends keyof TextSettings>(key: K, value: TextSettings[K]) => {
    setTextSettings(prev => ({ ...prev, [key]: value }));
  };

  const getTextAlignClass = () => {
    switch (textSettings.textAlign) {
      case 'center': return 'text-center';
      case 'left': return 'text-left';
      case 'justify': return 'text-justify';
      default: return 'text-right';
    }
  };

  const textClasses = `${textSettings.fontFamily} ${getTextAlignClass()} ${textSettings.isBold ? 'font-bold' : ''} ${textSettings.isItalic ? 'italic' : ''} ${textSettings.textColor} ${textSettings.bgColor}`;

  const jumpToLine = useCallback(() => {
    if (!fullText?.trim()) {
      toast.info("אין טקסט מלא לקפיצה לשורה");
      return;
    }

    const lineNumber = Number(lineJumpInput);
    const lines = fullText.split("\n");
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines.length) {
      toast.error(`מספר שורה לא תקין (1-${lines.length})`);
      return;
    }

    const viewport = infoScrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) return;

    const ratio = lines.length <= 1 ? 0 : (lineNumber - 1) / (lines.length - 1);
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    viewport.scrollTo({ top: Math.round(maxScrollTop * ratio), behavior: 'smooth' });
    toast.success(`מעבר לשורה ${lineNumber}`);
  }, [fullText, lineJumpInput]);

  // Search logic
  const getSearchableText = useCallback(() => {
    if (!psak) return "";
    const ft = psak.full_text || psak.fullText || "";
    return `${psak.summary || ""}\n${psak.connection || ""}\n${ft}`;
  }, [psak]);

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const text = getSearchableText();
    if (!text) return [];
    let query = searchQuery;
    let flags = 'g';
    if (!caseSensitive) flags += 'i';
    if (wholeWord) query = `\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
    else query = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const regex = new RegExp(query, flags);
      const matches: { index: number; length: number }[] = [];
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push({ index: match.index, length: match[0].length });
        if (matches.length > 500) break;
      }
      return matches;
    } catch {
      return [];
    }
  }, [searchQuery, caseSensitive, wholeWord, getSearchableText]);

  const totalMatches = searchMatches.length;

  useEffect(() => {
    if (totalMatches > 0 && currentMatch >= totalMatches) setCurrentMatch(0);
  }, [totalMatches, currentMatch]);

  useEffect(() => {
    if (showSearch && searchInputRef.current) searchInputRef.current.focus();
  }, [showSearch]);

  useEffect(() => {
    if (!open) { setShowSearch(false); setSearchQuery(""); setCurrentMatch(0); }
  }, [open]);

  useEffect(() => {
    if (!isEditing) {
      setSelectionMenu(null);
      return;
    }
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (!richEditorRef.current?.contains(e.target)) {
        setSelectionMenu(null);
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [isEditing]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setShowSearch(true); }
      if (e.key === 'Escape' && showSearch) { setShowSearch(false); setSearchQuery(""); }
      if (e.key === 'Enter' && showSearch && totalMatches > 0) {
        e.preventDefault();
        setCurrentMatch(prev => e.shiftKey ? (prev - 1 + totalMatches) % totalMatches : (prev + 1) % totalMatches);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, showSearch, totalMatches]);

  useEffect(() => {
    if (!contentRef.current || totalMatches === 0) return;
    const marks = contentRef.current.querySelectorAll('mark[data-current="true"]');
    if (marks.length > 0) marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentMatch, totalMatches, searchQuery]);

  const highlightText = useCallback((text: string): React.ReactNode => {
    if (!searchQuery.trim()) return text;
    let query = searchQuery;
    let flags = 'g';
    if (!caseSensitive) flags += 'i';
    if (wholeWord) query = `\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
    else query = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const regex = new RegExp(`(${query})`, flags);
      const parts = text.split(regex);
      let matchIdx = 0;
      return parts.map((part, i) => {
        const testRegex = new RegExp(query, flags.replace('g', ''));
        if (testRegex.test(part)) {
          const isCurrent = matchIdx === currentMatch;
          matchIdx++;
          return (
            <mark
              key={i}
              data-current={isCurrent ? "true" : "false"}
              className={`rounded px-0.5 transition-colors ${isCurrent ? 'bg-orange-400 text-orange-950 ring-2 ring-orange-500' : 'bg-yellow-200 text-yellow-900 dark:bg-yellow-700 dark:text-yellow-100'}`}
            >
              {part}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      });
    } catch {
      return text;
    }
  }, [searchQuery, caseSensitive, wholeWord, currentMatch]);

  // Guard against null psak — MUST be after all hooks to avoid "Rendered more hooks" error
  if (!psak) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            טוען פסק דין...
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const renderSearchBar = () => {
    if (!showSearch) return null;
    return (
      <div className="flex items-center gap-2 p-2 bg-muted/80 backdrop-blur rounded-lg border border-border mb-2 animate-in slide-in-from-top-2 duration-200" dir="rtl">
        <div className="relative flex-1">
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentMatch(0); }}
            placeholder="חיפוש בטקסט..."
            className="pr-8 h-8 text-sm"
          />
        </div>
        {totalMatches > 0 && (
          <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[60px] text-center">
            {currentMatch + 1} / {totalMatches}
          </span>
        )}
        {searchQuery && totalMatches === 0 && (
          <span className="text-xs text-destructive whitespace-nowrap">לא נמצא</span>
        )}
        <div className="flex items-center gap-0.5">
          <Button variant={caseSensitive ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7"
            onClick={() => { setCaseSensitive(!caseSensitive); setCurrentMatch(0); }} title="רגיש לאותיות גדולות/קטנות">
            <CaseSensitive className="h-3.5 w-3.5" />
          </Button>
          <Button variant={wholeWord ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7"
            onClick={() => { setWholeWord(!wholeWord); setCurrentMatch(0); }} title="מילה שלמה בלבד">
            <WholeWord className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={totalMatches === 0} title="התאמה קודמת"
            onClick={() => setCurrentMatch(prev => (prev - 1 + Math.max(totalMatches, 1)) % Math.max(totalMatches, 1))}>
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={totalMatches === 0} title="התאמה הבאה"
            onClick={() => setCurrentMatch(prev => (prev + 1) % Math.max(totalMatches, 1))}>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowSearch(false); setSearchQuery(""); }}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  };


  const renderTextToolbar = () => (
    <div className="flex items-center gap-1 flex-wrap p-2 bg-muted/50 rounded-lg border mb-2">
      {/* Font Size Controls */}
      <div className="flex items-center gap-1 border-l pl-2 ml-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => updateTextSetting('fontSize', Math.max(10, textSettings.fontSize - 1))}
          title="הקטן גופן"
        >
          <AArrowDown className="h-3 w-3" />
        </Button>
        <span className="text-xs text-muted-foreground w-6 text-center">{textSettings.fontSize}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => updateTextSetting('fontSize', Math.min(32, textSettings.fontSize + 1))}
          title="הגדל גופן"
        >
          <AArrowUp className="h-3 w-3" />
        </Button>
      </div>

      {/* Font Family */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="סוג גופן">
            <Type className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-popover z-50">
          {FONTS.map(font => (
            <DropdownMenuItem
              key={font.value}
              onClick={() => updateTextSetting('fontFamily', font.value)}
              className={`flex items-center gap-2 ${font.value}`}
            >
              <span>{font.label}</span>
              {textSettings.fontFamily === font.value && <span className="text-primary">✓</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Text Alignment */}
      <div className="flex items-center gap-0.5 border-x px-2 mx-1">
        <Button
          variant={textSettings.textAlign === 'right' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => updateTextSetting('textAlign', 'right')}
          title="יישור לימין"
        >
          <AlignRight className="h-3 w-3" />
        </Button>
        <Button
          variant={textSettings.textAlign === 'center' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => updateTextSetting('textAlign', 'center')}
          title="יישור למרכז"
        >
          <AlignCenter className="h-3 w-3" />
        </Button>
        <Button
          variant={textSettings.textAlign === 'left' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => updateTextSetting('textAlign', 'left')}
          title="יישור לשמאל"
        >
          <AlignLeft className="h-3 w-3" />
        </Button>
        <Button
          variant={textSettings.textAlign === 'justify' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => updateTextSetting('textAlign', 'justify')}
          title="יישור משני הצדדים"
        >
          <AlignJustify className="h-3 w-3" />
        </Button>
      </div>

      {/* Bold */}
      <Button
        variant={textSettings.isBold ? 'secondary' : 'ghost'}
        size="icon"
        className="h-7 w-7"
        onClick={() => updateTextSetting('isBold', !textSettings.isBold)}
        title="הדגשה"
      >
        <Bold className="h-3 w-3" />
      </Button>

      {/* Italic */}
      <Button
        variant={textSettings.isItalic ? 'secondary' : 'ghost'}
        size="icon"
        className="h-7 w-7"
        onClick={() => updateTextSetting('isItalic', !textSettings.isItalic)}
        title="נטוי"
      >
        <Italic className="h-3 w-3" />
      </Button>

      {/* Text Color */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="צבע טקסט">
            <Palette className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-36 p-2 bg-popover z-50" align="start">
          <div className="grid grid-cols-3 gap-1">
            {TEXT_COLORS.map(color => (
              <button
                key={color.value}
                onClick={() => updateTextSetting('textColor', color.value)}
                className={`h-7 rounded border flex items-center justify-center ${textSettings.textColor === color.value ? 'ring-2 ring-primary' : ''}`}
                style={{ color: color.color }}
                title={color.label}
              >
                A
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Background Color */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="צבע רקע">
            <Highlighter className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-36 p-2 bg-popover z-50" align="start">
          <div className="grid grid-cols-3 gap-1">
            {BG_COLORS.map(color => (
              <button
                key={color.value}
                onClick={() => updateTextSetting('bgColor', color.value)}
                className={`h-7 rounded border ${textSettings.bgColor === color.value ? 'ring-2 ring-primary' : ''}`}
                style={{ backgroundColor: color.color }}
                title={color.label}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Line numbers */}
      <Button
        variant={textSettings.showLineNumbers ? 'secondary' : 'ghost'}
        size="icon"
        className="h-7 w-7"
        onClick={() => updateTextSetting('showLineNumbers', !textSettings.showLineNumbers)}
        title="מספרי שורות"
      >
        <ListOrdered className="h-3 w-3" />
      </Button>

      {/* Jump to line */}
      <div className="flex items-center gap-1 border-r pr-2 mr-1">
        <Input
          value={lineJumpInput}
          onChange={(e) => setLineJumpInput(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              jumpToLine();
            }
          }}
          placeholder="שורה"
          className="h-7 w-16 text-xs"
          dir="ltr"
        />
        <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={jumpToLine}>
          מעבר
        </Button>
      </div>
    </div>
  );

  if (!psak) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className={`flex flex-col overflow-hidden bg-card border-border ${
          isFullscreen 
            ? 'max-w-[95vw] max-h-[95vh] w-[95vw] h-[95vh]' 
            : 'w-[calc(100vw-0.75rem)] sm:w-full max-w-4xl max-h-[94dvh] sm:max-h-[90vh]'
        }`}
      >
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-start justify-between">
            <DialogTitle className="text-base sm:text-xl font-bold text-foreground text-right flex-1 flex items-center gap-2 justify-end leading-snug">
              <FileTypeBadge url={psak.source_url || psak.sourceUrl} size="sm" />
              {psak.title}
            </DialogTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSearch(!showSearch)}
                title="חיפוש (Ctrl+F)"
              >
                <Search className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsFullscreen(!isFullscreen)}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground mt-2">
            {psak.court && (
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                  <Building2 className="w-3 h-3 text-primary" />
                </div>
                {psak.court}
              </div>
            )}
            {psak.year && (
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                  <Calendar className="w-3 h-3 text-primary" />
                </div>
                {psak.year}
              </div>
            )}
            {caseNumber && (
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                  <FileText className="w-3 h-3 text-primary" />
                </div>
                {caseNumber}
              </div>
            )}
            {psak.source && (
              <Badge variant="outline" className="text-xs">
                {psak.source}
              </Badge>
            )}
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
            <TabsTrigger value="preview" className="gap-2" disabled={!sourceUrl}>
              <Eye className="w-4 h-4" />
              צפייה בקובץ
            </TabsTrigger>
            <TabsTrigger value="info" className="gap-2">
              <FileText className="w-4 h-4" />
              מידע
            </TabsTrigger>
            <TabsTrigger value="beautified" className="gap-2">
              <Sparkles className="w-4 h-4" />
              מעוצב
            </TabsTrigger>
          </TabsList>

          {renderSearchBar()}

          <TabsContent value="info" className="flex-1 min-h-0 mt-4 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              {!isEditing ? renderTextToolbar() : <div />}
              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelEdit}
                      disabled={isSaving}
                      className="gap-1"
                    >
                      <X className="w-4 h-4" />
                      ביטול
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={isSaving}
                      className="gap-1"
                    >
                      <Save className="w-4 h-4" />
                      {isSaving ? "שומר..." : "שמור"}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                    className="gap-1"
                    disabled={!psak.id}
                  >
                    <Edit className="w-4 h-4" />
                    עריכה
                  </Button>
                )}
              </div>
            </div>
            <ScrollArea ref={infoScrollAreaRef} className="flex-1 min-h-0 border border-border rounded-lg">
              <div 
                ref={contentRef}
                className={`p-4 space-y-4 ${isEditing ? '' : textClasses}`} 
                dir="rtl"
                style={{ fontSize: isEditing ? undefined : `${textSettings.fontSize}px` }}
              >
                {isEditing ? (
                  <>
                    {/* Edit Mode */}
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>כותרת</Label>
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="כותרת פסק הדין"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>בית דין</Label>
                          <Input
                            value={editCourt}
                            onChange={(e) => setEditCourt(e.target.value)}
                            placeholder="שם בית הדין"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>שנה</Label>
                          <Input
                            type="number"
                            value={editYear}
                            onChange={(e) => setEditYear(e.target.value ? parseInt(e.target.value) : "")}
                            placeholder="שנת פסק הדין"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>מספר תיק</Label>
                          <Input
                            value={editCaseNumber}
                            onChange={(e) => setEditCaseNumber(e.target.value)}
                            placeholder="מספר התיק"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>תקציר</Label>
                        <Textarea
                          value={editSummary}
                          onChange={(e) => setEditSummary(e.target.value)}
                          placeholder="תקציר פסק הדין"
                          rows={4}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>טקסט מלא</Label>
                          <div className="relative">
                            <div
                              ref={richEditorRef}
                              contentEditable
                              suppressContentEditableWarning
                              dir="rtl"
                              className="min-h-[280px] max-h-[460px] overflow-auto rounded-md border bg-background p-3 text-sm leading-7 font-serif focus:outline-none focus:ring-2 focus:ring-primary/30"
                              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(richHtml) }}
                              onInput={syncRichEditorToState}
                              onMouseUp={handleRichSelection}
                              onKeyUp={handleRichSelection}
                              onBlur={syncRichEditorToState}
                            />

                            {selectionMenu && (
                              <div
                                className="fixed z-50 -translate-x-1/2 -translate-y-full bg-card border rounded-lg shadow-xl p-1.5 flex items-center gap-1"
                                style={{ left: selectionMenu.x, top: selectionMenu.y }}
                              >
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormatCommand('bold')} title="מודגש">
                                  <Bold className="w-3.5 h-3.5" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormatCommand('italic')} title="נטוי">
                                  <Italic className="w-3.5 h-3.5" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormatCommand('underline')} title="קו תחתון">
                                  <Underline className="w-3.5 h-3.5" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormatCommand('hiliteColor', '#fff59d')} title="סימון צהוב">
                                  <Palette className="w-3.5 h-3.5" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormatCommand('removeFormat')} title="נקה עיצוב">
                                  <X className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                      </div>
                      <div className="space-y-2">
                        <Label>תגיות (מופרדות בפסיק)</Label>
                        <Input
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          placeholder="תגית1, תגית2, תגית3"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* View Mode */}
                     <div className="p-3 rounded-lg border bg-muted/20">
                       <h3 className="font-semibold mb-2 flex items-center gap-2 justify-end">
                         <ScrollText className="w-4 h-4 text-primary" />
                         תקציר המקרה
                       </h3>
                       <p className="leading-relaxed whitespace-pre-wrap">{highlightText(psak.summary)}</p>
                     </div>

                     {!!factualCaseText && (
                       <div className="p-3 rounded-lg border bg-primary/5">
                         <h3 className="font-semibold mb-2 flex items-center gap-2 justify-end">
                           <BookOpen className="w-4 h-4 text-primary" />
                           המקרה העובדתי
                         </h3>
                         <p className="leading-relaxed whitespace-pre-wrap">{highlightText(factualCaseText)}</p>
                       </div>
                     )}

                     {psak.connection && (
                       <div className="p-3 rounded-lg border">
                         <h3 className="font-semibold mb-2">קשר לסוגיה</h3>
                         <p className="opacity-80">{highlightText(psak.connection)}</p>
                       </div>
                     )}

                     <div>
                          <h3 className="font-semibold mb-2 flex items-center gap-2 justify-end">
                            <ListOrdered className="w-4 h-4 text-primary" />
                            טקסט מלא
                            <span className="text-[10px] text-muted-foreground font-normal">(ניתן לעריכה)</span>
                          </h3>
                          <div className="relative">
                            <div
                              ref={richEditorRef}
                              contentEditable
                              suppressContentEditableWarning
                              dir="rtl"
                              className="min-h-[200px] max-h-[460px] overflow-auto rounded-md border bg-background p-4 leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/30"
                              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(richHtml) }}
                              onInput={syncRichEditorToState}
                              onMouseUp={handleRichSelection}
                              onKeyUp={handleRichSelection}
                              onBlur={() => { syncRichEditorToState(); autoSaveFullText(); }}
                              style={{ fontSize: `${textSettings.fontSize}px` }}
                            />
                            {selectionMenu && (
                              <div
                                className="fixed z-50 -translate-x-1/2 -translate-y-full bg-card border rounded-lg shadow-xl p-1.5 flex items-center gap-1"
                                style={{ left: selectionMenu.x, top: selectionMenu.y }}
                              >
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormatCommand('bold')} title="מודגש">
                                  <Bold className="w-3.5 h-3.5" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormatCommand('italic')} title="נטוי">
                                  <Italic className="w-3.5 h-3.5" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormatCommand('underline')} title="קו תחתון">
                                  <Underline className="w-3.5 h-3.5" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormatCommand('hiliteColor', '#fff59d')} title="סימון צהוב">
                                  <Palette className="w-3.5 h-3.5" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormatCommand('removeFormat')} title="נקה עיצוב">
                                  <X className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>

                    {psak.tags && psak.tags.length > 0 && (
                      <div>
                        <h3 className="font-semibold mb-2">תגיות</h3>
                        <div className="flex flex-wrap gap-2">
                          {psak.tags.map((tag: string, idx: number) => (
                            <Badge key={idx} variant="secondary" className="bg-muted text-muted-foreground">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="preview" className="flex-1 min-h-0 mt-4">
            {sourceUrl ? (
              <div className="h-full flex flex-col">
                {renderTextToolbar()}
                <div className="flex-1 border border-border rounded-lg overflow-hidden bg-muted/20">
                  {fileType === 'pdf' ? (
                    <iframe
                      src={`${sourceUrl}#toolbar=1&navpanes=1&scrollbar=1`}
                      className="w-full h-full min-h-[320px] sm:min-h-[500px]"
                      title="צפייה בפסק דין"
                    />
                  ) : fileType === 'doc' ? (
                    <iframe
                      src={getPreviewUrl(sourceUrl, fileType)}
                      className="w-full h-full min-h-[320px] sm:min-h-[500px]"
                      title="צפייה בפסק דין"
                    />
                  ) : fileType === 'html' ? (
                    fetchingHtmlPreview ? (
                      <div className="flex items-center justify-center h-full min-h-[320px] sm:min-h-[500px]">
                        <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" />
                      </div>
                    ) : fetchedHtmlPreview ? (
                      <iframe
                        srcDoc={fetchedHtmlPreview}
                        className="w-full h-full min-h-[320px] sm:min-h-[500px]"
                        title="צפייה בפסק דין מעוצב"
                        sandbox="allow-same-origin allow-scripts allow-popups"
                      />
                    ) : (
                      <iframe
                        src={sourceUrl}
                        className="w-full h-full min-h-[320px] sm:min-h-[500px]"
                        title="צפייה בפסק דין מעוצב"
                        sandbox="allow-same-origin allow-scripts"
                      />
                    )
                  ) : fileType === 'txt' ? (
                    <TxtViewer url={sourceUrl} textSettings={textSettings} textClasses={textClasses} />
                  ) : (
                    <iframe
                      src={sourceUrl}
                      className="w-full h-full min-h-[320px] sm:min-h-[500px]"
                      title="צפייה בפסק דין"
                      sandbox="allow-same-origin allow-scripts"
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <FileIcon className="w-16 h-16 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">אין קובץ מצורף</p>
              </div>
            )}
          </TabsContent>

          {/* ═══ BEAUTIFIED TAB ═══ */}
          <TabsContent value="beautified" className="flex-1 min-h-0 mt-4">
            {!beautifiedHtml ? (
              <div className="flex flex-col items-center justify-center h-full p-12 text-center space-y-6">
                <div className="relative">
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[#D4AF37]/20 to-[#0B1F5B]/10 flex items-center justify-center">
                    <Sparkles className="w-12 h-12 text-[#D4AF37]" />
                  </div>
                </div>
                <div className="space-y-2 max-w-md">
                  <h3 className="text-lg font-bold text-foreground">עיצוב פסק דין מקצועי</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    לחץ על הכפתור כדי להפוך את פסק הדין למסמך HTML מעוצב ומקצועי
                    עם חלוקה לסעיפים, כותרות, צבעים ועיצוב משפטי יפה.
                  </p>
                </div>
                <Button
                  size="lg"
                  className="gap-2 bg-gradient-to-l from-[#0B1F5B] to-[#1a3580] text-white border-2 border-[#D4AF37] hover:opacity-90 px-8"
                  onClick={() => void applySelectedTemplate(selectedTemplate)}
                  disabled={isBeautifying}
                >
                  {isBeautifying ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      מעצב את פסק הדין...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      עצב פסק דין ({selectedTemplateInfo.name}) ✨
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="h-full flex flex-col">
                {/* Toolbar */}
                <div className="flex items-center gap-2 mb-2 flex-nowrap overflow-x-auto scrollbar-hide sm:flex-wrap sm:overflow-visible [&>*]:shrink-0">
                  <div className="w-[210px]">
                    <Select value={selectedTemplate} onValueChange={handleTemplateSelection}>
                      <SelectTrigger className="h-8">
                        <SelectValue>
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span>{selectedTemplateInfo.icon}</span>
                            <span>{selectedTemplateInfo.name}</span>
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {TEMPLATES.map(tmpl => (
                          <SelectItem key={tmpl.id} value={tmpl.id}>
                            <span className="inline-flex items-center gap-2">
                              <span>{tmpl.icon}</span>
                              <span>{tmpl.name}</span>
                              {tmpl.requiresAi && <span className="text-[10px] text-muted-foreground">AI</span>}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => void applySelectedTemplate(selectedTemplate)}
                    disabled={isBeautifying}
                  >
                    {isBeautifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    החל מחדש ({selectedTemplateInfo.name})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={handlePrintBeautified}
                  >
                    <Printer className="w-3.5 h-3.5" />
                    הדפס
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      const blob = new Blob([beautifiedHtml], { type: "text/html;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${psak.title || "psak-din"}-מעוצב.html`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success("הקובץ הורד בהצלחה");
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    הורד HTML
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      const win = window.open("", "_blank");
                      if (win) {
                        win.document.write(beautifiedHtml);
                        win.document.close();
                      }
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    פתח בחלון חדש
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      // PDF export via print dialog
                      const iframe = document.createElement("iframe");
                      iframe.style.position = "fixed";
                      iframe.style.left = "-9999px";
                      iframe.style.width = "210mm";
                      iframe.style.height = "297mm";
                      document.body.appendChild(iframe);
                      const doc = iframe.contentDocument || iframe.contentWindow?.document;
                      if (doc) {
                        doc.open();
                        doc.write(beautifiedHtml);
                        doc.close();
                        setTimeout(() => {
                          iframe.contentWindow?.print();
                          setTimeout(() => document.body.removeChild(iframe), 2000);
                        }, 500);
                      }
                      toast.success("חלון הדפסה נפתח — בחר 'שמור כ-PDF'");
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    ייצוא PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={async () => {
                      try {
                        const { generateDocx } = await import('@/lib/docxGenerator');
                        const blob = await generateDocx({
                          title: psak?.title || 'פסק דין',
                          court: psak?.court || 'לא צוין',
                          year: psak?.year || new Date().getFullYear(),
                          case_number: psak?.case_number || psak?.caseNumber,
                          full_text: beautifiedHtml ? stripHtmlToText(beautifiedHtml) : (psak?.full_text || psak?.fullText || psak?.summary),
                          summary: psak?.summary,
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${psak?.title || 'psak-din'}.docx`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast.success('קובץ DOCX הורד בהצלחה');
                      } catch (err) {
                        console.error('DOCX export error:', err);
                        toast.error('שגיאה בייצוא DOCX');
                      }
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    ייצוא WORD
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      const text = beautifiedHtml
                        ? stripHtmlToText(beautifiedHtml)
                        : (psak?.full_text || psak?.fullText || psak?.summary || '');
                      const header = `${psak?.title || ''}\n${'='.repeat(40)}\nבית דין: ${psak?.court || 'לא צוין'}\nשנה: ${psak?.year || ''}\n${psak?.case_number || psak?.caseNumber ? `תיק: ${psak?.case_number || psak?.caseNumber}\n` : ''}${'='.repeat(40)}\n\n`;
                      const blob = new Blob([`\uFEFF${header}${text}`], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${psak?.title || 'psak-din'}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success('קובץ TXT הורד בהצלחה');
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    ייצוא TXT
                  </Button>

                  {/* Save buttons separator */}
                  <div className="w-px h-6 bg-border mx-1" />

                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1 bg-gradient-to-l from-[#0B1F5B] to-[#1a3580] text-white"
                    onClick={handleSaveBeautified}
                    disabled={isSavingBeautified || !psak?.id}
                  >
                    {isSavingBeautified ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    שמור
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 border-[#D4AF37]/50 text-[#0B1F5B]"
                    onClick={handleCopyAndSaveBeautified}
                    disabled={isSavingBeautified}
                  >
                    {isSavingBeautified ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                    העתק ושמור
                  </Button>
                </div>
                {/* Rendered HTML — editable */}
                <div className="flex-1 border border-border rounded-lg overflow-hidden bg-white">
                  <iframe
                    ref={beautifyIframeRef}
                    srcDoc={beautifiedHtml}
                    className="w-full h-full min-h-[320px] sm:min-h-[500px]"
                    title="פסק דין מעוצב"
                    sandbox="allow-same-origin allow-popups"
                    onLoad={() => {
                      const doc = beautifyIframeRef.current?.contentDocument;
                      if (doc?.body) {
                        doc.designMode = "on";
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Actions */}
        <div className="flex-shrink-0 pt-4 border-t border-border flex gap-2 justify-end flex-nowrap overflow-x-auto scrollbar-hide sm:flex-wrap sm:overflow-visible [&>*]:shrink-0">
          {/* Beautify button — always visible */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 bg-gradient-to-l from-[#D4AF37]/10 to-[#D4AF37]/5 border-[#D4AF37]/50 text-[#0B1F5B] hover:bg-[#D4AF37]/20"
            onClick={() => void applySelectedTemplate(selectedTemplate)}
            disabled={isBeautifying}
          >
            {isBeautifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-[#D4AF37]" />}
            {isBeautifying ? "מעצב..." : `עצב פסק דין (${selectedTemplateInfo.name})`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 bg-[#D4AF37]/10 border-[#D4AF37]/40 text-[#0B1F5B] hover:bg-[#D4AF37]/20"
            onClick={() => {
              onOpenChange(false);
              navigate(`/embedpdf-viewer?${sourceUrl ? `url=${encodeURIComponent(sourceUrl)}&` : ''}${psak?.id ? `psakId=${psak.id}` : ''}`);
            }}
          >
            <FileText className="w-4 h-4" />
            פתח ב-EmbedPDF
          </Button>
          {sourceUrl && (
            <>
              <Button
                variant="outline"
                size="sm"
                asChild
                className="gap-2"
              >
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" />
                  פתח בחלון חדש
                </a>
              </Button>
              <Button
                variant="default"
                size="sm"
                asChild
                className="gap-2"
              >
                <a href={sourceUrl} download>
                  <Download className="w-4 h-4" />
                  הורד קובץ
                </a>
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Component for viewing TXT files with text settings
interface TxtViewerProps {
  url: string;
  textSettings: TextSettings;
  textClasses: string;
}

const TxtViewer = ({ url, textSettings, textClasses }: TxtViewerProps) => {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load file');
        return res.text();
      })
      .then(text => {
        setContent(text);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [url]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <p className="text-destructive mb-2">שגיאה בטעינת הקובץ</p>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      {textSettings.showLineNumbers ? (
        <div className="grid grid-cols-[56px_1fr]">
          <div className="bg-muted/30 border-l p-3 text-xs text-muted-foreground font-mono select-none">
            {content?.split("\n").map((_, idx) => (
              <div key={`txt-line-num-${idx}`} className="leading-7 text-left">{idx + 1}</div>
            ))}
          </div>
          <pre
            className={`p-4 whitespace-pre-wrap ${textClasses}`}
            dir="rtl"
            style={{ fontSize: `${textSettings.fontSize}px` }}
          >
            {content}
          </pre>
        </div>
      ) : (
        <pre
          className={`p-4 whitespace-pre-wrap ${textClasses}`}
          dir="rtl"
          style={{ fontSize: `${textSettings.fontSize}px` }}
        >
          {content}
        </pre>
      )}
    </ScrollArea>
  );
};

export default PsakDinViewDialog;