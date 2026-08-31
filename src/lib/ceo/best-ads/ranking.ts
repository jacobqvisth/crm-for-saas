// Scoring for /dashboard/best-ads: turning per-asset Google Ads metrics into a
// ranking you can act on.
//
// Three problems have to be solved before "best" means anything here.
//
// 1. RAW RATES REWARD LUCK. An asset with 8 impressions and 1 click scores a
//    12.5% CTR and would top any naive sort, ahead of one that has held 5.2%
//    over 300,000 impressions. Both estimates are of the same quantity; only
//    one of them is worth believing. So every rate is shrunk toward the
//    baseline for its own field type by a fixed pseudo-count: an asset with no
//    evidence scores exactly average, and evidence pulls it away in proportion
//    to how much there is. This is the standard empirical-Bayes correction and
//    it is what stops the top of the list being a list of accidents.
//
// 2. FIELD TYPES ARE NOT COMPARABLE. Portrait marketing images run a 4.6% CTR
//    and YouTube videos 1.4%, because they sit in different placements, not
//    because portrait images are three times the creative. Ranking them in one
//    pool would sort by format. Every asset is therefore scored against the
//    pooled rate of its own field type, and the published number is a lift —
//    1.9 means "1.9x the average headline", which is comparable across formats
//    in a way a bare percentage is not.
//
// 3. CLICKS ARE NOT THE GOAL. us-codes+make bought 13,505 clicks and converted
//    exactly none of them. Any ranking that stopped at CTR would put its
//    headlines at the top of a page whose entire purpose is deciding what to
//    make more of. So CTR lift and conversion lift are computed separately and
//    kept separately, and the combined score is their product — an asset has to
//    earn the click AND the signup to lead the list.
//
// The one thing that is NOT done here: totals are never summed across assets.
// Google credits every asset that served in an impression with that impression,
// so three headlines in one ad each book the same click. Rates survive that;
// sums do not. See the migration comment for the measured multiplier.

import type { AssetRollupRow, AssetSurface } from "./types";

/**
 * Pseudo-impressions of prior belief mixed into every CTR estimate.
 *
 * Read it as "this asset has to outrun the average over 800 impressions before
 * I take its CTR at face value". Chosen against the real distribution: our
 * median served asset has a few thousand impressions, so 800 leaves genuine
 * long-running winners near their raw rate while collapsing the 8-impression
 * flukes onto the baseline. Nothing downstream depends on the exact value —
 * raising it makes the list more conservative, lowering it more excitable.
 */
export const CTR_PRIOR_IMPRESSIONS = 800;

/**
 * The same idea for conversion rate, in clicks.
 *
 * Much smaller because clicks are much scarcer than impressions: an asset with
 * 40 clicks genuinely is weak evidence about conversion, and demanding 800
 * would flatten every asset in the account to the baseline and tell us nothing.
 */
export const CVR_PRIOR_CLICKS = 40;

/**
 * Minimum impressions before an asset is allowed into a ranked list.
 *
 * Shrinkage already handles small samples correctly — it scores them as
 * average — but "correctly average" still means a hundred no-evidence assets
 * padding the middle of a list nobody wants to scroll. This is a display
 * threshold, not a statistical one.
 */
export const MIN_IMPRESSIONS_FOR_RANKING = 500;

/** Minimum clicks before an asset's conversion rate is worth showing at all. */
export const MIN_CLICKS_FOR_CVR = 20;

export type FieldTypeBaseline = {
  fieldType: string;
  surface: AssetSurface;
  assets: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cvr: number;
};

export type ScoredAsset = AssetRollupRow & {
  ctr: number;
  cvr: number;
  costSek: number;
  costPerConversionSek: number | null;
  /** Shrunk CTR as a multiple of this field type's pooled CTR. 1.0 = average. */
  ctrLift: number;
  /** Shrunk conversion rate as a multiple of this field type's pooled rate. */
  cvrLift: number;
  /** ctrLift x cvrLift. Earns the click and the signup, or it does not lead. */
  score: number;
  /** False when the asset is below the display threshold for a ranked list. */
  hasEnoughVolume: boolean;
  /** True when the asset drew real traffic and converted none of it. */
  clicksWithoutConversions: boolean;
};

/**
 * Pool every asset of one field type to get the rate a new asset of that type
 * should be assumed to have until it proves otherwise.
 *
 * Pooling the volumes is legitimate here even though per-asset volumes are not
 * additive, because the ratio is what is wanted: an ad's impressions are
 * double-counted once per asset it carries, so both the numerator and the
 * denominator inflate by the same factor and the rate is unchanged.
 */
export function buildBaselines(rows: AssetRollupRow[]): Map<string, FieldTypeBaseline> {
  const baselines = new Map<string, FieldTypeBaseline>();

  for (const row of rows) {
    const key = baselineKey(row.fieldType, row.surface);
    const existing = baselines.get(key);
    if (existing) {
      existing.assets += 1;
      existing.impressions += row.impressions;
      existing.clicks += row.clicks;
      existing.conversions += row.conversions;
      continue;
    }
    baselines.set(key, {
      fieldType: row.fieldType,
      surface: row.surface,
      assets: 1,
      impressions: row.impressions,
      clicks: row.clicks,
      conversions: row.conversions,
      ctr: 0,
      cvr: 0,
    });
  }

  for (const baseline of baselines.values()) {
    baseline.ctr = baseline.impressions > 0 ? baseline.clicks / baseline.impressions : 0;
    baseline.cvr = baseline.clicks > 0 ? baseline.conversions / baseline.clicks : 0;
  }

  return baselines;
}

export function baselineKey(fieldType: string, surface: AssetSurface): string {
  return `${surface}:${fieldType}`;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** (observed + prior x baseline) / (evidence + prior). */
function shrink(
  observed: number,
  evidence: number,
  baselineRate: number,
  prior: number,
): number {
  return (observed + prior * baselineRate) / (evidence + prior);
}

export function scoreAssets(rows: AssetRollupRow[]): {
  scored: ScoredAsset[];
  baselines: Map<string, FieldTypeBaseline>;
} {
  const baselines = buildBaselines(rows);

  const scored = rows.map((row) => {
    const baseline = baselines.get(baselineKey(row.fieldType, row.surface));
    const baseCtr = baseline?.ctr ?? 0;
    const baseCvr = baseline?.cvr ?? 0;

    const ctr = rate(row.clicks, row.impressions);
    const cvr = rate(row.conversions, row.clicks);

    const shrunkCtr = shrink(row.clicks, row.impressions, baseCtr, CTR_PRIOR_IMPRESSIONS);
    const shrunkCvr = shrink(row.conversions, row.clicks, baseCvr, CVR_PRIOR_CLICKS);

    // A zero baseline means nothing of this field type ever converted, so there
    // is no ratio to take. Lift of 1 says "no signal", which is the truth, and
    // keeps the combined score from collapsing to zero on a technicality.
    const ctrLift = baseCtr > 0 ? shrunkCtr / baseCtr : 1;
    const cvrLift = baseCvr > 0 ? shrunkCvr / baseCvr : 1;

    const costSek = row.costMicros / 1_000_000;

    return {
      ...row,
      ctr,
      cvr,
      costSek,
      costPerConversionSek: row.conversions > 0 ? costSek / row.conversions : null,
      ctrLift,
      cvrLift,
      score: ctrLift * cvrLift,
      hasEnoughVolume: row.impressions >= MIN_IMPRESSIONS_FOR_RANKING,
      clicksWithoutConversions: row.clicks >= 100 && row.conversions === 0,
    } satisfies ScoredAsset;
  });

  return { scored, baselines };
}

export type RankMode = "score" | "ctr" | "conversions" | "volume";

/**
 * Order a list for display.
 *
 * Ties break on impressions rather than arbitrarily, so the better-evidenced of
 * two equal-looking assets is the one shown first.
 */
export function rankBy(assets: ScoredAsset[], mode: RankMode): ScoredAsset[] {
  const ordered = [...assets];
  ordered.sort((a, b) => {
    const primary = rankValue(b, mode) - rankValue(a, mode);
    if (primary !== 0) return primary;
    return b.impressions - a.impressions;
  });
  return ordered;
}

function rankValue(asset: ScoredAsset, mode: RankMode): number {
  switch (mode) {
    case "ctr":
      return asset.ctrLift;
    case "conversions":
      return asset.cvrLift;
    case "volume":
      return asset.impressions;
    case "score":
    default:
      return asset.score;
  }
}
