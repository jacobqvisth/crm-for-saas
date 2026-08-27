/**
 * Bring the live WL Plan campaigns back in line with the pricing pages.
 *
 *   npx tsx --env-file=.env.local scripts/refresh-plan-ads.mts            # dry run
 *   npx tsx --env-file=.env.local scripts/refresh-plan-ads.mts --apply    # write
 *   npx tsx --env-file=.env.local scripts/refresh-plan-ads.mts --apply --only=negatives
 *
 * Written 2026-08-27, after an audit found the plan campaigns advertising a
 * pricing model the pages had stopped using. Large was quoting $195 a month and
 * 80 vehicles against a page saying $249 and 200, and Small and Large both
 * promised a money-back guarantee only ONE still carries.
 *
 * Four stages, each independently skippable so a quota failure part way through
 * costs nothing:
 *
 *   negatives  scan-tool hardware terms as campaign negatives on all three
 *   ads        new responsive search ads from the mirror, old ones paused
 *   routes     competitor keywords pointed at their own comparison page
 *   pricekw    price-intent keywords added, each routed the same way
 *
 * The ad copy comes from `campaigns-creative.ts` rather than being repeated
 * here. That file is what /dashboard/campaigns renders, so sourcing both from
 * it is the only way the dashboard and the account cannot disagree.
 *
 * IDEMPOTENCE. Re-running is safe. Negatives and keywords that already exist
 * come back as duplicate-resource errors under partial failure and are counted
 * rather than fatal. The `ads` stage is the exception: it creates a new ad every
 * run, so it self-skips when an enabled ad already matches the mirror's first
 * headline.
 *
 * QUOTA. Explorer access allows 2,880 operations a day and `validateOnly` costs
 * quota exactly like a real write, so the dry run is not free. If the account is
 * near its ceiling, run one stage at a time with --only and skip the dry run.
 */

import {
  createGoogleAdsAccess,
  googleAdsRequest,
  googleAdsSearch,
  hasGoogleAdsApiCredentials,
  type GoogleAdsAccess,
} from "@/lib/ceo/sync/google-ads-client";
import {
  CAMPAIGN_CREATIVE,
  SCAN_TOOL_NEGATIVES,
  keywordText,
  matchTypeOf,
} from "@/lib/ceo/campaigns-creative";

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",");
/**
 * Send at most this many operations per request, so a stage larger than the
 * remaining daily quota lands as far as it can and resumes next run rather than
 * failing whole. Every stage reads the account first and only sends what is
 * missing, so resuming never re-spends quota on work already done.
 */
const BATCH = Number(
  process.argv.find((a) => a.startsWith("--batch="))?.slice("--batch=".length) ??
    25,
);

/** Landing page per ad group, and the plan page each ad points at. */
const AD_GROUP_URLS: Record<string, { url: string; path1: string; path2: string }> = {
  "One | single vehicle": {
    url: "https://wrenchlane.com/en/wrenchlane-one",
    path1: "plans",
    path2: "one",
  },
  "Small | independent workshop": {
    url: "https://wrenchlane.com/en/small",
    path1: "plans",
    path2: "small",
  },
  "Small | alternatives": {
    url: "https://wrenchlane.com/en/small",
    path1: "compare",
    path2: "plans",
  },
  "Large | multi-tech workshop": {
    url: "https://wrenchlane.com/en/large",
    path1: "plans",
    path2: "large",
  },
};

type MutateOp = Record<string, unknown>;
type MutateResult = {
  mutateOperationResponses?: unknown[];
  partialFailureError?: { message?: string; details?: unknown[] };
};

async function mutate(
  access: GoogleAdsAccess,
  label: string,
  ops: MutateOp[],
  { partial = false }: { partial?: boolean } = {},
) {
  if (ops.length === 0) {
    console.log(`  ${label}: nothing to do`);
    return;
  }
  console.log(`  ${label}: ${ops.length} operations${APPLY ? "" : " (dry run)"}`);

  let sent = 0;
  for (let i = 0; i < ops.length; i += BATCH) {
    const chunk = ops.slice(i, i + BATCH);
    try {
      const result = await googleAdsRequest<MutateResult>(
        access,
        `customers/${access.customerId}/googleAds:mutate`,
        {
          mutateOperations: chunk,
          validateOnly: !APPLY,
          // partialFailure and validateOnly are mutually exclusive in the API,
          // so this only goes on for real writes.
          ...(partial && APPLY ? { partialFailure: true } : {}),
        },
      );
      sent += chunk.length;
      if (result.partialFailureError?.message) {
        // Expected on a re-run: duplicates come back here rather than throwing.
        console.log(
          `    batch ${i / BATCH + 1}: partial failures (usually duplicates)`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("RESOURCE_EXHAUSTED")) {
        console.log(
          `  ${label}: quota reached after ${sent} of ${ops.length}. ` +
            "Re-run to resume; nothing already applied is re-sent.",
        );
        return;
      }
      throw error;
    }
  }
  // A validate-only pass returns an EMPTY response on success, so zero
  // responses does not mean nothing ran.
  console.log(`  ${label}: ${APPLY ? "applied" : "validated"} ${sent} operations`);
}

async function campaignIds(access: GoogleAdsAccess) {
  const rows = await googleAdsSearch<{
    campaign: { id: string; name: string };
  }>(
    access,
    "SELECT campaign.id, campaign.name FROM campaign WHERE campaign.name LIKE 'WL Plan%'",
  );
  const byName = new Map<string, string>();
  for (const row of rows) byName.set(row.campaign.name, row.campaign.id);
  return byName;
}

async function adGroups(access: GoogleAdsAccess) {
  const rows = await googleAdsSearch<{
    adGroup: { id: string; name: string };
    campaign: { name: string };
  }>(
    access,
    "SELECT ad_group.id, ad_group.name, campaign.name FROM ad_group WHERE campaign.name LIKE 'WL Plan%'",
  );
  const byName = new Map<string, string>();
  for (const row of rows) byName.set(row.adGroup.name, row.adGroup.id);
  return byName;
}

/** ---------------------------------------------------------------- negatives */
async function stageNegatives(access: GoogleAdsAccess) {
  console.log("\n[negatives] scan-tool hardware, all three campaigns");
  const campaigns = await campaignIds(access);

  // Read what is already blocked. Explorer quota is tight enough that
  // re-sending 81 operations to create 27 missing ones is the difference
  // between finishing and not.
  const existing = await googleAdsSearch<{
    campaign: { id: string };
    campaignCriterion: { keyword?: { text: string } };
  }>(
    access,
    `SELECT campaign.id, campaign_criterion.keyword.text
     FROM campaign_criterion
     WHERE campaign.name LIKE 'WL Plan%' AND campaign_criterion.negative = TRUE`,
  );
  const blocked = new Set(
    existing
      .filter((r) => r.campaignCriterion.keyword?.text)
      .map((r) => `${r.campaign.id}::${r.campaignCriterion.keyword!.text}`),
  );

  const ops: MutateOp[] = [];
  let skipped = 0;
  for (const id of campaigns.values()) {
    for (const text of SCAN_TOOL_NEGATIVES) {
      if (blocked.has(`${id}::${text}`)) {
        skipped += 1;
        continue;
      }
      ops.push({
        campaignCriterionOperation: {
          create: {
            campaign: `customers/${access.customerId}/campaigns/${id}`,
            negative: true,
            keyword: { text, matchType: "BROAD" },
          },
        },
      });
    }
  }
  if (skipped > 0) console.log(`  ${skipped} already blocked, skipping`);
  await mutate(access, "negatives", ops, { partial: true });
}

/** --------------------------------------------------------------------- ads */
async function stageAds(access: GoogleAdsAccess) {
  console.log("\n[ads] new responsive search ads, old ones paused");
  const groups = await adGroups(access);

  const live = await googleAdsSearch<{
    adGroup: { name: string };
    adGroupAd: {
      resourceName: string;
      ad: { responsiveSearchAd?: { headlines?: { text: string }[] } };
    };
  }>(
    access,
    `SELECT ad_group.name, ad_group_ad.resource_name,
            ad_group_ad.ad.responsive_search_ad.headlines
     FROM ad_group_ad
     WHERE campaign.name LIKE 'WL Plan%' AND ad_group_ad.status = 'ENABLED'`,
  );

  const ops: MutateOp[] = [];
  for (const groupsForCampaign of Object.values(CAMPAIGN_CREATIVE)) {
    for (const group of groupsForCampaign) {
      const target = AD_GROUP_URLS[group.name];
      const adGroupId = groups.get(group.name);
      if (!target || !adGroupId) {
        // The Upsell campaign is in the mirror but cannot exist in the account:
        // Customer Match lists cannot be used in Targeting mode.
        console.log(`  skip ${group.name} (not a live ad group)`);
        continue;
      }
      const existing = live.filter((r) => r.adGroup.name === group.name);
      // Compare the FULL headline set, not the first headline. ONE's old ad
      // opened with "WrenchLane ONE" and so does the new one, so a first-line
      // check skipped the very ad that needed replacing.
      const wanted = JSON.stringify([...group.headlines].sort());
      const alreadyCurrent = existing.some(
        (r) =>
          JSON.stringify(
            (r.adGroupAd.ad.responsiveSearchAd?.headlines ?? [])
              .map((h) => h.text)
              .sort(),
          ) === wanted,
      );
      if (alreadyCurrent) {
        console.log(`  skip ${group.name} (already running the current copy)`);
        continue;
      }
      ops.push({
        adGroupAdOperation: {
          create: {
            adGroup: `customers/${access.customerId}/adGroups/${adGroupId}`,
            status: "ENABLED",
            ad: {
              finalUrls: [target.url],
              responsiveSearchAd: {
                headlines: group.headlines.map((text) => ({ text })),
                descriptions: group.descriptions.map((text) => ({ text })),
                path1: target.path1,
                path2: target.path2,
              },
            },
          },
        },
      });
      for (const row of existing) {
        ops.push({
          adGroupAdOperation: {
            update: { resourceName: row.adGroupAd.resourceName, status: "PAUSED" },
            updateMask: "status",
          },
        });
      }
    }
  }
  await mutate(access, "ads", ops);
}

/** ------------------------------------------------------------------ routes */
/**
 * Keyword-level final URLs. An ad group has one final URL per ad, so without
 * this the only way to send `alldata alternative` to the ALLDATA comparison
 * page is to split the ad group, which creates ad groups and sets bids. Routing
 * at the keyword level changes destinations without committing a krona.
 */
async function stageRoutes(access: GoogleAdsAccess) {
  console.log("\n[routes] competitor keywords to their comparison page");
  const groups = await adGroups(access);

  const live = await googleAdsSearch<{
    adGroup: { name: string };
    adGroupCriterion: {
      resourceName: string;
      keyword: { text: string; matchType: string };
    };
  }>(
    access,
    `SELECT ad_group.name, ad_group_criterion.resource_name,
            ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
     FROM ad_group_criterion
     WHERE campaign.name LIKE 'WL Plan%'
       AND ad_group_criterion.type = 'KEYWORD'
       AND ad_group_criterion.negative = FALSE`,
  );

  const ops: MutateOp[] = [];
  let missing = 0;
  for (const groupsForCampaign of Object.values(CAMPAIGN_CREATIVE)) {
    for (const group of groupsForCampaign) {
      if (!groups.has(group.name)) continue;
      for (const [keyword, url] of Object.entries(group.keywordRoutes ?? {})) {
        const text = keywordText(keyword);
        const match = live.find(
          (r) =>
            r.adGroup.name === group.name &&
            r.adGroupCriterion.keyword.text === text,
        );
        if (!match) {
          // Not yet in the account. The pricekw stage creates these with their
          // route already set, so this is expected on a first run.
          missing += 1;
          continue;
        }
        ops.push({
          adGroupCriterionOperation: {
            update: {
              resourceName: match.adGroupCriterion.resourceName,
              finalUrls: [url],
            },
            updateMask: "finalUrls",
          },
        });
      }
    }
  }
  if (missing > 0) {
    console.log(`  ${missing} routed keywords are not in the account yet`);
  }
  await mutate(access, "routes", ops);
}

/** ----------------------------------------------------------------- pricekw */
async function stagePriceKeywords(access: GoogleAdsAccess) {
  console.log("\n[pricekw] price-intent keywords, routed on creation");
  const groups = await adGroups(access);

  const live = await googleAdsSearch<{
    adGroup: { name: string };
    adGroupCriterion: { keyword: { text: string } };
  }>(
    access,
    `SELECT ad_group.name, ad_group_criterion.keyword.text
     FROM ad_group_criterion
     WHERE campaign.name LIKE 'WL Plan%'
       AND ad_group_criterion.type = 'KEYWORD'
       AND ad_group_criterion.negative = FALSE`,
  );
  const have = new Set(
    live.map((r) => `${r.adGroup.name}::${r.adGroupCriterion.keyword.text}`),
  );

  const MATCH: Record<string, string> = {
    Exact: "EXACT",
    Phrase: "PHRASE",
    Broad: "BROAD",
  };

  const ops: MutateOp[] = [];
  for (const groupsForCampaign of Object.values(CAMPAIGN_CREATIVE)) {
    for (const group of groupsForCampaign) {
      const adGroupId = groups.get(group.name);
      if (!adGroupId) continue;
      for (const keyword of group.keywords) {
        const text = keywordText(keyword);
        if (have.has(`${group.name}::${text}`)) continue;
        const url = group.keywordRoutes?.[keyword];
        ops.push({
          adGroupCriterionOperation: {
            create: {
              adGroup: `customers/${access.customerId}/adGroups/${adGroupId}`,
              status: "ENABLED",
              keyword: { text, matchType: MATCH[matchTypeOf(keyword)] },
              ...(url ? { finalUrls: [url] } : {}),
            },
          },
        });
      }
    }
  }
  await mutate(access, "pricekw", ops, { partial: true });
}

/** -------------------------------------------------------------------- main */
if (!hasGoogleAdsApiCredentials()) {
  console.error(
    "Google Ads API is not configured: need GOOGLE_ADS_DEVELOPER_TOKEN and GOOGLE_ADS_CUSTOMER_ID.",
  );
  process.exit(1);
}

const access = await createGoogleAdsAccess();
const stages: [string, (a: GoogleAdsAccess) => Promise<void>][] = [
  ["negatives", stageNegatives],
  ["ads", stageAds],
  ["routes", stageRoutes],
  ["pricekw", stagePriceKeywords],
];

console.log(
  `Customer ${access.customerId}. Mode: ${APPLY ? "APPLY" : "DRY RUN"}.`,
);
if (ONLY) console.log(`Stages: ${ONLY.join(", ")}`);

for (const [name, run] of stages) {
  if (ONLY && !ONLY.includes(name)) continue;
  try {
    await run(access);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[${name}] FAILED: ${message}`);
    if (message.includes("RESOURCE_EXHAUSTED")) {
      console.error(
        "\nExplorer access is capped at 2,880 operations a day and a dry run\n" +
          "costs the same as a write. Re-run the remaining stages after the\n" +
          "reset with --only, and skip the dry run to halve the cost.",
      );
    }
    process.exit(1);
  }
}

console.log("\ndone");
