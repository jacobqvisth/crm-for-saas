/**
 * Run the competitor reconciler against the live account and print the plan.
 *
 *   npx tsx --env-file=<env> scripts/ads-sync-dryrun.mts
 *
 * Reads only. The apply path lives behind the API route and a confirmation
 * string; this exists so the plan can be read and argued with before anyone
 * writes to an account that is currently spending money.
 */

import {
  createGoogleAdsAccess,
  hasGoogleAdsApiCredentials,
} from "@/lib/ceo/sync/google-ads-client";
import { planCompetitorSync, readAdGroups } from "@/lib/landing/ads-sync";
import { UNMATCHED_COMPETITOR_TERMS } from "@/lib/landing/ad-targets";

if (!hasGoogleAdsApiCredentials()) {
  console.error(
    "Google Ads API is not configured: need GOOGLE_ADS_DEVELOPER_TOKEN and GOOGLE_ADS_CUSTOMER_ID.",
  );
  process.exit(1);
}

const access = await createGoogleAdsAccess();
const observed = await readAdGroups(access);
const plan = planCompetitorSync(observed);

console.log(`Ad groups read: ${observed.length}`);
console.log(
  `Violations (built page, wrong destination): ${plan.violations}`,
);
console.log(`Ad groups the programme would create: ${plan.creates}`);
console.log("");

for (const action of plan.actions) {
  if (action.kind === "retarget") {
    console.log(`RETARGET  ${action.adGroupName}  [${action.campaignName}]`);
    console.log(`          from ${action.from}`);
    console.log(`          to   ${action.to}`);
  }
  if (action.kind === "split") {
    console.log(`SPLIT     ${action.adGroupName}  [${action.campaignName}]`);
    console.log(`          everything currently lands on ${action.from}`);
    for (const rival of action.rivals) {
      console.log(`            ${rival.name.padEnd(24)} -> ${rival.to}`);
    }
  }
}

const creates = plan.actions.filter((a) => a.kind === "create_ad_group");
if (creates.length > 0) {
  console.log("");
  console.log("Would need a new ad group (left for a human, commits budget):");
  for (const action of creates) {
    if (action.kind !== "create_ad_group") continue;
    console.log(`  ${action.adGroupName} -> ${action.finalUrl}`);
  }
}

const ok = plan.actions.filter((a) => a.kind === "ok");
if (ok.length > 0) {
  console.log("");
  console.log(`Already correct: ${ok.length}`);
}

console.log("");
console.log(`Unmanaged ad groups (untouched): ${plan.unmanaged.length}`);
console.log(`  ${plan.unmanaged.join(", ")}`);
console.log("");
console.log(
  `Competitor terms with no page to send them to: ${UNMATCHED_COMPETITOR_TERMS.join(", ")}`,
);
