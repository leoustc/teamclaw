import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { companiesApi } from "../api/companies";
import { FileExplorer } from "../components/FileExplorer";
import { queryKeys } from "../lib/queryKeys";

export function CompanyExplore() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Explore" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  const rootQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.companies.detail(selectedCompanyId) : ["companies", "none", "detail"],
    queryFn: () => companiesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company to explore files.</p>;
  }

  if (rootQuery.error) {
    return <p className="text-sm text-destructive">{(rootQuery.error as Error).message}</p>;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <FileExplorer
        scopeKey={`company:${selectedCompanyId}`}
        title="Company Files"
        emptyMessage="No files found in the company home directory."
        className="h-full min-h-0 flex-1 w-full"
        loadRoot={() => companiesApi.listFiles(selectedCompanyId)}
        loadChildren={(relativePath) => companiesApi.listFiles(selectedCompanyId, relativePath)}
        loadFileContent={(relativePath) => companiesApi.readFile(selectedCompanyId, relativePath)}
        onCreateEntry={(data) => companiesApi.createFileSystemEntry(selectedCompanyId, data)}
        onRenamePath={(relativePath, newName) => companiesApi.renamePath(selectedCompanyId, relativePath, newName)}
        onSaveFile={(relativePath, content) => companiesApi.writeFile(selectedCompanyId, relativePath, content)}
        onDeleteFile={(relativePath) => companiesApi.deleteFile(selectedCompanyId, relativePath)}
        seamless
      />
    </div>
  );
}
