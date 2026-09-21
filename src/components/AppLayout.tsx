import { useNavigate, useLocation } from "react-router-dom";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import AppHeader from "./AppHeader";
import { lazy, Suspense } from "react";
import { useAppContext } from "@/contexts/AppContext";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGemaraDownloadEngine } from "@/hooks/useGemaraDownloadEngine";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";

const GemaraDownloadFloat = lazy(() => import("./GemaraDownloadFloat"));


interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayoutInner = ({ children }: AppLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    activeTab, 
    setActiveTab, 
    setSelectedMasechet, 
    isPinned, 
    setIsPinned 
  } = useAppContext();
  const { open: sidebarOpen, setOpen } = useSidebar();
  const isMobile = useIsMobile();

  // Start the background download engine (processes queued jobs)
  useGemaraDownloadEngine();

  // Swipe gestures: swipe from right edge → open sidebar, swipe right → close
  useSwipeGesture({
    onSwipeLeft: () => {
      if (isMobile && !sidebarOpen) setOpen(true);
    },
    onSwipeRight: () => {
      if (isMobile && sidebarOpen) setOpen(false);
    },
    threshold: 50,
    edgeZoneLeft: isMobile ? 50 : undefined,
  });

  const handleTabChange = (tab: string) => {
    if (tab === "embedpdf-viewer" || tab === "pdf-viewer") {
      navigate("/embedpdf-viewer");
      return;
    }
    setActiveTab(tab);
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  const handleMasechetSelect = (masechetHebrewName: string) => {
    setSelectedMasechet(masechetHebrewName);
    setActiveTab("gemara");
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  const handlePinToggle = () => {
    setIsPinned(!(isPinned ?? false));
  };

  const sidebarIsPinned = isPinned ?? false;
  // Reserve margin when pinned OR when unpinned but sidebar is open (hover)
  const shouldReserveSpace = !isMobile && (sidebarIsPinned || sidebarOpen);

  return (
    <div className="min-h-screen flex flex-col w-full bg-background">
      {/* Header - full width, always on top */}
      <AppHeader 
        activeTab={activeTab} 
        onTabChange={handleTabChange}
      />

      {/* Content area below header */}
      <div className="flex-1 flex w-full min-h-0 relative">
        {/* Main content - reflows based on sidebar state */}
        <div className={cn(
          "flex-1 flex flex-col min-w-0 transition-all duration-300",
          shouldReserveSpace ? "md:mr-[--sidebar-width]" : ""
        )}>
          {/* Bottom padding on phones keeps the floating buttons off the last card's actions */}
          <main className="flex-1 pb-24 md:pb-0" style={{
            fontFamily: 'var(--page-font-family, inherit)',
            fontSize: 'var(--page-font-size, inherit)',
            lineHeight: 'var(--page-line-height, inherit)',
          }}>
            {children}
          </main>
        </div>

        {/* Sidebar */}
        <AppSidebar 
          activeTab={activeTab} 
          onTabChange={handleTabChange}
          onMasechetSelect={handleMasechetSelect}
          isPinned={sidebarIsPinned}
          onPinToggle={handlePinToggle}
          isMobile={isMobile}
        />
      </div>

      {/* Gemara Download Progress Float */}
      <Suspense fallback={null}>
        <GemaraDownloadFloat />
      </Suspense>
    </div>
  );
};

const AppLayout = ({ children }: AppLayoutProps) => {
  const { isPinned } = useAppContext();
  const isMobile = useIsMobile();
  const sidebarIsPinned = isPinned ?? false;
  const defaultSidebarOpen = isMobile ? false : sidebarIsPinned;

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <AppLayoutInner>{children}</AppLayoutInner>
    </SidebarProvider>
  );
};

export default AppLayout;
