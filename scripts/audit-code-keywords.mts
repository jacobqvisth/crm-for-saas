/**
 * Audit the account's fault-code keywords against the landing-page cluster.
 *
 *   npx tsx --env-file=<env> scripts/audit-code-keywords.mts
 *
 * Answers the question the landing-page programme exists to answer: of every
 * fault code this account has ever bid on, which ones now have a page to land
 * on, and which ones are not real codes at all.
 *
 * The second question turns out to matter more than the first. SAE J2012 allows
 * only 0 to 3 as a code's second character, so `P8000` and `P9982` are not
 * codes any vehicle emits. A keyword list built by enumerating P plus four
 * digits is mostly bidding on strings nobody can search for, because no scan
 * tool ever displayed them.
 */

import {
  createGoogleAdsAccess,
  googleAdsSearch,
  hasGoogleAdsApiCredentials,
} from "@/lib/ceo/sync/google-ads-client";
import { isValidSaeSecondChar } from "@/lib/ceo/dtc/parse";
import { getDiagnosticsDrilldownList } from "@/lib/ceo/data/diagnostics";
import { analyseDtcCodes } from "@/lib/ceo/dtc/analyse";
import { resolveDashboardTimeRange } from "@/lib/ceo/time-ranges";
import { buildLandingPlan } from "@/lib/landing/plan";
import { BUILDABLE_TIERS } from "@/lib/landing/types";

if (!hasGoogleAdsApiCredentials()) {
  console.error("Google Ads API is not configured.");
  process.exit(1);
}

const access = await createGoogleAdsAccess();

type Row = {
  campaign?: { name?: string; status?: string };
  adGroupCriterion?: { keyword?: { text?: string } };
};

const rows = await googleAdsSearch<Row>(
  access,
  `SELECT campaign.name, campaign.status, ad_group_criterion.keyword.text
   FROM ad_group_criterion
   WHERE ad_group_criterion.type = 'KEYWORD'
     AND ad_group_criterion.status != 'REMOVED'`,
);

// Which codes the cluster actually built a page for.
const diagnostics = await getDiagnosticsDrilldownList({
  range: resolveDashboardTimeRange("all_time"),
  includeInternal: false,
});
const plan = buildLandingPlan(analyseDtcCodes(diagnostics));
const built = new Set(
  plan.candidates
    .filter((row) => BUILDABLE_TIERS.includes(row.tier))
    .map((row) => row.code),
);

/** Every OBD-II-shaped token in a keyword, uppercased. */
const CODE_RE = /\b([PBCU][0-9A-F]{4})\b/gi;

let keywordsWithCode = 0;
const valid = new Set<string>();
const impossible = new Set<string>();
let impossibleKeywords = 0;
let validKeywords = 0;
const covered = new Set<string>();
let coveredKeywords = 0;
const perCampaign = new Map<
  string,
  { total: number; impossible: number; covered: number }
>();

for (const row of rows) {
  const text = row.adGroupCriterion?.keyword?.text;
  const campaign = row.campaign?.name ?? "(unknown)";
  if (!text) continue;

  const matches = [...text.matchAll(CODE_RE)].map((m) => m[1].toUpperCase());
  if (matches.length === 0) continue;
  keywordsWithCode += 1;

  const stat = perCampaign.get(campaign) ?? {
    total: 0,
    impossible: 0,
    covered: 0,
  };
  stat.total += 1;

  // A keyword is impossible if every code in it is impossible.
  const anyValid = matches.some((code) => isValidSaeSecondChar(code.charAt(1)));
  for (const code of matches) {
    if (isValidSaeSecondChar(code.charAt(1))) valid.add(code);
    else impossible.add(code);
  }
  if (anyValid) validKeywords += 1;
  else {
    impossibleKeywords += 1;
    stat.impossible += 1;
  }

  if (matches.some((code) => built.has(code))) {
    coveredKeywords += 1;
    stat.covered += 1;
    for (const code of matches) if (built.has(code)) covered.add(code);
  }
  perCampaign.set(campaign, stat);
}

const pct = (n: number, d: number) =>
  d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`;

console.log(`Keywords in the account         : ${rows.length}`);
console.log(`  containing a code-shaped token: ${keywordsWithCode}`);
console.log("");
console.log(`Distinct code strings bid on    : ${valid.size + impossible.size}`);
console.log(
  `  structurally valid SAE codes  : ${valid.size} (${pct(valid.size, valid.size + impossible.size)})`,
);
console.log(
  `  impossible, no car emits them : ${impossible.size} (${pct(impossible.size, valid.size + impossible.size)})`,
);
console.log(
  `Keywords whose codes are ALL impossible: ${impossibleKeywords} (${pct(impossibleKeywords, keywordsWithCode)} of code keywords)`,
);
console.log("");
console.log(`Codes with a landing page now   : ${covered.size}`);
console.log(
  `Keywords now landable            : ${coveredKeywords} (${pct(coveredKeywords, keywordsWithCode)} of code keywords, ${pct(coveredKeywords, validKeywords)} of the valid ones)`,
);
console.log("");
console.log("Per campaign:");
for (const [name, stat] of [...perCampaign].sort(
  (a, b) => b[1].total - a[1].total,
)) {
  console.log(
    `  ${name.padEnd(26)} ${String(stat.total).padStart(6)} code keywords · ${pct(stat.impossible, stat.total).padStart(4)} impossible · ${pct(stat.covered, stat.total).padStart(4)} now landable`,
  );
}

console.log("");
console.log(
  `Sample impossible codes: ${[...impossible].slice(0, 20).join(", ")}`,
);
