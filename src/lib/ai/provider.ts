/**
 * The CRM's AI provider layer.
 *
 * Why this exists: every AI feature in the CRM used to call
 * `new Anthropic(...)` directly, so a single org-wide event on the Anthropic
 * side took all of them down at once. That happened twice (2026-07-02 and
 * 2026-08-27), and the tell is nasty: an exhausted credit balance returns HTTP
 * 400 `invalid_request_error`, not a 401, so it does not read as an auth or
 * quota problem in the logs.
 *
 * So call sites ask for a completion, not for a vendor. This module keeps
 * Anthropic as the primary (same models, same prompts, same output as before)
 * and fails over to Gemini, billed to the Google account that holds the AI
 * credits, when Anthropic cannot serve the request.
 *
 * Two entry points cover every CRM pattern:
 *   generateText  - system + one user turn, text back.
 *   generateJson  - same, but the reply is constrained to a schema. On Anthropic
 *                   that is a forced tool call; on Gemini it is responseSchema.
 *
 * Not covered on purpose: Anthropic's server-side `web_search` tool
 * (`enrich/find-website`, `enrich/find-phone`) and prompt caching
 * (`articles/generate`). Gemini's grounding is a different contract with a
 * different result shape, so those sites stay Anthropic-only rather than being
 * silently downgraded. They are the only remaining single-provider features.
 *
 * Configuration (all optional):
 *   GEMINI_API_KEY          Enables the Gemini side. Without it this module
 *                           behaves exactly as the old direct calls did.
 *   AI_PRIMARY_PROVIDER     "anthropic" (default) or "gemini".
 *   AI_FALLBACK_DISABLED    "1" to attempt the primary only.
 *   GEMINI_MODEL            Default "gemini-3.6-flash".
 *   GEMINI_MODEL_STRONG     Default "gemini-pro-latest". Used when the call site
 *                           asked Anthropic for a sonnet/opus-class model.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_MODEL_STRONG,
  geminiGenerate,
  isGeminiConfigured,
  toGeminiSchema,
} from "./gemini";

export type AiProvider = "anthropic" | "gemini";

/** Model used when a call site does not name one. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

export type AiAttempt = { provider: AiProvider; reason: string };

export type AiRequest = {
  /**
   * Call-site identifier for logs, e.g. "inbox/draft-reply". Shows up in the
   * failover warning so an outage points at the affected features.
   */
  label: string;
  system?: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  /** Anthropic model, when Anthropic serves the request. */
  anthropicModel?: string;
  /** Gemini model override, when Gemini serves it. */
  geminiModel?: string;
  signal?: AbortSignal;
};

export type AiTextResult =
  | { ok: true; text: string; provider: AiProvider; model: string }
  | { ok: false; reason: string; attempts: AiAttempt[] };

/**
 * A schema for a constrained reply. `input_schema` is plain JSON Schema, which
 * is what the existing Anthropic tool definitions already hold, so a call site
 * can pass its current tool object unchanged.
 */
export type AiJsonSpec = {
  name: string;
  description?: string;
  input_schema: unknown;
};

export type AiJsonResult<T> =
  | { ok: true; data: T; provider: AiProvider; model: string }
  | { ok: false; reason: string; attempts: AiAttempt[] };

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

function primaryProvider(): AiProvider {
  return process.env.AI_PRIMARY_PROVIDER === "gemini" ? "gemini" : "anthropic";
}

function fallbackEnabled(): boolean {
  return process.env.AI_FALLBACK_DISABLED !== "1";
}

function providerOrder(): AiProvider[] {
  const primary = primaryProvider();
  const secondary: AiProvider = primary === "anthropic" ? "gemini" : "anthropic";

  const order: AiProvider[] = [primary];
  if (fallbackEnabled()) order.push(secondary);

  // Drop providers that cannot possibly serve, so a missing key never costs a
  // round trip and never masks the real reason in the error message.
  return order.filter((p) =>
    p === "anthropic" ? Boolean(process.env.ANTHROPIC_API_KEY) : isGeminiConfigured(),
  );
}

/**
 * Should this Anthropic failure fail over to Gemini?
 *
 * Yes for anything that is about capacity, quota, or funds rather than about
 * the request itself. The credit-balance case is a 400, so status alone is not
 * enough to classify it.
 */
export function shouldFailoverFromAnthropic(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

  if (status === 429) return true; // rate limited
  if (status === 529) return true; // overloaded
  if (typeof status === "number" && status >= 500) return true; // transient fault
  if (status === 401 || status === 403) return true; // key revoked or wrong org

  // The one that has actually bitten us: funds exhausted, reported as a 400.
  if (message.includes("credit balance")) return true;
  if (message.includes("quota")) return true;
  if (message.includes("overloaded")) return true;

  // A connection reset or timeout arrives without a status.
  if (status === undefined) {
    if (message.includes("timeout") || message.includes("econnreset")) return true;
    if (message.includes("fetch failed") || message.includes("network")) return true;
  }

  // Anything else (a malformed request, a prompt too long, a refusal) would
  // fail the same way on Gemini, so do not spend a second call on it.
  return false;
}

/** Pick a Gemini model of roughly comparable class to the requested Anthropic one. */
function mapToGeminiModel(req: AiRequest): string {
  if (req.geminiModel) return req.geminiModel;

  const anthropicModel = req.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL;
  const wantsStrong = anthropicModel.includes("sonnet") || anthropicModel.includes("opus");
  if (wantsStrong) return process.env.GEMINI_MODEL_STRONG || DEFAULT_GEMINI_MODEL_STRONG;

  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

function logFailover(label: string, from: AiProvider, reason: string) {
  // Warn rather than throw: the request is still being served. This is the line
  // to grep in Vercel logs when a provider outage starts.
  console.warn(`[ai] ${label}: ${from} failed, failing over. reason=${reason}`);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

async function anthropicText(req: AiRequest): Promise<{ text: string; model: string }> {
  const model = req.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create(
    {
      model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
      messages: [{ role: "user", content: req.user }],
    },
    req.signal ? { signal: req.signal } : undefined,
  );

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) throw new Error(`anthropic returned no text (stop_reason=${response.stop_reason})`);

  return { text, model };
}

export async function generateText(req: AiRequest): Promise<AiTextResult> {
  const order = providerOrder();
  if (order.length === 0) {
    return {
      ok: false,
      reason: "no AI provider configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY)",
      attempts: [],
    };
  }

  const attempts: AiAttempt[] = [];

  for (const provider of order) {
    const isLast = provider === order[order.length - 1];

    if (provider === "anthropic") {
      try {
        const { text, model } = await anthropicText(req);
        return { ok: true, text, provider, model };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        attempts.push({ provider, reason });
        if (isLast || !shouldFailoverFromAnthropic(err)) break;
        logFailover(req.label, provider, reason);
        continue;
      }
    }

    const result = await geminiGenerate({
      model: mapToGeminiModel(req),
      system: req.system,
      user: req.user,
      maxOutputTokens: req.maxTokens,
      temperature: req.temperature,
      signal: req.signal,
    });

    if (result.ok) return { ok: true, text: result.text, provider, model: result.model };

    attempts.push({ provider, reason: result.reason });
    if (isLast || !result.retryable) break;
    logFailover(req.label, provider, result.reason);
  }

  return {
    ok: false,
    reason: attempts.map((a) => `${a.provider}: ${a.reason}`).join(" | "),
    attempts,
  };
}

// ---------------------------------------------------------------------------
// Structured JSON
// ---------------------------------------------------------------------------

async function anthropicJson<T>(
  req: AiRequest,
  spec: AiJsonSpec,
): Promise<{ data: T; model: string }> {
  const model = req.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create(
    {
      model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
      tools: [
        {
          name: spec.name,
          ...(spec.description ? { description: spec.description } : {}),
          input_schema: spec.input_schema as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: spec.name },
      messages: [{ role: "user", content: req.user }],
    },
    req.signal ? { signal: req.signal } : undefined,
  );

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === spec.name,
  );
  if (!block) {
    throw new Error(`anthropic did not call ${spec.name} (stop_reason=${response.stop_reason})`);
  }

  return { data: block.input as T, model };
}

export async function generateJson<T>(
  req: AiRequest,
  spec: AiJsonSpec,
): Promise<AiJsonResult<T>> {
  const order = providerOrder();
  if (order.length === 0) {
    return {
      ok: false,
      reason: "no AI provider configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY)",
      attempts: [],
    };
  }

  const attempts: AiAttempt[] = [];

  for (const provider of order) {
    const isLast = provider === order[order.length - 1];

    if (provider === "anthropic") {
      try {
        const { data, model } = await anthropicJson<T>(req, spec);
        return { ok: true, data, provider, model };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        attempts.push({ provider, reason });
        if (isLast || !shouldFailoverFromAnthropic(err)) break;
        logFailover(req.label, provider, reason);
        continue;
      }
    }

    const result = await geminiGenerate({
      model: mapToGeminiModel(req),
      system: req.system,
      user: req.user,
      maxOutputTokens: req.maxTokens,
      temperature: req.temperature,
      responseSchema: toGeminiSchema(spec.input_schema),
      signal: req.signal,
    });

    if (!result.ok) {
      attempts.push({ provider, reason: result.reason });
      if (isLast || !result.retryable) break;
      logFailover(req.label, provider, result.reason);
      continue;
    }

    try {
      // responseMimeType application/json makes this reliable, but a truncated
      // reply still parses as invalid, so it is guarded.
      const data = JSON.parse(result.text) as T;
      return { ok: true, data, provider, model: result.model };
    } catch {
      const reason = "gemini returned unparseable JSON";
      attempts.push({ provider, reason });
      if (isLast) break;
      logFailover(req.label, provider, reason);
    }
  }

  return {
    ok: false,
    reason: attempts.map((a) => `${a.provider}: ${a.reason}`).join(" | "),
    attempts,
  };
}

// ---------------------------------------------------------------------------
// Structured output from a Zod schema
// ---------------------------------------------------------------------------

/**
 * Same contract as `generateJson`, but the shape is a Zod schema rather than raw
 * JSON Schema, and the reply is validated against it before it is returned.
 *
 * On Anthropic this is `messages.parse` with `zodOutputFormat`, which is what
 * the article pipeline already used. On Gemini the schema is converted to a
 * responseSchema, and the parsed reply is run back through Zod, so a provider
 * that honours the schema loosely cannot hand malformed data downstream.
 */
export async function generateStructured<S extends z.ZodType>(
  req: AiRequest,
  schema: S,
): Promise<AiJsonResult<z.infer<S>>> {
  const order = providerOrder();
  if (order.length === 0) {
    return {
      ok: false,
      reason: "no AI provider configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY)",
      attempts: [],
    };
  }

  const attempts: AiAttempt[] = [];

  for (const provider of order) {
    const isLast = provider === order[order.length - 1];

    if (provider === "anthropic") {
      const model = req.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL;
      try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.parse(
          {
            model,
            max_tokens: req.maxTokens,
            ...(req.system ? { system: req.system } : {}),
            ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
            messages: [{ role: "user", content: req.user }],
            output_config: { format: zodOutputFormat(schema) },
          },
          req.signal ? { signal: req.signal } : undefined,
        );

        const parsed = response.parsed_output;
        if (!parsed) throw new Error("anthropic returned no parsed_output");

        return { ok: true, data: parsed as z.infer<S>, provider, model };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        attempts.push({ provider, reason });
        if (isLast || !shouldFailoverFromAnthropic(err)) break;
        logFailover(req.label, provider, reason);
        continue;
      }
    }

    const result = await geminiGenerate({
      model: mapToGeminiModel(req),
      system: req.system,
      user: req.user,
      maxOutputTokens: req.maxTokens,
      temperature: req.temperature,
      responseSchema: toGeminiSchema(z.toJSONSchema(schema)),
      signal: req.signal,
    });

    if (!result.ok) {
      attempts.push({ provider, reason: result.reason });
      if (isLast || !result.retryable) break;
      logFailover(req.label, provider, result.reason);
      continue;
    }

    // Validate rather than cast. Gemini honours a responseSchema well but not
    // perfectly, and every caller of this function writes the result to Webflow
    // or to the database.
    const validated = schema.safeParse(safeJsonParse(result.text));
    if (validated.success) {
      return { ok: true, data: validated.data as z.infer<S>, provider, model: result.model };
    }

    const reason = `gemini output failed schema validation: ${validated.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
      .join("; ")}`;
    attempts.push({ provider, reason });
    if (isLast) break;
    logFailover(req.label, provider, reason);
  }

  return {
    ok: false,
    reason: attempts.map((a) => `${a.provider}: ${a.reason}`).join(" | "),
    attempts,
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** What is wired up right now. Surfaced on the settings page and in the CLI test. */
export function aiProviderStatus(): {
  primary: AiProvider;
  fallback: AiProvider | null;
  anthropicConfigured: boolean;
  geminiConfigured: boolean;
  order: AiProvider[];
} {
  const order = providerOrder();
  return {
    primary: primaryProvider(),
    fallback: fallbackEnabled() ? (primaryProvider() === "anthropic" ? "gemini" : "anthropic") : null,
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    geminiConfigured: isGeminiConfigured(),
    order,
  };
}
