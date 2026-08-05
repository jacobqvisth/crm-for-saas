// The Anthropic call behind the Articles studio.
//
// Two deliberate differences from src/lib/forums/generate.ts, which this is
// otherwise modelled on:
//
//  1. Structured outputs instead of "return only JSON" plus a defensive parser.
//     The forums generator strips code fences and hunts for the first brace
//     because it was written before that was an option. Here the schema is
//     enforced at the API layer, so the model retries on a mismatch and there is
//     no parser to get wrong.
//
//  2. claude-opus-5 rather than Sonnet. These are public-facing brand artifacts
//     at very low volume, so quality dominates cost. Thinking is on by default
//     on Opus 5, which is what we want, and because max_tokens caps thinking
//     plus response together, max_tokens is set generously.
//
// Every text field goes through stripLongDashes: em and en dashes are banned in
// generated Wrenchlane copy. Worth noting the competitor post that inspired this
// feature is full of them.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { NO_LONG_DASH_INSTRUCTION, stripLongDashes } from "@/lib/ai/no-long-dash";
import { decodeStrayUnicodeEscapes } from "./sanitize";
import {
  brandKnowledgeBlock,
  buildStyleGuidance,
  languageName,
} from "./generation-options";
import { getFormatSpec } from "./formats";
import { renderFactPack, type StatFactPack } from "./stat-stories";
import {
  hasImpact,
  type ArticleClaim,
  type ArticleDiagnosticSnapshot,
  type ArticleFormat,
  type ArticleGenerationOptions,
  type ArticleImpact,
  type ArticleSeo,
} from "./types";

const MODEL = "claude-opus-5";

/**
 * Where to go when the primary model's capacity pool is exhausted.
 *
 * A 529 overloaded_error is a capacity signal for that specific model, so
 * retrying the same model can keep failing through a broad overload. Sonnet 5 is
 * a separate pool and is a legitimate fallback for public-facing copy (the
 * forums generator has run on Sonnet since June 2026 for exactly this kind of
 * writing). Which model actually produced a draft is recorded on the row and
 * surfaced in the UI, so a fallback is never a silent quality downgrade.
 */
const FALLBACK_MODEL = "claude-sonnet-5";

// Room for a 2000-word article plus adaptive thinking. Comfortably inside the
// SDK's non-streaming HTTP timeout.
const MAX_TOKENS = 16000;

/**
 * The SDK retries 408/409/429/5xx with exponential backoff and honours
 * retry-after. The default of 2 is too few for a sustained overload, and this is
 * a low-volume interactive tool where waiting beats failing.
 */
const MAX_RETRIES = 4;

/** Why a generation failed, so the UI can say something useful. */
export type GenerateFailureKind =
  | "overloaded" // 529 / 429: capacity, worth retrying
  | "refusal" // the model declined
  | "not_configured" // missing API key
  | "bad_output" // parsed but unusable
  | "unknown";

/* ------------------------------------------------------------ output shape */

const draftSchema = z.object({
  hooks: z
    .array(z.string())
    .describe(
      "Alternative opening lines, strongest first. Each must work as a standalone hook.",
    ),
  title: z
    .string()
    .nullable()
    .describe("Headline or subject line. Null for channels that have no title."),
  body: z
    .string()
    .describe(
      "The full piece, already opening with hooks[0]. Real line breaks, not escaped ones.",
    ),
  hashtags: z
    .array(z.string())
    .describe("Hashtags without the leading hash. Empty array when not applicable."),
  claims: z
    .array(
      z.object({
        text: z.string().describe("The specific assertion, quoted from the body."),
        source: z
          .enum(["data", "user", "knowledge", "unsourced"])
          .describe(
            "data = came from the supplied facts. user = a supplied impact figure. knowledge = a product fact from the grounding block. unsourced = your own words, not traceable to anything given to you.",
          ),
      }),
    )
    .describe(
      "Every factual or numeric assertion the body makes, with an honest provenance label. Be complete and be honest: labelling something 'data' when it is not is the worst possible failure here.",
    ),
  seo: z
    .object({
      metaTitle: z.string().nullable(),
      metaDescription: z.string().nullable(),
      slug: z.string().nullable(),
      internalLinkIdeas: z.array(z.string()),
    })
    .describe("Blog only. Nulls and an empty array for every other channel."),
});

type Draft = z.infer<typeof draftSchema>;

/* ------------------------------------------------------------------ prompt */

/**
 * The stable half of the system prompt: role, channel structure, honesty rules,
 * product grounding. Varies only by format and brand level, so it is the cached
 * prefix when Jacob generates several drafts in a row.
 */
function buildStablePrompt(format: ArticleFormat, options: ArticleGenerationOptions): string {
  const spec = getFormatSpec(format);
  if (!spec) throw new Error(`Unknown format: ${format}`);

  return `You write content for Wrenchlane, an AI diagnostic platform for automotive workshops. Everything you write here is copy-pasted by a human and published under a real name, so it has to be something a knowledgeable person in this trade would be happy to put their name to.

CHANNEL: ${spec.label}
${spec.structure}

WHAT MAKES THIS GOOD OR BAD
The single most common failure is generic content: true, unobjectionable, and worth nothing. Specificity is the whole game. A named vehicle, an actual fault code, a real measured number, a genuine diagnostic step. If a sentence could appear verbatim in a competitor's blog post, delete it.

Things that make it read like AI, all forbidden: opening with "In today's fast-paced automotive industry", the phrase "game changer", "revolutionise", "leverage" as a verb, "it's important to note", stacked rhetorical questions, a tidy three-item list where two items would do, and closing with a summary of what you just said.

HONESTY RULES, these override style
- Never invent a number. Not a percentage, not a currency amount, not a time saving, not an industry statistic. If you were not given it, it does not go in.
- Never invent a customer, a workshop name, a person, or a quote. The facts you are given are anonymised on purpose. Do not add a plausible name or location to make the story concrete.
- Where a fact is marked as not recorded, it genuinely does not exist in our data. Write around the gap. Do not fill it with a realistic-sounding value, and do not gesture at one ("a high-mileage example", "a well-used car") when you were not told. A piece with one fewer detail is fine; a piece with one invented detail is not publishable.
- Data you are given is Wrenchlane's own platform data. Describe it as that. It is not an industry survey and not market-wide.
- Do not imply a causal outcome the facts do not support. That a diagnosis ranked a cause first does not mean it was confirmed, and does not mean anyone saved money.
- You must then list every factual assertion in the claims field with an honest provenance label. This list is read by a human before publishing, so an incomplete or flattering list defeats its whole purpose. Anything you wrote from your own general knowledge is "unsourced", and that is a perfectly acceptable label. Mislabelling is not.

WRITING MECHANICS
- ${NO_LONG_DASH_INSTRUCTION}
- Vary sentence length. A short sentence after two long ones is what makes prose readable.
- Prefer the concrete noun. "The solenoid" beats "the component in question".
- Contractions are fine. Corporate register is not.

${brandKnowledgeBlock(options.brandLevel)}`;
}

/** The volatile half: the per-request style axes. */
function buildStylePrompt(options: ArticleGenerationOptions, format: ArticleFormat): string {
  const spec = getFormatSpec(format);
  const lengthLine = spec?.lengthOverride?.[options.length];
  const hookNote = spec?.hookMaxChars
    ? ` Each hook must be under ${spec.hookMaxChars} characters.`
    : "";

  return `HOW TO WRITE THIS ONE
${buildStyleGuidance(options)}
${lengthLine ? `Length for this channel: ${lengthLine}` : ""}

Language: write everything, including the hooks and any title, in ${languageName(options.language)}.

Hooks: produce exactly ${spec?.hookCount ?? 3} genuinely different opening lines, not three rewordings of one idea. Try a different entry point in each: the concrete detail, the surprising number, the reader's own frustration.${hookNote} The body must open with the first one.

Hashtags: ${options.hashtags && spec?.wantsHashtags ? "include five or six, mixing category, persona and product. No leading hash character in the array." : "return an empty array."}
SEO fields: ${spec?.wantsSeo ? "fill all of them." : "return nulls and an empty array."}`;
}

function describeDiagnostic(s: ArticleDiagnosticSnapshot): string {
  const lines: string[] = [];
  // Absent fields are named explicitly rather than silently omitted.
  //
  // This is not defensive padding. In testing, a diagnostic with mileage null
  // produced a post asserting "at 110,000 miles" and did not flag it as
  // unsourced: given a case-study shape with a gap in it, the model fills the gap
  // with something plausible. Stating "not recorded, do not state one" removes
  // the gap. Same reasoning for every other optional field.
  const missing: string[] = [];

  const car = [s.carYear, s.carMake, s.carModel].filter(Boolean).join(" ");
  if (car) lines.push(`Vehicle: ${car}`);
  else missing.push("the vehicle make, model and year");
  if (!s.carYear) missing.push("the model year");

  if (s.mileage) lines.push(`Odometer reading: ${s.mileage} (unit not recorded, so do not write "miles" or "km", either say "on the clock" or leave the reading out)`);
  else missing.push("the odometer reading");

  if (s.country) lines.push(`Market: ${s.country}`);
  else missing.push("the country");

  if (s.dtcs.length) lines.push(`Fault codes present: ${s.dtcs.join(", ")}`);
  else missing.push("any fault codes");

  if (s.symptoms.length) lines.push(`Symptoms recorded: ${s.symptoms.join(", ")}`);
  else missing.push("a structured symptom list");

  if (s.description) {
    lines.push(`What the technician wrote, verbatim: "${s.description}"`);
  } else {
    missing.push("any written description from the technician");
  }
  if (s.causes.length) {
    lines.push("Causes our engine ranked, most likely first:");
    for (const c of s.causes) {
      const prob = c.probability != null ? `, ranked at ${Math.round(c.probability * 100)}%` : "";
      const sev = c.severity ? `, severity ${c.severity}` : "";
      lines.push(`  - ${c.name}${prob}${sev}${c.description ? `: ${c.description}` : ""}`);
      if (c.suggestedTests.length) {
        lines.push(`      Tests suggested for this cause: ${c.suggestedTests.join("; ")}`);
      }
    }
    lines.push(
      "Use these ranked causes and their suggested tests as the real diagnostic path. This is the part no competitor can fabricate, so do not water it down into generalities.",
    );
  }
  if (missing.length) {
    lines.push(
      `NOT RECORDED for this job: ${missing.join("; ")}. These values do not exist in our data. Write the piece without them. Do not supply a plausible substitute for any of them, and do not imply a value you were not given.`,
    );
  }
  lines.push(
    "The workshop and technician are deliberately not identified. Do not invent a name, a town, or a person for them.",
  );
  return lines.join("\n");
}

function describeImpact(impact: ArticleImpact): string {
  if (!hasImpact(impact)) {
    return `IMPACT FIGURES: none supplied.
This means you may NOT state any time saved, money earned, delay avoided, or efficiency gained. Do not estimate them, do not hedge them into existence, and do not include a result block. Write the piece on the strength of the diagnostic facts alone.`;
  }
  const cur = impact.currency?.trim() ?? "";
  const hasMoney = impact.ticketValue != null || impact.additionalProfit != null;
  const lines: string[] = [
    "IMPACT FIGURES, supplied by a human and verified. You may state these as fact, and you may not add any others:",
  ];
  if (impact.hoursSaved != null) lines.push(`  - Hours saved on the job: ${impact.hoursSaved}`);
  if (impact.daysAvoided != null) lines.push(`  - Days of delay avoided: ${impact.daysAvoided}`);
  // Money figures with no currency selected are the same unlabelled-number trap
  // as the null mileage: the model will attach a plausible unit. State the
  // amount bare and forbid naming one.
  if (impact.ticketValue != null) {
    lines.push(`  - Ticket value: ${cur ? `${cur}${impact.ticketValue}` : String(impact.ticketValue)}`);
  }
  if (impact.additionalProfit != null) {
    lines.push(
      `  - Additional profit on the ticket: ${cur ? `${cur}${impact.additionalProfit}` : String(impact.additionalProfit)}`,
    );
  }
  if (hasMoney && !cur) {
    lines.push(
      "  - CURRENCY NOT RECORDED for the amounts above. Do not name, symbol, or imply a currency: no dollars, euros, kronor, pounds, no $ or € sign. Write the bare number with a neutral noun, for example \"a 750 ticket\" or \"750 on the ticket\", or leave the amount out entirely if that reads badly in this language.",
    );
  }
  if (impact.resolvedWithoutEscalation != null) {
    lines.push(
      impact.resolvedWithoutEscalation
        ? "  - Resolved without escalating to a senior technician"
        : "  - Did require escalation to a senior technician",
    );
  }
  if (impact.note && impact.note.trim()) lines.push(`  - Also worth stating: ${impact.note.trim()}`);
  lines.push("Label every one of these as source \"user\" in the claims field.");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ result */

export interface GeneratedArticle {
  hooks: string[];
  title: string | null;
  body: string;
  hashtags: string[];
  claims: ArticleClaim[];
  seo: ArticleSeo;
  model: string;
  /** True when the primary model was unavailable and the fallback wrote this. */
  usedFallbackModel: boolean;
}

export type GenerateArticleResult =
  | { ok: true; article: GeneratedArticle }
  | { ok: false; reason: string; kind: GenerateFailureKind };

export interface GenerateArticleInput {
  format: ArticleFormat;
  options: ArticleGenerationOptions;
  impact: ArticleImpact;
  /** Exactly one of these three carries the grounding. */
  diagnostic?: ArticleDiagnosticSnapshot | null;
  statPack?: StatFactPack | null;
  freeTopic?: string | null;
}

export async function generateArticle(
  input: GenerateArticleInput,
): Promise<GenerateArticleResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, kind: "not_configured", reason: "ANTHROPIC_API_KEY is not set" };

  const spec = getFormatSpec(input.format);
  if (!spec) return { ok: false, kind: "unknown", reason: `Unknown format: ${input.format}` };

  const grounding = buildGrounding(input);
  if (!grounding) return { ok: false, kind: "unknown", reason: "No grounding supplied" };

  const client = new Anthropic({ apiKey, maxRetries: MAX_RETRIES });

  const request = {
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text" as const,
        text: buildStablePrompt(input.format, input.options),
        // Stable across drafts of the same format, so this is the cached
        // prefix. Volatile per-request content all lives after it.
        cache_control: { type: "ephemeral" as const },
      },
      { type: "text" as const, text: buildStylePrompt(input.options, input.format) },
    ],
    messages: [{ role: "user" as const, content: grounding }],
    output_config: { format: zodOutputFormat(draftSchema) },
  };

  // Try the primary model, then the fallback pool if the primary is overloaded.
  // The SDK already retried MAX_RETRIES times with backoff before we get here, so
  // reaching the fallback means the pool is genuinely saturated, not flaky.
  let draft: Draft | null = null;
  let usedModel = MODEL;
  let lastFailure: { reason: string; kind: GenerateFailureKind } | null = null;

  for (const model of [MODEL, FALLBACK_MODEL]) {
    try {
      const response = await client.messages.parse({ ...request, model });
      if (response.stop_reason === "refusal") {
        // A refusal is about the content, not capacity, so the fallback would
        // almost certainly refuse too. Stop here.
        return {
          ok: false,
          kind: "refusal",
          reason: "The model declined to write this. Try a different angle or source.",
        };
      }
      draft = response.parsed_output ?? null;
      usedModel = model;
      break;
    } catch (err) {
      lastFailure = classifyError(err);
      // Only capacity problems are worth trying another model for.
      if (lastFailure.kind !== "overloaded") return { ok: false, ...lastFailure };
      if (model === FALLBACK_MODEL) return { ok: false, ...lastFailure };
    }
  }

  if (!draft) {
    return (
      (lastFailure && { ok: false as const, ...lastFailure }) ?? {
        ok: false as const,
        kind: "bad_output" as const,
        reason: "The model returned nothing usable. Try again.",
      }
    );
  }
  if (!draft.body.trim()) {
    return { ok: false, kind: "bad_output", reason: "The model returned an empty draft. Try again." };
  }

  // Every model-authored string goes through both repairs: long dashes are banned
  // in Wrenchlane copy, and stray \uXXXX escapes otherwise reach a published page.
  const clean = (s: string) => stripLongDashes(decodeStrayUnicodeEscapes(s));

  const hooks = draft.hooks.map((h) => clean(h.trim())).filter(Boolean);

  return {
    ok: true,
    article: {
      hooks,
      title: draft.title ? clean(draft.title.trim()) : null,
      body: clean(draft.body.trim()),
      // Defend against the model including the hash despite being told not to.
      hashtags: draft.hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean),
      claims: draft.claims
        .filter((c) => c.text.trim())
        .map((c) => ({ text: clean(c.text.trim()), source: c.source })),
      seo: {
        metaTitle: draft.seo.metaTitle ? clean(draft.seo.metaTitle.trim()) : null,
        metaDescription: draft.seo.metaDescription
          ? clean(draft.seo.metaDescription.trim())
          : null,
        slug: draft.seo.slug?.trim() || null,
        internalLinkIdeas: draft.seo.internalLinkIdeas
          .map((s) => clean(s.trim()))
          .filter(Boolean),
      },
      model: usedModel,
      usedFallbackModel: usedModel !== MODEL,
    },
  };
}

/**
 * Turn an SDK error into something a human can act on. The raw shape is a JSON
 * blob ("anthropic error: 529 {\"type\":\"error\"...") which was being
 * surfaced straight into a toast.
 */
function classifyError(err: unknown): { reason: string; kind: GenerateFailureKind } {
  const status =
    err instanceof Anthropic.APIError ? err.status : undefined;
  const type = err instanceof Anthropic.APIError ? err.type : undefined;

  if (status === 529 || type === "overloaded_error") {
    return {
      kind: "overloaded",
      reason:
        "Claude is overloaded right now. Nothing is wrong with your setup, give it a minute and press Write it again.",
    };
  }
  if (status === 429 || type === "rate_limit_error") {
    return {
      kind: "overloaded",
      reason: "Rate limited by the Claude API. Wait a moment and try again.",
    };
  }
  if (status === 401 || status === 403) {
    return { kind: "not_configured", reason: "The Claude API key was rejected. Check ANTHROPIC_API_KEY." };
  }
  if (status && status >= 500) {
    return { kind: "overloaded", reason: "The Claude API had a server error. Try again in a moment." };
  }
  return {
    kind: "unknown",
    reason: err instanceof Error ? err.message : String(err),
  };
}

function buildGrounding(input: GenerateArticleInput): string | null {
  const impactBlock = describeImpact(input.impact);

  if (input.diagnostic) {
    return `Here is one real diagnostic our engine ran. Every fact below is genuine and anonymised.

${describeDiagnostic(input.diagnostic)}

${impactBlock}

Write the piece now.`;
  }

  if (input.statPack) {
    return `Here is a real slice of our own platform data to build the piece around.

${renderFactPack(input.statPack)}

${impactBlock}

Write the piece now. Lead with whichever figure above is genuinely the most surprising to someone who works in this trade, and make an argument with it rather than listing the rest.`;
  }

  const topic = input.freeTopic?.trim();
  if (topic) {
    return `Topic to write about: ${topic}

You have been given NO data for this one. That means you may not state any statistic, percentage, or measured figure at all, and every factual assertion you make must be labelled "unsourced" in the claims field unless it comes from the product knowledge block. Write from reasoning and trade knowledge, and keep it concrete anyway.

${impactBlock}

Write the piece now.`;
  }

  return null;
}
