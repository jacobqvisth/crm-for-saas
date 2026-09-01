/**
 * "Look it up on the web, then give me a typed answer."
 *
 * Two AI call sites need this: `enrich/find-website` and `enrich/find-phone`.
 * Both were Anthropic-only for longer than the rest of the CRM because
 * Anthropic's server-side `web_search` tool does the whole job in one call, and
 * Gemini cannot.
 *
 * WHY IT IS TWO CALLS ON GEMINI
 * -----------------------------
 * Google Search grounding and structured output are mutually exclusive in
 * practice, and the failure is silent rather than loud: send `responseSchema`
 * (or function declarations) alongside `google_search` and you get a
 * perfectly-shaped reply with an empty `webSearchQueries` and no grounding
 * chunks, invented from parametric memory. Measured across five runs on
 * 2026-09-01, it never searched once, and in forced-function mode it returned a
 * plausible URL that was really a site-search link.
 *
 * A fabricated phone number or website is worse than no answer for these call
 * sites, so the two concerns are split:
 *
 *   1. GROUND   google_search, no schema, prose out, and the grounding metadata
 *               is checked so an ungrounded answer is rejected rather than used.
 *   2. EXTRACT  no tools, schema enforced, over the text from step 1.
 *
 * Step 2 goes through the normal provider layer, so it obeys
 * AI_PRIMARY_PROVIDER like everything else and can be served by either vendor.
 * Only step 1 is Gemini-specific.
 *
 * The extra call is cheap: the extract step is a short parse on a flash-class
 * model, and the point of routing this to Gemini at all is that the Google
 * credits are the ones with an expiry date on them.
 */

import type { z } from "zod";
import { geminiGroundedSearch, type GeminiGroundingEvidence } from "./gemini";
import { generateStructured } from "./provider";

export type GroundedExtractResult<T> =
  | {
      ok: true;
      data: T;
      /** Model that did the searching. The extract step may differ. */
      model: string;
      /** Proof of what was searched and which domains were consulted. */
      evidence: GeminiGroundingEvidence;
    }
  | { ok: false; reason: string; retryable: boolean };

export type GroundedExtractRequest<S extends z.ZodType> = {
  /** Call-site identifier for logs, e.g. "enrich/find-website". */
  label: string;
  /** What to look up. Written as an instruction to a researcher. */
  searchPrompt: string;
  /** Optional steer for the search step (rules about what counts as a hit). */
  searchSystem?: string;
  /** How to turn the findings into the schema. */
  extractSystem: string;
  schema: S;
  /**
   * Prose budget for the search step. Needs real room: the findings are the only
   * input the extract step gets, so truncating them loses candidates.
   */
  searchMaxTokens?: number;
  extractMaxTokens?: number;
  /** Use the stronger (pro) model for the search step. */
  strong?: boolean;
  signal?: AbortSignal;
};

export async function groundedExtract<S extends z.ZodType>(
  req: GroundedExtractRequest<S>,
): Promise<GroundedExtractResult<z.infer<S>>> {
  // --- 1. ground ------------------------------------------------------------
  const search = await geminiGroundedSearch({
    model: req.strong ? process.env.GEMINI_MODEL_STRONG || "gemini-pro-latest" : undefined,
    system: req.searchSystem,
    user: req.searchPrompt,
    maxOutputTokens: req.searchMaxTokens ?? 2000,
    // Search needs to reason about which result is the right entity, so this is
    // not the place to economise on thinking.
    thinkingLevel: "low",
    signal: req.signal,
  });

  if (!search.ok) {
    return { ok: false, reason: `grounded search failed: ${search.reason}`, retryable: search.retryable };
  }

  // --- 2. extract -----------------------------------------------------------
  const extract = await generateStructured(
    {
      label: `${req.label}-extract`,
      system: req.extractSystem,
      user: [
        "Here is what a web search turned up. Use ONLY what is in these findings.",
        "Do not add a result that does not appear below, and do not fill a field by guessing.",
        "",
        `Domains consulted: ${search.evidence.sources.join(", ") || "(none reported)"}`,
        "",
        "=== FINDINGS ===",
        search.text,
        "=== END FINDINGS ===",
        "",
        "Now produce the structured answer.",
      ].join("\n"),
      maxTokens: req.extractMaxTokens ?? 1500,
      signal: req.signal,
    },
    req.schema,
  );

  if (!extract.ok) {
    return {
      ok: false,
      reason: `extract from findings failed: ${extract.reason}`,
      // The search half already worked, so a retry is cheap and often enough.
      retryable: true,
    };
  }

  return {
    ok: true,
    data: extract.data as z.infer<S>,
    model: search.model,
    evidence: search.evidence,
  };
}
