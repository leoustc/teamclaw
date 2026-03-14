import {
  Inbox,
  CircleDot,
  LayoutDashboard,
  DollarSign,
  History,
  Search,
  SquarePen,
  Network,
  Settings,
  FolderOpen,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarAgents } from "./SidebarAgents";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";

export function Sidebar({
  collapsed = false,
  onToggleCollapse,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { openNewIssue } = useDialog();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { data: sidebarBadges } = useQuery({
    queryKey: queryKeys.sidebarBadges(selectedCompanyId!),
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });
  const liveRunCount = liveRuns?.length ?? 0;

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  return (
    <aside className="w-full h-full min-h-0 border-r border-border bg-background flex flex-col">
      {/* Top bar: Company name (bold) + Search — aligned with top sections (no visible border) */}
      {collapsed ? (
        <div className="flex shrink-0 flex-col items-center gap-1 px-2 py-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8 shrink-0 rounded-md"
            onClick={onToggleCollapse}
            title={selectedCompany?.name ? `Expand ${selectedCompany.name}` : "Expand sidebar"}
          >
            {selectedCompany?.name ? (
              <div
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-[11px] font-bold uppercase tracking-wide text-foreground"
                style={selectedCompany.brandColor ? { backgroundColor: `${selectedCompany.brandColor}22`, borderColor: selectedCompany.brandColor } : undefined}
              >
                {selectedCompany.name.trim().charAt(0) || "C"}
              </div>
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                C
              </div>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground shrink-0"
            onClick={openSearch}
            title="Search"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1 px-3 h-12 shrink-0">
          {selectedCompany?.brandColor && (
            <div
              className="w-4 h-4 rounded-sm shrink-0 ml-1"
              style={{ backgroundColor: selectedCompany.brandColor }}
            />
          )}
          {onToggleCollapse ? (
            <button
              type="button"
              className="flex flex-1 items-center truncate pl-1 text-left text-sm font-bold uppercase tracking-wider text-foreground"
              onClick={onToggleCollapse}
              title="Collapse sidebar"
            >
              <span className="truncate">{selectedCompany?.name ?? "Select company"}</span>
            </button>
          ) : (
            <span className="flex-1 truncate pl-1 text-sm font-bold uppercase tracking-wider text-foreground">
              {selectedCompany?.name ?? "Select company"}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground shrink-0"
            onClick={openSearch}
            title="Search"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
      )}

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          {/* New Issue button aligned with nav items */}
          <button
            onClick={() => openNewIssue()}
            className={cn(
              "flex items-center px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors",
              collapsed ? "justify-center gap-0" : "gap-2.5",
            )}
            title={collapsed ? "New Issue" : undefined}
          >
            <SquarePen className="h-4 w-4 shrink-0" />
            {!collapsed ? <span className="truncate">New Issue</span> : null}
          </button>
          <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} liveCount={liveRunCount} collapsed={collapsed} />
          <SidebarNavItem
            to="/inbox"
            label="Inbox"
            icon={Inbox}
            badge={sidebarBadges?.inbox}
            badgeTone={sidebarBadges?.failedRuns ? "danger" : "default"}
            alert={(sidebarBadges?.failedRuns ?? 0) > 0}
            collapsed={collapsed}
          />
        </div>

        <SidebarSection label="Work" collapsed={collapsed}>
          <SidebarNavItem to="/issues" label="Issues" icon={CircleDot} collapsed={collapsed} />
        </SidebarSection>

        <SidebarProjects collapsed={collapsed} />

        <SidebarAgents collapsed={collapsed} />

        <SidebarSection label="Company" collapsed={collapsed}>
          <SidebarNavItem to="/explore" label="Explore" icon={FolderOpen} collapsed={collapsed} />
          <SidebarNavItem to="/org" label="Org" icon={Network} collapsed={collapsed} />
          <SidebarNavItem to="/costs" label="Costs" icon={DollarSign} collapsed={collapsed} />
          <SidebarNavItem to="/activity" label="Activity" icon={History} collapsed={collapsed} />
          <SidebarNavItem to="/company/settings" label="Settings" icon={Settings} collapsed={collapsed} />
        </SidebarSection>
      </nav>
    </aside>
  );
}
