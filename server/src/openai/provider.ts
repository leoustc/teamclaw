import type { OpenAIProviderConfig } from "./config.js";

export type OpenAIChatRequestFeature =
  | "model"
  | "messages"
  | "stream"
  | "temperature"
  | "stop"
  | "n"
  | "max_tokens"
  | "response_format"
  | "user";

export interface NormalizedChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIProviderRequest {
  model: string;
  messages: NormalizedChatMessage[];
  temperature?: number;
  stop?: string | string[];
  n?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: string;
  user?: string;
}

export interface OpenAIProviderChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: string | null;
}

export interface OpenAIProviderUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIProviderResult {
  id?: string;
  model?: string;
  created?: number;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: unknown;
    };
    text?: unknown;
    finish_reason?: string | null;
  }>;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
    promptTokens?: unknown;
    completionTokens?: unknown;
  } | null;
  system_fingerprint?: string | null;
}

export interface NormalizedOpenAIProviderResult {
  id: string;
  model: string;
  created: number;
  choices: OpenAIProviderChoice[];
  usage: OpenAIProviderUsage;
  system_fingerprint?: string | null;
}

export class OpenAIProviderError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly type: string;
  public readonly param?: string | null;

  constructor(input: {
    status: number;
    code: string;
    type: string;
    message: string;
    param?: string | null;
  }) {
    super(input.message);
    this.status = input.status;
    this.code = input.code;
    this.type = input.type;
    this.param = input.param;
  }
}

export interface OpenAIChatProviderCapabilities {
  supportedRequestFeatures: ReadonlySet<OpenAIChatRequestFeature>;
}

export interface OpenAIChatProvider {
  name: string;
  capabilities: OpenAIChatProviderCapabilities;
  complete(request: OpenAIProviderRequest): Promise<NormalizedOpenAIProviderResult>;
}

export type OpenAIChatProviderFactory = (config: OpenAIProviderConfig) => OpenAIChatProvider;

const REQUEST_FEATURES: OpenAIChatRequestFeature[] = [
  "model",
  "messages",
  "temperature",
  "stop",
  "n",
  "max_tokens",
  "stream",
  "response_format",
  "user",
];

const REQUEST_FEATURE_ERROR_CODE: Record<OpenAIChatRequestFeature, string> = {
  model: "invalid_request_error",
  messages: "invalid_request_error",
  temperature: "unsupported_temperature",
  stop: "unsupported_stop",
  n: "unsupported_n",
  max_tokens: "unsupported_max_tokens",
  stream: "unsupported_stream",
  response_format: "unsupported_response_format",
  user: "unsupported_user",
};

const BASE_PROVIDER_CAPABILITIES: OpenAIChatProviderCapabilities = {
  supportedRequestFeatures: new Set(["model", "messages", "temperature", "stop", "n", "max_tokens", "response_format", "user"]),
};

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(["provider_unavailable", "provider_timeout", "service_error"]);

const DEFAULT_AZURE_API_VERSION = "2024-04-01-preview";
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 250;

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toStringifiedContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseChoiceText(
  choice:
    | {
        message?: {
          role?: string;
          content?: unknown;
        };
        text?: unknown;
      }
    | undefined,
): string {
  if (typeof choice?.message?.content === "string") return choice.message.content;
  if (choice?.message?.content !== undefined) return toStringifiedContent(choice.message.content);
  if (typeof choice?.text === "string") return choice.text;
  if (choice?.text !== undefined) return toStringifiedContent(choice.text);
  return "";
}

function normalizeUsage(raw: OpenAIProviderResult["usage"]): OpenAIProviderUsage {
  const prompt = toNumber(raw?.prompt_tokens) ?? toNumber(raw?.inputTokens) ?? toNumber(raw?.input_tokens) ?? 0;
  const completion =
    toNumber(raw?.completion_tokens) ?? toNumber(raw?.outputTokens) ?? toNumber(raw?.output_tokens) ?? 0;
  const total = toNumber(raw?.total_tokens) ?? prompt + completion;

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

function normalizeResult(raw: OpenAIProviderResult, fallbackModel: string): NormalizedOpenAIProviderResult {
  const rawChoices = Array.isArray(raw.choices) ? raw.choices : [];
  const choices: OpenAIProviderChoice[] = rawChoices.map((choice, index) => ({
    index: typeof choice?.index === "number" ? choice.index : index,
    message: {
      role: "assistant",
      content: parseChoiceText(choice),
    },
    finish_reason: choice.finish_reason ?? null,
  }));

  return {
    id: raw.id?.trim() || `chatcmpl-${fallbackModel}`,
    model: raw.model?.trim() || fallbackModel,
    created: toNumber(raw.created) || Math.floor(Date.now() / 1000),
    choices,
    usage: normalizeUsage(raw.usage as OpenAIProviderResult["usage"]),
    system_fingerprint: raw.system_fingerprint,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parseUpstreamError(body: unknown): { message?: string; code?: string; type?: string; param?: string | null } {
  if (!isObject(body)) return {};

  const rawError = body.error;
  if (!isObject(rawError)) return {};

  const typed = rawError as Record<string, unknown>;
  return {
    message: typeof typed.message === "string" ? typed.message : undefined,
    code: typeof typed.code === "string" ? typed.code : undefined,
    type: typeof typed.type === "string" ? typed.type : undefined,
    param: typeof typed.param === "string" ? typed.param : null,
  };
}

function mapUpstreamStatus(status: number, body: unknown) {
  const upstream = parseUpstreamError(body);

  if (status === 401 || status === 403) {
    return {
      code: upstream.code || "invalid_api_key",
      type: "authentication_error",
      message: upstream.message ?? `Provider authentication failed with HTTP ${status}`,
      param: upstream.param,
    };
  }

  if (status === 404) {
    return {
      code: upstream.code || "model_not_found",
      type: "invalid_request_error",
      message: upstream.message ?? "Requested resource was not found",
      param: upstream.param,
    };
  }

  if (status === 429) {
    return {
      code: upstream.code || "rate_limit_exceeded",
      type: "rate_limit_error",
      message: upstream.message ?? "Request was rate-limited",
      param: upstream.param,
    };
  }

  if (status === 408) {
    return {
      code: upstream.code || "request_timeout",
      type: "timeout_error",
      message: upstream.message ?? "Request timeout from upstream provider",
      param: upstream.param,
    };
  }

  if (status >= 500) {
    return {
      code: upstream.code || "service_error",
      type: upstream.type || "server_error",
      message: upstream.message ?? `Provider returned HTTP ${status}`,
      param: upstream.param,
    };
  }

  return {
    code: upstream.code || "invalid_request_error",
    type: upstream.type || "invalid_request_error",
    message: upstream.message ?? `Provider returned HTTP ${status}`,
    param: upstream.param,
  };
}

function toProviderError(input: {
  status: number;
  code: string;
  type: string;
  message: string;
  param?: string | null;
}): OpenAIProviderError {
  return new OpenAIProviderError(input);
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRequestValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : undefined;
}

function buildOpenAIProviderEndpoint(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed) return `https://api.openai.com/v1/chat/completions`;
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function buildAzureOpenAIEndpoint(base: string, deployment: string, apiVersion: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  const deploymentPath = encodeURIComponent(deployment);
  const version = encodeURIComponent(parseRequestValue(apiVersion) ?? DEFAULT_AZURE_API_VERSION);
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/openai/deployments/${deploymentPath}/chat/completions?api-version=${version}`;
}

function resolveAzureDeployment(config: OpenAIProviderConfig, request: OpenAIProviderRequest): string {
  return (
    parseRequestValue(config.azureDeployment) ||
    parseRequestValue(request.model) ||
    parseRequestValue(config.defaultModel) ||
    "default"
  );
}

function buildOpenAIRequestPayload(request: OpenAIProviderRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.stop === undefined ? {} : { stop: request.stop }),
    ...(request.n === undefined ? {} : { n: request.n }),
    ...(request.max_tokens === undefined ? {} : { max_tokens: request.max_tokens }),
    ...(request.user === undefined ? {} : { user: request.user }),
    ...(request.response_format ? { response_format: { type: request.response_format } } : {}),
    stream: false,
  };
}

function parseJsonPayload(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function resolveRetryPolicy(config: OpenAIProviderConfig) {
  return {
    maxRetries: Math.max(0, Number.isFinite(config.requestRetries) ? Math.floor(config.requestRetries) : DEFAULT_RETRY_COUNT),
    delayMs: Math.max(0, Number.isFinite(config.requestRetryDelayMs) ? Math.floor(config.requestRetryDelayMs) : DEFAULT_RETRY_DELAY_MS),
  };
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function isRetryableError(error: OpenAIProviderError): boolean {
  return isRetryableStatus(error.status) || RETRYABLE_ERROR_CODES.has(error.code);
}

async function postJSONWithRetry(
  endpoint: string,
  request: OpenAIProviderRequest,
  config: OpenAIProviderConfig,
  headers: Record<string, string>,
): Promise<OpenAIProviderResult> {
  const payload = buildOpenAIRequestPayload(request);
  const retryPolicy = resolveRetryPolicy(config);

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const rawPayload = await parseJsonPayload(response);
      if (!response.ok) {
        const mapped = mapUpstreamStatus(response.status, rawPayload);
        const providerError = toProviderError({
          status: response.status,
          code: mapped.code,
          type: mapped.type,
          message: mapped.message,
          param: mapped.param,
        });

        if (isRetryableStatus(response.status) && attempt < retryPolicy.maxRetries) {
          attempt += 1;
          await sleep(retryPolicy.delayMs);
          continue;
        }
        throw providerError;
      }

      if (!isObject(rawPayload)) {
        throw toProviderError({
          status: 502,
          code: "bad_gateway",
          type: "server_error",
          message: "Provider returned a non-JSON response",
        });
      }

      return rawPayload as OpenAIProviderResult;
    } catch (error) {
      clearTimeout(timer);

      if (error instanceof OpenAIProviderError) {
        if (isRetryableError(error) && attempt < retryPolicy.maxRetries) {
          attempt += 1;
          await sleep(retryPolicy.delayMs);
          continue;
        }
        throw error;
      }

      const timedOut = (error as { name?: string })?.name === "AbortError";
      if (timedOut) {
        const timeoutError = toProviderError({
          status: 504,
          code: "provider_timeout",
          type: "timeout_error",
          message: "Provider request timed out",
        });
        if (attempt < retryPolicy.maxRetries) {
          attempt += 1;
          await sleep(retryPolicy.delayMs);
          continue;
        }
        throw timeoutError;
      }

      const transportError = toProviderError({
        status: 503,
        code: "provider_unavailable",
        type: "server_error",
        message: (error as Error)?.message ?? "Provider request failed",
      });
      if (isRetryableError(transportError) && attempt < retryPolicy.maxRetries) {
        attempt += 1;
        await sleep(retryPolicy.delayMs);
        continue;
      }
      throw transportError;
    }
  }
}

export function createSingleChatProvider(config: OpenAIProviderConfig): OpenAIChatProvider {
  const endpoint = buildOpenAIProviderEndpoint(config.serviceBaseUrl);
  return {
    name: "openai",
    capabilities: BASE_PROVIDER_CAPABILITIES,
    async complete(request: OpenAIProviderRequest): Promise<NormalizedOpenAIProviderResult> {
      const headers = {
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      };
      const raw = await postJSONWithRetry(endpoint, request, config, headers);
      return normalizeResult(raw, request.model);
    },
  };
}

export function createAzureOpenAIProvider(config: OpenAIProviderConfig): OpenAIChatProvider {
  return {
    name: "azure",
    capabilities: BASE_PROVIDER_CAPABILITIES,
    async complete(request: OpenAIProviderRequest): Promise<NormalizedOpenAIProviderResult> {
      const deployment = resolveAzureDeployment(config, request);
      const endpoint = buildAzureOpenAIEndpoint(
        config.serviceBaseUrl,
        deployment,
        config.azureApiVersion ?? DEFAULT_AZURE_API_VERSION,
      );
      const headers = {
        ...(config.apiKey ? { "api-key": config.apiKey } : {}),
      };
      const raw = await postJSONWithRetry(endpoint, request, config, headers);
      return normalizeResult(raw, request.model);
    },
  };
}

export function createMockChatProvider(config: OpenAIProviderConfig): OpenAIChatProvider {
  return {
    name: "mock",
    capabilities: BASE_PROVIDER_CAPABILITIES,
    async complete(request: OpenAIProviderRequest): Promise<NormalizedOpenAIProviderResult> {
      const model = request.model || config.defaultModel;
      const lastUserMessage = request.messages
        .slice()
        .reverse()
        .find((message) => message.role === "user")?.content;
      const prompt = lastUserMessage ? lastUserMessage : "[empty request]";
      const content = `Mock response (${model}): ${prompt}`;
      return {
        id: `mock-${model}`,
        model,
        created: 1700000000,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: request.messages.length,
          completion_tokens: content.length,
          total_tokens: request.messages.length + content.length,
        },
      };
    },
  };
}

export function validateRequestForProvider(provider: OpenAIChatProvider, request: OpenAIProviderRequest): void {
  for (const feature of REQUEST_FEATURES) {
    if (feature === "stream") {
      const stream = request.stream;
      if (stream === undefined || stream === false) continue;
    } else if (request[feature as keyof OpenAIProviderRequest] === undefined) {
      continue;
    }

    if (provider.capabilities.supportedRequestFeatures.has(feature)) {
      continue;
    }

    throw toProviderError({
      status: 400,
      code: REQUEST_FEATURE_ERROR_CODE[feature],
      type: "invalid_request_error",
      message: `OpenAI request feature '${feature}' is not supported by provider '${provider.name}'`,
      param: feature,
    });
  }
}

const PROVIDER_FACTORIES: Record<string, OpenAIChatProviderFactory> = {
  openai: createSingleChatProvider,
  single: createSingleChatProvider,
  azure: createAzureOpenAIProvider,
  azure_openai: createAzureOpenAIProvider,
  mock: createMockChatProvider,
  local: createMockChatProvider,
};

export function createOpenAIChatProvider(config: OpenAIProviderConfig): OpenAIChatProvider {
  const factory = PROVIDER_FACTORIES[config.provider];
  if (!factory) {
    throw toProviderError({
      status: 400,
      code: "unsupported_provider",
      type: "invalid_request_error",
      message: `Unsupported provider '${config.provider}'`,
    });
  }
  return factory(config);
}

export function createOpenAIChatProviderOrThrow(
  config: OpenAIProviderConfig,
  factory?: OpenAIChatProviderFactory,
) {
  if (factory) return factory(config);
  return createOpenAIChatProvider(config);
}
