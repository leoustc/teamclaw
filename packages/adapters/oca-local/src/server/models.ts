import type { AdapterModel } from "@teamclawai/adapter-utils";
import { asString, runChildProcess } from "@teamclawai/adapter-utils/server-utils";

const CACHE_TTL_MS = 60_000;

let cached: { expiresAt: number; models: AdapterModel[] } | null = null;

function normalizeEnv(input: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function parseModelsOutput(stdout: string): AdapterModel[] {
  const seen = new Set<string>();
  const models: AdapterModel[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const id = line.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: id });
  }
  return models;
}

export async function listOcaModels(): Promise<AdapterModel[]> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.models;

  const command = asString(process.env.TEAMCLAW_OCA_LOCAL_COMMAND, "oca-local");
  let models: AdapterModel[] = [];
  try {
    const result = await runChildProcess(
      `oca-models-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      command,
      ["list-models"],
      {
        cwd: process.cwd(),
        env: normalizeEnv(process.env),
        timeoutSec: 20,
        graceSec: 3,
        onLog: async () => {},
      },
    );
    if (!result.timedOut && (result.exitCode ?? 1) === 0) {
      models = parseModelsOutput(result.stdout);
    }
  } catch {
    models = [];
  }

  cached = {
    expiresAt: now + CACHE_TTL_MS,
    models,
  };
  return models;
}

export async function getPrimaryOcaConfiguredModel(): Promise<AdapterModel | null> {
  const models = await listOcaModels();
  return models[0] ?? null;
}
