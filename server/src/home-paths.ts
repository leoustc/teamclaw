import os from "node:os";
import path from "node:path";

const DEFAULT_INSTANCE_ID = "default";
const INSTANCE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;
const WORKSPACE_SEGMENT_DELIM_RE = /[^a-z0-9]+/g;
const WORKSPACE_SEGMENT_TRIM_RE = /^-+|-+$/g;

function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolveTeamClawHomeDir(): string {
  const envHome = process.env.TEAMCLAW_HOME?.trim();
  if (envHome) return path.resolve(expandHomePrefix(envHome));
  return path.resolve(os.homedir(), ".teamclaw");
}

export function resolveTeamClawInstanceId(): string {
  const raw = process.env.TEAMCLAW_INSTANCE_ID?.trim() || DEFAULT_INSTANCE_ID;
  if (!INSTANCE_ID_RE.test(raw)) {
    throw new Error(`Invalid TEAMCLAW_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolveTeamClawInstanceRoot(): string {
  return path.resolve(resolveTeamClawHomeDir(), "instances", resolveTeamClawInstanceId());
}

export function resolveDefaultConfigPath(): string {
  return path.resolve(resolveTeamClawInstanceRoot(), "config.json");
}

export function resolveDefaultEmbeddedPostgresDir(): string {
  return path.resolve(resolveTeamClawInstanceRoot(), "db");
}

export function resolveDefaultLogsDir(): string {
  return path.resolve(resolveTeamClawInstanceRoot(), "logs");
}

export function resolveDefaultSecretsKeyFilePath(): string {
  return path.resolve(resolveTeamClawInstanceRoot(), "secrets", "master.key");
}

export function resolveDefaultStorageDir(): string {
  return path.resolve(resolveTeamClawInstanceRoot(), "data", "storage");
}

export function resolveDefaultBackupDir(): string {
  return path.resolve(resolveTeamClawInstanceRoot(), "data", "backups");
}

export function normalizeWorkspacePathSegment(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(WORKSPACE_SEGMENT_DELIM_RE, "-")
    .replace(WORKSPACE_SEGMENT_TRIM_RE, "");
  return normalized.length > 0 ? normalized : fallback;
}

export function resolveDefaultAgentWorkspaceDir(
  companyId: string,
  input: {
    companyName?: string | null;
    agentRole?: string | null;
    agentName?: string | null;
    agentIdFallback?: string | null;
  } = {},
): string {
  const companyTrimmed = companyId.trim();
  const companySegment = normalizeWorkspacePathSegment(input.companyName, companyTrimmed);
  const roleSegment = normalizeWorkspacePathSegment(input.agentRole, "agent");
  const fallbackAgentSegment = PATH_SEGMENT_RE.test((input.agentIdFallback ?? "").trim())
    ? (input.agentIdFallback ?? "").trim()
    : "agent";
  const nameSegment = normalizeWorkspacePathSegment(input.agentName, fallbackAgentSegment);
  return path.resolve(os.homedir(), companySegment, "agents", `${roleSegment}_${nameSegment}`);
}

export function resolveDefaultCompanyWorkspaceDir(companyId: string, companyName?: string | null): string {
  const trimmed = companyId.trim();
  const companySegment = normalizeWorkspacePathSegment(companyName, trimmed);
  return path.resolve(os.homedir(), companySegment, "projects", "default");
}

export function resolveDefaultCompanyHomeDir(companyId: string, companyName?: string | null): string {
  const trimmed = companyId.trim();
  const companySegment = normalizeWorkspacePathSegment(companyName, trimmed);
  return path.resolve(os.homedir(), companySegment);
}

export function resolveDefaultProjectWorkspaceDir(
  companyId: string,
  projectId: string,
  input: {
    companyName?: string | null;
    projectName?: string | null;
  } = {},
): string {
  const companyTrimmed = companyId.trim();
  const projectTrimmed = projectId.trim();
  const companySegment = normalizeWorkspacePathSegment(input.companyName, companyTrimmed);
  const projectSegment = normalizeWorkspacePathSegment(input.projectName, projectTrimmed);
  return path.resolve(os.homedir(), companySegment, "projects", projectSegment);
}

export function resolveLegacyCompanyWorkspaceDir(companyId: string): string {
  const trimmed = companyId.trim();
  if (!PATH_SEGMENT_RE.test(trimmed)) {
    throw new Error(`Invalid company id for workspace path '${companyId}'.`);
  }
  return path.resolve(resolveTeamClawInstanceRoot(), "workspaces", "company", trimmed);
}

export function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}
