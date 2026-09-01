/**
 * Gemini (Google Generative Language API) client.
 *
 * Deliberately written against the REST endpoint with `fetch` instead of the
 * `@google/genai` SDK: this file only needs one method (generateContent), and a
 * raw call keeps the dependency tree, the bundle size, and the version-churn
 * surface of a Next.js route unchanged.
 *
 * Auth is an API key from the Google account that owns the AI credits
 * (jacob@wrenchlane.com). It is sent as the `x-goog-api-key` header, never as a
 * `?key=` query parameter, so the secret cannot leak into a request log or into
 * an error message that echoes the URL.
 *
 * Nothing here knows about Anthropic or about fallback policy. That lives in
 * `./provider.ts`, which is what call sites should use.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Default models, verified against a live key on 2026-09-01.
 *
 * Both gemini-2.5-flash and gemini-2.5-pro are retired for new API keys: they
 * still appear in the ListModels response but every generateContent call
 * returns 404 "no longer available to new users". So the list endpoint cannot
 * be trusted to tell you what works, and these are pinned to models that were
 * actually exercised.
 *
 * Flash is a concrete non-preview version. There is no concrete non-preview
 * pro (only gemini-3.1-pro-preview), so the strong tier uses the `-latest`
 * alias, which trades exact pinning for never 404-ing on a retirement.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_GEMINI_MODEL_STRONG = "gemini-pro-latest";

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function geminiApiKey(): string | undefined {
  // GOOGLE_AI_API_KEY is accepted as an alias because that is the name the AI
  // Studio UI uses when you copy a key out of it.
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || undefined;
}

export function isGeminiConfigured(): boolean {
  return Boolean(geminiApiKey());
}

/**
 * A Gemini schema (a subset of OpenAPI 3.0). Structurally close to the JSON
 * Schema that Anthropic tools use, but not identical, hence `toGeminiSchema`.
 */
export type GeminiSchema = {
  type: string;
  description?: string;
  nullable?: boolean;
  enum?: string[];
  format?: string;
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
};

/**
 * How hard the model is allowed to think before answering.
 *
 * This matters for cost, not just latency: asked for one OBD-II code with no
 * thinking config at all, gemini-3.6-flash spent 122 thinking tokens on a
 * 3-token answer. At "minimal" it spends 0.
 *
 * Support is per model and there is no way to ask in advance, so requests walk
 * a ladder: the requested level, then "low", then no thinking config. Only a
 * "thinking level X is not supported" 400 triggers a step down.
 *   - gemini-3.6-flash accepts "minimal"
 *   - gemini-pro-latest, gemini-flash-latest and the 3.1 previews reject
 *     "minimal" and need "low"
 *   - "none" and "off" are not valid values on any model
 */
export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

export type GeminiRequest = {
  model?: string;
  system?: string;
  /** Single user turn. Multi-turn is not needed by any current call site. */
  user: string;
  maxOutputTokens: number;
  temperature?: number;
  /** Preferred thinking level. Defaults to the cheapest, "minimal". */
  thinkingLevel?: GeminiThinkingLevel;
  /**
   * Legacy Gemini 2.x numeric budget. Only read for `gemini-2.*` models, which
   * predate thinkingLevel and reject it.
   */
  thinkingBudget?: number;
  /** When set, the model is constrained to emit JSON matching this schema. */
  responseSchema?: GeminiSchema;
  signal?: AbortSignal;
};

export type GeminiUsage = { inputTokens: number; outputTokens: number };

export type GeminiResult =
  | { ok: true; text: string; model: string; usage: GeminiUsage }
  | { ok: false; reason: string; status?: number; retryable: boolean };

/**
 * True when the failure is worth retrying or worth failing over to another
 * provider: quota, rate limit, or a transient server fault. A 400 on a
 * malformed request or a 401 on a bad key is not retryable.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 503 || status === 504;
}

/** Convert an Anthropic-style JSON Schema into the subset Gemini accepts. */
export function toGeminiSchema(input: unknown): GeminiSchema {
  const node = (input ?? {}) as Record<string, unknown>;

  // Gemini has no union types, so JSON Schema's ["string","null"] collapses to
  // a nullable scalar.
  const typeList = Array.isArray(node.type)
    ? (node.type as string[])
    : [typeof node.type === "string" ? node.type : "object"];
  const concrete = typeList.find((t) => t !== "null") ?? "string";
  const nullable = typeList.includes("null") || node.nullable === true;

  const out: GeminiSchema = { type: concrete.toUpperCase() };
  if (nullable) out.nullable = true;
  if (typeof node.description === "string") out.description = node.description;
  if (Array.isArray(node.enum)) out.enum = node.enum.map(String);

  if (concrete === "array" && node.items) out.items = toGeminiSchema(node.items);

  if (concrete === "object" && node.properties && typeof node.properties === "object") {
    const props: Record<string, GeminiSchema> = {};
    for (const [key, value] of Object.entries(node.properties as Record<string, unknown>)) {
      props[key] = toGeminiSchema(value);
    }
    out.properties = props;
    if (Array.isArray(node.required)) out.required = node.required.map(String);
  }

  // Intentionally dropped, because Gemini rejects the request when they are
  // present: $schema, additionalProperties, oneOf/anyOf/allOf, const,
  // minimum/maximum, pattern, default, format on strings.
  return out;
}

/** True for the pre-3.x models that take a numeric budget, not a named level. */
function usesLegacyThinkingBudget(model: string): boolean {
  return /^gemini-[12]\./.test(model);
}

/** Does this 400 mean the thinking level was the problem, and nothing else? */
function isUnsupportedThinkingLevel(status: number, detail: string): boolean {
  return status === 400 && /thinking level/i.test(detail) && /not supported/i.test(detail);
}

export async function geminiGenerate(req: GeminiRequest): Promise<GeminiResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) return { ok: false, reason: "GEMINI_API_KEY not set", retryable: false };

  const model = req.model || geminiModel();

  // The ladder of thinking configs to try, cheapest first. `null` means send no
  // thinking config at all, which always works but lets the model spend freely.
  const thinkingLadder: Array<Record<string, unknown> | null> = usesLegacyThinkingBudget(model)
    ? [{ thinkingBudget: req.thinkingBudget ?? 0 }, null]
    : (() => {
        const preferred = req.thinkingLevel ?? "minimal";
        const levels = preferred === "low" ? ["low"] : [preferred, "low"];
        return [...levels.map((thinkingLevel) => ({ thinkingLevel })), null];
      })();

  let lastFailure: GeminiResult = {
    ok: false,
    reason: "gemini made no attempt",
    retryable: false,
  };

  for (const thinkingConfig of thinkingLadder) {
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: req.maxOutputTokens,
      ...(thinkingConfig ? { thinkingConfig } : {}),
    };
    if (typeof req.temperature === "number") generationConfig.temperature = req.temperature;
    if (req.responseSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = req.responseSchema;
    }

    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig,
    };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };

    const attempt = await geminiAttempt(apiKey, model, body, req.signal);

    // A thinking level this model does not accept is the one failure worth
    // retrying differently rather than reporting.
    if (
      !attempt.ok &&
      attempt.status !== undefined &&
      isUnsupportedThinkingLevel(attempt.status, attempt.reason)
    ) {
      lastFailure = attempt;
      continue;
    }

    return attempt;
  }

  return lastFailure;
}

async function geminiAttempt(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<GeminiResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // A network fault or a timeout is exactly the case failover exists for.
    return { ok: false, reason: `gemini fetch failed: ${reason}`, retryable: true };
  }

  const raw = await res.text();

  if (!res.ok) {
    let detail = raw.slice(0, 400);
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // Keep the truncated body.
    }
    return {
      ok: false,
      reason: `gemini ${res.status}: ${detail}`,
      status: res.status,
      retryable: isRetryableStatus(res.status),
    };
  }

  type GeminiResponse = {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  let parsed: GeminiResponse;
  try {
    parsed = JSON.parse(raw) as GeminiResponse;
  } catch {
    return { ok: false, reason: "gemini returned a non-JSON body", retryable: true };
  }

  if (parsed.promptFeedback?.blockReason) {
    return {
      ok: false,
      reason: `gemini blocked the prompt (${parsed.promptFeedback.blockReason})`,
      retryable: false,
    };
  }

  const candidate = parsed.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();

  const usage: GeminiUsage = {
    inputTokens: parsed.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: parsed.usageMetadata?.candidatesTokenCount ?? 0,
  };

  if (!text) {
    const finish = candidate?.finishReason ?? "unknown";
    // MAX_TOKENS with no text almost always means the budget went to thinking.
    return {
      ok: false,
      reason: `gemini returned no text (finishReason=${finish})`,
      retryable: finish === "MAX_TOKENS" || finish === "unknown",
    };
  }

  return { ok: true, text, model, usage };
}

/** List the models the key can actually reach. Used by the connection test. */
export async function geminiListModels(): Promise<
  { ok: true; models: string[] } | { ok: false; reason: string }
> {
  const apiKey = geminiApiKey();
  if (!apiKey) return { ok: false, reason: "GEMINI_API_KEY not set" };

  const res = await fetch(`${API_BASE}/models?pageSize=200`, {
    headers: { "x-goog-api-key": apiKey },
  });
  const raw = await res.text();
  if (!res.ok) return { ok: false, reason: `gemini ${res.status}: ${raw.slice(0, 300)}` };

  try {
    const parsed = JSON.parse(raw) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    const models = (parsed.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
    return { ok: true, models };
  } catch {
    return { ok: false, reason: "gemini returned a non-JSON model list" };
  }
}
