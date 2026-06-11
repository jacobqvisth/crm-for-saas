// Pure matching logic for the "Check Customer.io" reconciliation: compares
// the board's email touchpoints against the live campaign list and proposes
// corrections. Kept free of IO so the scoring is easy to reason about.

import type { CioCampaignSummary } from "./cio";

const STOPWORDS = new Set([
  "email",
  "emails",
  "the",
  "a",
  "an",
  "to",
  "for",
  "of",
  "in",
  "on",
  "and",
  "or",
  "after",
  "before",
  "with",
  "your",
  "will",
  "p1",
  "p2",
  "p3",
  "p4",
  "p5",
]);

export function titleTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9åäöé]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Two tokens "match" when equal or one is a ≥4-char prefix of the other (end/ending). */
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

/** 0..1 similarity between a touchpoint title and a campaign name. */
export function matchScore(itemTitle: string, campaignName: string): number {
  const ta = titleTokens(itemTitle);
  const tb = titleTokens(campaignName);
  if (ta.length === 0 || tb.length === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.some((u) => tokenMatches(t, u))) inter += 1;
  }
  const union = ta.length + tb.length - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Best campaign candidate for an unlinked touchpoint title. Each candidate is
 * scored against its campaign name AND its email subject lines (a campaign
 * named "P1" still matches a "Welcome email" card via its subject).
 */
export interface MatchCandidate {
  campaign: CioCampaignSummary;
  /** Extra text to match against, e.g. the campaign's email subjects. */
  texts: string[];
}

export function bestMatch(
  title: string,
  candidates: MatchCandidate[]
): { campaign: CioCampaignSummary; score: number } | null {
  let best: { campaign: CioCampaignSummary; score: number } | null = null;
  for (const cand of candidates) {
    const score = Math.max(
      matchScore(title, cand.campaign.name),
      ...cand.texts.map((t) => matchScore(title, t))
    );
    if (score > 0 && (!best || score > best.score)) best = { campaign: cand.campaign, score };
  }
  return best && best.score >= 0.3 ? best : null;
}

/** Suggestions at or above this score are applied automatically. */
export const AUTO_APPLY_SCORE = 0.45;

/** Map a Customer.io campaign state onto the board's status taxonomy. */
export function stateToStatus(state: string | null): "Live" | "Planned" | "Paused" {
  const s = (state ?? "").toLowerCase();
  if (s === "running") return "Live";
  if (s === "draft") return "Planned";
  return "Paused"; // stopped / archived / unknown
}

export function verifiedNote(campaign: CioCampaignSummary, checkedAt: string): string {
  return `Verified in Customer.io on ${checkedAt}: campaign "${campaign.name}" (id ${campaign.id}) is ${campaign.state ?? "in an unknown state"}.`;
}
