// The actual ad copy and keywords running in each WL Plan campaign.
//
// Kept separate from campaigns-shared.ts because creative churns far more
// often than campaign structure does, and because this is a MIRROR of what is
// live in Google Ads rather than a source of truth. There is no Google Ads API
// developer token on this account, so the dashboard cannot read ad text back
// from Google. When the copy changes in the ad account, update it here too.
//
// Last reconciled: 2026-08-27, read back from the live account over the API
// (the developer token now exists, so this file is verifiable rather than
// hopeful). The 2026-08-27 pass rewrote all four live ad groups because the
// pricing pages changed underneath them: seats are no longer metered, vehicles
// are, and the 14-day money-back guarantee now applies to ONE alone.
//
// Two outright errors were found in the copy that had been running: Large
// advertised "$195/Month" and "80 Premium Vehicles/Month" against a page that
// says $249 and 200 vehicles, and Small and Large both promised a money-back
// guarantee their landing pages no longer offer.

export type CatalogAdGroup = {
  name: string;
  /** Written the way Google writes them: [exact], "phrase", bare = broad. */
  keywords: string[];
  /**
   * Keyword-level final URLs, keyed by the keyword exactly as written above.
   * An ad group has one final URL per ad, so this is how competitor terms
   * reach their own comparison page without splitting the ad group and
   * committing new bids.
   */
  keywordRoutes?: Record<string, string>;
  headlines: string[];
  descriptions: string[];
};

// Headlines lifted verbatim from the "Pmax eng" asset groups, where they have
// already run and been approved. Reusing proven copy rather than inventing new
// claims for a campaign nobody has watched yet.
const PMAX_WORKSHOP = [
  "AI Automotive Diagnostics",
  "AI Diagnostics For Garages",
  "Smart Car Troubleshooting",
  "Find Fault Root Causes Fast",
  "Professional Auto Software",
  "Smart Workshop Decision Tool",
  "AI For Auto Repair Shops",
];

/**
 * The five carried into the plan campaigns. Each workshop ad group now has ten
 * plan-specific headlines of its own, and Google caps a responsive search ad at
 * fifteen, so only five of the seven fit. These five are the ones that describe
 * the product rather than a workshop size, which is the axis that changed when
 * pricing moved from seats to vehicles.
 */
const PMAX_WORKSHOP_5 = PMAX_WORKSHOP.slice(0, 5);

const PMAX_SINGLE = [
  "AI Automotive Diagnostics",
  "Smart Car Troubleshooting",
  "Find Fault Root Causes Fast",
  "Professional Auto Software",
];

/**
 * Two proven PMax headlines were deliberately NOT carried over:
 * "Reduce Comebacks By 42%" and "Diagnose Cars 7x Faster". Both are numeric
 * performance claims, and they were held back pending sign-off rather than
 * copied into new campaigns automatically. "Sign Up For Free Now" was also
 * dropped, since it pushes the free plan and these campaigns sell paid ones.
 */
export const WITHHELD_HEADLINES = [
  "Reduce Comebacks By 42%",
  "Diagnose Cars 7x Faster",
  "Sign Up For Free Now",
];

/**
 * Scan-tool hardware terms, added as BROAD campaign negatives on all three
 * plan campaigns on 2026-08-27.
 *
 * The search terms report showed the plan campaigns paying for people shopping
 * for a physical OBD dongle: topdon scanner, carly obd, icarsoft, launch scan
 * tool, vcds, hex v2, forscan. WrenchLane is not a scanner, so those clicks
 * can never convert, and at 96 SEK a day a single one is a meaningful share of
 * the budget.
 *
 * Autel, Bosch and Snap-on are deliberately ABSENT. They look like the same
 * kind of term but each has a published comparison page, so they are
 * competitor intent worth buying, not hardware shopping worth blocking.
 */
export const SCAN_TOOL_NEGATIVES = [
  "topdon",
  "icarsoft",
  "thinkcar",
  "thinkdiag",
  "launch x431",
  "vcds",
  "vag com",
  "vag k can",
  "hex v2",
  "forscan",
  "carly",
  "obdeleven",
  "elm327",
  "ancel",
  "foxwell",
  "xtool",
  "autophix",
  "konnwei",
  "mucar",
  "vident",
  "obd2 scanner",
  "obd scanner",
  "code reader",
  "scan tool",
  "scanner",
  "dongle",
  "carpal",
];

export const CAMPAIGN_CREATIVE: Record<string, CatalogAdGroup[]> = {
  "WL Plan | One": [
    {
      name: "One | single vehicle",
      keywords: [
        "[car repair manual subscription]",
        "[oem repair data for one car]",
        "[wiring diagram subscription]",
        '"vehicle repair data subscription"',
        '"car service data online"',
      ],
      // ONE keeps the money-back line, because ONE is the only tier that
      // still carries it. The page leads on the yearly rate, so the ad does too.
      headlines: [
        "WrenchLane ONE",
        "From $5/Month Yearly",
        "One Car, Fully Unlocked",
        "OEM Repair Data, One Car",
        "Wiring Diagrams Included",
        "14-Day Money-Back",
        "Snap A Photo, Read The Codes",
        "Unlimited AI Chat",
        "Repair Manuals + Specs",
        "Fix It Right, First Time",
        ...PMAX_SINGLE,
      ],
      descriptions: [
        "Full OEM repair data for one vehicle. From $5/month billed yearly.",
        "Repair manuals, wiring diagrams and service data for your car. 14-day money-back.",
        "Unlimited diagnostics and AI chat on one fully unlocked vehicle.",
        "Snap a photo of the dash and we read the codes. Cancel anytime.",
      ],
    },
  ],

  "WL Plan | Small": [
    {
      name: "Small | independent workshop",
      keywords: [
        "[workshop diagnostic software]",
        "[auto repair information system]",
        "[oem repair data subscription]",
        '"repair information for workshops"',
        '"garage diagnostic software"',
      ],
      // "Built for 1-2 Mechanics" was removed deliberately. Seat counts are
      // not what Small sells any more; 50 vehicles a month is, and the page
      // now says "Unlimited users" in as many words.
      headlines: [
        "Unlimited Mechanics, One Fee",
        "50 Vehicles A Month",
        "AI Diagnostics, $79/Month",
        "No Per Seat Pricing",
        "OEM Data + Labour Times",
        "Snap A Photo, Read The Codes",
        "Built For Small Workshops",
        "Full InfoPro Technical Data",
        "Cancel Anytime, No Contract",
        "One Workflow, Every Job",
        ...PMAX_WORKSHOP_5,
      ],
      descriptions: [
        "Unlimited mechanics on one plan. Premium data for 50 vehicles a month. $79/month.",
        "AI diagnostics, OEM data, wiring diagrams and labour times in one workflow.",
        "Rivals charge per seat. We charge per workshop. Unlimited users, cancel anytime.",
        "Snap a photo of the dash and we read the codes. Start free, no card needed.",
      ],
    },
    {
      name: "Small | alternatives",
      // The four below the first group were read from the live account and were
      // missing from this mirror, which made the routing gap look smaller than
      // it is: six rival names are bought here, not four. `shopkey alternative`
      // is the odd one out, because ShopKey has no comparison page at all.
      keywords: [
        "[alldata alternative]",
        "[autodata alternative]",
        "[mitchell 1 alternative]",
        "[haynespro alternative]",
        '"alternative to alldata"',
        "[prodemand alternative]",
        "[identifix alternative]",
        "[shopkey alternative]",
        "[alldata competitor]",
        // Live in the account since launch but missing from this mirror until
        // 2026-08-27, found by the routing test rather than by reading.
        '"alternative to autodata"',
        '"alternative to mitchell 1"',
        // Price-intent terms added 2026-08-27. The search terms report showed
        // "alldata price", "alldata cost" and "haynes pro workshop data price"
        // already matching and landing on a generic plan page. This is the
        // highest-intent traffic in the account and the new pricing finally
        // answers it: the rivals licence per seat, WrenchLane does not.
        "[alldata price]",
        "[alldata cost]",
        '"alldata pricing"',
        "[prodemand price]",
        "[prodemand cost]",
        "[mitchell 1 price]",
        "[haynespro price]",
        "[identifix price]",
        "[autodata price]",
      ],
      keywordRoutes: {
        "[alldata alternative]": "https://wrenchlane.com/en/vs/alldata",
        "[alldata competitor]": "https://wrenchlane.com/en/vs/alldata",
        "\"alternative to alldata\"": "https://wrenchlane.com/en/vs/alldata",
        "[autodata alternative]": "https://wrenchlane.com/en/vs/autodata",
        "\"alternative to autodata\"": "https://wrenchlane.com/en/vs/autodata",
        "[prodemand alternative]": "https://wrenchlane.com/en/vs/mitchell1-prodemand",
        "[mitchell 1 alternative]": "https://wrenchlane.com/en/vs/mitchell1-prodemand",
        "\"alternative to mitchell 1\"": "https://wrenchlane.com/en/vs/mitchell1-prodemand",
        "[identifix alternative]": "https://wrenchlane.com/en/vs/identifix",
        "[haynespro alternative]": "https://wrenchlane.com/en/vs/haynespro",
        "[alldata price]": "https://wrenchlane.com/en/vs/alldata",
        "[alldata cost]": "https://wrenchlane.com/en/vs/alldata",
        "\"alldata pricing\"": "https://wrenchlane.com/en/vs/alldata",
        "[prodemand price]": "https://wrenchlane.com/en/vs/mitchell1-prodemand",
        "[prodemand cost]": "https://wrenchlane.com/en/vs/mitchell1-prodemand",
        "[mitchell 1 price]": "https://wrenchlane.com/en/vs/mitchell1-prodemand",
        "[haynespro price]": "https://wrenchlane.com/en/vs/haynespro",
        "[identifix price]": "https://wrenchlane.com/en/vs/identifix",
        "[autodata price]": "https://wrenchlane.com/en/vs/autodata",
      },
      headlines: [
        "Unlimited Mechanics, One Fee",
        "No Per Seat Pricing",
        "See The Price Side By Side",
        "Compare Repair Data Tools",
        "AI Diagnostics, $79/Month",
        "Full InfoPro Technical Data",
        "Switch In One Afternoon",
        "Snap A Photo, Read The Codes",
        "Cancel Anytime, No Contract",
        "50 Vehicles A Month",
        ...PMAX_WORKSHOP_5,
      ],
      descriptions: [
        "See how WrenchLane compares on price, coverage and per seat fees.",
        "Unlimited mechanics, premium data by the vehicle. No per seat licence.",
        "AI diagnostics plus full OEM technical data. Start free, no card needed.",
        "Compare repair data tools on real prices and features. No spin, sourced.",
      ],
    },
  ],

  "WL Plan | Large": [
    {
      name: "Large | multi-tech workshop",
      keywords: [
        "[repair information for multiple technicians]",
        "[workshop software for teams]",
        "[multi user repair data]",
        '"diagnostic software for busy workshops"',
        '"repair data for whole workshop"',
        // Four rival names are live in this ad group and were missing from this
        // mirror entirely, which made the misrouting look like a Small-only
        // problem when it spans two ad groups.
        "[prodemand alternative]",
        "[identifix alternative]",
        "[shopkey alternative]",
        "[mitchell prodemand alternative]",
      ],
      // Large also buys rival names. Same treatment: route each to its own
      // comparison page instead of the generic /en/large.
      keywordRoutes: {
        "[prodemand alternative]":
          "https://wrenchlane.com/en/vs/mitchell1-prodemand",
        "[mitchell prodemand alternative]":
          "https://wrenchlane.com/en/vs/mitchell1-prodemand",
        "[identifix alternative]": "https://wrenchlane.com/en/vs/identifix",
      },
      // Was advertising $195 and 80 vehicles. The page says $249 and 200.
      // A wrong price in a live ad is the most expensive kind of stale copy,
      // so this correction is the reason the whole pass happened.
      headlines: [
        "200 Vehicles A Month",
        "Unlimited Mechanics Included",
        "AI Diagnostics, $249/Month",
        "The Whole Floor, One Fee",
        "No Per Technician Fees",
        "Snap A Photo, Read The Codes",
        "Built For Busy Workshops",
        "OEM Depth On Every Job",
        "Save 26% Billed Yearly",
        "One Workflow, Every Bay",
        ...PMAX_WORKSHOP_5,
      ],
      descriptions: [
        "Premium data for 200 vehicles a month, unlimited mechanics. $249/month.",
        "One diagnostic workflow for the whole floor. OEM data, labour times, wiring diagrams.",
        "No per technician fees. Every mechanic on one plan. Save 26% billed yearly.",
        "Snap a photo of the dash and we read the codes. Start free, no card needed.",
      ],
    },
  ],

  "WL Plan | Upsell Free Users": [
    {
      name: "Upsell | free to paid",
      // Deliberately loose phrase terms. The Customer Match list is doing the
      // targeting here, so the keywords only need to catch these users when
      // they search anything work-related, not isolate intent on their own.
      keywords: [
        '"oem repair data"',
        '"labour times lookup"',
        '"wiring diagram lookup"',
        '"repair manual online"',
        '"diagnostic trouble code lookup"',
        '"fault code meaning"',
        '"service reset procedure"',
      ],
      headlines: [
        "Upgrade Your WrenchLane",
        "Unlock Premium Vehicles",
        "OEM Data + Labour Times",
        "From $19/Month",
        "14-Day Money-Back",
        "More Vehicles, Same Tool",
        "Pick Your Plan",
        "7x Faster Diagnosis",
        "42% Fewer Comebacks",
        "Wiring Diagrams Included",
        "Go Beyond The Free Plan",
      ],
      descriptions: [
        "On the free plan? Unlock premium vehicles, OEM data and labour times.",
        "Upgrade from $19/month. 14-day money-back guarantee, cancel anytime.",
        "Same tool you already use, with the vehicle limits removed.",
        "OEM repair instructions in guided workflows. Compare plans and pick yours.",
      ],
    },
  ],
};

export function creativeFor(campaignName: string): CatalogAdGroup[] {
  return CAMPAIGN_CREATIVE[campaignName] ?? [];
}

/** Total keyword count across a campaign's ad groups. */
export function keywordCount(campaignName: string): number {
  return creativeFor(campaignName).reduce(
    (sum, group) => sum + group.keywords.length,
    0,
  );
}

export function matchTypeOf(keyword: string): "Exact" | "Phrase" | "Broad" {
  if (keyword.startsWith("[")) return "Exact";
  if (keyword.startsWith('"')) return "Phrase";
  return "Broad";
}

export function keywordText(keyword: string): string {
  if (keyword.startsWith("[") || keyword.startsWith('"')) {
    return keyword.slice(1, -1);
  }
  return keyword;
}
