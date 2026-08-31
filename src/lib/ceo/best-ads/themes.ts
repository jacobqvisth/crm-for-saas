// Grouping ad copy by the angle it takes, so the page answers "what should we
// write next" and not just "which sentence won".
//
// One winning headline is an anecdote. The same angle winning across a dozen
// assets, over hundreds of thousands of impressions, is a brief. These themes
// are the unit a person can actually act on.
//
// The patterns are deliberately hand-written rather than clustered. Automatic
// clustering over 250 short strings finds groupings that are real but not
// useful — it will happily separate "faster" from "fast". These ten are the
// angles the copy actually takes, and each one maps to a decision about the
// next batch. A phrase can belong to several: "Ask our AI Mechanic - get the
// solution in seconds" is audience, AI and speed at once, and splitting it
// across three counts is correct, because all three claims were on screen.
//
// The finding that motivated shipping this, measured over the account's full
// history: the themes that win CLICKS and the themes that win SIGNUPS are
// almost disjoint. Fault-code language runs 1.67x the average CTR and 0.41x the
// average conversion rate. OEM-data language is the mirror image — 0.54x on
// clicks, 1.68x on conversions. A page that ranked on CTR alone would have
// recommended writing more of exactly the copy that does not sell.

import type { AssetRollupRow, ThemeSummary } from "./types";

type ThemeDef = {
  key: string;
  label: string;
  description: string;
  pattern: RegExp;
};

export const COPY_THEMES: ThemeDef[] = [
  {
    key: "audience",
    label: "Names the reader",
    description:
      "Says mechanic, technician, workshop or garage out loud instead of describing the software.",
    pattern: /\b(mechanic|mechanics|technician|technicians|workshop|workshops|garage|garages)\b/i,
  },
  {
    key: "free",
    label: "Free or trial offer",
    description: "Leads with the free plan or the trial rather than the capability.",
    pattern: /\b(free|trial)\b/i,
  },
  {
    key: "money",
    label: "Money and margin",
    description:
      "Frames the product as profit per job, saved time or a price, not as a feature.",
    pattern: /\b(profit|profitable|margin|margins|revenue|save|saves|saving|price|per month|\$)\b/i,
  },
  {
    key: "second-person",
    label: "Second person",
    description: "Addresses the reader directly as you or your.",
    pattern: /\b(you|your|yours)\b/i,
  },
  {
    key: "oem",
    label: "OEM data and depth",
    description:
      "Sells the underlying data: OEM instructions, wiring diagrams, labour times, TSBs.",
    pattern:
      /\b(oem|wiring diagram|wiring diagrams|repair data|labour time|labour times|labor time|labor times|service data|repair manual|repair manuals|repair instructions|tsb)\b/i,
  },
  {
    key: "faultcode",
    label: "Fault-code language",
    description:
      "Built around DTCs, OBD2 and error codes — the vocabulary of someone mid-diagnosis.",
    pattern: /\b(dtc|dtcs|fault code|fault codes|obd2|obd|error code|error codes|trouble code|trouble codes)\b/i,
  },
  {
    key: "ai",
    label: "AI framing",
    description: "Puts the technology in front: AI-driven, AI assistant, AI mechanic.",
    pattern: /\b(ai|artificial intelligence)\b/i,
  },
  {
    key: "speed",
    label: "Speed and immediacy",
    description: "Promises instant, fast, faster or in seconds.",
    pattern: /\b(instant|instantly|instantly|seconds|fast|faster|fastest|quick|quicker|superfast|speed)\b/i,
  },
  {
    key: "accuracy",
    label: "Right first time",
    description:
      "Sells correctness rather than speed: accurate answers, the right solution, fewer comebacks.",
    pattern: /\b(comeback|comebacks|rework|accurate|accuracy|right|correct|correctly|solution|solutions)\b/i,
  },
  {
    key: "anti-forum",
    label: "Against the old way",
    description:
      "Positions against forum-trawling and endless searching rather than against a competitor.",
    pattern: /\b(forum|forums|scroll|scrolling|searching|google it|endless)\b/i,
  },
];

/**
 * Score every theme against the pooled rate of all text assets in the window.
 *
 * Pooling volumes is legitimate for a ratio even though per-asset volumes are
 * not additive: the double-counting inflates numerator and denominator by the
 * same factor and cancels. Only the rates are published; no total from here is
 * ever presented as a count of real clicks.
 */
export function summariseThemes(rows: AssetRollupRow[]): ThemeSummary[] {
  const text = rows.filter(
    (row) => row.kind === "text" && row.impressions > 0,
  );
  if (text.length === 0) return [];

  const totalImpressions = text.reduce((sum, row) => sum + row.impressions, 0);
  const totalClicks = text.reduce((sum, row) => sum + row.clicks, 0);
  const totalConversions = text.reduce((sum, row) => sum + row.conversions, 0);

  const baseCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const baseCvr = totalClicks > 0 ? totalConversions / totalClicks : 0;

  const summaries: ThemeSummary[] = [];

  for (const theme of COPY_THEMES) {
    const matches = text.filter((row) => row.text && theme.pattern.test(row.text));
    if (matches.length === 0) continue;

    const impressions = matches.reduce((sum, row) => sum + row.impressions, 0);
    const clicks = matches.reduce((sum, row) => sum + row.clicks, 0);
    const conversions = matches.reduce((sum, row) => sum + row.conversions, 0);
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cvr = clicks > 0 ? conversions / clicks : 0;

    summaries.push({
      key: theme.key,
      label: theme.label,
      description: theme.description,
      assets: matches.length,
      impressions,
      clicks,
      conversions,
      ctr,
      cvr,
      ctrIndex: baseCtr > 0 ? ctr / baseCtr : 1,
      cvrIndex: baseCvr > 0 ? cvr / baseCvr : 1,
      examples: matches
        // Examples have to be things that actually ran. An unserved asset with a
        // flattering rate would be the worst possible thing to hold up as proof.
        .filter((row) => row.impressions >= 800)
        .map((row) => ({
          text: row.text ?? "",
          ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
          impressions: row.impressions,
        }))
        .sort((a, b) => b.ctr - a.ctr)
        .slice(0, 3),
    });
  }

  // Ordered by the product, so an angle has to earn the click and the signup to
  // sit at the top — the same rule the asset ranking uses.
  summaries.sort((a, b) => b.ctrIndex * b.cvrIndex - a.ctrIndex * a.cvrIndex);
  return summaries;
}

/** Baseline rates for the whole text pool, for the playbook header. */
export function textBaseline(rows: AssetRollupRow[]) {
  const text = rows.filter((row) => row.kind === "text" && row.impressions > 0);
  const impressions = text.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = text.reduce((sum, row) => sum + row.clicks, 0);
  const conversions = text.reduce((sum, row) => sum + row.conversions, 0);
  return {
    assets: text.length,
    impressions,
    clicks,
    conversions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cvr: clicks > 0 ? conversions / clicks : 0,
  };
}
