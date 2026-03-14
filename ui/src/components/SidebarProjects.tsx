import { useCallback, useMemo, useState } from "react";
import { NavLink, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { authApi } from "../api/auth";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { cn, projectRouteRef } from "../lib/utils";
import { useProjectOrder } from "../hooks/useProjectOrder";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Project } from "@teamclawai/shared";

function SortableProjectItem({
  activeProjectRef,
  collapsed,
  isMobile,
  project,
  setSidebarOpen,
}: {
  activeProjectRef: string | null;
  collapsed: boolean;
  isMobile: boolean;
  project: Project;
  setSidebarOpen: (open: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const routeRef = projectRouteRef(project);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn(isDragging && "opacity-80")}
      {...attributes}
      {...listeners}
    >
      <NavLink
        to={`/projects/${routeRef}/issues`}
        onClick={() => {
          if (isMobile) setSidebarOpen(false);
        }}
        className={cn(
          "flex items-center px-3 py-1.5 text-[13px] font-medium transition-colors",
          collapsed ? "justify-center gap-0" : "gap-2.5",
          activeProjectRef === routeRef || activeProjectRef === project.id
            ? "bg-accent text-foreground"
            : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
        )}
        title={collapsed ? project.name : undefined}
      >
        <span
          className="shrink-0 h-3.5 w-3.5 rounded-sm"
          style={{ backgroundColor: project.color ?? "#6366f1" }}
        />
        {!collapsed ? <span className="flex-1 truncate">{project.name}</span> : null}
      </NavLink>
    </div>
  );
}

export function SidebarProjects({ collapsed = false }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(true);
  const { selectedCompanyId } = useCompany();
  const { openNewProject } = useDialog();
  const { isMobile, setSidebarOpen } = useSidebar();
  const location = useLocation();

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const visibleProjects = useMemo(
    () => (projects ?? []).filter((project: Project) => !project.archivedAt),
    [projects],
  );
  const { orderedProjects, persistOrder } = useProjectOrder({
    projects: visibleProjects,
    companyId: selectedCompanyId,
    userId: currentUserId,
  });

  const projectMatch = location.pathname.match(/^\/(?:[^/]+\/)?projects\/([^/]+)/);
  const activeProjectRef = projectMatch?.[1] ?? null;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const ids = orderedProjects.map((project) => project.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      persistOrder(arrayMove(ids, oldIndex, newIndex));
    },
    [orderedProjects, persistOrder],
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className={cn("flex items-center px-3 py-1.5", collapsed && "justify-center px-2")}>
          <CollapsibleTrigger className={cn("flex items-center gap-1 flex-1 min-w-0", collapsed && "justify-center")}>
            {!collapsed ? (
              <>
                <ChevronRight
                  className={cn(
                    "h-3 w-3 text-muted-foreground/60 transition-transform opacity-0 group-hover:opacity-100",
                    open && "rotate-90"
                  )}
                />
                <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
                  Projects
                </span>
              </>
            ) : (
              <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
                P
              </span>
            )}
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedProjects.map((project) => project.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-0.5 mt-0.5">
              {orderedProjects.map((project: Project) => (
                <SortableProjectItem
                  key={project.id}
                  activeProjectRef={activeProjectRef}
                  collapsed={collapsed}
                  isMobile={isMobile}
                  project={project}
                  setSidebarOpen={setSidebarOpen}
                />
              ))}
              <button
                type="button"
                onClick={openNewProject}
                className={cn(
                  "flex items-center px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
                  collapsed ? "justify-center gap-0" : "gap-2.5",
                )}
                aria-label="New project"
                title="New project"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                {!collapsed ? <span className="truncate">Add Project</span> : null}
              </button>
            </div>
          </SortableContext>
        </DndContext>
      </CollapsibleContent>
    </Collapsible>
  );
}
