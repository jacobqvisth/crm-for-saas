// Pricing options brainstorm (/pricing-options).
//
// A thinking surface, NOT live pricing. Nothing here is wired to Stripe and
// nothing here changes what app.wrenchlane.com/en/pricing shows. Stripe stays
// the source of truth for real prices; this page exists so we can argue about
// shapes before touching it.
//
// The numbers in SIGNALS are real, pulled from the CEO-sync tables in prod
// (dashboard_workshops / dashboard_diagnostics) with internal-test accounts
// excluded, on the date stamped in SIGNALS_AS_OF. They are here so every draft
// below can be judged against what the funnel actually does rather than against
// what we assume it does. Re-run the queries in QUERIES if you want them fresh.

export const SIGNALS_AS_OF = "2026-08-10";

export type Signal = {
  label: string;
  value: string;
  detail: string;
  /** "bad" tints the tile red, "good" green, "flat" stays neutral. */
  tone: "good" | "bad" | "flat";
};

export const SIGNALS: Signal[] = [
  {
    label: "Workshops on Free",
    value: "1,297",
    detail:
      "89% of the 1,450 workshops we have ever seen sit on the Free plan. Every signup lands there, there is no direct paid signup.",
    tone: "bad",
  },
  {
    label: "Paying today",
    value: "60",
    detail:
      "Active paid subscriptions: 24 Small monthly, 11 Large monthly, 8 One monthly, 8 Small yearly, 6 Large yearly, 3 One yearly.",
    tone: "flat",
  },
  {
    label: "In trial right now",
    value: "45",
    detail:
      "Workshops currently inside the 14-day card-required trial. That is a big pipeline relative to 60 payers, so the leak is at the end of the trial, not the start.",
    tone: "flat",
  },
  {
    label: "Put a card in, then reverted",
    value: "191",
    detail:
      "Free workshops that still carry a Stripe subscription id, meaning they trialed or paid and fell back to Free. Roughly 3 reverted for every 1 that stuck.",
    tone: "bad",
  },
  {
    label: "Ever ran a diagnostic",
    value: "436",
    detail:
      "30% of all workshops. The other 70% signed up and never used the core feature once, so a free plan is not what is holding them back.",
    tone: "bad",
  },
  {
    label: "Median diagnostics per workshop",
    value: "1",
    detail:
      "Of the 442 workshops that ever diagnosed, 233 ran exactly one, 123 ran 2 to 5, and only 30 ran more than 20. Monthly seats are the wrong shape for that curve.",
    tone: "bad",
  },
  {
    label: "Finished inside 7 days",
    value: "338 of 442",
    detail:
      "76% of diagnosing workshops did every diagnostic they will ever do within a 7-day span. A 7-day trial is not as short as it sounds.",
    tone: "good",
  },
  {
    label: "AI cost per diagnostic",
    value: "$0.014",
    detail:
      "Average diag_cost across all 2,785 diagnostics, $38 in total, ever. Compute is not the cost driver, per-vehicle premium data is.",
    tone: "good",
  },
];

/** Rough list-price MRR, used only as an anchor for the drafts below. */
export const MRR_ANCHOR = {
  mrrSek: 51_700,
  arpaSek: 862,
  note:
    "Estimated from the active plan mix at list price, monthly-equivalent for yearly plans. Not Stripe-billed revenue, it ignores discounts, VAT, currency and proration.",
};

export type PlanDraft = {
  name: string;
  tagline: string;
  /** Rendered big. "Free", "SEK 179", "SEK 99 / vehicle". */
  price: string;
  period?: string;
  /** Small line under the price, e.g. "billed yearly". */
  priceNote?: string;
  badge?: string;
  highlight?: boolean;
  features: string[];
  /** Rendered greyed out with a lock, like the real pricing page. */
  locked?: string[];
  cta: string;
};

export type PricingOption = {
  id: string;
  /** "A", "B", ... used as the tab label prefix. */
  key: string;
  name: string;
  thesis: string;
  trial: string;
  /** Chips in the option header. */
  revenueShape: string;
  buildEffort: "Low" | "Medium" | "High";
  plans: PlanDraft[];
  changes: string[];
  bet: string;
  evidence: string[];
  risks: string[];
  bestIf: string;
};

// ---------------------------------------------------------------------------
// Today, kept in the same shape so it can sit in the compare matrix.
// ---------------------------------------------------------------------------

export const CURRENT: PricingOption = {
  id: "current",
  key: "Now",
  name: "What we ship today",
  thesis:
    "A permanent free tier with daily caps, three paid tiers above it, and a 14-day card-required trial on every paid tier.",
  trial: "14 days, card required, unlimited vehicles, on any paid tier.",
  revenueShape: "Freemium subscription",
  buildEffort: "Low",
  plans: [
    {
      name: "Free",
      tagline: "For individual mechanics",
      price: "SEK 0",
      badge: "Current plan",
      features: [
        "1 diagnostic / day",
        "3 AI chat messages / day",
        "10 AI searches / day",
        "TSB search",
        "Diagnostic reports",
        "Last 5 ongoing diagnostics",
        "InfoPro data on 1 demo vehicle",
      ],
      locked: ["Full InfoPro on all vehicles", "Verified measurements", "Team members"],
      cta: "Current plan",
    },
    {
      name: "One",
      tagline: "1 vehicle, fully unlocked",
      price: "SEK 179",
      period: "/ month",
      priceNote: "Save 75% with yearly",
      features: [
        "1 fully unlocked vehicle",
        "Unlimited diagnostics",
        "Full history",
        "Full InfoPro technical data (1 vehicle)",
        "Unlimited AI search",
        "Unlimited AI chat",
        "Verified measurements (1 vehicle)",
      ],
      locked: ["Team members"],
      cta: "Start free trial",
    },
    {
      name: "Small",
      tagline: "For small workshops, 1-3 mechanics",
      price: "SEK 749",
      period: "/ month",
      priceNote: "Save 27% with yearly",
      badge: "Most popular",
      highlight: true,
      features: [
        "Up to 3 users",
        "Premium data for 20 vehicles / month",
        "Everything in One",
        "Verified measurements",
        "Full InfoPro technical data",
        "Unlimited AI search",
        "Unlimited AI chat",
        "Priority support",
      ],
      cta: "Start free trial",
    },
    {
      name: "Large",
      tagline: "For growing workshops, up to 11",
      price: "SEK 1,799",
      period: "/ month",
      priceNote: "Save 26% with yearly",
      features: [
        "Up to 11 users",
        "Premium data for 80 vehicles / month",
        "Everything in Small",
        "Priority support",
      ],
      cta: "Start free trial",
    },
  ],
  changes: [],
  bet: "That a generous free tier builds a base we can convert later.",
  evidence: [
    "1,297 workshops on Free against 60 paying is a 4.6% lifetime conversion.",
    "70% of signups never ran a single diagnostic, so the free tier is not being consumed, it is being ignored.",
    "The One tier moves one dial (vehicles) while Small and Large move two (vehicles and seats), which makes self-selection hard.",
  ],
  risks: [
    "Free is doing the job of a demo without any of the urgency of a trial.",
    "The 75% yearly discount on One prices a year of One at roughly SEK 45 / month, far below Small and Large yearly. Worth confirming that is deliberate.",
  ],
  bestIf: "Volume of signups is the goal and monetisation can wait.",
};

// ---------------------------------------------------------------------------
// The drafts.
// ---------------------------------------------------------------------------

const PAID_LADDER_UNCHANGED: PlanDraft[] = [
  {
    name: "One",
    tagline: "1 vehicle, fully unlocked",
    price: "SEK 179",
    period: "/ month",
    features: [
      "1 fully unlocked vehicle",
      "Unlimited diagnostics",
      "Full InfoPro technical data",
      "Verified measurements",
      "Unlimited AI search and chat",
      "Full history",
    ],
    locked: ["Team members"],
    cta: "Choose One",
  },
  {
    name: "Small",
    tagline: "For small workshops, 1-3 mechanics",
    price: "SEK 749",
    period: "/ month",
    badge: "Most popular",
    highlight: true,
    features: [
      "Up to 3 users",
      "Premium data for 20 vehicles / month",
      "Everything in One",
      "Priority support",
    ],
    cta: "Choose Small",
  },
  {
    name: "Large",
    tagline: "For growing workshops, up to 11",
    price: "SEK 1,799",
    period: "/ month",
    features: [
      "Up to 11 users",
      "Premium data for 80 vehicles / month",
      "Everything in Small",
      "Priority support",
    ],
    cta: "Choose Large",
  },
];

export const OPTIONS: PricingOption[] = [
  // -------------------------------------------------------------- A
  {
    id: "trial-only",
    key: "A",
    name: "Trial only, no free plan",
    thesis:
      "Delete the free tier. Everyone starts a 7-day trial, card up front, and the trial is scoped to one vehicle. On day 8 the plan they picked starts charging.",
    trial: "7 days, card required, 1 vehicle, otherwise fully unlocked.",
    revenueShape: "Pure subscription",
    buildEffort: "Medium",
    plans: [
      {
        name: "Free trial",
        tagline: "Bring one real car and see what it does",
        price: "7 days",
        priceNote: "Card required, converts automatically",
        badge: "Everyone starts here",
        features: [
          "1 vehicle, fully unlocked",
          "Unlimited diagnostics on that vehicle",
          "Full InfoPro technical data",
          "Verified measurements",
          "Unlimited AI search and chat",
          "Cancel any time in the 7 days",
        ],
        locked: ["Second vehicle", "Team members"],
        cta: "Start 7-day trial",
      },
      ...PAID_LADDER_UNCHANGED,
    ],
    changes: [
      "Free plan is removed from the pricing page and from signup.",
      "Signup routes through Stripe checkout before the app opens, so a card exists from minute one.",
      "The trial is capped at one vehicle instead of unlimited, which is a real product change, not just a pricing one.",
      "Trial drops from 14 days to 7.",
      "Something has to happen to the 1,297 workshops already on Free. Grandfather them, migrate them to a trial, or lock them out.",
    ],
    bet: "That the free tier is not building a base, it is absorbing demand. Forcing the decision inside the first week converts more of the same traffic.",
    evidence: [
      "76% of workshops that ever diagnosed did all of it inside a 7-day span, so 7 days covers the natural usage window for most.",
      "The median diagnosing workshop ran exactly one diagnostic ever, so a one-vehicle trial is not much of a restriction for the typical user.",
      "70% of signups never ran a diagnostic at all. That pool is not converting later, it is just sitting there.",
      "45 workshops are in trial against 60 paying, so trial volume is already healthy. The problem is the end of the trial.",
    ],
    risks: [
      "A card wall usually cuts signup volume hard. If signups drop 70% then trial-to-paid has to more than triple just to break even.",
      "The app store listing and any marketing that promises a free tier all have to change at the same time, or the store review and the app disagree.",
      "The freemium check-in sequences and the freemium lifecycle stage in this CRM are built on a free pool existing. Removing Free breaks that motion.",
      "The 191 workshops that already reverted to Free have nowhere to land, so they either churn out entirely or need a special case.",
      "One vehicle in 7 days assumes the mechanic has a suitable car in the bay that week. If not, the trial expires having proved nothing.",
    ],
    bestIf: "We believe the product sells itself in one week and we would rather have 200 serious workshops than 1,300 dormant ones.",
  },

  // -------------------------------------------------------------- B
  {
    id: "trial-plus-archive",
    key: "B",
    name: "Trial, then read-only Archive",
    thesis:
      "Same 7-day card trial as A, but expired trials fall back to a read-only Archive tier instead of disappearing. They keep their history, they just cannot run anything new.",
    trial: "7 days, card required, 1 vehicle. Expiry drops to Archive, not to nothing.",
    revenueShape: "Subscription with a retention floor",
    buildEffort: "Medium",
    plans: [
      {
        name: "Free trial",
        tagline: "One car, one week, everything unlocked",
        price: "7 days",
        priceNote: "Card required",
        badge: "Everyone starts here",
        features: [
          "1 vehicle, fully unlocked",
          "Unlimited diagnostics on that vehicle",
          "Full InfoPro and verified measurements",
          "Cancel any time in the 7 days",
        ],
        cta: "Start 7-day trial",
      },
      {
        name: "Archive",
        tagline: "Where an expired trial lands",
        price: "SEK 0",
        priceNote: "Not sold, only fallen into",
        features: [
          "Read every diagnostic you already ran",
          "Export your reports",
          "Account and team stay intact",
          "Resubscribe in one click",
        ],
        locked: ["New diagnostics", "AI chat and search", "InfoPro data", "Verified measurements"],
        cta: "Upgrade to continue",
      },
      ...PAID_LADDER_UNCHANGED,
    ],
    changes: [
      "Free is replaced by Archive, which is read-only and is never advertised as a plan.",
      "The 1,297 existing free workshops migrate to Archive cleanly, which solves A's biggest migration problem.",
      "Pricing page shows three paid plans and a trial. Archive only appears once you are in it.",
    ],
    bet: "That the value of the free tier was never the free work, it was keeping the account alive and reachable. Archive keeps the account, removes the free lunch.",
    evidence: [
      "191 workshops already reverted from a subscription to Free. Under A they vanish, under B they stay contactable and one click from resubscribing.",
      "Losing access to work you already did is a much sharper prompt to pay than never having had access.",
      "The CRM's free-user check-in sequences keep working, they just target Archive instead of Free.",
    ],
    risks: [
      "There is still a SEK 0 row in the product, so some of the psychological benefit of killing Free is lost.",
      "Support load from people who do not understand why the app went read-only.",
      "Needs a real read-only mode in the app, which is more product work than simply deleting a plan.",
    ],
    bestIf: "We want A's urgency but cannot stomach throwing away 1,297 accounts and the re-engagement motion built on them.",
  },

  // -------------------------------------------------------------- C
  {
    id: "vehicle-credits",
    key: "C",
    name: "Pay per vehicle, credits",
    thesis:
      "Stop selling months and start selling cars. A credit unlocks one vehicle completely for 72 hours. Subscriptions become an optional bulk discount for workshops that actually run volume.",
    trial: "1 free credit, no card. One real car, fully unlocked, no clock.",
    revenueShape: "Usage, with an optional subscription on top",
    buildEffort: "High",
    plans: [
      {
        name: "Single vehicle",
        tagline: "One car, 72 hours, fully unlocked",
        price: "SEK 99",
        period: "/ vehicle",
        features: [
          "Full InfoPro on that vehicle",
          "Unlimited diagnostics on it for 72 hours",
          "Verified measurements",
          "Unlimited AI chat and search",
          "No subscription, no card on file needed",
        ],
        cta: "Buy 1 credit",
      },
      {
        name: "10 pack",
        tagline: "SEK 79 per vehicle",
        price: "SEK 790",
        priceNote: "Credits never expire",
        features: ["10 vehicle credits", "Shared across the whole workshop", "Full history kept forever"],
        cta: "Buy 10",
      },
      {
        name: "50 pack",
        tagline: "SEK 59 per vehicle",
        price: "SEK 2,950",
        priceNote: "Credits never expire",
        badge: "Best value",
        highlight: true,
        features: ["50 vehicle credits", "Up to 3 users", "Priority support"],
        cta: "Buy 50",
      },
      {
        name: "Workshop",
        tagline: "For shops that run volume every month",
        price: "SEK 749",
        period: "/ month",
        features: [
          "20 credits every month",
          "Unused credits roll over",
          "Up to 3 users",
          "Priority support",
        ],
        cta: "Subscribe",
      },
    ],
    changes: [
      "Plans become packs. The seat dimension mostly disappears, the vehicle dimension becomes the only thing you buy.",
      "Billing moves from recurring-only to one-off purchases plus optional recurring, which is real Stripe work.",
      "The whole entitlement model in the app changes from plan-based to credit-based.",
    ],
    bet: "That the usage curve, not the willingness to pay, is what is blocking revenue. A workshop that runs one diagnostic a quarter will never buy a monthly plan, but it will happily pay 99 kr for the car in front of it.",
    evidence: [
      "233 of 442 diagnosing workshops ran exactly one diagnostic ever, and the median is 1. A monthly subscription asks that workshop to pay 12 times for something it does once.",
      "Only 30 workshops ever ran more than 20 diagnostics, so the volume segment that genuinely needs a subscription is tiny and can be served by the Workshop plan.",
      "AI cost per diagnostic is $0.014, so the price of a credit is set almost entirely by the per-vehicle data licence, not by compute.",
    ],
    risks: [
      "Every number above is a guess until we know the actual per-vehicle InfoPro licence cost. If it is above roughly SEK 40 the 50 pack has no margin.",
      "Kills the MRR narrative. Revenue becomes lumpy and much harder to forecast.",
      "Credit anxiety is real. Mechanics may hesitate to spend a credit, which suppresses exactly the usage we want.",
      "Existing 60 subscribers have to be migrated or grandfathered.",
    ],
    bestIf: "The long tail matters more than predictable MRR, and the per-vehicle data cost is low enough to price a credit under SEK 100.",
  },

  // -------------------------------------------------------------- D
  {
    id: "single-seat-plan",
    key: "D",
    name: "One plan, priced per mechanic",
    thesis:
      "Collapse the ladder. One plan, one price, per user, everything unlocked, no vehicle quota at all. You buy seats, the way a workshop already buys every other tool.",
    trial: "7 days, card required, unlimited vehicles, 1 seat.",
    revenueShape: "Per-seat subscription",
    buildEffort: "Low",
    plans: [
      {
        name: "Wrenchlane",
        tagline: "Everything, per mechanic",
        price: "SEK 449",
        period: "/ user / month",
        badge: "The only plan",
        highlight: true,
        features: [
          "Unlimited vehicles",
          "Unlimited diagnostics",
          "Full InfoPro technical data on every vehicle",
          "Verified measurements",
          "Unlimited AI search and chat",
          "Full history",
          "Add and remove seats any month",
          "Priority support",
        ],
        cta: "Start 7-day trial",
      },
      {
        name: "Wrenchlane yearly",
        tagline: "Same plan, two months free",
        price: "SEK 4,490",
        period: "/ user / year",
        priceNote: "Equivalent to SEK 374 / month",
        features: ["Everything in the monthly plan", "Locked price for 12 months", "Invoice billing available"],
        cta: "Go yearly",
      },
    ],
    changes: [
      "Three tiers become one. The vehicle quota disappears entirely.",
      "Simplest option to actually build, it is mostly deleting things.",
      "Single-mechanic shops currently on One at SEK 179 jump to SEK 449, which is a 2.5x increase for that segment.",
    ],
    bet: "That the current ladder loses sales to confusion. Two dials move at once, vehicles and seats, and a mechanic cannot tell which plan is theirs without doing arithmetic.",
    evidence: [
      "Current ARPA is roughly SEK 862 / month, so a 2-mechanic shop at SEK 898 is close to revenue-neutral and every 3-seat shop is an increase.",
      "24 of 60 payers are on Small, which is 1-3 users, so the middle of the market is already seat-shaped.",
      "The 20 and 80 vehicles-per-month quotas are almost certainly never hit given the median workshop runs one diagnostic ever, so the quota is buying us complexity and no revenue protection.",
    ],
    risks: [
      "Unlimited vehicles removes the cap on per-vehicle data cost. One heavy shop could be unprofitable and nothing stops it.",
      "The One tier at SEK 179 is our only cheap entry point. Removing it may lose the solo mechanic entirely.",
      "Loses upsell headroom. With one price there is no natural expansion path except more seats.",
    ],
    bestIf: "We think the ladder is costing us more in confusion than the quotas are saving us in data cost, and we can verify that heavy users are rare.",
  },

  // -------------------------------------------------------------- E
  {
    id: "free-diagnose-pay-fix",
    key: "E",
    name: "Free to diagnose, pay to fix",
    thesis:
      "Keep signup free and frictionless, but move the paywall to the moment of value. The ranked list of likely causes is free forever. The procedure that actually fixes the car is not.",
    trial: "No card, 7 days of full access, unlimited vehicles.",
    revenueShape: "Freemium with the wall at the moment of value",
    buildEffort: "High",
    plans: [
      {
        name: "Free",
        tagline: "Diagnose any car, unlimited",
        price: "SEK 0",
        features: [
          "Unlimited diagnostics on any vehicle",
          "Ranked likely causes with confidence",
          "TSB search",
          "AI chat about the fault",
          "Full history",
        ],
        locked: [
          "The repair procedure",
          "Verified measurements and test values",
          "Wiring diagrams and full InfoPro",
          "Torque specs and part numbers",
        ],
        cta: "Start free",
      },
      {
        name: "One",
        tagline: "Unlock the car in your bay",
        price: "SEK 179",
        period: "/ month",
        features: ["1 fully unlocked vehicle", "Full procedures and measurements", "Full InfoPro technical data"],
        cta: "Unlock",
      },
      {
        name: "Small",
        tagline: "For small workshops, 1-3 mechanics",
        price: "SEK 749",
        period: "/ month",
        badge: "Most popular",
        highlight: true,
        features: ["Up to 3 users", "Premium data for 20 vehicles / month", "Everything unlocked on those vehicles"],
        cta: "Choose Small",
      },
      {
        name: "Large",
        tagline: "For growing workshops, up to 11",
        price: "SEK 1,799",
        period: "/ month",
        features: ["Up to 11 users", "Premium data for 80 vehicles / month", "Priority support"],
        cta: "Choose Large",
      },
    ],
    changes: [
      "The free plan gets more generous on volume (unlimited diagnostics) and much stricter on depth (no procedure, no measurements).",
      "Daily caps on the free tier disappear, which removes a lot of arbitrary-feeling limits.",
      "The paywall moves from 'you have used your free thing today' to 'here is your answer, pay to act on it'.",
    ],
    bet: "That we are paywalling the wrong half. A daily cap frustrates people before they see value. A procedure paywall arrives exactly when they are standing at a car they cannot fix.",
    evidence: [
      "30% of workshops ever ran a diagnostic and the free tier is not being consumed, so top of funnel is not the constraint, conversion at the moment of value is.",
      "The premium data is the thing with a real per-vehicle cost, so paywalling exactly that aligns price with cost.",
      "A ranked cause list costs us $0.014 to produce, so giving it away unlimited is nearly free.",
    ],
    risks: [
      "For an experienced mechanic a good ranked cause list may be the whole product. We would be giving away the differentiator and keeping the commodity.",
      "Hardest of the six to build. It needs a genuine split of the diagnostic output into free and paid halves.",
      "A paywall at the moment of frustration can read as a bait and switch if the free half feels deliberately crippled.",
    ],
    bestIf: "We believe the AI diagnosis is the hook and the InfoPro data is the product, and we are willing to prove that with a real split.",
  },

  // -------------------------------------------------------------- F
  {
    id: "annual-first",
    key: "F",
    name: "Annual first",
    thesis:
      "Keep the tiers and the 7-day card trial, but sell the year. Monthly survives only on the cheapest tier. A workshop tool is an annual purchase, and monthly makes cancelling the default every 30 days.",
    trial: "7 days, card required, 1 vehicle, then the annual term starts.",
    revenueShape: "Annual subscription",
    buildEffort: "Low",
    plans: [
      {
        name: "One",
        tagline: "1 vehicle, the only monthly option",
        price: "SEK 179",
        period: "/ month",
        priceNote: "or SEK 1,490 / year",
        features: ["1 fully unlocked vehicle", "Unlimited diagnostics", "Full InfoPro on that vehicle"],
        cta: "Start 7-day trial",
      },
      {
        name: "Small",
        tagline: "For small workshops, 1-3 mechanics",
        price: "SEK 6,990",
        period: "/ year",
        priceNote: "Equivalent to SEK 582 / month",
        badge: "Most popular",
        highlight: true,
        features: [
          "Up to 3 users",
          "Premium data for 20 vehicles / month",
          "Everything in One",
          "Priority support",
          "Invoice billing available",
        ],
        cta: "Start 7-day trial",
      },
      {
        name: "Large",
        tagline: "For growing workshops, up to 11",
        price: "SEK 15,900",
        period: "/ year",
        priceNote: "Equivalent to SEK 1,325 / month",
        features: ["Up to 11 users", "Premium data for 80 vehicles / month", "Everything in Small", "Priority support"],
        cta: "Start 7-day trial",
      },
    ],
    changes: [
      "Monthly billing is removed from Small and Large. One keeps it as the low-commitment entry.",
      "Yearly discounts get normalised. Today One saves 75% yearly while Small and Large save around 26%, which is hard to defend.",
      "Free is removed the same way as in option A, or replaced by Archive as in option B.",
    ],
    bet: "That our churn is a billing-cadence problem as much as a value problem. Monthly puts a cancel decision in front of every workshop twelve times a year.",
    evidence: [
      "191 workshops reverted from a subscription back to Free. With monthly billing that is a one-click decision available every 30 days.",
      "Only 17 of 60 payers are on a yearly plan today, so there is a lot of room to shift the mix.",
      "Workshops already buy diagnostic tooling and data subscriptions annually, so the cadence matches how the buyer budgets.",
    ],
    risks: [
      "A SEK 6,990 commitment after a 7-day trial is a much bigger ask. Trial-to-paid will drop, the question is whether retained revenue rises more.",
      "Refund and cancellation policy needs to be genuinely good or the annual term feels like a trap.",
      "Cash is collected up front, which is good for us and bad for a small shop's cash flow. May need invoice billing to work at all.",
    ],
    bestIf: "We think the 60 payers we have are the right customers and the problem is that we keep giving them a chance to leave.",
  },
];

export type OpenQuestion = { question: string; why: string };

export const OPEN_QUESTIONS: OpenQuestion[] = [
  {
    question: "What is the real per-vehicle cost of the premium (InfoPro) data?",
    why: "Options C and D are unpriceable without it. C sets a credit price against it directly, and D removes the vehicle quota entirely, which only works if a heavy user cannot be unprofitable.",
  },
  {
    question: "What happens to the 1,297 workshops already on Free?",
    why: "Options A and F delete the plan they are on. Grandfathering them keeps goodwill but keeps the dead pool. Migrating them to a trial converts some and annoys the rest. Option B is mostly an answer to this question.",
  },
  {
    question: "Is the 75% yearly discount on One deliberate?",
    why: "It prices a year of One at roughly SEK 45 / month against 27% and 26% on Small and Large. Either it is an intentional loss-leader or it is a pricing bug, and it changes the shape of any ladder we design.",
  },
  {
    question: "Does the App Store listing promise a free tier?",
    why: "The Swedish App Store listing is our only source of reviews right now. Removing Free means the listing, the screenshots and the store metadata all change together, and a mismatch risks a review rejection.",
  },
  {
    question: "What breaks in this CRM if Free disappears?",
    why: "The freemium lifecycle stage, the auto-enrol free-user check-in sequences and the Free Users dashboard all assume a free pool exists. They need a new definition, probably 'expired trial' or 'Archive'.",
  },
  {
    question: "Why did 70% of signups never run a diagnostic?",
    why: "Every option here is a pricing answer to what might be an onboarding problem. If the blocker is that a mechanic cannot get their car connected in the first session, no price change fixes it.",
  },
];

/** The SQL behind SIGNALS, so the numbers can be refreshed without guessing. */
export const QUERIES = `-- Plan and subscription mix (internal-test accounts excluded)
select plan_key, core_subscription_status, count(*)
from dashboard_workshops
where coalesce(is_internal_test,false) = false
group by 1,2 order by 3 desc;

-- Free pool, reverted subscribers, paying, trialing
with w as (select * from dashboard_workshops where coalesce(is_internal_test,false) = false)
select
  (select count(*) from w where plan_key='free') as free_workshops,
  (select count(*) from w where plan_key='free' and core_stripe_subscription_id is not null) as free_reverted,
  (select count(*) from w where plan_key<>'free' and plan_key is not null and core_subscription_status='active') as paid_active,
  (select count(*) from w where core_subscription_status='trialing') as trialing_now,
  (select count(*) from w) as total_workshops;

-- Usage curve: how many diagnostics does a workshop actually run
with per as (
  select workshop_id, count(*) n, min(created_at) first_diag, max(created_at) last_diag
  from dashboard_diagnostics group by 1
)
select
  count(*) filter (where n = 1) as one_and_done,
  count(*) filter (where n between 2 and 5) as few,
  count(*) filter (where n > 20) as heavy,
  percentile_cont(0.5) within group (order by n) as median_diags,
  count(*) filter (where last_diag - first_diag <= interval '7 days') as all_within_7d
from per;`;
