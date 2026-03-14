import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  OpenAIProviderError,
  type OpenAIChatProvider,
  type OpenAIProviderRequest,
} from "../openai/provider.js";
import type { OpenAIConfig } from "../openai/config.js";
import { openAIChatRoutes } from "../routes/openai-chat.js";

type RequestHandler = OpenAIChatProvider["complete"];

type ProviderResult = Awaited<ReturnType<RequestHandler>>;

function buildConfig(): OpenAIConfig {
  return {
    provider: {
      provider: "openai",
      serviceBaseUrl: "https://api.openai.test/v1",
      defaultModel: "gpt-4o-mini",
      requestTimeoutMs: 5_000,
      requestRetries: 0,
      requestRetryDelayMs: 0,
    },
    auth: {
      apiKeys: ["test-token"],
      allowlistedIpCidrs: [],
    },
  };
}

function buildSuccessProvider(): OpenAIChatProvider {
  return {
    name: "openai",
    capabilities: {
      supportedRequestFeatures: new Set([
        "model",
        "messages",
        "temperature",
        "stop",
        "n",
        "max_tokens",
        "response_format",
        "user",
      ]),
    },
    async complete(request: OpenAIProviderRequest): Promise<ProviderResult> {
      return {
        id: `chat-${request.model}`,
        model: request.model,
        created: 1700000000,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello from contract",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: request.messages.length,
          completion_tokens: 4,
          total_tokens: request.messages.length + 4,
        },
      };
    },
  };
}

describe("openai chat contract routes", () => {
  it("validates malformed request body and does not call provider", async () => {
    const providerComplete = vi.fn();
    const app = express();
    app.use(express.json());
    app.use(
      openAIChatRoutes({
        config: buildConfig(),
        provider: {
          name: "openai",
          capabilities: {
            supportedRequestFeatures: new Set([
              "model",
              "messages",
              "temperature",
              "stop",
              "n",
              "max_tokens",
              "response_format",
              "user",
            ]),
          },
          async complete() {
            providerComplete();
          },
        },
      }),
    );

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("authorization", "Bearer test-token")
      .send({
        model: "gpt-4o-mini",
        messages: [],
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        type: "invalid_request_error",
        code: "invalid_request_error",
        param: "messages",
      },
    });
    expect(providerComplete).not.toHaveBeenCalled();
  });

  it("rejects unknown request fields before provider execution", async () => {
    const providerComplete = vi.fn();
    const app = express();
    app.use(express.json());
    app.use(
      openAIChatRoutes({
        config: buildConfig(),
        provider: {
          name: "openai",
          capabilities: {
            supportedRequestFeatures: new Set([
              "model",
              "messages",
              "temperature",
              "stop",
              "n",
              "max_tokens",
              "response_format",
              "user",
            ]),
          },
          async complete() {
            providerComplete();
          },
        },
      }),
    );

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("authorization", "Bearer test-token")
      .send({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hi" }],
        top_p: 0.9,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        type: "invalid_request_error",
        code: "invalid_request_error",
      },
    });
    expect(res.body.error.message).toContain("Unrecognized key(s)");
    expect(providerComplete).not.toHaveBeenCalled();
  });

  it("returns 401 when bearer token is missing", async () => {
    const app = express();
    app.use(express.json());
    app.use(openAIChatRoutes({ config: buildConfig(), provider: buildSuccessProvider() }));

    const res = await request(app).post("/v1/chat/completions").send({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: {
        type: "authentication_error",
        code: "missing_api_key",
      },
    });
  });

  it("returns a validated provider contract error on malformed request", async () => {
    const app = express();
    app.use(express.json());
    app.use(openAIChatRoutes({ config: buildConfig(), provider: buildSuccessProvider() }));

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("authorization", "Bearer test-token")
      .send({
        model: "",
        messages: [],
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        type: "invalid_request_error",
        code: "invalid_request_error",
      },
    });
  });

  it("maps provider unsupported stream into openai error envelope", async () => {
    const app = express();
    app.use(express.json());
    app.use(openAIChatRoutes({ config: buildConfig(), provider: buildSuccessProvider() }));

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("authorization", "Bearer test-token")
      .send({
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        type: "invalid_request_error",
        code: "unsupported_stream",
      },
    });
  });

  it("maps upstream authentication errors to openai error envelope", async () => {
    const provider: OpenAIChatProvider = {
      name: "openai",
      capabilities: { supportedRequestFeatures: new Set(["model", "messages", "temperature", "stop", "n", "max_tokens", "response_format", "user"]) },
      async complete() {
        throw new OpenAIProviderError({
          status: 401,
          code: "invalid_api_key",
          type: "authentication_error",
          message: "Invalid key",
        });
      },
    };

    const app = express();
    app.use(express.json());
    app.use(openAIChatRoutes({ config: buildConfig(), provider }));

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("authorization", "Bearer test-token")
      .send({
        messages: [{ role: "user", content: "Hi" }],
      });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: {
        type: "authentication_error",
        code: "invalid_api_key",
      },
    });
  });

  it.each([
    {
      status: 401,
      code: "invalid_api_key",
      type: "authentication_error",
      message: "Provider unauthorized",
      param: "authorization",
    },
    {
      status: 403,
      code: "permission_denied",
      type: "authentication_error",
      message: "Forbidden upstream",
      param: "authorization",
    },
    {
      status: 404,
      code: "model_not_found",
      type: "invalid_request_error",
      message: "Unknown model",
      param: "model",
    },
    {
      status: 429,
      code: "rate_limit_exceeded",
      type: "rate_limit_error",
      message: "Too many requests",
    },
    {
      status: 503,
      code: "provider_unavailable",
      type: "server_error",
      message: "Provider unavailable",
    },
    {
      status: 500,
      code: "provider_error",
      type: "server_error",
      message: "Provider internal error",
      param: "messages",
    },
  ])("maps upstream provider status $status into openai error contract", async ({ status, code, type, message, param }) => {
    const provider: OpenAIChatProvider = {
      name: "openai",
      capabilities: {
        supportedRequestFeatures: new Set(["model", "messages", "temperature", "stop", "n", "max_tokens", "response_format", "user"]),
      },
      async complete() {
        throw new OpenAIProviderError({
          status,
          code,
          type,
          message,
          param,
        });
      },
    };

    const app = express();
    app.use(express.json());
    app.use(openAIChatRoutes({ config: buildConfig(), provider }));

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("authorization", "Bearer test-token")
      .send({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hi" }],
      });

    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({
      error: expect.objectContaining({
        type,
        code,
        message,
        ...(param ? { param } : {}),
      }),
    });
  });

  it("maps unexpected provider exceptions to internal error contract", async () => {
    const provider: OpenAIChatProvider = {
      name: "openai",
      capabilities: {
        supportedRequestFeatures: new Set(["model", "messages", "temperature", "stop", "n", "max_tokens", "response_format", "user"]),
      },
      async complete() {
        throw new Error("unexpected provider panic");
      },
    };

    const app = express();
    app.use(express.json());
    app.use(openAIChatRoutes({ config: buildConfig(), provider }));

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("authorization", "Bearer test-token")
      .send({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hi" }],
      });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: {
        type: "server_error",
        code: "provider_error",
        message: "Failed to process request",
      },
    });
  });

  it("returns openai chat completion response envelope", async () => {
    const app = express();
    app.use(express.json());
    app.use(openAIChatRoutes({ config: buildConfig(), provider: buildSuccessProvider() }));

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("authorization", "Bearer test-token")
      .send({
        messages: [{ role: "user", content: "Hi" }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      object: "chat.completion",
      model: "gpt-4o-mini",
      usage: {
        prompt_tokens: 1,
        completion_tokens: 4,
        total_tokens: 5,
      },
    });
    expect(res.body).toHaveProperty("id", "chat-gpt-4o-mini");
  });
});
