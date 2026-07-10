// Shared "how should this draft be written" options for every forum text
// generator (posts, replies to posts, replies to other people's comments, and
// per-member comments). Before this module the mention-level guidance lived as
// three near-identical copies across generate.ts / reply-generate.ts /
// thread-analyze.ts and comment.ts opted out of mentions entirely. This is the
// single source of truth for both the UI label maps and the prompt guidance so
// the "Generation options" panel and the model prompts never drift apart.

import { z } from "zod";
import { WRENCHLANE_KNOWLEDGE } from "@/lib/inbox/wrenchlane-knowledge";
import type {
  ForumApproach,
  ForumGenerationOptions,
  ForumMentionLevel,
  ForumReplyLength,
  ForumVoice,
} from "./types";

// The raw axis types live in types.ts (leaf module) to avoid a circular import;
// re-export them here so callers can pull types + label maps from one place.
export type {
  ForumApproach,
  ForumGenerationOptions,
  ForumMentionLevel,
  ForumReplyLength,
  ForumVoice,
};

export const DEFAULT_GENERATION_OPTIONS: ForumGenerationOptions = {
  mentionLevel: "none",
  length: "balanced",
  voice: "owner",
  approach: "direct",
};

// Request-body schema shared by every forum generate/regenerate route. Every
// field is optional so callers can send a partial (or nothing) and the
// generator fills the rest from DEFAULT_GENERATION_OPTIONS via normalizeOptions.
export const generationOptionsSchema = z
  .object({
    mentionLevel: z.enum(["none", "subtle", "explicit"]),
    length: z.enum(["quick", "balanced", "thorough"]),
    voice: z.enum(["owner", "mechanic", "neutral"]),
    approach: z.enum(["direct", "ask_questions", "similar_experience", "step_by_step"]),
  })
  .partial();

// Fill in any missing axis with the default. Persisted rows store a partial
// generation_options jsonb (or none at all, pre-feature), so always normalize
// before handing options to a generator.
export function normalizeOptions(
  partial?: Partial<ForumGenerationOptions> | null,
): ForumGenerationOptions {
  return { ...DEFAULT_GENERATION_OPTIONS, ...(partial ?? {}) };
}

// --- UI label maps (used by the shared React panel) --------------------------

export const MENTION_LABEL: Record<ForumMentionLevel, string> = {
  none: "No mention",
  subtle: "Subtle mention",
  explicit: "Explicit mention",
};

export const LENGTH_LABEL: Record<ForumReplyLength, string> = {
  quick: "Quick tip",
  balanced: "Balanced",
  thorough: "Thorough",
};

export const VOICE_LABEL: Record<ForumVoice, string> = {
  owner: "Fellow owner",
  mechanic: "Experienced mechanic",
  neutral: "Neutral helper",
};

export const APPROACH_LABEL: Record<ForumApproach, string> = {
  direct: "Direct fix",
  ask_questions: "Ask questions first",
  similar_experience: "Similar experience",
  step_by_step: "Step by step",
};

// --- Prompt guidance (used by the generators) --------------------------------

export const MENTION_GUIDANCE: Record<ForumMentionLevel, string> = {
  none: "Do NOT mention Wrenchlane, any app, or any product at all. This is pure community help; the only goal is to genuinely help this person.",
  subtle:
    "You MAY add one passing, natural aside that you ran the symptoms through an AI car-diagnosis app to narrow it down, without naming a brand or linking anything. Keep it incidental; the text must stand on its own as helpful even if that line were deleted. Skip it if it would feel forced.",
  explicit:
    "You may name Wrenchlane once, naturally, as the tool that helped (e.g. 'I ran the symptoms through Wrenchlane and it flagged X as the most likely cause'). One mention only, no link, no sales language. It must still read as a genuine owner/helper, never an ad; lead with real help and mention it at most as an afterthought.",
};

export const LENGTH_GUIDANCE: Record<ForumReplyLength, string> = {
  quick: "Keep it short and punchy: one or two sentences, or a single tight paragraph. Just the key point, no preamble.",
  balanced: "Natural length: two or three short paragraphs. Enough to be genuinely useful without padding.",
  thorough:
    "A more complete answer: walk through the reasoning, cover the most likely cause and the main runner-ups, and how to confirm each. Still readable, never a wall of text.",
};

export const VOICE_GUIDANCE: Record<ForumVoice, string> = {
  owner: "Write as a fellow car owner or DIYer sharing from personal experience, not an expert. Peer to peer.",
  mechanic:
    "Write as an experienced mechanic who has seen this many times. Confident, hands-on and practical, but never condescending.",
  neutral: "Write as a knowledgeable, helpful community regular; neither claiming to be a pro nor a novice.",
};

export const APPROACH_GUIDANCE: Record<ForumApproach, string> = {
  direct: "Lead with the most likely cause and the concrete fix or next step. Get to the answer fast.",
  ask_questions:
    "Focus on the one or two missing details that would actually change the diagnosis and ask them. Offer a provisional direction, but be clear you'd want those answers first.",
  similar_experience:
    "Anchor the reply in a specific similar case you (or someone you know) went through, then connect it to their situation.",
  step_by_step:
    "Give a clear ordered path to diagnose it: what to check first, what that rules in or out, and the next step from there.",
};

// A compact guidance block covering the three style axes, dropped into any
// system prompt. Mention level is handled separately (it also gates whether the
// product-knowledge block is included) via mentionKnowledgeBlock().
export function buildStyleGuidance(o: ForumGenerationOptions): string {
  return [
    `Length: ${LENGTH_GUIDANCE[o.length]}`,
    `Voice: ${VOICE_GUIDANCE[o.voice]}`,
    `Approach: ${APPROACH_GUIDANCE[o.approach]}`,
  ].join("\n");
}

// The grounding block appended to a prompt so any Wrenchlane mention is
// accurate. Empty string for "none" (no product talk at all, so no need to put
// the product in the model's context).
export function mentionKnowledgeBlock(level: ForumMentionLevel): string {
  if (level === "none") return "";
  return `For grounding ONLY, so any mention is accurate (do not paste this in):
=== WRENCHLANE PRODUCT KNOWLEDGE ===
${WRENCHLANE_KNOWLEDGE}
=== END ===
`;
}

// --- Persona ceiling helpers (used by the UI warn + thread analyzer) ---------

export const MENTION_RANK: Record<ForumMentionLevel, number> = {
  none: 0,
  subtle: 1,
  explicit: 2,
};

// The strongest mention level a roster account's persona is cleared to use.
export function mentionCeilingFromFlags(flags: {
  can_mention_wrenchlane?: boolean | null;
  uses_ai_tools?: boolean | null;
}): ForumMentionLevel {
  if (flags.can_mention_wrenchlane) return "explicit";
  if (flags.uses_ai_tools) return "subtle";
  return "none";
}

// True when the chosen level is stronger than the account's persona ceiling.
// The UI uses this to warn-but-allow (Jacob's call 2026-07-10) rather than
// silently clamp.
export function exceedsCeiling(
  level: ForumMentionLevel,
  ceiling: ForumMentionLevel,
): boolean {
  return MENTION_RANK[level] > MENTION_RANK[ceiling];
}
