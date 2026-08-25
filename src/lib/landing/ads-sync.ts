/**
 * Reconciling Google Ads against the landing-page programme.
 *
 * The programme decides which pages exist and which query is allowed to reach
 * each one. This module reads what the account actually does, diffs the two,
 * and can apply the difference.
 *
 * WHY A RECONCILER AND NOT A SCRIPT
 *
 * A script that creates ad groups is only correct the first time it runs. The
 * account drifts, someone edits an ad in the UI, a page slug changes, and the
 * script either duplicates what it made before or silently disagrees with it.
 * A diff against a declared desired state is re-runnable, tells you what it
 * would do before it does it, and converges instead of accumulating.
 *
 * SAFETY
 *
 * Nothing here mutates unless it is handed `dryRun: false` explicitly. The
 * default is a plan, not an application. This is spending money on someone
 * else's behalf, in an account whose live campaigns are already fragile, so the
 * asymmetry is deliberate: a plan that was never applied costs nothing, and a
 * mutate that should not have run costs real money and is awkward to unwind.
 *
 * The reconciler also never pauses, removes or edits anything it did not create
 * or is not explicitly told to retarget. Its whole vocabulary is: create the ad
 * group that should exist, and point a final URL at the page it should point at.
 */

import {
  googleAdsRequest,
  googleAdsSearch,
  type GoogleAdsAccess,
} from "@/lib/ceo/sync/google-ads-client";
import {
  COMPETITOR_TARGETS,
  competitorAdGroupName,
  competitorKeywords,
  type CompetitorTarget,
} from "./ad-targets";
import { SITE_ORIGIN } from "./slugs";

/** What one ad group in the live account currently does. */
export type ObservedAdGroup = {
  resourceName: string;
  id: string;
  name: string;
  campaignName: string;
  status: string;
  /** Distinct final URLs across the ads in this group. */
  finalUrls: string[];
  /** Keyword texts on this group. */
  keywords: string[];
};

export type AdSyncAction =
  | {
      kind: "retarget";
      adGroupName: string;
      campaignName: string;
      from: string;
      to: string;
      reason: string;
    }
  | {
      kind: "create_ad_group";
      adGroupName: string;
      finalUrl: string;
      keywords: { text: string; matchType: "EXACT" | "PHRASE" }[];
      reason: string;
    }
  | {
      kind: "ok";
      adGroupName: string;
      finalUrl: string;
      reason: string;
    };

export type AdSyncPlan = {
  actions: AdSyncAction[];
  /** Ad groups in the account that the programme says nothing about. */
  unmanaged: string[];
  violations: number;
  creates: number;
};

/**
 * Every ad group with the final URLs its ads point at.
 *
 * Final URLs live on the ad, not the ad group, so this reads ad_group_ad and
 * folds up. An ad group whose ads disagree with each other about the
 * destination shows every URL it uses, which is itself worth seeing.
 */
export const AD_GROUP_TARGETS_QUERY = `
  SELECT
    ad_group.resource_name,
    ad_group.id,
    ad_group.name,
    ad_group.status,
    campaign.name,
    ad_group_ad.ad.final_urls
  FROM ad_group_ad
  WHERE ad_group_ad.status != 'REMOVED'
    AND ad_group.status != 'REMOVED'
`;

export const AD_GROUP_KEYWORDS_QUERY = `
  SELECT
    ad_group.id,
    ad_group_criterion.keyword.text
  FROM ad_group_criterion
  WHERE ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.status != 'REMOVED'
`;

type AdGroupAdRow = {
  adGroup?: { resourceName?: string; id?: string; name?: string; status?: string };
  campaign?: { name?: string };
  adGroupAd?: { ad?: { finalUrls?: string[] } };
};

type KeywordRow = {
  adGroup?: { id?: string };
  adGroupCriterion?: { keyword?: { text?: string } };
};

export async function readAdGroups(
  access: GoogleAdsAccess,
): Promise<ObservedAdGroup[]> {
  const [adRows, keywordRows] = await Promise.all([
    googleAdsSearch<AdGroupAdRow>(access, AD_GROUP_TARGETS_QUERY),
    googleAdsSearch<KeywordRow>(access, AD_GROUP_KEYWORDS_QUERY),
  ]);

  const keywordsByGroup = new Map<string, string[]>();
  for (const row of keywordRows) {
    const id = row.adGroup?.id;
    const text = row.adGroupCriterion?.keyword?.text;
    if (!id || !text) continue;
    const list = keywordsByGroup.get(id) ?? [];
    list.push(text);
    keywordsByGroup.set(id, list);
  }

  const groups = new Map<string, ObservedAdGroup>();
  for (const row of adRows) {
    const id = row.adGroup?.id;
    if (!id) continue;
    const existing = groups.get(id);
    const urls = row.adGroupAd?.ad?.finalUrls ?? [];
    if (existing) {
      for (const url of urls) {
        if (!existing.finalUrls.includes(url)) existing.finalUrls.push(url);
      }
      continue;
    }
    groups.set(id, {
      resourceName: row.adGroup?.resourceName ?? "",
      id,
      name: row.adGroup?.name ?? "",
      campaignName: row.campaign?.name ?? "",
      status: row.adGroup?.status ?? "",
      finalUrls: [...urls],
      keywords: keywordsByGroup.get(id) ?? [],
    });
  }

  return Array.from(groups.values());
}

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

/**
 * Does this ad group buy this rival's name?
 *
 * Matched on the keyword text rather than on the ad group name, because the
 * account names ad groups by plan and the whole point of the exercise is that
 * the plan is the wrong axis. What a group buys is the ground truth.
 */
function buysTerm(group: ObservedAdGroup, target: CompetitorTarget) {
  const haystack = group.keywords.join(" ").toLowerCase();
  return target.terms.some((term) => haystack.includes(term.toLowerCase()));
}

/**
 * The diff. Pure, so it is testable without credentials and so the plan can be
 * shown before anything touches the account.
 */
export function planCompetitorSync(observed: ObservedAdGroup[]): AdSyncPlan {
  const actions: AdSyncAction[] = [];
  const touched = new Set<string>();

  for (const target of COMPETITOR_TARGETS) {
    const wantedUrl = `${SITE_ORIGIN}${target.path}`;
    const buyers = observed.filter((group) => buysTerm(group, target));

    if (buyers.length === 0) {
      actions.push({
        kind: "create_ad_group",
        adGroupName: competitorAdGroupName(target),
        finalUrl: wantedUrl,
        keywords: competitorKeywords(target),
        reason: `A comparison page for ${target.name} is published and indexed and nothing points at it.`,
      });
      continue;
    }

    for (const group of buyers) {
      touched.add(group.id);
      const current = group.finalUrls[0] ?? "";
      const currentPath = pathOf(current);

      if (currentPath === target.path) {
        actions.push({
          kind: "ok",
          adGroupName: group.name,
          finalUrl: current,
          reason: `Already points at the ${target.name} comparison page.`,
        });
        continue;
      }

      actions.push({
        kind: "retarget",
        adGroupName: group.name,
        campaignName: group.campaignName,
        from: current || "(no final URL)",
        to: wantedUrl,
        reason: `Buys ${target.name} and lands on ${currentPath ?? "an unreadable URL"}, which is more generic than the query. A page written for this exact comparison already exists.`,
      });
    }
  }

  const managed = new Set(
    actions.flatMap((action) =>
      action.kind === "retarget" || action.kind === "ok"
        ? [action.adGroupName]
        : [],
    ),
  );

  return {
    actions,
    unmanaged: observed
      .filter((group) => !managed.has(group.name) && !touched.has(group.id))
      .map((group) => group.name),
    violations: actions.filter((action) => action.kind === "retarget").length,
    creates: actions.filter((action) => action.kind === "create_ad_group")
      .length,
  };
}

export type ApplyResult = {
  applied: boolean;
  performed: string[];
  skipped: string[];
};

/**
 * Apply a plan.
 *
 * Only handles `retarget`, and only by rewriting final URLs on the ads that are
 * already there. Creating an ad group means also creating ads, keywords and a
 * bid, which is a genuinely new spending decision rather than a correction of a
 * routing mistake, so it is left as a plan for a human to approve in the UI.
 * The distinction is between fixing something that is already wrong and
 * committing budget that nobody has agreed to.
 */
export async function applyCompetitorSync(
  access: GoogleAdsAccess,
  plan: AdSyncPlan,
  observed: ObservedAdGroup[],
  options: { dryRun?: boolean } = {},
): Promise<ApplyResult> {
  const { dryRun = true } = options;
  const performed: string[] = [];
  const skipped: string[] = [];

  for (const action of plan.actions) {
    if (action.kind === "ok") continue;
    if (action.kind === "create_ad_group") {
      skipped.push(
        `${action.adGroupName}: creating an ad group commits new budget, so it is left for approval in the UI.`,
      );
      continue;
    }

    const group = observed.find((row) => row.name === action.adGroupName);
    if (!group) {
      skipped.push(`${action.adGroupName}: no longer present in the account.`);
      continue;
    }

    // Final URLs live on the ad, so retargeting rewrites every ad in the group.
    const ads = await googleAdsSearch<{
      adGroupAd?: { resourceName?: string };
    }>(
      access,
      `SELECT ad_group_ad.resource_name FROM ad_group_ad
       WHERE ad_group.id = ${group.id} AND ad_group_ad.status != 'REMOVED'`,
    );

    const operations = ads
      .map((row) => row.adGroupAd?.resourceName)
      .filter((name): name is string => Boolean(name))
      .map((resourceName) => ({
        update: { resourceName, ad: { finalUrls: [action.to] } },
        updateMask: "ad.final_urls",
      }));

    if (operations.length === 0) {
      skipped.push(`${action.adGroupName}: no ads to retarget.`);
      continue;
    }

    // A dry run still goes to Google, with validateOnly set.
    //
    // Checking locally that we built a sensible-looking operation only proves
    // we think it is sensible. validateOnly makes the server run the same
    // validation it would run on a real write and reject anything it would
    // have rejected, without persisting. That turns "this should work" into
    // "Google has confirmed it would accept this", which is the whole point of
    // looking before writing.
    //
    // A validate-only pass returns an empty response body on success, so an
    // empty result here means it passed, not that nothing ran.
    await googleAdsRequest(
      access,
      `customers/${access.customerId}/adGroupAds:mutate`,
      { operations, partialFailure: false, validateOnly: dryRun },
    );

    performed.push(
      dryRun
        ? `Validated: pointing ${action.adGroupName} at ${action.to} across ${operations.length} ad(s) would be accepted. Currently ${action.from}.`
        : `Pointed ${action.adGroupName} at ${action.to} across ${operations.length} ad(s).`,
    );
  }

  return { applied: !dryRun, performed, skipped };
}
