// The actual ad copy and keywords running in each WL Plan campaign.
//
// Kept separate from campaigns-shared.ts because creative churns far more
// often than campaign structure does, and because this is a MIRROR of what is
// live in Google Ads rather than a source of truth. There is no Google Ads API
// developer token on this account, so the dashboard cannot read ad text back
// from Google. When the copy changes in the ad account, update it here too.
//
// Last reconciled: 2026-08-24, against the scripts that created and then
// expanded these ads (create-plan-campaigns.js, expand-rsa-copy.js,
// create-upsell-campaign.js in _planning/google-ads/).

export type CatalogAdGroup = {
  name: string;
  /** Written the way Google writes them: [exact], "phrase", bare = broad. */
  keywords: string[];
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
      headlines: [
        "WrenchLane ONE",
        "OEM Repair Data, One Car",
        "From $19/Month",
        "AI Diagnostics for One Car",
        "Wiring Diagrams Included",
        "14-Day Money-Back",
        "Fix It Right, First Time",
        ...PMAX_SINGLE,
      ],
      descriptions: [
        "Professional diagnostics and OEM repair data for one vehicle. Start free, no card needed.",
        "Repair manuals, wiring diagrams and service data. From $19/month. 14-day money-back.",
        "OEM repair data, wiring diagrams and service info for your vehicle, in one place.",
        "Start free, no card needed. 14-day money-back guarantee, cancel anytime.",
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
      headlines: [
        "For Independent Workshops",
        "AI Diagnostics, $79/Month",
        "OEM Data + Labour Times",
        "Built for 1-2 Mechanics",
        "Diagnose Faster, Fix Right",
        "14-Day Money-Back",
        "One Workflow, Every Job",
        ...PMAX_WORKSHOP,
      ],
      descriptions: [
        "AI diagnostics, OEM data, wiring diagrams and labour times in one workflow. $79/month.",
        "Built for workshops with 1-2 mechanics. Start free, 14-day money-back guarantee.",
        "OEM repair data, wiring diagrams and labour times in one AI-powered workflow.",
        "Start free, no card needed. 14-day money-back guarantee, cancel anytime.",
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
      ],
      headlines: [
        "A Faster Repair Data Tool",
        "AI Diagnostics, $79/Month",
        "OEM Data + Labour Times",
        "Compare Repair Data Tools",
        "Built for Small Workshops",
        "14-Day Money-Back",
        "Switch In One Afternoon",
        ...PMAX_WORKSHOP,
      ],
      descriptions: [
        "Compare repair data tools on real prices and features. No spin, sourced comparisons.",
        "AI diagnostics on top of OEM repair data. $79/month, 14-day money-back guarantee.",
        "OEM repair data, wiring diagrams and labour times in one AI-powered workflow.",
        "Start free, no card needed. 14-day money-back guarantee, cancel anytime.",
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
      ],
      headlines: [
        "For Workshops of 3-10",
        "One Workflow, Whole Shop",
        "AI Diagnostics, $195/Month",
        "Shared Team Access",
        "80 Premium Vehicles/Month",
        "OEM Data + Labour Times",
        "Book a Demo Today",
        ...PMAX_WORKSHOP,
      ],
      descriptions: [
        "One diagnostic and repair workflow for workshops with 3-10 technicians. Shared access.",
        "80 premium vehicles a month, OEM data and labour times. $195/month, money-back.",
        "OEM repair data, wiring diagrams and labour times in one AI-powered workflow.",
        "Shared access for your whole team. 14-day money-back guarantee, cancel anytime.",
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
