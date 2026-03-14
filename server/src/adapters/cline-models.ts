import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterModel } from "./types.js";

const CLINE_GLOBAL_STATE_PATH = path.join(os.homedir(), ".cline", "data", "globalState.json");
const CLINE_MODELS_CACHE_TTL_MS = 60_000;

let cached: { expiresAt: number; models: AdapterModel[] } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeModelId(value: string): string {
  return value.trim();
}

function isLikelyModelId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value);
}

function describeSource(key: string): string {
  if (key.startsWith("actMode")) return "Act default";
  if (key.startsWith("planMode")) return "Plan default";
  return "Configured";
}

function keyPriority(key: string): number {
  if (key.startsWith("actMode")) return 0;
  if (key.startsWith("planMode")) return 1;
  return 2;
}

function extractModelsFromGlobalState(state: Record<string, unknown>): AdapterModel[] {
  const discovered = Object.entries(state)
    .filter(([key, value]) => {
      if (typeof value !== "string") return false;
      if (!/(?:ModelId|ModelName)$/.test(key)) return false;
      const id = sanitizeModelId(value);
      return isLikelyModelId(id);
    })
    .sort(([a], [b]) => keyPriority(a) - keyPriority(b) || a.localeCompare(b));

  const deduped = new Map<string, { id: string; labels: string[] }>();
  for (const [key, rawValue] of discovered) {
    const id = sanitizeModelId(rawValue as string);
    const source = describeSource(key);
    const existing = deduped.get(id);
    if (existing) {
      if (!existing.labels.includes(source)) existing.labels.push(source);
      continue;
    }
    deduped.set(id, {
      id,
      labels: [source],
    });
  }
  return Array.from(deduped.values()).map((entry) => ({
    id: entry.id,
    label: `${entry.labels.join(" + ")}: ${entry.id}`,
  }));
}

async function readClineGlobalState(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(CLINE_GLOBAL_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function listClineModels(): Promise<AdapterModel[]> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.models;
  }

  const state = await readClineGlobalState();
  const models = state ? extractModelsFromGlobalState(state) : [];
  cached = {
    expiresAt: now + CLINE_MODELS_CACHE_TTL_MS,
    models,
  };
  return models;
}

export async function getPrimaryClineConfiguredModel(): Promise<AdapterModel | null> {
  const models = await listClineModels();
  return models[0] ?? null;
}

export function resetClineModelsCacheForTests() {
  cached = null;
}
