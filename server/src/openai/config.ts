import fs from "node:fs";
import { resolveTeamClawConfigPath } from "../paths.js";

export interface OpenAIAuthConfig {
  apiKeys: string[];
  allowlistedIpCidrs: string[];
}

export interface OpenAIProviderConfig {
  provider: string;
  serviceBaseUrl: string;
  defaultModel: string;
  requestTimeoutMs: number;
  requestRetries: number;
  requestRetryDelayMs: number;
  azureDeployment?: string;
  azureApiVersion?: string;
  apiKey?: string;
}

export interface OpenAIConfig {
  provider: OpenAIProviderConfig;
  auth: OpenAIAuthConfig;
}

interface OpenAIConfigFile {
  provider?: string;
  serviceBaseUrl?: string;
  defaultModel?: string;
  requestTimeoutMs?: number;
  requestRetries?: number;
  requestRetryDelayMs?: number;
  azureDeployment?: string;
  azureApiVersion?: string;
  providerApiKey?: string;
  apiKeys?: string | string[];
  allowlistedIpCidrs?: string | string[];
}

const DEFAULT_PROVIDER = "single";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_SERVICE_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AZURE_API_VERSION = "2024-04-01-preview";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_RETRIES = 1;
const DEFAULT_REQUEST_RETRY_DELAY_MS = 250;

const PROVIDER_ALIASES: Record<string, string> = {
  single: "openai",
  "openai-compatible": "openai",
  openai_compatible: "openai",
  "azure-openai": "azure",
  azure_openai: "azure",
  local: "mock",
};

function normalizeTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeScalar<T>(value: string | undefined, fallback: T): T {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  return (trimmed.length > 0 ? (trimmed as unknown as T) : fallback);
}

function parseNumericEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

function parseNumeric(value: number | string | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string") return parseNumericEnv(value, fallback);
  return fallback;
}

function normalizeProvider(value: string): string {
  return PROVIDER_ALIASES[value.trim().toLowerCase()] ?? value.trim().toLowerCase();
}

function resolveProviderApiKey(
  provider: string,
  env: NodeJS.ProcessEnv,
  fileConfig: OpenAIConfigFile,
): string | undefined {
  if (provider === "mock") return undefined;

  const providerUpper = provider.toUpperCase().replace("-", "_");
  const providerKey = normalizeScalar(env[`${providerUpper}_API_KEY`], "");
  if (providerKey) return providerKey;

  if (provider === "azure") {
    const azureEnvKey = normalizeScalar(env.AZURE_OPENAI_API_KEY, "");
    if (azureEnvKey) return azureEnvKey;
  }

  const openAIFallback = normalizeScalar(env.OPENAI_API_KEY, "");
  if (openAIFallback) return openAIFallback;

  const serviceEnvKey = normalizeScalar(env.SERVICE_API_KEY, "");
  if (serviceEnvKey) return serviceEnvKey;

  if (fileConfig.providerApiKey) return fileConfig.providerApiKey.trim();
  return undefined;
}

function resolveProviderBaseUrl(
  provider: string,
  env: NodeJS.ProcessEnv,
  fileConfig: OpenAIConfigFile,
): string {
  const envProviderBase = provider === "azure"
    ? normalizeScalar(env.AZURE_OPENAI_ENDPOINT, normalizeScalar(env.AZURE_OPENAI_SERVICE_BASE_URL, ""))
    : normalizeScalar(env.SERVICE_BASE_URL, "");
  return normalizeScalar(
    envProviderBase,
    normalizeScalar(fileConfig.serviceBaseUrl, DEFAULT_SERVICE_BASE_URL),
  );
}

function normalizeIp(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.startsWith("::ffff:")) return normalized.slice(7);
  if (normalized.includes("%")) return normalized.split("%")[0] ?? "";
  return normalized;
}

function readOpenAIConfigFile(): OpenAIConfigFile {
  try {
    const configPath = resolveTeamClawConfigPath();
    if (!fs.existsSync(configPath)) return {};
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (raw && typeof raw === "object" && "openai" in raw && raw.openai && typeof raw.openai === "object") {
      return raw.openai as OpenAIConfigFile;
    }
  } catch {
    // Intentionally ignore config read/parse failures and rely on env/defaults.
  }
  return {};
}

export function readOpenAIConfig(env: NodeJS.ProcessEnv = process.env): OpenAIConfig {
  const fileConfig = readOpenAIConfigFile();
  const provider = normalizeProvider(
    normalizeScalar(env.PROVIDER, normalizeScalar(fileConfig.provider, DEFAULT_PROVIDER)),
  );
  const serviceBaseUrl = resolveProviderBaseUrl(provider, env, fileConfig);
  const defaultModel = normalizeScalar(
    env.DEFAULT_MODEL,
    normalizeScalar(fileConfig.defaultModel, DEFAULT_MODEL),
  );
  const requestTimeoutMs = parseNumericEnv(env.SERVICE_TIMEOUT_MS, fileConfig.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const requestRetries = parseNumeric(
    parseNumericEnv(env.OPENAI_REQUEST_RETRIES, fileConfig.requestRetries ?? DEFAULT_REQUEST_RETRIES),
    DEFAULT_REQUEST_RETRIES,
  );
  const requestRetryDelayMs = parseNumeric(
    parseNumericEnv(
      env.OPENAI_REQUEST_RETRY_DELAY_MS,
      fileConfig.requestRetryDelayMs ?? DEFAULT_REQUEST_RETRY_DELAY_MS,
    ),
    DEFAULT_REQUEST_RETRY_DELAY_MS,
  );
  const azureDeployment = normalizeScalar(
    env.AZURE_OPENAI_DEPLOYMENT,
    normalizeScalar(env.AZURE_DEPLOYMENT, normalizeScalar(fileConfig.azureDeployment, "")),
  );
  const azureApiVersion = normalizeScalar(
    env.AZURE_OPENAI_API_VERSION,
    normalizeScalar(env.AZURE_API_VERSION, normalizeScalar(fileConfig.azureApiVersion, DEFAULT_AZURE_API_VERSION)),
  );

  const providerApiKey = resolveProviderApiKey(provider, env, fileConfig);

  const apiKeysFromEnv = normalizeTextList(env.OPENAI_API_KEYS);
  const apiKeysFromFile = normalizeTextList(fileConfig.apiKeys);
  const allowlistedIpCidrsFromEnv = normalizeTextList(env.OPENAI_ANONYMOUS_ALLOWLIST);
  const allowlistedIpCidrsFromFile = normalizeTextList(fileConfig.allowlistedIpCidrs);

  return {
    provider: {
      provider,
      serviceBaseUrl,
      defaultModel,
      requestTimeoutMs,
      requestRetries,
      requestRetryDelayMs,
      azureDeployment: azureDeployment || undefined,
      azureApiVersion: azureApiVersion || undefined,
      apiKey: providerApiKey,
    },
    auth: {
      apiKeys: apiKeysFromEnv.length > 0 ? apiKeysFromEnv : apiKeysFromFile,
      allowlistedIpCidrs: [...allowlistedIpCidrsFromEnv, ...allowlistedIpCidrsFromFile]
        .map(normalizeIp)
        .filter((value) => value.length > 0),
    },
  };
}

export function isIpAllowlisted(allowlistedIpCidrs: string[], ip: string): boolean {
  const normalizedIp = normalizeIp(ip);
  return allowlistedIpCidrs.map(normalizeIp).includes(normalizedIp);
}
