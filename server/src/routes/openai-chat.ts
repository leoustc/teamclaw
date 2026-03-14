import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import { z, ZodError } from "zod";
import { logger } from "../middleware/logger.js";
import { readOpenAIConfig, type OpenAIConfig } from "../openai/config.js";
import {
  OpenAIProviderError,
  createOpenAIChatProviderOrThrow,
  type OpenAIChatProvider,
  type OpenAIChatProviderFactory,
  type OpenAIProviderRequest,
  validateRequestForProvider,
} from "../openai/provider.js";

type ProviderChoice = {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: string | null;
};

type OpenAIChatResponseChoice = {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: string | null;
};

interface OpenAIChatResponseUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatResponseChoice[];
  usage: OpenAIChatResponseUsage;
  system_fingerprint?: string | null;
}

interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    param?: string;
    code: string;
  };
}

interface OpenAIChatRoutesOptions {
  config?: OpenAIConfig;
  provider?: OpenAIChatProvider;
  providerFactory?: OpenAIChatProviderFactory;
}

const openAIMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const openAIRequestSchema = z
  .object({
    model: z.string().trim().min(1).optional(),
    messages: z.array(openAIMessageSchema).min(1),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().min(1).optional(),
    stream: z.boolean().optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    n: z.number().int().min(1).max(16).optional(),
    response_format: z
      .object({
        type: z.string().trim().min(1),
      })
      .strict()
      .optional(),
    user: z.string().trim().max(64).optional(),
  })
  .strict();

function normalizeRequestIp(req: Request): string {
  const xForwardedFor = req.header("x-forwarded-for");
  if (typeof xForwardedFor === "string") {
    const forwarded = xForwardedFor.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  if (Array.isArray(req.headers["x-forwarded-for"])) {
    const first = req.headers["x-forwarded-for"][0];
    if (typeof first === "string") return first.trim();
  }

  const socketIp = req.socket?.remoteAddress;
  if (socketIp) return socketIp;
  return "";
}

function extractBearerToken(req: Request): string | undefined {
  const authorization = req.header("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }
  return undefined;
}

function buildOpenAIError(message: string, type: string, code: string, param?: string): OpenAIErrorResponse {
  return {
    error: {
      message,
      type,
      code,
      ...(param ? { param } : {}),
    },
  };
}

function mapRequestToProviderRequest(
  request: z.infer<typeof openAIRequestSchema>,
  defaultModel: string,
): OpenAIProviderRequest {
  return {
    model: request.model?.trim() || defaultModel,
    messages: request.messages,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.stop === undefined ? {} : { stop: request.stop }),
    ...(request.n === undefined ? {} : { n: request.n }),
    ...(request.max_tokens === undefined ? {} : { max_tokens: request.max_tokens }),
    ...(request.stream === undefined ? {} : { stream: request.stream }),
    ...(request.response_format?.type === undefined
      ? {}
      : { response_format: request.response_format.type }),
    ...(request.user === undefined ? {} : { user: request.user }),
  };
}

function toOpenAIChoices(raw: Array<ProviderChoice>): OpenAIChatResponseChoice[] {
  return raw.map((choice) => ({
    index: choice.index,
    message: {
      role: choice.message.role,
      content: choice.message.content,
    },
    finish_reason: choice.finish_reason,
  }));
}

function toOpenAIUsage(usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): OpenAIChatResponseUsage {
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
}

function isAuthenticated(req: Request, config: OpenAIConfig): { valid: boolean; missingOrInvalid: "missing" | "invalid" | null } {
  const bearer = extractBearerToken(req);
  if (bearer && config.auth.apiKeys.includes(bearer)) return { valid: true, missingOrInvalid: null };
  if (bearer && !config.auth.apiKeys.includes(bearer)) return { valid: false, missingOrInvalid: "invalid" };

  const requestIp = normalizeRequestIp(req);
  if (
    !bearer &&
    requestIp &&
    config.auth.allowlistedIpCidrs.length > 0 &&
    config.auth.allowlistedIpCidrs.includes(requestIp)
  ) {
    return { valid: true, missingOrInvalid: null };
  }

  return {
    valid: false,
    missingOrInvalid: bearer ? "invalid" : "missing",
  };
}

export function openAIChatRoutes(options: OpenAIChatRoutesOptions = {}) {
  const config = options.config ?? readOpenAIConfig();
  const provider = options.provider ?? createOpenAIChatProviderOrThrow(config.provider, options.providerFactory);
  const router = Router();

  router.post("/v1/chat/completions", async (req: Request, res: Response) => {
    const requestId = req.header("x-request-id") || randomUUID();
    const startedAt = performance.now();

    const auth = isAuthenticated(req, config);
    if (!auth.valid) {
      const message = auth.missingOrInvalid === "invalid" ? "Invalid API key" : "Missing API key";
      const code = auth.missingOrInvalid === "invalid" ? "invalid_api_key" : "missing_api_key";
      res.status(401).json(buildOpenAIError(message, "authentication_error", code));
      return;
    }

    let requestPayload: z.infer<typeof openAIRequestSchema>;
    try {
      requestPayload = openAIRequestSchema.parse(req.body);
    } catch (error) {
      if (error instanceof ZodError) {
        const firstError = error.errors[0];
        const field = firstError?.path?.join(".") || "body";
        const firstMessage = firstError?.message || "Request payload does not match schema";
        logger.warn({ requestId, field, errors: error.errors }, "OpenAI payload validation failed");
        res.status(400).json(buildOpenAIError(firstMessage, "invalid_request_error", "invalid_request_error", field));
        return;
      }
      throw error;
    }

    const providerRequest = mapRequestToProviderRequest(requestPayload, config.provider.defaultModel);
    try {
      validateRequestForProvider(provider, providerRequest);
    } catch (error) {
      if (error instanceof OpenAIProviderError) {
        logger.warn(
          {
            requestId,
            event: "openai_chat_completion_unsupported_request_feature",
            code: error.code,
            param: error.param,
          },
          "OpenAI request contained unsupported provider field",
        );
        res.status(400).json(buildOpenAIError(error.message, "invalid_request_error", error.code, error.param ?? undefined));
      } else {
        logger.error({ requestId, err: String(error) }, "OpenAI request validation crashed");
        res.status(500).json(buildOpenAIError("Failed to process request", "server_error", "provider_error"));
      }
      return;
    }

    try {
      const providerResult = await provider.complete(providerRequest);
      const response: OpenAIChatResponse = {
        id: providerResult.id,
        object: "chat.completion",
        created: providerResult.created,
        model: providerResult.model,
        choices: toOpenAIChoices(providerResult.choices as ProviderChoice[]),
        usage: toOpenAIUsage(providerResult.usage),
        ...(providerResult.system_fingerprint === undefined ? {} : { system_fingerprint: providerResult.system_fingerprint }),
      };

      const latencyMs = Math.round(performance.now() - startedAt);
      logger.info(
        {
          requestId,
          event: "openai_chat_completion_success",
          latencyMs,
          model: providerResult.model,
          usage: response.usage,
        },
        "OpenAI chat completion completed",
      );
      res.status(200).json(response);
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startedAt);
      if (error instanceof OpenAIProviderError) {
        logger.warn(
          {
            requestId,
            event: "openai_chat_completion_provider_error",
            latencyMs,
            providerStatus: error.status,
            code: error.code,
            type: error.type,
          },
          "OpenAI provider request failed",
        );
        res.status(error.status).json({
          error: {
            message: error.message,
            type: error.type,
            code: error.code,
            ...(error.param ? { param: error.param } : {}),
          },
        });
        return;
      }

      logger.error({ requestId, event: "openai_chat_completion_unexpected_error", latencyMs, err: String(error) },
        "OpenAI provider request failed unexpectedly");
      res.status(500).json(
        buildOpenAIError("Failed to process request", "server_error", "provider_error", "chat.completions"),
      );
    }
  });

  return router;
}
