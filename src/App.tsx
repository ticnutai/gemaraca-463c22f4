import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Suspense, lazy } from "react";
import { ThemeProvider } from "./components/ThemeProvider";
import AppLayout from "./components/AppLayout";
import { AppContextProvider } from "./contexts/AppContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DocumentViewerProvider } from "./components/DocumentViewerProvider";

// Lazy-loaded route pages (code splitting)
const Index = lazy(() => import("./pages/Index"));
const SugyaDetail = lazy(() => import("./pages/SugyaDetail"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const EmbedPdfViewerPage = lazy(() => import("./pages/EmbedPdfViewerPage"));
const ShasManagerPage = lazy(() => import("./pages/ShasManagerPage"));

// Lazy-loaded global overlays — only loaded when actually needed
const SettingsButton = lazy(() => import("./components/SettingsButton").then(m => ({ default: m.SettingsButton })));
const GlobalUploadProgress = lazy(() => import("./components/GlobalUploadProgress"));
const GlobalDownloadProgress = lazy(() => import("./components/GlobalDownloadProgress"));
const GlobalDeleteProgress = lazy(() => import("./components/GlobalDeleteProgress"));
const AiTutorChat = lazy(() => import("./components/AiTutorChat"));
const OfflineIndicator = lazy(() => import("./components/OfflineIndicator"));
const FloatingExplorerPanel = lazy(() => import("./components/FloatingExplorerPanel"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,       // 1 min before data considered stale
      gcTime: 10 * 60 * 1000,  // Keep unused data in memory 10 min (was 5 default)
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppContextProvider>
            <DocumentViewerProvider>
            <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
            <SettingsButton />
            <GlobalUploadProgress />
            <GlobalDownloadProgress />
            <GlobalDeleteProgress />
            <AiTutorChat />
            <OfflineIndicator />
            <FloatingExplorerPanel />
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/" element={<AppLayout><Index /></AppLayout>} />
              <Route path="/sugya/:id" element={<AppLayout><SugyaDetail /></AppLayout>} />
              <Route path="/embedpdf-viewer" element={<EmbedPdfViewerPage />} />
              <Route path="/shas-manager" element={<AppLayout><ShasManagerPage /></AppLayout>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            </DocumentViewerProvider>
          </AppContextProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
