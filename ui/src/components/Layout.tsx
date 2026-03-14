import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, LogOut, Moon, Sun, Terminal } from "lucide-react";
import { Outlet, useLocation, useNavigate, useParams } from "@/lib/router";
import { Sidebar } from "./Sidebar";
import { SidebarNavItem } from "./SidebarNavItem";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { PropertiesPanel } from "./PropertiesPanel";
import { CommandPalette } from "./CommandPalette";
import { NewIssueDialog } from "./NewIssueDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewGoalDialog } from "./NewGoalDialog";
import { NewAgentDialog } from "./NewAgentDialog";
import { TerminalOverlay } from "./TerminalOverlay";
import { ToastViewport } from "./ToastViewport";
import { MobileBottomNav } from "./MobileBottomNav";
import { useDialog } from "../context/DialogContext";
import { usePanel } from "../context/PanelContext";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { useTheme } from "../context/ThemeContext";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useCompanyPageMemory } from "../hooks/useCompanyPageMemory";
import { authApi } from "../api/auth";
import { healthApi } from "../api/health";
import { companyRouteKey, normalizeCompanyPrefix } from "../lib/company-routes";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { NotFoundPage } from "../pages/NotFound";
import { Button } from "@/components/ui/button";

export function Layout() {
  const desktopSidebarCollapsedStorageKey = "teamclaw:layout:sidebar-collapsed";
  const DESKTOP_SIDEBAR_WIDTH = 240;
  const DESKTOP_SIDEBAR_COLLAPSED_WIDTH = 72;
  const queryClient = useQueryClient();
  const { sidebarOpen, setSidebarOpen, toggleSidebar, isMobile } = useSidebar();
  const { openNewIssue, openOnboarding, openTerminal } = useDialog();
  const { togglePanelVisible } = usePanel();
  const {
    companies,
    loading: companiesLoading,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId,
  } = useCompany();
  const { theme, toggleTheme } = useTheme();
  const { companyPrefix } = useParams<{ companyPrefix: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const onboardingTriggered = useRef(false);
  const lastMainScrollTop = useRef(0);
  const [mobileNavVisible, setMobileNavVisible] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(desktopSidebarCollapsedStorageKey) === "true";
  });
  const compactSidebarFooter = !isMobile && sidebarCollapsed;
  const nextTheme = theme === "dark" ? "light" : "dark";
  const isExploreRoute = /\/explore$/.test(location.pathname);
  const matchedCompany = useMemo(() => {
    if (!companyPrefix) return null;
    const requestedPrefix = normalizeCompanyPrefix(companyPrefix);
    return companies.find((company) => companyRouteKey(company) === requestedPrefix) ?? null;
  }, [companies, companyPrefix]);
  const hasUnknownCompanyPrefix =
    Boolean(companyPrefix) && !companiesLoading && companies.length > 0 && !matchedCompany;
  const { data: health } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });
  const isAuthenticatedMode = health?.deploymentMode === "authenticated";

  const handleLogout = useCallback(async () => {
    try {
      await authApi.signOut();
    } finally {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      if (isMobile) setSidebarOpen(false);
      navigate("/auth", { replace: true });
    }
  }, [isMobile, navigate, queryClient, setSidebarOpen]);

  useEffect(() => {
    if (companiesLoading || onboardingTriggered.current) return;
    if (companies.length === 0) {
      onboardingTriggered.current = true;
      openOnboarding();
    }
  }, [companies, companiesLoading, openOnboarding]);

  useEffect(() => {
    if (!companyPrefix || companiesLoading || companies.length === 0) return;

    if (!matchedCompany) {
      const fallback = (selectedCompanyId ? companies.find((company) => company.id === selectedCompanyId) : null)
        ?? companies[0]
        ?? null;
      if (fallback && selectedCompanyId !== fallback.id) {
        setSelectedCompanyId(fallback.id, { source: "route_sync" });
      }
      return;
    }

    const canonicalPrefix = companyRouteKey(matchedCompany);
    if (normalizeCompanyPrefix(companyPrefix) !== canonicalPrefix) {
      const suffix = location.pathname.replace(/^\/[^/]+/, "");
      navigate(`/${canonicalPrefix}${suffix}${location.search}`, { replace: true });
      return;
    }

    if (selectedCompanyId !== matchedCompany.id) {
      setSelectedCompanyId(matchedCompany.id, { source: "route_sync" });
    }
  }, [
    companyPrefix,
    companies,
    companiesLoading,
    matchedCompany,
    location.pathname,
    location.search,
    navigate,
    selectedCompanyId,
    setSelectedCompanyId,
  ]);

  const togglePanel = togglePanelVisible;

  // Cmd+1..9 to switch companies
  const switchCompany = useCallback(
    (index: number) => {
      if (index < companies.length) {
        setSelectedCompanyId(companies[index]!.id);
      }
    },
    [companies, setSelectedCompanyId],
  );

  useCompanyPageMemory();

  useKeyboardShortcuts({
    onNewIssue: () => openNewIssue(),
    onToggleSidebar: toggleSidebar,
    onTogglePanel: togglePanel,
    onSwitchCompany: switchCompany,
  });

  useEffect(() => {
    if (!isMobile) {
      setMobileNavVisible(true);
      return;
    }
    lastMainScrollTop.current = 0;
    setMobileNavVisible(true);
  }, [isMobile]);

  useEffect(() => {
    if (typeof window === "undefined" || isMobile) return;
    window.localStorage.setItem(desktopSidebarCollapsedStorageKey, String(sidebarCollapsed));
  }, [desktopSidebarCollapsedStorageKey, isMobile, sidebarCollapsed]);

  // Swipe gesture to open/close sidebar on mobile
  useEffect(() => {
    if (!isMobile) return;

    const EDGE_ZONE = 30; // px from left edge to start open-swipe
    const MIN_DISTANCE = 50; // minimum horizontal swipe distance
    const MAX_VERTICAL = 75; // max vertical drift before we ignore

    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]!;
      startX = t.clientX;
      startY = t.clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]!;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);

      if (dy > MAX_VERTICAL) return; // vertical scroll, ignore

      // Swipe right from left edge → open
      if (!sidebarOpen && startX < EDGE_ZONE && dx > MIN_DISTANCE) {
        setSidebarOpen(true);
        return;
      }

      // Swipe left when open → close
      if (sidebarOpen && dx < -MIN_DISTANCE) {
        setSidebarOpen(false);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [isMobile, sidebarOpen, setSidebarOpen]);

  const handleMainScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      if (!isMobile) return;

      const currentTop = event.currentTarget.scrollTop;
      const delta = currentTop - lastMainScrollTop.current;

      if (currentTop <= 24) {
        setMobileNavVisible(true);
      } else if (delta > 8) {
        setMobileNavVisible(false);
      } else if (delta < -8) {
        setMobileNavVisible(true);
      }

      lastMainScrollTop.current = currentTop;
    },
    [isMobile],
  );

  if (!companiesLoading && companies.length === 0) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-xl rounded-lg border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">Set up your company</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No company could be loaded from the database. Create your first company to continue.
          </p>
          <div className="mt-4">
            <Button onClick={() => openOnboarding()}>Set Up Company</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh bg-background text-foreground overflow-hidden pt-[env(safe-area-inset-top)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to Main Content
      </a>
      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      {/* Sidebar area + utility row */}
      {isMobile ? (
        <div
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden pt-[env(safe-area-inset-top)] transition-transform duration-100 ease-out",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <Sidebar />
          </div>
          <div className="mt-auto border-t border-r border-border bg-background">
            <div className="flex items-center justify-start gap-1 px-2 py-2">
              {isAuthenticatedMode && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleLogout}
                  className="text-muted-foreground shrink-0"
                  aria-label="Logout"
                  title="Logout"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground shrink-0"
                onClick={toggleTheme}
                aria-label={`Switch to ${nextTheme} mode`}
                title={`Switch to ${nextTheme} mode`}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground shrink-0"
                onClick={() => {
                  if (isMobile) setSidebarOpen(false);
                  navigate("design-guide");
                }}
                aria-label="Documentation"
                title="Documentation"
              >
                <BookOpen className="h-4 w-4 shrink-0" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground shrink-0"
                onClick={() => openTerminal()}
                aria-label="Open terminal"
                title="Terminal"
              >
                <Terminal className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex shrink-0 h-full"
          style={{ width: sidebarOpen ? `${sidebarCollapsed ? DESKTOP_SIDEBAR_COLLAPSED_WIDTH : DESKTOP_SIDEBAR_WIDTH}px` : "0px" }}
        >
          <div
            className={cn(
              "flex h-full flex-col overflow-hidden transition-[width] duration-100 ease-out",
              sidebarOpen ? "w-auto" : "w-0"
            )}
            style={{
              width: sidebarOpen
                ? `${sidebarCollapsed ? DESKTOP_SIDEBAR_COLLAPSED_WIDTH : DESKTOP_SIDEBAR_WIDTH}px`
                : "0px",
            }}
          >
            <div className="flex-1 min-h-0 overflow-hidden">
              <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((current) => !current)} />
            </div>
            <div className="mt-auto border-t border-r border-border">
              <div
                className={cn(
                  "px-2 py-2",
                  compactSidebarFooter ? "flex flex-col items-center gap-1" : "flex items-center justify-start gap-1",
                )}
              >
                {isAuthenticatedMode && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleLogout}
                    className="text-muted-foreground shrink-0"
                    aria-label="Logout"
                    title="Logout"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground shrink-0"
                  onClick={toggleTheme}
                  aria-label={`Switch to ${nextTheme} mode`}
                  title={`Switch to ${nextTheme} mode`}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground shrink-0"
                  onClick={() => navigate("design-guide")}
                  aria-label="Documentation"
                  title="Documentation"
                >
                  <BookOpen className="h-4 w-4 shrink-0" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground shrink-0"
                  onClick={() => openTerminal()}
                  aria-label="Open terminal"
                  title="Terminal"
                >
                  <Terminal className="h-4 w-4 shrink-0" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <BreadcrumbBar />
        <div className="flex flex-1 min-h-0">
          <main
            id="main-content"
            tabIndex={-1}
            className={cn(
              "flex-1 overflow-auto",
              isExploreRoute ? "p-0" : "p-4 md:p-6",
              isMobile && "pb-[calc(5rem+env(safe-area-inset-bottom))]",
            )}
            onScroll={handleMainScroll}
          >
            {hasUnknownCompanyPrefix ? (
              <NotFoundPage
                scope="invalid_company_prefix"
                requestedPrefix={companyPrefix ?? selectedCompany?.issuePrefix}
              />
            ) : (
              <Outlet />
            )}
          </main>
          <PropertiesPanel />
        </div>
      </div>
      {isMobile && <MobileBottomNav visible={mobileNavVisible} />}
      <CommandPalette />
      <NewIssueDialog />
      <NewProjectDialog />
      <NewGoalDialog />
      <NewAgentDialog />
      <TerminalOverlay />
      <ToastViewport />
    </div>
  );
}
