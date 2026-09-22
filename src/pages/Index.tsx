import { lazy, Suspense } from "react";
import { useAppContext } from "@/contexts/AppContext";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import PinnedItemsBar from "@/components/PinnedItemsBar";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";

// Lazy-loaded tab components (code splitting)
const SedarimNavigator = lazy(() => import("@/components/SedarimNavigator"));
const PsakDinTab = lazy(() => import("@/components/PsakDinTab"));
const SearchPsakDinTab = lazy(() => import("@/components/SearchPsakDinTab"));
const UploadPsakDinTab = lazy(() => import("@/components/UploadPsakDinTab"));
const DownloadManagerTab = lazy(() => import("@/components/DownloadManagerTab"));
const LearningHistoryTab = lazy(() => import("@/components/LearningHistoryTab"));
const DafYomiTab = lazy(() => import("@/components/DafYomiTab"));
const PsakDinCompareTab = lazy(() => import("@/components/PsakDinCompareTab"));
const KnowledgeGraphTab = lazy(() => import("@/components/KnowledgeGraphTab"));
const GlobalSearchTab = lazy(() => import("@/components/GlobalSearchTab"));
const PdfViewerTab = lazy(() => import("@/components/PdfViewerTab"));
const BulkShasDownload = lazy(() => import("@/components/BulkShasDownload"));
const WeeklyPlannerTab = lazy(() => import("@/components/WeeklyPlannerTab"));
const GlossaryTab = lazy(() => import("@/components/GlossaryTab"));
const ShasHeatmapTab = lazy(() => import("@/components/ShasHeatmapTab"));
const FlashcardsTab = lazy(() => import("@/components/FlashcardsTab"));
const QuizModeTab = lazy(() => import("@/components/QuizModeTab"));
const StatsDashboardTab = lazy(() => import("@/components/StatsDashboardTab"));
const LearningRecommendations = lazy(() => import("@/components/LearningRecommendations"));
const BeautifyPsakDinTab = lazy(() => import("@/components/BeautifyPsakDinTab"));
const OcrTab = lazy(() => import("@/components/OcrTab"));
const SourcesIndexTab = lazy(() => import("@/components/SourcesIndexTab"));
const FolderManagerTab = lazy(() => import("@/components/FolderManagerTab"));

const TabFallback = () => (
  <div className="p-3 md:p-6 space-y-4">
    <Skeleton className="h-8 w-48" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-32 w-full" />
  </div>
);

const Index = () => {
  const { activeTab } = useAppContext();
  const isMobile = useIsMobile();

  // Sync preferences to cloud on login
  useCloudPreferences();

  // On mobile, hide SedarimNavigator when another tab is active to save space
  const showNavigator = !isMobile || activeTab === "gemara";

  return (
    <div className="p-2 md:p-6 space-y-3 md:space-y-4 max-w-full" data-active-tab={activeTab}>
      {/* Pinned & Favorite items bar */}
      {showNavigator && <PinnedItemsBar />}

      {/* Sedarim Navigator - lazy loaded, hidden on mobile when non-gemara tab active */}
      {showNavigator && (
        <SectionErrorBoundary section="ניווט סדרים">
          <Suspense fallback={<Skeleton className="h-32 w-full rounded-xl" />}>
            <SedarimNavigator />
          </Suspense>
        </SectionErrorBoundary>
      )}

      {/* Content cards - only show for non-gemara tabs */}
      {activeTab !== "gemara" && (
        <div className="bg-card rounded-xl md:rounded-2xl shadow-lg border border-border/50 overflow-hidden">
          <SectionErrorBoundary section="תוכן ראשי">
            <Suspense fallback={<TabFallback />}>
              {activeTab === "psak-din" && <PsakDinTab />}
              {activeTab === "search" && <SearchPsakDinTab />}
              {activeTab === "global-search" && <GlobalSearchTab />}
              {activeTab === "upload" && <UploadPsakDinTab />}
              {activeTab === "download" && <DownloadManagerTab />}
              {activeTab === "learning-history" && <LearningHistoryTab />}
              {activeTab === "daf-yomi" && <DafYomiTab />}
              {activeTab === "compare" && <PsakDinCompareTab />}
              {activeTab === "knowledge-graph" && <KnowledgeGraphTab />}
              {activeTab === "pdf-viewer" && <PdfViewerTab />}
              {activeTab === "bulk-shas" && <BulkShasDownload />}
              {activeTab === "weekly-planner" && <WeeklyPlannerTab />}
              {activeTab === "glossary" && <GlossaryTab />}
              {activeTab === "shas-heatmap" && <ShasHeatmapTab />}
              {activeTab === "flashcards" && <FlashcardsTab />}
              {activeTab === "quiz" && <QuizModeTab />}
              {activeTab === "stats" && <StatsDashboardTab />}
              {activeTab === "recommendations" && <LearningRecommendations />}
              {activeTab === "beautify-psak" && <BeautifyPsakDinTab />}
              {activeTab === "ocr" && <OcrTab />}
              {/* שלושת המזהים מובילים לאותו מסך. הישנים נשמרים כדי שמשתמש
                  שהטאב האחרון שלו שמור לא ייפתח מול מסך ריק */}
              {(activeTab === "sources-index" || activeTab === "advanced-index"
                || activeTab === "smart-index") && <SourcesIndexTab />}
              {activeTab === "folders" && <FolderManagerTab />}
            </Suspense>
          </SectionErrorBoundary>
        </div>
      )}
    </div>
  );
};

export default Index;
