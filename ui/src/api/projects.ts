import type { Project, ProjectWorkspace } from "@teamclawai/shared";
import { api } from "./client";

export type ProjectFileEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number | null;
};

export type ProjectFileListing = {
  rootCwd: string;
  path: string;
  entries: ProjectFileEntry[];
};

export type ProjectFileContent = {
  rootCwd: string;
  path: string;
  content: string;
  truncated: boolean;
};

function withCompanyScope(path: string, companyId?: string) {
  if (!companyId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}companyId=${encodeURIComponent(companyId)}`;
}

function projectPath(id: string, companyId?: string, suffix = "") {
  return withCompanyScope(`/projects/${encodeURIComponent(id)}${suffix}`, companyId);
}

export const projectsApi = {
  list: (companyId: string) => api.get<Project[]>(`/companies/${companyId}/projects`),
  get: (id: string, companyId?: string) => api.get<Project>(projectPath(id, companyId)),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Project>(`/companies/${companyId}/projects`, data),
  update: (id: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<Project>(projectPath(id, companyId), data),
  listWorkspaces: (projectId: string, companyId?: string) =>
    api.get<ProjectWorkspace[]>(projectPath(projectId, companyId, "/workspaces")),
  createWorkspace: (projectId: string, data: Record<string, unknown>, companyId?: string) =>
    api.post<ProjectWorkspace>(projectPath(projectId, companyId, "/workspaces"), data),
  listFiles: (projectId: string, relativePath = "", companyId?: string) =>
    api.get<ProjectFileListing>(
      projectPath(
        projectId,
        companyId,
        `/files${relativePath ? `?path=${encodeURIComponent(relativePath)}` : ""}`,
      ),
    ),
  readFile: (projectId: string, relativePath: string, companyId?: string) =>
    api.get<ProjectFileContent>(
      projectPath(projectId, companyId, `/file-content?path=${encodeURIComponent(relativePath)}`),
    ),
  updateWorkspace: (projectId: string, workspaceId: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<ProjectWorkspace>(
      projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`),
      data,
    ),
  removeWorkspace: (projectId: string, workspaceId: string, companyId?: string) =>
    api.delete<ProjectWorkspace>(projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`)),
  remove: (id: string, companyId?: string) => api.delete<Project>(projectPath(id, companyId)),
};
