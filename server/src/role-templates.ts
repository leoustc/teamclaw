import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROLE_TEMPLATE_FILENAMES = ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"] as const;
const AGENT_WORKSPACE_DIRNAMES = ["memory", "notes"] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveBundledRoleTemplateRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "../../roles");
}

export async function seedRoleTemplateFiles(params: {
  role: string | null | undefined;
  cwd: string | null | undefined;
  adapterConfig: Record<string, unknown>;
  instructionsFilePathKey?: string;
  templateRoot?: string;
}): Promise<Record<string, unknown>> {
  const role = params.role?.trim().toLowerCase();
  const cwd = params.cwd?.trim();
  if (!role || !cwd || !path.isAbsolute(cwd)) return params.adapterConfig;

  const roleTemplateDir = path.resolve(params.templateRoot ?? resolveBundledRoleTemplateRoot(), role);
  let templateDirEntries: string[];
  try {
    templateDirEntries = await fs.readdir(roleTemplateDir);
  } catch {
    return params.adapterConfig;
  }

  const templateNames = new Set(templateDirEntries);
  await fs.mkdir(cwd, { recursive: true });
  await Promise.all(
    AGENT_WORKSPACE_DIRNAMES.map((dirname) =>
      fs.mkdir(path.resolve(cwd, dirname), { recursive: true })
    ),
  );

  for (const filename of ROLE_TEMPLATE_FILENAMES) {
    if (!templateNames.has(filename)) continue;
    const sourcePath = path.resolve(roleTemplateDir, filename);
    const targetPath = path.resolve(cwd, filename);
    try {
      await fs.access(targetPath);
    } catch {
      await fs.copyFile(sourcePath, targetPath);
    }
  }

  const instructionsFilePathKey = params.instructionsFilePathKey;
  if (!instructionsFilePathKey || isNonEmptyString(params.adapterConfig[instructionsFilePathKey])) {
    return params.adapterConfig;
  }

  const agentsFilePath = path.resolve(cwd, "AGENTS.md");
  try {
    await fs.access(agentsFilePath);
    return {
      ...params.adapterConfig,
      [instructionsFilePathKey]: agentsFilePath,
    };
  } catch {
    return params.adapterConfig;
  }
}
