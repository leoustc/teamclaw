import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import { ChevronRight, Eye, FileCode2, FilePlus2, Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { MarkdownBody } from "./MarkdownBody";

export type FileEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number | null;
};

export type FileListing = {
  rootCwd: string;
  path: string;
  entries: FileEntry[];
};

export type FileContent = {
  rootCwd: string;
  path: string;
  content: string;
  truncated: boolean;
};

function detectLanguage(filePath: string | null) {
  if (!filePath) return "plaintext";
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx"].includes(ext)) return "typescript";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "javascript";
  if (ext === "json") return "json";
  if (ext === "md") return "markdown";
  if (ext === "css") return "css";
  if (ext === "html") return "html";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "sh") return "shell";
  if (ext === "py") return "python";
  if (ext === "go") return "go";
  if (ext === "rs") return "rust";
  if (ext === "java") return "java";
  if (ext === "sql") return "sql";
  return "plaintext";
}

function FileTreeNode({
  scopeKey,
  entry,
  depth,
  expandedPaths,
  onToggle,
  selectedPath,
  onSelectEntry,
  loadChildren,
  onDeletePath,
}: {
  scopeKey: string;
  entry: FileEntry;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  selectedPath: string | null;
  onSelectEntry: (path: string, kind: FileEntry["kind"]) => void;
  loadChildren: (relativePath: string) => Promise<FileListing>;
  onDeletePath?: (path: string) => void;
}) {
  const isDirectory = entry.kind === "directory";
  const isExpanded = expandedPaths.has(entry.path);
  const childrenQuery = useQuery({
    queryKey: ["file-explorer", scopeKey, "tree", entry.path],
    queryFn: () => loadChildren(entry.path),
    enabled: isDirectory && isExpanded,
  });

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-2 rounded pr-1 text-sm hover:bg-accent/40",
          selectedPath === entry.path && "bg-accent",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => {
            if (isDirectory) {
              onSelectEntry(entry.path, entry.kind);
              onToggle(entry.path);
              return;
            }
            onSelectEntry(entry.path, entry.kind);
          }}
        >
          {isDirectory ? (
            <>
              <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isExpanded && "rotate-90")} />
              {isExpanded ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
            </>
          ) : (
            <>
              <span className="w-3.5 shrink-0" />
              <FileCode2 className="h-4 w-4 shrink-0" />
            </>
          )}
          <span className="truncate">{entry.name}</span>
        </button>
        {onDeletePath ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              const confirmed = window.confirm(
                `Delete "${entry.path}"${isDirectory ? " and all of its contents" : ""}? This cannot be undone.`,
              );
              if (!confirmed) return;
              onDeletePath(entry.path);
            }}
            aria-label={`Delete ${entry.name}`}
            title={`Delete ${entry.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      {isDirectory && isExpanded ? (
        <div>
          {childrenQuery.isLoading ? (
            <div className="px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${depth * 14 + 30}px` }}>
              Loading...
            </div>
          ) : childrenQuery.error ? (
            <div className="px-2 py-1 text-xs text-destructive" style={{ paddingLeft: `${depth * 14 + 30}px` }}>
              {(childrenQuery.error as Error).message}
            </div>
          ) : (
            childrenQuery.data?.entries.map((child) => (
              <FileTreeNode
                key={child.path}
                scopeKey={scopeKey}
                entry={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                selectedPath={selectedPath}
                onSelectEntry={onSelectEntry}
                loadChildren={loadChildren}
                onDeletePath={onDeletePath}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function FileExplorer({
  scopeKey,
  title = "Files",
  emptyMessage,
  loadRoot,
  loadChildren,
  loadFileContent,
  className,
  onSaveFile,
  onDeleteFile,
  onCreateEntry,
  onRenamePath,
  seamless = false,
}: {
  scopeKey: string;
  title?: string;
  emptyMessage: string;
  loadRoot: () => Promise<FileListing>;
  loadChildren: (relativePath: string) => Promise<FileListing>;
  loadFileContent: (relativePath: string) => Promise<FileContent>;
  className?: string;
  onSaveFile?: (relativePath: string, content: string) => Promise<unknown>;
  onDeleteFile?: (relativePath: string) => Promise<unknown>;
  onCreateEntry?: (data: { parentPath?: string; name: string; kind: "file" | "directory" }) => Promise<unknown>;
  onRenamePath?: (relativePath: string, newName: string) => Promise<unknown>;
  seamless?: boolean;
}) {
  const storageKey = `teamclaw:file-explorer:${scopeKey}:tree-width`;
  const queryClient = useQueryClient();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<FileEntry["kind"] | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => (typeof window === "undefined" ? true : window.innerWidth >= 768));
  const [treeWidth, setTreeWidth] = useState(() => {
    if (typeof window === "undefined") return 320;
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? Math.min(520, Math.max(220, parsed)) : 320;
  });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const rootQuery = useQuery({
    queryKey: ["file-explorer", scopeKey, "tree", ""],
    queryFn: loadRoot,
  });

  const selectedFileQuery = useQuery({
    queryKey: ["file-explorer", scopeKey, "file", selectedPath],
    queryFn: () => loadFileContent(selectedPath!),
    enabled: Boolean(selectedPath) && selectedKind === "file",
  });
  const saveFile = useMutation({
    mutationFn: async ({ filePath, content }: { filePath: string; content: string }) => {
      if (!onSaveFile) throw new Error("Saving is not enabled");
      return onSaveFile(filePath, content);
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["file-explorer", scopeKey, "file", variables.filePath] });
    },
  });
  const deleteFile = useMutation({
    mutationFn: async (filePath: string) => {
      if (!onDeleteFile) throw new Error("Delete is not enabled");
      return onDeleteFile(filePath);
    },
    onSuccess: async (_result, deletedPath) => {
      if (selectedPath === deletedPath) {
        setSelectedPath(null);
        setSelectedKind(null);
        setDraftContent("");
      }
      setExpandedPaths((current) => {
        const next = new Set<string>();
        for (const value of current) {
          if (value === deletedPath || value.startsWith(`${deletedPath}/`)) continue;
          next.add(value);
        }
        return next;
      });
      setDraftContent("");
      await queryClient.invalidateQueries({ queryKey: ["file-explorer", scopeKey, "tree"] });
      await queryClient.invalidateQueries({ queryKey: ["file-explorer", scopeKey, "file"] });
    },
  });
  const createEntry = useMutation({
    mutationFn: async (payload: { parentPath?: string; name: string; kind: "file" | "directory" }) => {
      if (!onCreateEntry) throw new Error("Create is not enabled");
      return onCreateEntry(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["file-explorer", scopeKey, "tree"] });
    },
  });
  const renamePath = useMutation({
    mutationFn: async ({ path, newName }: { path: string; newName: string }) => {
      if (!onRenamePath) throw new Error("Rename is not enabled");
      return onRenamePath(path, newName);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["file-explorer", scopeKey, "tree"] });
      await queryClient.invalidateQueries({ queryKey: ["file-explorer", scopeKey, "file"] });
    },
  });

  useEffect(() => {
    setDraftContent(selectedFileQuery.data?.content ?? "");
    saveFile.reset();
    deleteFile.reset();
    createEntry.reset();
    renamePath.reset();
    setMarkdownPreview(false);
  }, [selectedPath, selectedFileQuery.data?.content]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, String(treeWidth));
  }, [storageKey, treeWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const togglePath = (filePath: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const canEdit = Boolean(onSaveFile) && selectedKind === "file" && Boolean(selectedPath) && !selectedFileQuery.data?.truncated;
  const isMarkdownFile = selectedKind === "file" && detectLanguage(selectedPath) === "markdown";
  const selectedDirectoryPath =
    selectedKind === "directory"
      ? selectedPath
      : selectedPath?.includes("/")
        ? selectedPath.slice(0, selectedPath.lastIndexOf("/"))
        : "";
  const hasUnsavedChanges =
    Boolean(selectedPath) && selectedKind === "file"
    && selectedFileQuery.data !== undefined
    && draftContent !== (selectedFileQuery.data?.content ?? "");

  const handleCreateEntry = (kind: "file" | "directory") => {
    if (!onCreateEntry) return;
    const name = window.prompt(kind === "file" ? "New file name" : "New folder name");
    if (!name) return;
    createEntry.mutate({ parentPath: selectedDirectoryPath || "", name, kind });
  };

  const handleRenamePath = () => {
    if (!selectedPath || !onRenamePath) return;
    const currentName = selectedPath.split("/").pop() ?? selectedPath;
    const nextName = window.prompt("Rename path", currentName);
    if (!nextName || nextName === currentName) return;
    renamePath.mutate({ path: selectedPath, newName: nextName });
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "grid min-h-[520px] grid-cols-1 gap-0 md:grid-cols-[320px_minmax(0,1fr)]",
        className,
      )}
      style={isDesktop ? { gridTemplateColumns: `minmax(220px, ${treeWidth}px) 2px minmax(0, 1fr)` } : undefined}
    >
      <div className={cn(
        "flex min-h-0 flex-col md:col-[1]",
        seamless ? "bg-background" : "border-t border-l border-border bg-card md:border-r-0",
      )}>
        <div className={cn(
          "flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground",
          seamless ? "border-b border-border/60 bg-background" : "border-b border-border",
        )}>
          <div className="min-w-0 truncate">
            {title}
            {rootQuery.data?.rootCwd ? <span className="ml-2 font-mono">{rootQuery.data.rootCwd}</span> : null}
          </div>
          {onCreateEntry ? (
            <div className="flex items-center gap-1">
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => handleCreateEntry("file")} title="New file">
                <FilePlus2 className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => handleCreateEntry("directory")} title="New folder">
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {rootQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading files...</p>
          ) : rootQuery.error ? (
            <p className="text-sm text-destructive">{(rootQuery.error as Error).message}</p>
          ) : rootQuery.data && rootQuery.data.entries.length > 0 ? (
            rootQuery.data.entries.map((entry) => (
              <FileTreeNode
                key={entry.path}
                scopeKey={scopeKey}
                entry={entry}
                depth={0}
                expandedPaths={expandedPaths}
                onToggle={togglePath}
                selectedPath={selectedPath}
                onSelectEntry={(path, kind) => {
                  setSelectedPath(path);
                  setSelectedKind(kind);
                }}
                loadChildren={loadChildren}
                onDeletePath={onDeleteFile ? (path) => deleteFile.mutate(path) : undefined}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          )}
        </div>
      </div>

      <div
        className={cn(
          "hidden cursor-col-resize transition-colors hover:bg-border md:block md:col-[2]",
          seamless ? "bg-border/40" : "border-t border-border bg-border/70",
        )}
        onMouseDown={(event) => {
          event.preventDefault();
          const startX = event.clientX;
          const startWidth = treeWidth;
          const maxWidth = Math.min(520, Math.floor((containerRef.current?.getBoundingClientRect().width ?? 900) * 0.6));

          const handleMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            setTreeWidth(Math.min(maxWidth, Math.max(220, startWidth + delta)));
          };

          const handleUp = () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", handleUp);
          };

          window.addEventListener("mousemove", handleMove);
          window.addEventListener("mouseup", handleUp);
        }}
      />

      <div className={cn(
        "flex min-h-0 flex-col md:col-[3]",
        seamless ? "bg-background" : "border-t border-x border-border bg-card",
      )}>
        <div className={cn(
          "flex items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-muted-foreground",
          seamless ? "border-b border-border/60 bg-background" : "border-b border-border",
        )}>
          <span className="truncate">{selectedPath ?? "Select a file or folder"}</span>
          {selectedPath ? (
            <div className="flex items-center gap-2">
              {onRenamePath ? (
                <Button type="button" size="sm" variant="outline" disabled={renamePath.isPending} onClick={handleRenamePath}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Rename
                </Button>
              ) : null}
              {isMarkdownFile ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setMarkdownPreview((current) => !current)}>
                  <Eye className="mr-1 h-3.5 w-3.5" />
                  {markdownPreview ? "Edit" : "Preview"}
                </Button>
              ) : null}
              {onDeleteFile ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={deleteFile.isPending}
                  onClick={() => {
                    if (!selectedPath) return;
                    const confirmed = window.confirm(`Delete "${selectedPath}"? This cannot be undone.`);
                    if (!confirmed) return;
                    deleteFile.mutate(selectedPath);
                  }}
                >
                  {deleteFile.isPending ? "Deleting..." : "Delete"}
                </Button>
              ) : null}
              {selectedKind === "file" && onSaveFile ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canEdit || !hasUnsavedChanges || saveFile.isPending}
                  onClick={() => {
                    if (!selectedPath || !canEdit) return;
                    saveFile.mutate({ filePath: selectedPath, content: draftContent });
                  }}
                >
                  {saveFile.isPending ? "Saving..." : "Save"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {!selectedPath ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              Select a file or folder from the explorer.
            </div>
          ) : selectedKind === "directory" ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              Folder selected. Use the toolbar to create, rename, or delete entries here.
            </div>
          ) : selectedFileQuery.isLoading ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">Loading file...</div>
          ) : selectedFileQuery.error ? (
            <div className="px-4 py-6 text-sm text-destructive">{(selectedFileQuery.error as Error).message}</div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              {selectedFileQuery.data?.truncated ? (
                <div className="px-4 pt-3 text-xs text-muted-foreground">
                  Preview truncated to 256 KB.
                </div>
              ) : null}
              {saveFile.error ? (
                <div className="px-4 pt-3 text-xs text-destructive">
                  {(saveFile.error as Error).message}
                </div>
              ) : null}
              {deleteFile.error ? (
                <div className="px-4 pt-3 text-xs text-destructive">
                  {(deleteFile.error as Error).message}
                </div>
              ) : null}
              {createEntry.error ? (
                <div className="px-4 pt-3 text-xs text-destructive">
                  {(createEntry.error as Error).message}
                </div>
              ) : null}
              {renamePath.error ? (
                <div className="px-4 pt-3 text-xs text-destructive">
                  {(renamePath.error as Error).message}
                </div>
              ) : null}
              {isMarkdownFile && markdownPreview ? (
                <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
                  <MarkdownBody>{draftContent}</MarkdownBody>
                </div>
              ) : (
                <Editor
                  height="100%"
                  path={selectedPath ?? undefined}
                  defaultLanguage="plaintext"
                  language={detectLanguage(selectedPath)}
                  value={draftContent}
                  onChange={(value) => {
                    if (!onSaveFile) return;
                    setDraftContent(value ?? "");
                  }}
                  theme="vs-dark"
                  options={{
                    readOnly: !onSaveFile || selectedFileQuery.data?.truncated,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    wordWrap: isMarkdownFile ? "on" : "off",
                    automaticLayout: true,
                    renderWhitespace: "selection",
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
