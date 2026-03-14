import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@teamclawai/shared";
import { StatusBadge } from "./StatusBadge";
import { cn, formatDate } from "../lib/utils";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { statusBadge, statusBadgeDefault } from "../lib/status-colors";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, Check, ExternalLink, Github, Loader2, Trash2 } from "lucide-react";
import { ChoosePathButton } from "./PathInstructionsModal";
import { DraftInput } from "./agent-config-primitives";
import { InlineEditor } from "./InlineEditor";

const PROJECT_STATUSES = [
  { value: "backlog", label: "Backlog" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

// TODO(issue-worktree-support): re-enable this UI once the workflow is ready to ship.
const SHOW_EXPERIMENTAL_ISSUE_WORKTREE_UI = false;

interface ProjectPropertiesProps {
  project: Project;
  onUpdate?: (data: Record<string, unknown>) => void;
  onFieldUpdate?: (field: ProjectConfigFieldKey, data: Record<string, unknown>) => void;
  getFieldSaveState?: (field: ProjectConfigFieldKey) => ProjectFieldSaveState;
  onDelete?: () => void;
  deletePending?: boolean;
}

export type ProjectFieldSaveState = "idle" | "saving" | "saved" | "error";
export type ProjectConfigFieldKey =
  | "name"
  | "description"
  | "status"
  | "execution_workspace_enabled"
  | "execution_workspace_default_mode"
  | "execution_workspace_base_ref"
  | "execution_workspace_branch_template"
  | "execution_workspace_worktree_parent_dir"
  | "execution_workspace_provision_command"
  | "execution_workspace_teardown_command";

const REPO_ONLY_CWD_SENTINEL = "/__teamclaw_repo_only__";

function toWorkspacePathSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function SaveIndicator({ state }: { state: ProjectFieldSaveState }) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
        <Check className="h-3 w-3" />
        Saved
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
        <AlertCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return null;
}

function FieldLabel({
  label,
  state,
}: {
  label: string;
  state: ProjectFieldSaveState;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <SaveIndicator state={state} />
    </div>
  );
}

function PropertyRow({
  label,
  children,
  alignStart = false,
  valueClassName = "",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  alignStart?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className={cn("flex gap-3 py-1.5", alignStart ? "items-start" : "items-center")}>
      <div className="shrink-0 w-20">{label}</div>
      <div className={cn("min-w-0 flex-1", alignStart ? "pt-0.5" : "flex items-center gap-1.5", valueClassName)}>
        {children}
      </div>
    </div>
  );
}

function ProjectStatusPicker({ status, onChange }: { status: string; onChange: (status: string) => void }) {
  const [open, setOpen] = useState(false);
  const colorClass = statusBadge[status] ?? statusBadgeDefault;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer hover:opacity-80 transition-opacity",
            colorClass,
          )}
        >
          {status.replace("_", " ")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {PROJECT_STATUSES.map((s) => (
          <Button
            key={s.value}
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start gap-2 text-xs", s.value === status && "bg-accent")}
            onClick={() => {
              onChange(s.value);
              setOpen(false);
            }}
          >
            {s.label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function ProjectProperties({
  project,
  onUpdate,
  onFieldUpdate,
  getFieldSaveState,
  onDelete,
  deletePending = false,
}: ProjectPropertiesProps) {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const [executionWorkspaceAdvancedOpen, setExecutionWorkspaceAdvancedOpen] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"local" | "repo" | null>(null);
  const [workspaceCwd, setWorkspaceCwd] = useState("");
  const [workspaceRepoUrl, setWorkspaceRepoUrl] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const commitField = (field: ProjectConfigFieldKey, data: Record<string, unknown>) => {
    if (onFieldUpdate) {
      onFieldUpdate(field, data);
      return;
    }
    onUpdate?.(data);
  };
  const fieldState = (field: ProjectConfigFieldKey): ProjectFieldSaveState => getFieldSaveState?.(field) ?? "idle";
  const workspaces = project.workspaces ?? [];
  const visibleWorkspaces = workspaces.filter((workspace, index, all) => {
    const signature = `${workspace.cwd ?? ""}::${workspace.repoUrl ?? ""}`;
    return all.findIndex((candidate) => `${candidate.cwd ?? ""}::${candidate.repoUrl ?? ""}` === signature) === index;
  });
  const executionWorkspacePolicy = project.executionWorkspacePolicy ?? null;
  const executionWorkspacesEnabled = executionWorkspacePolicy?.enabled === true;
  const executionWorkspaceDefaultMode =
    executionWorkspacePolicy?.defaultMode === "isolated" ? "isolated" : "project_primary";
  const executionWorkspaceStrategy = executionWorkspacePolicy?.workspaceStrategy ?? {
    type: "git_worktree",
    baseRef: "",
    branchTemplate: "",
    worktreeParentDir: "",
  };
  const defaultWorkspaceCwd = `$HOME/${toWorkspacePathSegment(selectedCompany?.name ?? "", "company")}/projects/${toWorkspacePathSegment(project.name, "project")}`;

  const invalidateProject = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(project.id) });
    if (selectedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(selectedCompanyId) });
    }
  };

  const createWorkspace = useMutation({
    mutationFn: (data: Record<string, unknown>) => projectsApi.createWorkspace(project.id, data),
    onSuccess: () => {
      setWorkspaceCwd("");
      setWorkspaceRepoUrl("");
      setWorkspaceMode(null);
      setWorkspaceError(null);
      invalidateProject();
    },
  });

  const removeWorkspace = useMutation({
    mutationFn: (workspaceId: string) => projectsApi.removeWorkspace(project.id, workspaceId),
    onSuccess: invalidateProject,
  });
  const updateWorkspace = useMutation({
    mutationFn: ({ workspaceId, data }: { workspaceId: string; data: Record<string, unknown> }) =>
      projectsApi.updateWorkspace(project.id, workspaceId, data),
    onSuccess: invalidateProject,
  });

  const updateExecutionWorkspacePolicy = (patch: Record<string, unknown>) => {
    if (!onUpdate && !onFieldUpdate) return;
    return {
      executionWorkspacePolicy: {
        enabled: executionWorkspacesEnabled,
        defaultMode: executionWorkspaceDefaultMode,
        allowIssueOverride: executionWorkspacePolicy?.allowIssueOverride ?? true,
        ...executionWorkspacePolicy,
        ...patch,
      },
    };
  };

  const isAbsolutePath = (value: string) =>
    value.startsWith("/") ||
    value.startsWith("~/") ||
    value === "~" ||
    value.startsWith("$HOME/") ||
    value === "$HOME" ||
    /^[A-Za-z]:[\\/]/.test(value);

  const isGitHubRepoUrl = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      if (host !== "github.com" && host !== "www.github.com") return false;
      const segments = parsed.pathname.split("/").filter(Boolean);
      return segments.length >= 2;
    } catch {
      return /^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/i.test(trimmed);
    }
  };

  const deriveWorkspaceNameFromPath = (value: string) => {
    const normalized = value.trim().replace(/[\\/]+$/, "");
    const segments = normalized.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] ?? "Local folder";
  };

  const deriveWorkspaceNameFromRepo = (value: string) => {
    try {
      const parsed = new URL(value);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const repo = segments[segments.length - 1]?.replace(/\.git$/i, "") ?? "";
      return repo || "GitHub repo";
    } catch {
      const match = value.trim().match(/^git@github\.com:[^/\s]+\/([^/\s]+?)(?:\.git)?$/i);
      return match?.[1] ?? "GitHub repo";
    }
  };

  const formatGitHubRepo = (value: string) => {
    try {
      const parsed = new URL(value);
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length < 2) return value;
      const owner = segments[0];
      const repo = segments[1]?.replace(/\.git$/i, "");
      if (!owner || !repo) return value;
      return `${owner}/${repo}`;
    } catch {
      const match = value.trim().match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
      if (!match) return value;
      return `${match[1]}/${match[2]}`;
    }
  };

  const submitLocalWorkspace = () => {
    const cwd = workspaceCwd.trim() || defaultWorkspaceCwd;
    if (!isAbsolutePath(cwd)) {
      setWorkspaceError("Local folder must be a full absolute path.");
      return;
    }
    setWorkspaceError(null);
    if (cwd !== workspaceCwd) setWorkspaceCwd(cwd);
    createWorkspace.mutate({
      name: deriveWorkspaceNameFromPath(cwd),
      cwd,
    });
  };

  const submitRepoWorkspace = () => {
    const repoUrl = workspaceRepoUrl.trim();
    if (!isGitHubRepoUrl(repoUrl)) {
      setWorkspaceError("Repo workspace must use a valid GitHub HTTPS or SSH remote.");
      return;
    }
    setWorkspaceError(null);
    createWorkspace.mutate({
      name: deriveWorkspaceNameFromRepo(repoUrl),
      cwd: REPO_ONLY_CWD_SENTINEL,
      repoUrl,
    });
  };

  const clearLocalWorkspace = (workspace: Project["workspaces"][number]) => {
    const confirmed = window.confirm(
      workspace.repoUrl
        ? "Clear local folder from this workspace?"
        : "Delete this workspace local folder?",
    );
    if (!confirmed) return;
    if (workspace.repoUrl) {
      updateWorkspace.mutate({
        workspaceId: workspace.id,
        data: { cwd: null },
      });
      return;
    }
    removeWorkspace.mutate(workspace.id);
  };

  const clearRepoWorkspace = (workspace: Project["workspaces"][number]) => {
    const hasLocalFolder = Boolean(workspace.cwd && workspace.cwd !== REPO_ONLY_CWD_SENTINEL);
    const confirmed = window.confirm(
      hasLocalFolder
        ? "Clear GitHub repo from this workspace?"
        : "Delete this workspace repo?",
    );
    if (!confirmed) return;
    if (hasLocalFolder) {
      updateWorkspace.mutate({
        workspaceId: workspace.id,
        data: { repoUrl: null, repoRef: null },
      });
      return;
    }
    removeWorkspace.mutate(workspace.id);
  };

  return (
    <div>
      <div className="space-y-1 pb-4">
        <PropertyRow label={<FieldLabel label="Name" state={fieldState("name")} />}>
          {onUpdate || onFieldUpdate ? (
            <DraftInput
              value={project.name}
              onCommit={(name) => commitField("name", { name })}
              immediate
              className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm outline-none"
              placeholder="Project name"
            />
          ) : (
            <span className="text-sm">{project.name}</span>
          )}
        </PropertyRow>
        <PropertyRow
          label={<FieldLabel label="Description" state={fieldState("description")} />}
          alignStart
          valueClassName="space-y-0.5"
        >
          {onUpdate || onFieldUpdate ? (
            <InlineEditor
              value={project.description ?? ""}
              onSave={(description) => commitField("description", { description })}
              as="p"
              className="text-sm text-muted-foreground"
              placeholder="Add a description..."
              multiline
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {project.description?.trim() || "No description"}
            </p>
          )}
        </PropertyRow>
        <PropertyRow label={<FieldLabel label="Status" state={fieldState("status")} />}>
          {onUpdate || onFieldUpdate ? (
            <ProjectStatusPicker
              status={project.status}
              onChange={(status) => commitField("status", { status })}
            />
          ) : (
            <StatusBadge status={project.status} />
          )}
        </PropertyRow>
        {project.leadAgentId && (
          <PropertyRow label="Lead">
            <span className="text-sm font-mono">{project.leadAgentId.slice(0, 8)}</span>
          </PropertyRow>
        )}
        <PropertyRow label={<FieldLabel label="Created" state="idle" />}>
          <span className="text-sm">{formatDate(project.createdAt)}</span>
        </PropertyRow>
        <PropertyRow label={<FieldLabel label="Updated" state="idle" />}>
          <span className="text-sm">{formatDate(project.updatedAt)}</span>
        </PropertyRow>
        {project.targetDate && (
          <PropertyRow label={<FieldLabel label="Target Date" state="idle" />}>
            <span className="text-sm">{formatDate(project.targetDate)}</span>
          </PropertyRow>
        )}
      </div>

      <Separator className="my-4" />

      <div className="space-y-1 py-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Workspaces</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] text-muted-foreground hover:text-foreground"
                  aria-label="Workspaces help"
                >
                  ?
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Workspaces give your agents hints about where the work is
              </TooltipContent>
            </Tooltip>
          </div>
          {visibleWorkspaces.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
              No workspace configured.
            </p>
          ) : (
            <div className="space-y-1">
              {visibleWorkspaces.map((workspace) => (
                <div key={workspace.id} className="space-y-1">
                  {workspace.cwd && workspace.cwd !== REPO_ONLY_CWD_SENTINEL ? (
                    <div className="flex items-center justify-between gap-2 py-1">
                      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{workspace.cwd}</span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => clearLocalWorkspace(workspace)}
                        aria-label="Delete local folder"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : null}
                  {workspace.repoUrl ? (
                    <div className="flex items-center justify-between gap-2 py-1">
                      <a
                        href={workspace.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <Github className="h-3 w-3 shrink-0" />
                        <span className="truncate">{formatGitHubRepo(workspace.repoUrl)}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => clearRepoWorkspace(workspace)}
                        aria-label="Delete workspace repo"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : null}
                  {workspace.runtimeServices && workspace.runtimeServices.length > 0 ? (
                    <div className="space-y-1 pl-2">
                      {workspace.runtimeServices.map((service) => (
                        <div
                          key={service.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-medium">{service.serviceName}</span>
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                                  service.status === "running"
                                    ? "bg-green-500/15 text-green-700 dark:text-green-300"
                                    : service.status === "failed"
                                      ? "bg-red-500/15 text-red-700 dark:text-red-300"
                                      : "bg-muted text-muted-foreground",
                                )}
                              >
                                {service.status}
                              </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {service.url ? (
                                <a
                                  href={service.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:text-foreground hover:underline"
                                >
                                  {service.url}
                                </a>
                              ) : (
                                service.command ?? "No URL"
                              )}
                            </div>
                          </div>
                          <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {service.lifecycle}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col items-start gap-2">
            <Button
              variant="outline"
              size="xs"
              className="h-7 px-2.5"
              onClick={() => {
                setWorkspaceMode("local");
                setWorkspaceError(null);
              }}
            >
              Add workspace local folder
            </Button>
            <Button
              variant="outline"
              size="xs"
              className="h-7 px-2.5"
              onClick={() => {
                setWorkspaceMode("repo");
                setWorkspaceError(null);
              }}
            >
              Add workspace repo
            </Button>
          </div>
          {workspaceMode === "local" && (
            <div className="space-y-1.5 rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <input
                  className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
                  value={workspaceCwd}
                  onChange={(e) => setWorkspaceCwd(e.target.value)}
                  placeholder={defaultWorkspaceCwd}
                />
                <ChoosePathButton />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  className="h-6 px-2"
                  disabled={createWorkspace.isPending}
                  onClick={submitLocalWorkspace}
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 px-2"
                  onClick={() => {
                    setWorkspaceMode(null);
                    setWorkspaceCwd("");
                    setWorkspaceError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {workspaceMode === "repo" && (
            <div className="space-y-1.5 rounded-md border border-border p-2">
              <input
                className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
                value={workspaceRepoUrl}
                onChange={(e) => setWorkspaceRepoUrl(e.target.value)}
                placeholder="https://github.com/org/repo"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  className="h-6 px-2"
                  disabled={!workspaceRepoUrl.trim() || createWorkspace.isPending}
                  onClick={submitRepoWorkspace}
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 px-2"
                  onClick={() => {
                    setWorkspaceMode(null);
                    setWorkspaceRepoUrl("");
                    setWorkspaceError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {workspaceError && (
            <p className="text-xs text-destructive">{workspaceError}</p>
          )}
          {createWorkspace.isError && (
            <p className="text-xs text-destructive">Failed to save workspace.</p>
          )}
          {removeWorkspace.isError && (
            <p className="text-xs text-destructive">Failed to delete workspace.</p>
          )}
          {updateWorkspace.isError && (
            <p className="text-xs text-destructive">Failed to update workspace.</p>
          )}
        </div>

        {SHOW_EXPERIMENTAL_ISSUE_WORKTREE_UI && (
          <>
        <Separator className="my-4" />

        <div className="py-1.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Execution Workspaces</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] text-muted-foreground hover:text-foreground"
                  aria-label="Execution workspaces help"
                >
                  ?
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Project-owned defaults for isolated issue checkouts and execution workspace behavior.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>Enable isolated issue checkouts</span>
                  <SaveIndicator state={fieldState("execution_workspace_enabled")} />
                </div>
                <div className="text-xs text-muted-foreground">
                  Let issues choose between the project’s primary checkout and an isolated execution workspace.
                </div>
              </div>
              {onUpdate || onFieldUpdate ? (
                <button
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                    executionWorkspacesEnabled ? "bg-green-600" : "bg-muted",
                  )}
                  type="button"
                  onClick={() =>
                    commitField(
                      "execution_workspace_enabled",
                      updateExecutionWorkspacePolicy({ enabled: !executionWorkspacesEnabled })!,
                    )}
                >
                  <span
                    className={cn(
                      "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                      executionWorkspacesEnabled ? "translate-x-4.5" : "translate-x-0.5",
                    )}
                  />
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {executionWorkspacesEnabled ? "Enabled" : "Disabled"}
                </span>
              )}
            </div>

            {executionWorkspacesEnabled && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span>New issues default to isolated checkout</span>
                      <SaveIndicator state={fieldState("execution_workspace_default_mode")} />
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      If disabled, new issues stay on the project’s primary checkout unless someone opts in.
                    </div>
                  </div>
                  <button
                    className={cn(
                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                      executionWorkspaceDefaultMode === "isolated" ? "bg-green-600" : "bg-muted",
                    )}
                    type="button"
                    onClick={() =>
                      commitField(
                        "execution_workspace_default_mode",
                        updateExecutionWorkspacePolicy({
                          defaultMode: executionWorkspaceDefaultMode === "isolated" ? "project_primary" : "isolated",
                        })!,
                      )}
                  >
                    <span
                      className={cn(
                        "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                        executionWorkspaceDefaultMode === "isolated" ? "translate-x-4.5" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>

                <div className="border-t border-border/60 pt-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setExecutionWorkspaceAdvancedOpen((open) => !open)}
                  >
                    {executionWorkspaceAdvancedOpen ? "Hide advanced checkout settings" : "Show advanced checkout settings"}
                  </button>
                </div>

                {executionWorkspaceAdvancedOpen && (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground">
                      Host-managed implementation: <span className="text-foreground">Git worktree</span>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1.5">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Base ref</span>
                          <SaveIndicator state={fieldState("execution_workspace_base_ref")} />
                        </label>
                      </div>
                      <DraftInput
                        value={executionWorkspaceStrategy.baseRef ?? ""}
                        onCommit={(value) =>
                          commitField("execution_workspace_base_ref", {
                            ...updateExecutionWorkspacePolicy({
                              workspaceStrategy: {
                                ...executionWorkspaceStrategy,
                                type: "git_worktree",
                                baseRef: value || null,
                              },
                            })!,
                          })}
                        immediate
                        className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
                        placeholder="origin/main"
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1.5">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Branch template</span>
                          <SaveIndicator state={fieldState("execution_workspace_branch_template")} />
                        </label>
                      </div>
                      <DraftInput
                        value={executionWorkspaceStrategy.branchTemplate ?? ""}
                        onCommit={(value) =>
                          commitField("execution_workspace_branch_template", {
                            ...updateExecutionWorkspacePolicy({
                              workspaceStrategy: {
                                ...executionWorkspaceStrategy,
                                type: "git_worktree",
                                branchTemplate: value || null,
                              },
                            })!,
                          })}
                        immediate
                        className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
                        placeholder="{{issue.identifier}}-{{slug}}"
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1.5">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Worktree parent dir</span>
                          <SaveIndicator state={fieldState("execution_workspace_worktree_parent_dir")} />
                        </label>
                      </div>
                      <DraftInput
                        value={executionWorkspaceStrategy.worktreeParentDir ?? ""}
                        onCommit={(value) =>
                          commitField("execution_workspace_worktree_parent_dir", {
                            ...updateExecutionWorkspacePolicy({
                              workspaceStrategy: {
                                ...executionWorkspaceStrategy,
                                type: "git_worktree",
                                worktreeParentDir: value || null,
                              },
                            })!,
                          })}
                        immediate
                        className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
                        placeholder=".teamclaw/worktrees"
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1.5">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Provision command</span>
                          <SaveIndicator state={fieldState("execution_workspace_provision_command")} />
                        </label>
                      </div>
                      <DraftInput
                        value={executionWorkspaceStrategy.provisionCommand ?? ""}
                        onCommit={(value) =>
                          commitField("execution_workspace_provision_command", {
                            ...updateExecutionWorkspacePolicy({
                              workspaceStrategy: {
                                ...executionWorkspaceStrategy,
                                type: "git_worktree",
                                provisionCommand: value || null,
                              },
                            })!,
                          })}
                        immediate
                        className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
                        placeholder="bash ./scripts/provision-worktree.sh"
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1.5">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Teardown command</span>
                          <SaveIndicator state={fieldState("execution_workspace_teardown_command")} />
                        </label>
                      </div>
                      <DraftInput
                        value={executionWorkspaceStrategy.teardownCommand ?? ""}
                        onCommit={(value) =>
                          commitField("execution_workspace_teardown_command", {
                            ...updateExecutionWorkspacePolicy({
                              workspaceStrategy: {
                                ...executionWorkspaceStrategy,
                                type: "git_worktree",
                                teardownCommand: value || null,
                              },
                            })!,
                          })}
                        immediate
                        className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
                        placeholder="bash ./scripts/teardown-worktree.sh"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Provision runs inside the derived worktree before agent execution. Teardown is stored here for
                      future cleanup flows.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
          </>
        )}

        {onDelete ? (
          <>
            <Separator className="my-4" />
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-destructive">Delete Project</div>
                  <p className="text-xs text-muted-foreground">
                    Permanently delete this project and its project workspaces.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deletePending}
                  onClick={onDelete}
                >
                  {deletePending ? "Deleting..." : "Delete Project"}
                </Button>
              </div>
            </div>
          </>
        ) : null}

      </div>
    </div>
  );
}
