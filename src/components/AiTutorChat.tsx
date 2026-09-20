import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MessageCircle, X, Send, Loader2, GripVertical, Bot, User, Trash2,
  History, Plus, BookmarkPlus, Pencil, Check, Copy, Download,
  Search, ChevronRight, RotateCcw, Zap, Sparkles, Clock, Star,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useFloatingPanel, ResizeHandles } from "@/hooks/useFloatingPanel";

// ─── Types ───
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface SavedPrompt {
  id: string;
  label: string;
  text: string;
}

// ─── Storage helpers ───
const CONVERSATIONS_KEY = "ai-tutor-conversations";
const ACTIVE_CONV_KEY = "ai-tutor-active-conv";
const PROMPTS_KEY = "ai-tutor-saved-prompts";

const DEFAULT_PROMPTS: SavedPrompt[] = [
  { id: "dp-1", label: "הסבר סוגיה", text: "הסבר לי את הסוגיה הנוכחית בשפה פשוטה, כולל דעות החולקים ומסקנת הגמרא" },
  { id: "dp-2", label: "מושגים מרכזיים", text: "מהם המושגים המרכזיים בדף הנוכחי? תן הסבר קצר לכל מושג" },
  { id: "dp-3", label: "הלכה למעשה", text: "מה ההלכה למעשה שיוצאת מהסוגיה הזו? ציין את דעות הפוסקים העיקריים" },
  { id: "dp-4", label: "סיכום הדף", text: "תן סיכום קצר ותמציתי של כל הנושאים שנידונים בדף" },
  { id: "dp-5", label: "שאלות לחזרה", text: "צור 5 שאלות לחזרה על החומר שלמדתי, עם תשובות קצרות" },
];

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveConversations(convs: Conversation[]) {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs));
  } catch { /* quota */ }
}

function loadActiveConvId(): string | null {
  try { return localStorage.getItem(ACTIVE_CONV_KEY); } catch { return null; }
}

function saveActiveConvId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_CONV_KEY, id);
    else localStorage.removeItem(ACTIVE_CONV_KEY);
  } catch { /* skip */ }
}

function loadSavedPrompts(): SavedPrompt[] {
  try {
    const raw = localStorage.getItem(PROMPTS_KEY);
    if (!raw) return DEFAULT_PROMPTS;
    const parsed = JSON.parse(raw);
    return parsed.length ? parsed : DEFAULT_PROMPTS;
  } catch { return DEFAULT_PROMPTS; }
}

function persistPrompts(prompts: SavedPrompt[]) {
  try { localStorage.setItem(PROMPTS_KEY, JSON.stringify(prompts)); } catch { /* skip */ }
}

// ─── FAB position persistence (localStorage + Supabase cross-device) ───
const FAB_POS_KEY = "ai-tutor-fab-position";

// The global settings button sits fixed at bottom-6 right-6 (48px). The AI
// button has a higher z-index, so if it lands on that corner it hides the
// settings button completely; keep it just above instead.
const FAB_SIZE = 48;
const SETTINGS_CORNER = 24 + 48 + 8; // offset + button + breathing room

function clampFabPos(pos: { x: number; y: number }): { x: number; y: number } {
  if (typeof window === "undefined") return pos;
  const maxX = Math.max(0, window.innerWidth - 60);
  const maxY = Math.max(0, window.innerHeight - 60);
  const x = Math.min(Math.max(0, pos.x), maxX);
  let y = Math.min(Math.max(0, pos.y), maxY);
  const inSettingsCorner =
    x + FAB_SIZE > window.innerWidth - SETTINGS_CORNER && y + FAB_SIZE > window.innerHeight - SETTINGS_CORNER;
  if (inSettingsCorner) y = Math.max(0, window.innerHeight - SETTINGS_CORNER - FAB_SIZE - 8);
  return { x, y };
}

function loadFabPosLocal(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(FAB_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
      return clampFabPos(parsed);
    }
    return null;
  } catch { return null; }
}

function saveFabPosLocal(pos: { x: number; y: number }) {
  try { localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos)); } catch { /* skip */ }
}

// migrate old single-history format
function migrateOldHistory(): Conversation | null {
  try {
    const raw = localStorage.getItem("ai-tutor-history");
    if (!raw) return null;
    const msgs: ChatMessage[] = JSON.parse(raw);
    if (!msgs.length) return null;
    const conv: Conversation = {
      id: generateId(),
      title: msgs[0]?.content?.slice(0, 40) || "שיחה ישנה",
      messages: msgs,
      createdAt: msgs[0]?.timestamp || Date.now(),
      updatedAt: msgs[msgs.length - 1]?.timestamp || Date.now(),
    };
    localStorage.removeItem("ai-tutor-history");
    return conv;
  } catch { return null; }
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "short" }) + " " + time;
}

type TabView = "chat" | "history" | "prompts";

export default function AiTutorChat() {
  // ─── Conversations state ───
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations();
    const migrated = migrateOldHistory();
    if (migrated) {
      const merged = [migrated, ...loaded];
      saveConversations(merged);
      return merged;
    }
    return loaded;
  });
  const [activeConvId, setActiveConvId] = useState<string | null>(() => {
    const saved = loadActiveConvId();
    if (saved && conversations.some((c) => c.id === saved)) return saved;
    return conversations[0]?.id ?? null;
  });

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeConvId) ?? null,
    [conversations, activeConvId],
  );
  const messages = activeConv?.messages ?? [];

  // ─── Prompts state ───
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(loadSavedPrompts);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editText, setEditText] = useState("");
  const [newPromptMode, setNewPromptMode] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newText, setNewText] = useState("");

  // ─── UI state ───
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
  const [tab, setTab] = useState<TabView>("chat");
  const [historySearch, setHistorySearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // FAB position (persisted to localStorage + Supabase for cross-device sync)
  const [fabPos, setFabPos] = useState(() => {
    const stored = loadFabPosLocal();
    if (stored) return stored;
    return clampFabPos({
      x: typeof window !== "undefined" ? window.innerWidth - 80 : 300,
      y: typeof window !== "undefined" ? window.innerHeight - 80 : 400,
    });
  });
  const [isFabDragging, setIsFabDragging] = useState(false);
  const fabDragOffset = useRef({ x: 0, y: 0 });
  const fabPosLoadedFromCloud = useRef(false);

  const { geo: storedGeo, onDragStart: onPanelDragStart, onResizeStart } = useFloatingPanel("ai-tutor", {
    x: typeof window !== "undefined" ? window.innerWidth - 420 : 200,
    y: typeof window !== "undefined" ? window.innerHeight - 520 : 100,
    width: 400,
    height: 540,
  });
  // A phone has no room for a floating window: the chat takes the whole screen.
  const isMobile = useIsMobile();
  const geo = isMobile
    ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
    : storedGeo;

  // ─── Persist ───
  useEffect(() => { saveConversations(conversations); }, [conversations]);
  useEffect(() => { saveActiveConvId(activeConvId); }, [activeConvId]);
  useEffect(() => { persistPrompts(savedPrompts); }, [savedPrompts]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, tab]);

  // ─── Conversation CRUD ───
  const updateActiveMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConvId
          ? { ...c, messages: updater(c.messages), updatedAt: Date.now(), title: c.title || updater(c.messages)[0]?.content?.slice(0, 40) || "שיחה חדשה" }
          : c,
      ),
    );
  }, [activeConvId]);

  const startNewConversation = useCallback(() => {
    const conv: Conversation = {
      id: generateId(),
      title: "",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveConvId(conv.id);
    setTab("chat");
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) {
      setConversations((prev) => {
        setActiveConvId(prev[0]?.id ?? null);
        return prev;
      });
    }
  }, [activeConvId]);

  const switchConversation = useCallback((id: string) => {
    setActiveConvId(id);
    setTab("chat");
  }, []);

  // ─── Send message ───
  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isLoading) return;

    // ensure we have an active conversation
    let convId = activeConvId;
    if (!convId) {
      const conv: Conversation = {
        id: generateId(),
        title: text.slice(0, 40),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setConversations((prev) => [conv, ...prev]);
      convId = conv.id;
      setActiveConvId(conv.id);
    }

    const userMsg: ChatMessage = { role: "user", content: text, timestamp: Date.now() };

    // update title from first message
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, messages: [...c.messages, userMsg], updatedAt: Date.now(), title: c.title || text.slice(0, 40) }
          : c,
      ),
    );
    setInput("");
    setIsLoading(true);
    setTab("chat");

    const currentMessages = conversations.find((c) => c.id === convId)?.messages ?? [];

    try {
      const activeTab = document.querySelector("[data-active-tab]")?.getAttribute("data-active-tab") || "";
      const pageTitle = document.querySelector("h1")?.textContent || "";

      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      const supabaseUrl = (supabase as any).supabaseUrl ?? (supabase as any).rest?.url?.replace("/rest/v1", "") ?? "";
      const anonKey = (supabase as any).supabaseKey ?? (supabase as any).rest?.headers?.apikey ?? "";

      const res = await fetch(`${supabaseUrl}/functions/v1/ai-tutor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "apikey": anonKey,
        },
        body: JSON.stringify({
          question: text,
          context: { activeTab, pageTitle },
          history: currentMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
      });

      if (!res.ok) throw new Error(`שגיאת שרת: ${res.status}`);
      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream") && res.body) {
        const placeholder: ChatMessage = { role: "assistant", content: "", timestamp: Date.now() };
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, placeholder], updatedAt: Date.now() } : c)),
        );

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") break;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                accumulated += delta;
                const current = accumulated;
                setConversations((prev) =>
                  prev.map((c) => {
                    if (c.id !== convId) return c;
                    const copy = [...c.messages];
                    copy[copy.length - 1] = { ...copy[copy.length - 1], content: current };
                    return { ...c, messages: copy };
                  }),
                );
              }
            } catch { /* skip malformed */ }
          }
        }
        if (!accumulated) {
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
              const copy = [...c.messages];
              copy[copy.length - 1] = { ...copy[copy.length - 1], content: "לא התקבלה תשובה." };
              return { ...c, messages: copy };
            }),
          );
        }
      } else {
        const data = await res.json();
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: data?.answer || "מצטער, לא הצלחתי לעבד את השאלה.",
          timestamp: Date.now(),
        };
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, assistantMsg], updatedAt: Date.now() } : c)),
        );
      }
    } catch (err: unknown) {
      const errMsg: ChatMessage = {
        role: "assistant",
        content: `שגיאה: ${err instanceof Error ? err.message : "לא ניתן להתחבר לשרת"}. נסה שוב מאוחר יותר.`,
        timestamp: Date.now(),
      };
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, errMsg], updatedAt: Date.now() } : c)),
      );
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, activeConvId, conversations]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearCurrentChat = () => {
    if (!activeConvId) return;
    setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, messages: [], updatedAt: Date.now() } : c)));
  };

  const copyMessage = useCallback((idx: number) => {
    const msg = messages[idx];
    if (!msg) return;
    navigator.clipboard.writeText(msg.content);
    setCopiedMsgIdx(idx);
    setTimeout(() => setCopiedMsgIdx(null), 1500);
  }, [messages]);

  const exportConversation = useCallback(() => {
    if (!activeConv) return;
    const text = activeConv.messages.map((m) => `[${m.role === "user" ? "אני" : "AI"}] ${m.content}`).join("\n\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `שיחת-AI-${activeConv.title || "ללא-שם"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeConv]);

  // ─── Prompt CRUD ───
  const startEditPrompt = (p: SavedPrompt) => {
    setEditingPromptId(p.id);
    setEditLabel(p.label);
    setEditText(p.text);
  };
  const saveEditPrompt = () => {
    if (!editingPromptId || !editLabel.trim() || !editText.trim()) return;
    setSavedPrompts((prev) => prev.map((p) => (p.id === editingPromptId ? { ...p, label: editLabel.trim(), text: editText.trim() } : p)));
    setEditingPromptId(null);
  };
  const deletePrompt = (id: string) => {
    setSavedPrompts((prev) => prev.filter((p) => p.id !== id));
  };
  const addNewPrompt = () => {
    if (!newLabel.trim() || !newText.trim()) return;
    setSavedPrompts((prev) => [...prev, { id: generateId(), label: newLabel.trim(), text: newText.trim() }]);
    setNewLabel("");
    setNewText("");
    setNewPromptMode(false);
  };
  const resetPrompts = () => {
    setSavedPrompts(DEFAULT_PROMPTS);
  };
  const usePrompt = (text: string) => {
    setInput(text);
    setTab("chat");
  };

  // ─── History filtering ───
  const filteredConversations = useMemo(() => {
    if (!historySearch.trim()) return conversations;
    const q = historySearch.trim().toLowerCase();
    return conversations.filter(
      (c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [conversations, historySearch]);

  // ─── FAB drag ───
  const handleFabMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsFabDragging(true);
    fabDragOffset.current = { x: e.clientX - fabPos.x, y: e.clientY - fabPos.y };
  }, [fabPos]);

  useEffect(() => {
    if (!isFabDragging) return;
    const onMove = (e: MouseEvent) => setFabPos(clampFabPos({ x: e.clientX - fabDragOffset.current.x, y: e.clientY - fabDragOffset.current.y }));
    const onUp = () => {
      setIsFabDragging(false);
      // Persist final position locally + to Supabase for cross-device sync
      setFabPos((current) => {
        const clamped = clampFabPos(current);
        saveFabPosLocal(clamped);
        // Fire-and-forget cloud sync (only if user is signed in)
        (async () => {
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            await supabase
              .from("user_preferences")
              .upsert(
                { user_id: user.id, ai_fab_position: clamped as unknown as Json },
                { onConflict: "user_id" },
              );
          } catch { /* ignore network errors, localStorage already saved */ }
        })();
        return clamped;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isFabDragging]);

  // Cross-device sync: pull FAB position from Supabase on mount (overrides localStorage if cloud has value)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data, error } = await supabase
          .from("user_preferences")
          .select("ai_fab_position")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error || !data?.ai_fab_position || cancelled) return;
        const cloud = data.ai_fab_position as unknown as { x?: number; y?: number };
        if (typeof cloud?.x === "number" && typeof cloud?.y === "number") {
          const clamped = clampFabPos({ x: cloud.x, y: cloud.y });
          fabPosLoadedFromCloud.current = true;
          setFabPos(clamped);
          saveFabPosLocal(clamped);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Re-clamp on window resize so FAB never sits off-screen
  useEffect(() => {
    const onResize = () => setFabPos((p) => {
      const clamped = clampFabPos(p);
      if (clamped.x !== p.x || clamped.y !== p.y) saveFabPosLocal(clamped);
      return clamped;
    });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const onEsc = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      event.preventDefault();
      setIsOpen(false);
    };

    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [isOpen]);

  const msgCount = conversations.reduce((s, c) => s + c.messages.length, 0);

  return (
    <TooltipProvider delayDuration={300}>
      {/* FAB */}
      <Button
        className="fixed z-[9997] h-12 w-12 rounded-full bg-primary text-primary-foreground border border-accent/70 shadow-lg hover:bg-primary/90 hover:shadow-xl select-none"
        style={{ left: fabPos.x, top: fabPos.y, cursor: isFabDragging ? "grabbing" : "grab" }}
        onMouseDown={handleFabMouseDown}
        onClick={() => { if (!isFabDragging) setIsOpen((v) => !v); }}
        title="מורה AI"
      >
        <MessageCircle className="h-5 w-5" />
        {msgCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-[9px] flex items-center justify-center text-white font-bold">
            {conversations.length}
          </span>
        )}
      </Button>

      {/* Chat Panel */}
      {isOpen && (
        <div
          className={`fixed z-[9996] flex flex-col border border-accent/50 bg-background shadow-2xl select-none overflow-hidden ${isMobile ? "rounded-none" : "rounded-xl"}`}
          style={{ left: geo.x, top: geo.y, width: geo.width, height: geo.height }}
        >
          {!isMobile && <ResizeHandles onResizeStart={onResizeStart} />}

          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2 border-b bg-primary/10 cursor-grab shrink-0"
            onMouseDown={onPanelDragStart}
          >
            <div className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              <Bot className="h-4 w-4 text-accent" />
              <span className="text-sm font-bold">מורה AI</span>
              <Badge variant="secondary" className="text-[10px] px-1.5">בטא</Badge>
            </div>
            <div className="flex items-center gap-0.5">
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={startNewConversation}>
                  <Plus className="h-3 w-3" />
                </Button>
              </TooltipTrigger><TooltipContent side="bottom"><p>שיחה חדשה</p></TooltipContent></Tooltip>

              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={exportConversation} disabled={!messages.length}>
                  <Download className="h-3 w-3" />
                </Button>
              </TooltipTrigger><TooltipContent side="bottom"><p>ייצוא שיחה</p></TooltipContent></Tooltip>

              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearCurrentChat} disabled={!messages.length}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger><TooltipContent side="bottom"><p>נקה שיחה</p></TooltipContent></Tooltip>

              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsOpen(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b shrink-0 bg-muted/30" dir="rtl">
            {([
              { key: "chat" as TabView, icon: MessageCircle, label: "צ'אט" },
              { key: "history" as TabView, icon: History, label: `היסטוריה (${conversations.length})` },
              { key: "prompts" as TabView, icon: Zap, label: "פרומפטים" },
            ]).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.key
                    ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 dark:bg-blue-900/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <t.icon className="h-3 w-3" />
                {t.label}
              </button>
            ))}
          </div>

          {/* ══════════ TAB: Chat ══════════ */}
          {tab === "chat" && (
            <>
              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3" dir="rtl">
                {messages.length === 0 && (
                  <div className="text-center text-muted-foreground py-6">
                    <Bot className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">שלום! אני המורה AI</p>
                    <p className="text-xs mt-1 mb-4">שאל אותי שאלות על הגמרא, ההלכה, או כל נושא תורני</p>
                    {/* Quick prompts */}
                    <div className="space-y-1.5 max-w-[280px] mx-auto">
                      {savedPrompts.slice(0, 3).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => sendMessage(p.text)}
                          className="w-full text-right text-xs px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors flex items-center gap-2"
                        >
                          <Sparkles className="h-3 w-3 text-accent shrink-0" />
                          <span className="truncate">{p.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={`group flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div className={`shrink-0 h-6 w-6 rounded-full flex items-center justify-center mt-0.5 ${
                      msg.role === "user" ? "bg-primary/10" : "bg-accent/10"
                    }`}>
                      {msg.role === "user" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3 text-accent" />}
                    </div>
                    <div className="max-w-[85%] flex flex-col gap-0.5">
                      <div className={`rounded-lg p-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}>
                        {msg.content}
                      </div>
                      <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${
                        msg.role === "user" ? "flex-row-reverse" : ""
                      }`}>
                        <span className="text-[10px] text-muted-foreground">{formatTimestamp(msg.timestamp)}</span>
                        <button onClick={() => copyMessage(i)} className="text-muted-foreground hover:text-foreground" title="העתק">
                          {copiedMsgIdx === i ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-2">
                    <div className="h-6 w-6 rounded-full bg-accent/10 flex items-center justify-center">
                      <Bot className="h-3 w-3 text-accent" />
                    </div>
                    <div className="bg-muted rounded-lg p-2.5 flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
                      <span className="text-xs text-muted-foreground">חושב...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="border-t p-2 shrink-0" dir="rtl">
                <div className="flex gap-2">
                  <Input
                    placeholder="שאל שאלה..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                    className="flex-1 text-sm"
                  />
                  <Button size="icon" onClick={() => sendMessage()} disabled={isLoading || !input.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ══════════ TAB: History ══════════ */}
          {tab === "history" && (
            <div className="flex-1 overflow-y-auto p-2 space-y-1" dir="rtl">
              {/* Search */}
              <div className="relative mb-2">
                <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="חפש בהיסטוריה..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="text-xs pr-8 h-8"
                />
              </div>

              {filteredConversations.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">{historySearch ? "לא נמצאו תוצאות" : "אין שיחות שמורות"}</p>
                </div>
              )}

              {filteredConversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors group ${
                    conv.id === activeConvId
                      ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                      : "hover:bg-muted/70"
                  }`}
                  onClick={() => switchConversation(conv.id)}
                >
                  <MessageCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{conv.title || "שיחה ללא שם"}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">{formatTimestamp(conv.updatedAt)}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">{conv.messages.length} הודעות</Badge>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    title="מחק שיחה"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-400 hover:text-red-600" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ══════════ TAB: Prompts ══════════ */}
          {tab === "prompts" && (
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5" dir="rtl">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground">פרומפטים מהירים</span>
                <div className="flex gap-1">
                  <Tooltip><TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setNewPromptMode(true)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger><TooltipContent side="bottom"><p>הוסף פרומפט</p></TooltipContent></Tooltip>

                  <Tooltip><TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={resetPrompts}>
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger><TooltipContent side="bottom"><p>איפוס לברירת מחדל</p></TooltipContent></Tooltip>
                </div>
              </div>

              {/* New prompt form */}
              {newPromptMode && (
                <div className="border rounded-lg p-2 space-y-1.5 bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800">
                  <Input
                    placeholder="שם הפרומפט..."
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    className="text-xs h-7"
                  />
                  <textarea
                    placeholder="טקסט הפרומפט..."
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    rows={2}
                    className="w-full text-xs border rounded px-2 py-1 resize-none bg-background"
                  />
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setNewPromptMode(false)}>ביטול</Button>
                    <Button size="sm" className="h-6 text-xs" onClick={addNewPrompt} disabled={!newLabel.trim() || !newText.trim()}>שמור</Button>
                  </div>
                </div>
              )}

              {savedPrompts.map((p) => (
                <div key={p.id} className="group border rounded-lg p-2 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                  {editingPromptId === p.id ? (
                    <div className="space-y-1.5">
                      <Input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="text-xs h-7"
                      />
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={2}
                        className="w-full text-xs border rounded px-2 py-1 resize-none bg-background"
                      />
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingPromptId(null)}>ביטול</Button>
                        <Button size="sm" className="h-6 text-xs" onClick={saveEditPrompt}>שמור</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Star className="h-3 w-3 text-amber-500" />
                          <span className="text-xs font-medium">{p.label}</span>
                        </div>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEditPrompt(p)} className="text-muted-foreground hover:text-foreground" title="ערוך">
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button onClick={() => deletePrompt(p.id)} className="text-muted-foreground hover:text-red-500" title="מחק">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{p.text}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] mt-1.5 w-full"
                        onClick={() => usePrompt(p.text)}
                      >
                        <Send className="h-2.5 w-2.5 ml-1" />
                        השתמש בפרומפט
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </TooltipProvider>
  );
}
