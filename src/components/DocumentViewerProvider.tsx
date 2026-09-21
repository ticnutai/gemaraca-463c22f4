/**
 * The one way to open a ruling anywhere in the app.
 *
 * `useDocumentViewer().open(psak)` shows the EmbedPDF viewer page inside a
 * full-screen dialog (the page's `embedded=1` mode, the same way the Gemara
 * scan panel embeds it), so index pages keep their scroll position and
 * filters; "עמוד מלא" navigates to the page itself.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Maximize2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface DocumentRef {
  id: string;
  title?: string | null;
  source_url?: string | null;
}

export interface OpenDocumentOptions {
  /** Open the viewer page itself instead of the dialog. */
  fullPage?: boolean;
  /** Called after the ruling's record was edited inside the viewer. */
  onSaved?: () => void;
}

interface DocumentViewerContextValue {
  open: (doc: DocumentRef, options?: OpenDocumentOptions) => void;
}

const DocumentViewerContext = createContext<DocumentViewerContextValue | null>(null);

/** Message the embedded viewer posts to its parent when the ruling's record changes. */
export const PSAK_UPDATED_MESSAGE = "gemaraca:psak-updated";

export function viewerPath(doc: DocumentRef, embedded: boolean): string {
  const params = new URLSearchParams();
  if (embedded) params.set("embedded", "1");
  if (doc.source_url) params.set("url", doc.source_url);
  if (doc.title) params.set("title", doc.title);
  params.set("psakId", doc.id);
  return `/embedpdf-viewer?${params.toString()}`;
}

export function DocumentViewerProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState<DocumentRef | null>(null);
  const onSavedRef = useRef<(() => void) | undefined>(undefined);

  const open = useCallback((doc: DocumentRef, options?: OpenDocumentOptions) => {
    if (options?.fullPage) {
      navigate(viewerPath(doc, false));
      return;
    }
    onSavedRef.current = options?.onSaved;
    setCurrent(doc);
  }, [navigate]);

  // The embedded page tells us when it saved the ruling, so lists refresh.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== PSAK_UPDATED_MESSAGE) return;
      queryClient.invalidateQueries({ queryKey: ["psakim-for-daf"] });
      queryClient.invalidateQueries({ queryKey: ["psakei-din"] });
      onSavedRef.current?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [queryClient]);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <DocumentViewerContext.Provider value={value}>
      {children}
      <Dialog open={!!current} onOpenChange={(o) => { if (!o) setCurrent(null); }}>
        <DialogContent
          className="p-0 gap-0 w-screen h-[100dvh] max-w-none sm:w-[96vw] sm:h-[94vh] rounded-none sm:rounded-lg flex flex-col overflow-hidden [&>button]:hidden"
          dir="rtl"
        >
          <DialogHeader className="flex-row items-center justify-between gap-2 px-3 py-1.5 border-b border-[#D4AF37]/40 space-y-0 shrink-0">
            <DialogTitle className="text-sm font-bold text-[#0B1F5B] truncate text-right flex-1">
              {current?.title || "פסק דין"}
            </DialogTitle>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                title="פתח בעמוד מלא"
                onClick={() => { const doc = current; setCurrent(null); if (doc) navigate(viewerPath(doc, false)); }}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="סגור" onClick={() => setCurrent(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          {current && (
            <iframe
              key={current.id}
              src={viewerPath(current, true)}
              className="flex-1 w-full border-0 min-h-0"
              title={current.title || "פסק דין"}
              allow="fullscreen"
            />
          )}
        </DialogContent>
      </Dialog>
    </DocumentViewerContext.Provider>
  );
}

export function useDocumentViewer(): DocumentViewerContextValue {
  const ctx = useContext(DocumentViewerContext);
  if (!ctx) throw new Error("useDocumentViewer must be used inside DocumentViewerProvider");
  return ctx;
}
