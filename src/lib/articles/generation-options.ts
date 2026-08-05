// The "how should this be written" axes for the Articles studio, following the
// same one-module-for-UI-labels-and-prompt-guidance arrangement as
// src/lib/forums/generation-options.ts. Keeping the label maps and the guidance
// strings in one file is what stops the options panel and the prompts drifting
// apart, which is exactly what happened on the forums side before it was
// consolidated.

import { z } from "zod";
import { WRENCHLANE_KNOWLEDGE } from "@/lib/inbox/wrenchlane-knowledge";
import type {
  ArticleAngle,
  ArticleAudience,
  ArticleBrandLevel,
  ArticleCta,
  ArticleDataStrictness,
  ArticleGenerationOptions,
  ArticleLength,
  ArticleVoice,
} from "./types";

export const DEFAULT_ARTICLE_OPTIONS: ArticleGenerationOptions = {
  angle: "case_study",
  audience: "shop_owner",
  voice: "founder_first_person",
  length: "standard",
  brandLevel: "subtle",
  cta: "soft",
  hashtags: true,
  language: "en",
  dataStrictness: "strict",
};

export const articleOptionsSchema = z
  .object({
    angle: z.enum([
      "case_study",
      "data_insight",
      "how_to",
      "myth_buster",
      "market_shift",
      "founder_pov",
      "objection_handler",
    ]),
    audience: z.enum(["shop_owner", "technician", "dealer_fixed_ops", "distributor_partner"]),
    voice: z.enum(["founder_first_person", "company_brand", "technical_expert"]),
    length: z.enum(["short", "standard", "long"]),
    brandLevel: z.enum(["none", "subtle", "explicit"]),
    cta: z.enum(["none", "soft", "direct"]),
    hashtags: z.boolean(),
    language: z.string().min(2).max(5),
    dataStrictness: z.enum(["strict", "illustrative"]),
  })
  .partial();

export function normalizeArticleOptions(
  partial?: Partial<ArticleGenerationOptions> | null,
): ArticleGenerationOptions {
  return { ...DEFAULT_ARTICLE_OPTIONS, ...(partial ?? {}) };
}

/* --------------------------------------------------------- UI label maps */

export const ANGLE_LABEL: Record<ArticleAngle, string> = {
  case_study: "Case study",
  data_insight: "Data insight",
  how_to: "How-to",
  myth_buster: "Myth buster",
  market_shift: "Market shift",
  founder_pov: "Founder POV",
  objection_handler: "Objection handler",
};

export const AUDIENCE_LABEL: Record<ArticleAudience, string> = {
  shop_owner: "Shop owner",
  technician: "Technician",
  dealer_fixed_ops: "Dealer fixed ops",
  distributor_partner: "Distributor / partner",
};

export const VOICE_LABEL: Record<ArticleVoice, string> = {
  founder_first_person: "Founder, first person",
  company_brand: "Company voice",
  technical_expert: "Technical expert",
};

export const LENGTH_LABEL: Record<ArticleLength, string> = {
  short: "Short",
  standard: "Standard",
  long: "Long",
};

export const BRAND_LABEL: Record<ArticleBrandLevel, string> = {
  none: "No mention",
  subtle: "Subtle",
  explicit: "Named",
};

export const CTA_LABEL: Record<ArticleCta, string> = {
  none: "No CTA",
  soft: "Soft",
  direct: "Direct",
};

export const STRICTNESS_LABEL: Record<ArticleDataStrictness, string> = {
  strict: "Only real numbers",
  illustrative: "Allow hedged ranges",
};

/** Markets the CRM already runs sequences in, so the same codes are reused. */
export const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  et: "Estonian",
  lv: "Latvian",
  lt: "Lithuanian",
};

export function languageName(code: string): string {
  return LANGUAGE_LABEL[code] ?? code;
}

/* ------------------------------------------------------- prompt guidance */

export const ANGLE_GUIDANCE: Record<ArticleAngle, string> = {
  case_study:
    "Tell one concrete story start to finish: the vehicle and the fault that came in, why that kind of job normally stalls, what actually happened this time, and the outcome. Specific beats general. Never generalise into 'shops often see...' when you have one real case to describe.",
  data_insight:
    "Lead with the single most surprising number, then explain what it means and what a reader should do differently because of it. You are arguing a point that the data supports, not narrating a table. Pick the two or three figures that carry the argument and leave the rest out.",
  how_to:
    "Give a practical, ordered procedure the reader can actually follow: what to check first, what each result rules in or out, and where people usually go wrong. Concrete steps, no filler preamble.",
  myth_buster:
    "Name a belief the audience actually holds, state plainly why it is wrong or incomplete, and show what is true instead. Be respectful about it: the belief usually exists for a reason worth acknowledging.",
  market_shift:
    "Describe something that is changing in the trade, what is driving it, and what it means for a shop that has to decide where to invest. Grounded and specific, not futurology.",
  founder_pov:
    "A first-person observation from building this product: something you noticed, got wrong, or changed your mind about. Honest and specific. No triumphalism.",
  objection_handler:
    "Take the strongest real objection to AI-assisted diagnostics head on, state it fairly in the reader's own words, and answer it without dismissing it. If part of the objection is fair, say so.",
};

export const AUDIENCE_GUIDANCE: Record<ArticleAudience, string> = {
  shop_owner:
    "The reader owns or runs an independent workshop, typically 1 to 10 mechanics. They think in bay hours, throughput, comeback rate, and whether a job can be done without waiting for their best technician. Speak to the business, not the technology.",
  technician:
    "The reader turns wrenches. They will spot vagueness or a wrong technical detail instantly and stop reading. Use correct terminology, real procedures, and respect their expertise. Never explain their own job to them.",
  dealer_fixed_ops:
    "The reader runs a dealer service department. They think in effective labour rate, technician capacity, warranty exposure, and CSI. Larger scale and more process than an independent shop.",
  distributor_partner:
    "The reader is a distributor, tooling partner, or reseller thinking about whether this fits their catalogue and their customers. Speak to market fit and what it does for their customers.",
};

export const VOICE_GUIDANCE: Record<ArticleVoice, string> = {
  founder_first_person:
    "Write in first person singular as a founder of the company. You may say 'I' and 'we'. Direct, specific, willing to state an opinion. No corporate hedging, no third-person self-description.",
  company_brand:
    "Write in the company's voice using 'we'. Clear and professional without being stiff. Never refer to the company in the third person.",
  technical_expert:
    "Write as a diagnostic specialist explaining something to peers. Precise and technical, confident, no marketing register at all.",
};

export const LENGTH_GUIDANCE: Record<ArticleLength, string> = {
  short: "Tight. Around 100 to 150 words of body text. Every sentence has to earn its place.",
  standard: "Around 200 to 350 words of body text. Enough room for a real story or argument without padding.",
  long:
    "A full piece, roughly 900 to 1500 words, with sub-headings. Develop the argument properly, but never pad to hit a length.",
};

export const BRAND_GUIDANCE: Record<ArticleBrandLevel, string> = {
  none: "Do not mention Wrenchlane, the product, or any product at all. This is a pure industry-insight piece that stands entirely on its own.",
  subtle:
    "You may refer to the platform generically at most once, for example 'the diagnostic platform we build' or 'our own data', without turning it into a pitch. The piece must still read as genuinely useful if that reference were deleted.",
  explicit:
    "You may name Wrenchlane directly, but the piece still leads with the substance. One or two natural mentions at most, never a feature list, never sales language.",
};

export const CTA_GUIDANCE: Record<ArticleCta, string> = {
  none: "No call to action at all. End on the substance.",
  soft: "End with an invitation to conversation rather than a sell, for example asking whether others see the same pattern. One line, no link.",
  direct: "End with one clear, single call to action. Still one line, no hype, no stacked asks.",
};

export const STRICTNESS_GUIDANCE: Record<ArticleDataStrictness, string> = {
  strict:
    `You may only state numbers that appear explicitly in the facts given to you. Do not calculate derived figures, do not estimate, and do not round into a stronger claim.

This covers general and typical figures too, not just measurements about the specific case. Component lifespans, service intervals, failure rates, market sizes, adoption percentages and "typically lasts N" style durability claims are all numbers, and if they were not given to you then you do not have them. A sentence like "these are typically reliable well past 100,000 miles" is exactly the kind of invented statistic that must not appear: it sounds like trade knowledge, it is unverifiable, and it is the sort of thing a reader will quote back. Say "these are generally reliable" and move on.

If the piece would read better with a number you were not given, write it without the number.`,
  illustrative:
    "You may use clearly-hedged illustrative ranges where they help, but each one must be visibly marked as an estimate, for example 'typically somewhere in the region of one to three hours'. Never present an estimate as a measurement, and never attach an estimate to a specific named case.",
};

export function buildStyleGuidance(o: ArticleGenerationOptions): string {
  return [
    `Angle: ${ANGLE_GUIDANCE[o.angle]}`,
    `Audience: ${AUDIENCE_GUIDANCE[o.audience]}`,
    `Voice: ${VOICE_GUIDANCE[o.voice]}`,
    `Length: ${LENGTH_GUIDANCE[o.length]}`,
    `Brand prominence: ${BRAND_GUIDANCE[o.brandLevel]}`,
    `Call to action: ${CTA_GUIDANCE[o.cta]}`,
    `Numbers policy: ${STRICTNESS_GUIDANCE[o.dataStrictness]}`,
  ].join("\n");
}

/**
 * Product grounding, included only when the brand is actually going to be
 * mentioned. Mirrors mentionKnowledgeBlock() on the forums side: no reason to
 * put the product in the model's context when it is forbidden to mention it.
 */
export function brandKnowledgeBlock(level: ArticleBrandLevel): string {
  if (level === "none") return "";
  return `For grounding ONLY, so any product reference is accurate. Do not paste this in, do not turn it into a feature list:
=== WRENCHLANE PRODUCT KNOWLEDGE ===
${WRENCHLANE_KNOWLEDGE}
=== END ===
`;
}
