import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toGeminiSchema } from "./gemini";
import {
  aiProviderStatus,
  generateJson,
  generateText,
  shouldFailoverFromAnthropic,
} from "./provider";

// The Anthropic SDK is the one external call a unit test must not make. Same
// stubbing shape as src/lib/enrich/find-phone.test.ts.
const anthropicCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...args: unknown[]) => anthropicCreate(...args) };
  },
}));

/** Shape of a successful Anthropic text reply. */
function anthropicTextReply(text: string) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}

/** Shape of a successful Anthropic forced-tool reply. */
function anthropicToolReply(name: string, input: unknown) {
  return { content: [{ type: "tool_use", name, input }], stop_reason: "tool_use" };
}

/** An error the way the Anthropic SDK throws it: an Error carrying a status. */
function anthropicError(status: number | undefined, message: string) {
  const err = new Error(message) as Error & { status?: number };
  if (status !== undefined) err.status = status;
  return err;
}

/** A successful Gemini generateContent body. */
function geminiReply(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 22 },
      }),
  };
}

function geminiErrorReply(status: number, message: string) {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { message } }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  anthropicCreate.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("GEMINI_API_KEY", "gem-test");
  // The alias must be pinned too, or a real key in the ambient environment
  // would keep the "no Gemini configured" cases from ever being exercised.
  vi.stubEnv("GOOGLE_AI_API_KEY", "");
  vi.stubEnv("AI_PRIMARY_PROVIDER", "");
  vi.stubEnv("AI_FALLBACK_DISABLED", "");
  vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("GEMINI_MODEL_STRONG", "");
  // Failover logs a warning by design; keep the test output readable.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("toGeminiSchema", () => {
  it("uppercases types and keeps required + descriptions", () => {
    const out = toGeminiSchema({
      type: "object",
      properties: {
        sentiment: { type: "string", enum: ["positive", "negative"], description: "tone" },
        score: { type: "number" },
      },
      required: ["sentiment"],
    });

    expect(out).toEqual({
      type: "OBJECT",
      properties: {
        sentiment: { type: "STRING", description: "tone", enum: ["positive", "negative"] },
        score: { type: "NUMBER" },
      },
      required: ["sentiment"],
    });
  });

  it("collapses a nullable union into a nullable scalar", () => {
    // JSON Schema allows ["string","null"]; Gemini has no union type, so the
    // null arm has to become the `nullable` flag or the request is rejected.
    expect(toGeminiSchema({ type: ["string", "null"] })).toEqual({
      type: "STRING",
      nullable: true,
    });
  });

  it("recurses into array items", () => {
    expect(toGeminiSchema({ type: "array", items: { type: "object", properties: {} } })).toEqual({
      type: "ARRAY",
      items: { type: "OBJECT", properties: {} },
    });
  });

  it("drops the keywords Gemini rejects", () => {
    const out = toGeminiSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string", pattern: "^x", default: "x" } },
    });

    // If any of these survived, the real API returns a 400 on every call.
    expect(out).not.toHaveProperty("$schema");
    expect(out).not.toHaveProperty("additionalProperties");
    expect(out.properties?.a).toEqual({ type: "STRING" });
  });
});

describe("shouldFailoverFromAnthropic", () => {
  it("fails over on an exhausted credit balance, which arrives as a 400", () => {
    // The whole reason this layer exists. Twice this 400 read as a bad request
    // and took every AI feature down with no failover.
    expect(
      shouldFailoverFromAnthropic(
        anthropicError(400, "Your credit balance is too low to access the Anthropic API"),
      ),
    ).toBe(true);
  });

  it("fails over on rate limit, overload, and 5xx", () => {
    expect(shouldFailoverFromAnthropic(anthropicError(429, "rate_limit_error"))).toBe(true);
    expect(shouldFailoverFromAnthropic(anthropicError(529, "Overloaded"))).toBe(true);
    expect(shouldFailoverFromAnthropic(anthropicError(500, "internal"))).toBe(true);
  });

  it("fails over on a revoked or wrong-org key", () => {
    expect(shouldFailoverFromAnthropic(anthropicError(401, "invalid x-api-key"))).toBe(true);
  });

  it("fails over on a network fault that carries no status", () => {
    expect(shouldFailoverFromAnthropic(anthropicError(undefined, "fetch failed"))).toBe(true);
    expect(shouldFailoverFromAnthropic(anthropicError(undefined, "ECONNRESET"))).toBe(true);
  });

  it("does NOT fail over on a genuinely bad request", () => {
    // Gemini would reject this the same way, so a second call is pure waste.
    expect(
      shouldFailoverFromAnthropic(anthropicError(400, "max_tokens: must be greater than 0")),
    ).toBe(false);
  });
});

describe("generateText", () => {
  const req = { label: "test/site", system: "be brief", user: "hello", maxTokens: 100 };

  it("uses Anthropic and never touches Gemini when Anthropic works", () => {
    anthropicCreate.mockResolvedValue(anthropicTextReply("hi there"));

    return generateText(req).then((result) => {
      expect(result).toMatchObject({ ok: true, provider: "anthropic", text: "hi there" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("falls over to Gemini when Anthropic runs out of credit", async () => {
    anthropicCreate.mockRejectedValue(
      anthropicError(400, "Your credit balance is too low to access the Anthropic API"),
    );
    fetchMock.mockResolvedValue(geminiReply("served by gemini"));

    const result = await generateText(req);

    expect(result).toMatchObject({ ok: true, provider: "gemini", text: "served by gemini" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the API key as a header, not in the URL", async () => {
    anthropicCreate.mockRejectedValue(anthropicError(429, "rate_limit_error"));
    fetchMock.mockResolvedValue(geminiReply("ok"));

    await generateText(req);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // A key in the query string leaks into every access log and error trace.
    expect(url).not.toContain("gem-test");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("gem-test");
  });

  it("asks for minimal thinking on flash so the token budget goes to the answer", async () => {
    anthropicCreate.mockRejectedValue(anthropicError(429, "rate_limit_error"));
    fetchMock.mockResolvedValue(geminiReply("ok"));

    await generateText(req);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(url).toContain("gemini-3.6-flash");
    // Without this, flash spent 122 thinking tokens on a 3-token answer.
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
    expect(body.systemInstruction).toEqual({ parts: [{ text: "be brief" }] });
  });

  it("routes a sonnet-class request to the strong Gemini model", async () => {
    anthropicCreate.mockRejectedValue(anthropicError(429, "rate_limit_error"));
    fetchMock.mockResolvedValue(geminiReply("ok"));

    await generateText({ ...req, anthropicModel: "claude-sonnet-5" });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("gemini-pro-latest");
  });

  it("steps the thinking level down when a model rejects it, instead of failing", async () => {
    // gemini-pro-latest and the -latest aliases reject "minimal" but accept
    // "low", and there is no way to ask in advance which a model supports.
    anthropicCreate.mockRejectedValue(anthropicError(429, "rate_limit_error"));
    fetchMock
      .mockResolvedValueOnce(
        geminiErrorReply(400, "Thinking level MINIMAL is not supported for this model."),
      )
      .mockResolvedValueOnce(geminiReply("served after stepping down"));

    const result = await generateText(req);

    expect(result).toMatchObject({ ok: true, provider: "gemini", text: "served after stepping down" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const levels = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string).generationConfig.thinkingConfig,
    );
    expect(levels).toEqual([{ thinkingLevel: "minimal" }, { thinkingLevel: "low" }]);
  });

  it("does NOT step down on a 400 that is not about the thinking level", async () => {
    anthropicCreate.mockRejectedValue(anthropicError(429, "rate_limit_error"));
    fetchMock.mockResolvedValue(geminiErrorReply(400, "Request contains an invalid argument."));

    const result = await generateText(req);

    expect(result.ok).toBe(false);
    // One attempt only: retrying a malformed request at another level is waste.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the legacy numeric budget for a retired gemini-2.x model", async () => {
    // 2.x predates thinkingLevel and rejects it outright.
    anthropicCreate.mockRejectedValue(anthropicError(429, "rate_limit_error"));
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash");
    fetchMock.mockResolvedValue(geminiReply("ok"));

    await generateText(req);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("does not spend a Gemini call on a non-retryable Anthropic error", async () => {
    anthropicCreate.mockRejectedValue(anthropicError(400, "max_tokens: must be greater than 0"));

    const result = await generateText(req);

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports both failures when neither provider can serve", async () => {
    anthropicCreate.mockRejectedValue(anthropicError(429, "rate_limit_error"));
    fetchMock.mockResolvedValue(geminiErrorReply(429, "Resource exhausted"));

    const result = await generateText(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts.map((a) => a.provider)).toEqual(["anthropic", "gemini"]);
      expect(result.reason).toContain("Resource exhausted");
    }
  });

  it("skips Gemini entirely when no Gemini key is set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    anthropicCreate.mockRejectedValue(anthropicError(429, "rate_limit_error"));

    const result = await generateText(req);

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honours AI_PRIMARY_PROVIDER=gemini", async () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "gemini");
    fetchMock.mockResolvedValue(geminiReply("gemini first"));

    const result = await generateText(req);

    expect(result).toMatchObject({ ok: true, provider: "gemini" });
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("attempts only the primary when AI_FALLBACK_DISABLED=1", async () => {
    vi.stubEnv("AI_FALLBACK_DISABLED", "1");
    anthropicCreate.mockRejectedValue(anthropicError(429, "rate_limit_error"));

    const result = await generateText(req);

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an empty Gemini reply as a failure rather than empty text", async () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "gemini");
    vi.stubEnv("AI_FALLBACK_DISABLED", "1");
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] }),
    });

    const result = await generateText(req);

    // Returning ok with "" here would silently write blank drafts and blank
    // forum posts instead of surfacing the problem.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("MAX_TOKENS");
  });
});

describe("generateJson", () => {
  const spec = {
    name: "record_analysis",
    description: "Record the analysis",
    input_schema: {
      type: "object",
      properties: { sentiment: { type: "string" } },
      required: ["sentiment"],
    },
  };
  const req = { label: "test/json", user: "analyse this", maxTokens: 200 };

  it("forces the tool call on Anthropic and returns its input", async () => {
    anthropicCreate.mockResolvedValue(anthropicToolReply("record_analysis", { sentiment: "warm" }));

    const result = await generateJson<{ sentiment: string }>(req, spec);

    expect(result).toMatchObject({ ok: true, provider: "anthropic", data: { sentiment: "warm" } });
    const call = anthropicCreate.mock.calls[0][0];
    expect(call.tool_choice).toEqual({ type: "tool", name: "record_analysis" });
  });

  it("constrains Gemini with a converted responseSchema and parses the JSON", async () => {
    anthropicCreate.mockRejectedValue(anthropicError(400, "Your credit balance is too low"));
    fetchMock.mockResolvedValue(geminiReply('{"sentiment":"warm"}'));

    const result = await generateJson<{ sentiment: string }>(req, spec);

    expect(result).toMatchObject({ ok: true, provider: "gemini", data: { sentiment: "warm" } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toEqual({
      type: "OBJECT",
      properties: { sentiment: { type: "STRING" } },
      required: ["sentiment"],
    });
  });

  it("fails rather than returning half-parsed data on a truncated reply", async () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "gemini");
    vi.stubEnv("AI_FALLBACK_DISABLED", "1");
    fetchMock.mockResolvedValue(geminiReply('{"sentiment":"wa'));

    const result = await generateJson(req, spec);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("unparseable");
  });
});

describe("aiProviderStatus", () => {
  it("reports the resolved order both providers are configured", () => {
    expect(aiProviderStatus()).toEqual({
      primary: "anthropic",
      fallback: "gemini",
      anthropicConfigured: true,
      geminiConfigured: true,
      order: ["anthropic", "gemini"],
    });
  });

  it("drops an unconfigured provider from the order", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(aiProviderStatus().order).toEqual(["anthropic"]);
  });
});
