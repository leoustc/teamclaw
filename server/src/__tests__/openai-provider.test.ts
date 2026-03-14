import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenAIProviderError,
  createAzureOpenAIProvider,
  createMockChatProvider,
  createOpenAIChatProvider,
  createSingleChatProvider,
  validateRequestForProvider,
  type OpenAIProviderRequest,
} from "../openai/provider.js";

type FetchCall = Parameters<typeof fetch>[1];

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function openaiConfig(overrides: Partial<Parameters<typeof createSingleChatProvider>[0]> = {}) {
  return {
    provider: "openai",
    serviceBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    requestTimeoutMs: 5_000,
    requestRetries: 0,
    requestRetryDelayMs: 0,
    apiKey: "sk-test-key",
    ...overrides,
  };
}

function requestBody(model = "gpt-4o-mini"): OpenAIProviderRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: "Hello",
      },
      {
        role: "user",
        content: "What is 2+2?",
      },
    ],
  };
}

describe("OpenAI provider adapters", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("maps openai-compatible success payloads", async () => {
    const provider = createSingleChatProvider(openaiConfig());
    const callTracker = vi.spyOn(globalThis, "fetch");
    callTracker.mockResolvedValueOnce(
      mockJsonResponse({
        id: "chatcmpl-success",
        model: "gpt-4o-mini",
        created: 1700000100,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "4" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: "2",
          total_tokens: "5",
        },
      }),
    );

    const result = await provider.complete(requestBody());

    expect(result.model).toBe("gpt-4o-mini");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0]?.message.content).toBe("4");
    expect(result.usage.prompt_tokens).toBe(3);
    expect(result.usage.completion_tokens).toBe(2);

    const calledArgs = callTracker.mock.calls[0];
    expect(calledArgs?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    const options = calledArgs?.[1] as FetchCall;
    expect(options?.headers).toMatchObject({ authorization: "Bearer sk-test-key", "content-type": "application/json" });
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      model: "gpt-4o-mini",
      messages: requestBody().messages,
      stream: false,
    });
  });

  it("maps azure endpoint and api-key header", async () => {
    const provider = createAzureOpenAIProvider({
      provider: "azure",
      serviceBaseUrl: "https://myopenai.openai.azure.com",
      defaultModel: "deployment-1",
      requestTimeoutMs: 5_000,
      requestRetries: 0,
      requestRetryDelayMs: 0,
      azureDeployment: "deployment-1",
      azureApiVersion: "2024-04-01-preview",
      apiKey: "azure-test-key",
    });

    const callTracker = vi.spyOn(globalThis, "fetch");
    callTracker.mockResolvedValueOnce(
      mockJsonResponse({
        id: "azure-1",
        model: "deployment-1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      }),
    );

    await provider.complete({ ...requestBody("deployment-1") });

    const calledArgs = callTracker.mock.calls[0];
    expect(calledArgs?.[0]).toBe(
      "https://myopenai.openai.azure.com/openai/deployments/deployment-1/chat/completions?api-version=2024-04-01-preview",
    );
    const options = calledArgs?.[1] as FetchCall;
    expect(options?.headers).toMatchObject({ "api-key": "azure-test-key", "content-type": "application/json" });
  });

  it("uses deterministic mock output", async () => {
    const provider = createMockChatProvider({
      provider: "mock",
      serviceBaseUrl: "",
      defaultModel: "gpt-4o-mini",
      requestTimeoutMs: 5_000,
      requestRetries: 0,
      requestRetryDelayMs: 0,
    });

    const first = await provider.complete(requestBody("mock-model"));
    const second = await provider.complete(requestBody("mock-model"));

    expect(first.id).toBe("mock-mock-model");
    expect(first.choices[0]?.message.content).toBe(
      "Mock response (mock-model): What is 2+2?",
    );
    expect(second.choices[0]?.message.content).toBe(first.choices[0]?.message.content);
  });

  it("rejects unsupported provider request features", () => {
    const provider = createOpenAIChatProvider(openaiConfig());
    let error: unknown;
    try {
      validateRequestForProvider(provider, { ...requestBody(), stream: true });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect((error as OpenAIProviderError).status).toBe(400);
    expect((error as OpenAIProviderError).code).toBe("unsupported_stream");
  });

  it("retries transient failures and eventually succeeds", async () => {
    const provider = createSingleChatProvider(
      openaiConfig({
        requestRetries: 1,
        requestRetryDelayMs: 0,
      }),
    );
    const callTracker = vi.spyOn(globalThis, "fetch");
    callTracker
      .mockResolvedValueOnce(mockJsonResponse({ error: { message: "temporary outage", code: "service_unavailable" } }, 503))
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "chatcmpl-retried",
          model: "gpt-4o-mini",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
      );

    const result = await provider.complete(requestBody());
    expect(result.id).toBe("chatcmpl-retried");
    expect(callTracker).toHaveBeenCalledTimes(2);
  });

  it("maps timeout into provider_timeout", async () => {
    const provider = createSingleChatProvider(
      openaiConfig({
        requestRetries: 0,
      }),
    );
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new DOMException("Request was aborted", "AbortError"),
    );

    await expect(provider.complete(requestBody())).rejects.toMatchObject({
      status: 504,
      code: "provider_timeout",
      type: "timeout_error",
    });
  });

  it("maps transport errors to provider_unavailable", async () => {
    const provider = createSingleChatProvider(openaiConfig({ requestRetries: 0 }));
    vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("network unreachable"));

    await expect(provider.complete(requestBody())).rejects.toMatchObject({
      status: 503,
      code: "provider_unavailable",
      type: "server_error",
    });
  });

  it("maps non-JSON success body into bad_gateway", async () => {
    const provider = createSingleChatProvider(openaiConfig());
    vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } }));

    await expect(provider.complete(requestBody())).rejects.toMatchObject({
      status: 502,
      code: "bad_gateway",
      type: "server_error",
    });
  });
});
