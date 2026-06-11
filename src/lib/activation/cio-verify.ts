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

/** Best campaign candidate for an unlinked touchpoint title. */
export function bestMatch(
  title: string,
  campaigns: CioCampaignSummary[]
): { campaign: CioCampaignSummary; score: number } | null {
  let best: { campaign: CioCampaignSummary; score: number } | null = null;
  for (const c of campaigns) {
    const score = matchScore(title, c.name);
    if (score > 0 && (!best || score > best.score)) best = { campaign: c, score };
  }
  return best && best.score >= 0.3 ? best : null;
}

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
