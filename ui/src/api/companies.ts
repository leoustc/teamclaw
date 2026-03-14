import type {
  Company,
  CompanyPortabilityExportResult,
  CompanyPortabilityImportRequest,
  CompanyPortabilityImportResult,
  CompanyPortabilityPreviewRequest,
  CompanyPortabilityPreviewResult,
} from "@teamclawai/shared";
import { api } from "./client";

export type CompanyStats = Record<string, { agentCount: number; issueCount: number }>;
export type CompanyFileEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number | null;
};
export type CompanyFileListing = {
  rootCwd: string;
  path: string;
  entries: CompanyFileEntry[];
};
export type CompanyFileContent = {
  rootCwd: string;
  path: string;
  content: string;
  truncated: boolean;
};
export type CompanyFileWriteResult = {
  ok: true;
  rootCwd: string;
  path: string;
};

export const companiesApi = {
  list: () => api.get<Company[]>("/companies"),
  get: (companyId: string) => api.get<Company>(`/companies/${companyId}`),
  listFiles: (companyId: string, relativePath = "") =>
    api.get<CompanyFileListing>(
      `/companies/${companyId}/files${relativePath ? `?path=${encodeURIComponent(relativePath)}` : ""}`,
    ),
  createFileSystemEntry: (companyId: string, data: { parentPath?: string; name: string; kind: "file" | "directory" }) =>
    api.post<CompanyFileWriteResult>(`/companies/${companyId}/files`, data),
  readFile: (companyId: string, relativePath: string) =>
    api.get<CompanyFileContent>(`/companies/${companyId}/file-content?path=${encodeURIComponent(relativePath)}`),
  writeFile: (companyId: string, relativePath: string, content: string) =>
    api.patch<CompanyFileWriteResult>(`/companies/${companyId}/file-content`, { path: relativePath, content }),
  renamePath: (companyId: string, relativePath: string, newName: string) =>
    api.patch<CompanyFileWriteResult>(`/companies/${companyId}/file-path`, { path: relativePath, newName }),
  deleteFile: (companyId: string, relativePath: string) =>
    api.delete<CompanyFileWriteResult>(`/companies/${companyId}/file-content?path=${encodeURIComponent(relativePath)}`),
  stats: () => api.get<CompanyStats>("/companies/stats"),
  create: (data: { name: string; description?: string | null; budgetMonthlyCents?: number }) =>
    api.post<Company>("/companies", data),
  update: (
    companyId: string,
    data: Partial<
      Pick<
        Company,
        "name" | "description" | "status" | "budgetMonthlyCents" | "requireBoardApprovalForNewAgents" | "brandColor"
        | "engineerHeadcount"
      >
    >,
  ) => api.patch<Company>(`/companies/${companyId}`, data),
  archive: (companyId: string) => api.post<Company>(`/companies/${companyId}/archive`, {}),
  remove: (companyId: string) => api.delete<{ ok: true }>(`/companies/${companyId}`),
  exportBundle: (companyId: string, data: { include?: { company?: boolean; agents?: boolean } }) =>
    api.post<CompanyPortabilityExportResult>(`/companies/${companyId}/export`, data),
  importPreview: (data: CompanyPortabilityPreviewRequest) =>
    api.post<CompanyPortabilityPreviewResult>("/companies/import/preview", data),
  importBundle: (data: CompanyPortabilityImportRequest) =>
    api.post<CompanyPortabilityImportResult>("/companies/import", data),
};
