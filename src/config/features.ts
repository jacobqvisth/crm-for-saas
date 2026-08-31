// The feature registry: every surface that only some customers of this CRM
// want, and exactly what each one governs.
//
// WHY THIS EXISTS
// ---------------
// This codebase serves several companies from one `main` (see
// docs/plans/productisation/). Wrenchlane needs DTC lookups, forums, field
// routes, the call agent and the whole analytics suite; Animech and Spennare
// need almost none of it. Since Wrenchlane is live, none of it can be deleted,
// so every such surface becomes SWITCHABLE instead.
//
// Each entry declares the three places a feature has to be gated, because
// hiding it in only one of them is a bug:
//
//   navHrefs      the sidebar items that disappear
//   routePrefixes the page and API paths that 404
//   cronPaths     the scheduled jobs that no-op
//
// GROUND RULE R2: every flag defaults to ON. A new feature added here is
// enabled for Wrenchlane automatically and forever, unless Jacob says
// otherwise. New tenants get a config that switches things OFF; Wrenchlane's
// config is the baseline, never the exception.

export type FeatureKey =
  | "dtc"
  | "videos"
  | "forums"
  | "articles"
  | "reviews"
  | "field_routes"
  | "call_agent"
  | "calling"
  | "product_analytics"
  | "journey"
  | "funnel"
  | "activation"
  | "pricing_options"
  | "domain_portfolio"
  | "discovery"
  | "roadmap"
  | "mockup"
  | "deals"
  | "dealer_network"
  | "linkedin_steps";

/**
 * Grouping for the phase 04 admin console, so the toggles are not one flat list.
 *
 * Deliberately does not say how many there are. The previous version of this
 * line said nineteen and was wrong the moment a twentieth was added, which is
 * the same rot that left CLAUDE.md claiming 18 tables when there were 101.
 */
export type FeatureCategory =
  | "content"
  | "outbound"
  | "telephony"
  | "analytics"
  | "internal"
  | "planned";

export interface FeatureDefinition {
  key: FeatureKey;
  /** Human name, as the admin console will label the toggle. */
  name: string;
  category: FeatureCategory;
  /** What turning it off actually removes, in one line. */
  description: string;
  /**
   * Default for every tenant that does not say otherwise. Always `true` before
   * phase 08 (R2). `false` here would mean Wrenchlane lost a feature.
   */
  enabledByDefault: boolean;
  /** Sidebar hrefs removed when the feature is off. */
  navHrefs: readonly string[];
  /**
   * Page and API path prefixes that return 404 when the feature is off.
   * Matched longest-prefix-first, so `/dashboard/dtc-codes` resolves to `dtc`
   * rather than to `product_analytics`'s broader `/dashboard`.
   */
  routePrefixes: readonly string[];
  /**
   * Scheduled job paths. These are deliberately NOT 404'd: a cron whose
   * feature is off answers 200 with `{ skipped: "feature disabled" }`. A cron
   * that fails every five minutes buries the Slack alert channel and trains
   * everyone to ignore it.
   */
  cronPaths: readonly string[];
}

export const FEATURES: readonly FeatureDefinition[] = [
  {
    key: "dtc",
    name: "DTC codes",
    category: "content",
    description: "Fault-code lookup and the diagnostic-code dashboards.",
    enabledByDefault: true,
    navHrefs: ["/dtc-lookup"],
    routePrefixes: [
      "/dtc-lookup",
      "/api/dtc-lookup",
      "/dashboard/dtc-codes",
      "/dashboard/diagnostic-search-terms",
    ],
    cronPaths: [],
  },
  {
    key: "videos",
    name: "Videos",
    category: "content",
    description: "The DTC-code YouTube gallery.",
    enabledByDefault: true,
    navHrefs: ["/videos"],
    routePrefixes: ["/videos", "/api/videos"],
    cronPaths: [],
  },
  {
    key: "forums",
    name: "Forums",
    category: "content",
    description: "Reddit answering, mention tracking and the candidate queue.",
    enabledByDefault: true,
    navHrefs: ["/forums"],
    routePrefixes: ["/forums", "/api/forums"],
    cronPaths: ["/api/forums/mentions/scan", "/api/forums/candidates/scan"],
  },
  {
    key: "articles",
    name: "Articles",
    category: "content",
    description: "The content studio and Webflow publishing.",
    enabledByDefault: true,
    navHrefs: ["/articles"],
    routePrefixes: ["/articles", "/api/articles", "/api/landing-pages"],
    cronPaths: [],
  },
  {
    key: "reviews",
    name: "Reviews",
    category: "content",
    description: "App-store, Google and Trustpilot review collection.",
    enabledByDefault: true,
    navHrefs: ["/reviews"],
    routePrefixes: ["/reviews"],
    cronPaths: ["/api/cron/sync-reviews"],
  },
  {
    key: "field_routes",
    name: "Field routes",
    category: "outbound",
    description: "Map-planned visit routes for reps in the field.",
    enabledByDefault: true,
    navHrefs: ["/routes"],
    routePrefixes: ["/routes", "/api/routes", "/settings/field-visits"],
    cronPaths: [],
  },
  {
    key: "discovery",
    name: "Discovery",
    category: "outbound",
    description: "Scraped-prospect staging, promotion and contact enrichment.",
    enabledByDefault: true,
    navHrefs: ["/discovery"],
    routePrefixes: ["/discovery", "/api/discovery", "/api/enrich"],
    cronPaths: ["/api/cron/phone-enrichment"],
  },
  {
    key: "calling",
    name: "Calling",
    category: "telephony",
    description: "Click-to-call, the call worklist, transcription and logging.",
    enabledByDefault: true,
    navHrefs: ["/calls"],
    routePrefixes: ["/calls", "/api/calls", "/settings/calls", "/settings/phone-system"],
    cronPaths: ["/api/cron/sweep-stuck-calls"],
  },
  {
    key: "call_agent",
    name: "Call agent",
    category: "telephony",
    description: "The autonomous voice agent and the inbound receptionist.",
    enabledByDefault: true,
    navHrefs: ["/call-agent", "/receptionist"],
    routePrefixes: [
      "/call-agent",
      "/receptionist",
      "/api/call-agent",
      "/api/switchboard",
    ],
    cronPaths: ["/api/cron/call-agent", "/api/cron/switchboard-collect"],
  },
  {
    key: "product_analytics",
    name: "Product analytics",
    category: "analytics",
    description:
      "The whole /dashboard suite and the hourly syncs that feed it (Stripe, GA4, PostHog, Search Console, App Store, core app).",
    enabledByDefault: true,
    navHrefs: ["/dashboard"],
    routePrefixes: ["/dashboard", "/api/dashboard", "/api/ceo-sync"],
    cronPaths: [
      "/api/cron/discover-new-wl-users",
      "/api/cron/sync-cta-clicks",
      "/api/cron/reconcile-wl-attribution",
      "/api/cron/check-sync-health",
      "/api/cron/sync-google-ads-assets",
      "/api/cron/sync-ad-conversions",
    ],
  },
  {
    key: "journey",
    name: "User journey",
    category: "analytics",
    description: "The Miro-style journey canvas.",
    enabledByDefault: true,
    navHrefs: ["/journey"],
    routePrefixes: ["/journey", "/api/journey"],
    cronPaths: [],
  },
  {
    key: "funnel",
    name: "Funnel",
    category: "analytics",
    description: "The full-funnel analysis page.",
    enabledByDefault: true,
    navHrefs: ["/funnel"],
    routePrefixes: ["/funnel"],
    cronPaths: [],
  },
  {
    key: "activation",
    name: "Activation plan",
    category: "analytics",
    description: "Activation scenarios and the Customer.io campaign plan.",
    enabledByDefault: true,
    navHrefs: ["/activation"],
    routePrefixes: ["/activation", "/api/activation"],
    cronPaths: [],
  },
  {
    key: "pricing_options",
    name: "Pricing options",
    category: "analytics",
    description: "Pricing-model drafts and their supporting evidence.",
    enabledByDefault: true,
    navHrefs: ["/pricing-options"],
    routePrefixes: ["/pricing-options"],
    cronPaths: [],
  },
  {
    key: "domain_portfolio",
    name: "Domain portfolio",
    category: "outbound",
    description: "Sending-domain inventory and the daily deliverability checks.",
    enabledByDefault: true,
    navHrefs: ["/domain-portfolio"],
    routePrefixes: ["/domain-portfolio"],
    cronPaths: ["/api/cron/domain-health"],
  },
  {
    key: "roadmap",
    name: "Roadmap",
    category: "internal",
    description: "The Gantt-style product roadmap.",
    enabledByDefault: true,
    navHrefs: ["/roadmap"],
    routePrefixes: ["/roadmap", "/api/roadmap"],
    cronPaths: [],
  },
  {
    key: "mockup",
    name: "Mockup",
    category: "internal",
    description: "Internal home for design drafts awaiting review.",
    enabledByDefault: true,
    navHrefs: ["/mockup"],
    routePrefixes: ["/mockup"],
    cronPaths: [],
  },

  // Declared now, implemented in phase 10. They have no routes yet, so the
  // flags do nothing except exist — which is the point: phase 10 can build
  // against a key that is already part of the type and already surfaced in the
  // admin console.
  {
    key: "deals",
    name: "Deal pipeline",
    category: "planned",
    description: "Opportunity pipeline and stages. Built in phase 10.",
    enabledByDefault: true,
    navHrefs: [],
    routePrefixes: [],
    cronPaths: [],
  },
  {
    key: "dealer_network",
    name: "Dealer network",
    category: "planned",
    description: "Reseller and dealer hierarchy. Built in phase 10.",
    enabledByDefault: true,
    navHrefs: [],
    routePrefixes: [],
    cronPaths: [],
  },

  // The one flag that is deliberately OFF by default, and the only exception
  // R2 allows: R2 exists so Wrenchlane never silently LOSES a surface it
  // already has. LinkedIn steps are brand new, so defaulting them off removes
  // nothing. Jacob asked for exactly this on 2026-08-31 ("bygg den för
  // spennare och animech, låt den vara optional för wrenchlane"), which is the
  // "unless Jacob says otherwise" the header paragraph reserves.
  //
  // It governs no route: LinkedIn steps live inside /sequences, which is core
  // product. The gate is therefore in two other places, and both are needed —
  // the step type is hidden from the builder, and `createStepTasks` refuses to
  // create the task even for steps a tenant saved while the flag was on.
  {
    key: "linkedin_steps",
    name: "LinkedIn steps",
    category: "outbound",
    description:
      "Connection-request and message steps inside sequences. Creates a task for a rep; nothing is sent automatically.",
    enabledByDefault: false,
    navHrefs: [],
    routePrefixes: [],
    cronPaths: [],
  },
] as const;

/** One boolean per feature. Exhaustive: the compiler rejects a missing key. */
export type FeatureFlags = Record<FeatureKey, boolean>;

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((f) => f.key);

const BY_KEY = new Map<FeatureKey, FeatureDefinition>(FEATURES.map((f) => [f.key, f]));

export function featureDefinition(key: FeatureKey): FeatureDefinition {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown feature key "${key}"`);
  return def;
}

/**
 * The registry's own defaults, which for all but the declared opt-ins means
 * "on".
 *
 * Wrenchlane uses this rather than listing twenty booleans, which is what makes
 * R2 automatic: a feature added to the registry is on for Wrenchlane the moment
 * it exists, with no second file to remember to edit. A feature that ships
 * `enabledByDefault: false` is therefore off for Wrenchlane too, which is only
 * ever correct for something Wrenchlane never had — see the `OFF_BY_DEFAULT`
 * list in features.test.ts, which is where that exception is policed.
 */
export const ALL_FEATURES_ENABLED: FeatureFlags = Object.fromEntries(
  FEATURES.map((f) => [f.key, f.enabledByDefault]),
) as FeatureFlags;

/**
 * Cron paths, longest first. Checked before route prefixes, because a cron
 * under a gated prefix (`/api/forums/mentions/scan` lives under `/api/forums`)
 * must answer 200-skipped from its handler rather than being 404'd on the way
 * in.
 */
const CRON_PATHS: readonly string[] = FEATURES.flatMap((f) => f.cronPaths).sort(
  (a, b) => b.length - a.length,
);

export function isCronPath(pathname: string): boolean {
  return CRON_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Route prefixes paired with their feature, longest first. */
const ROUTE_INDEX: readonly { prefix: string; key: FeatureKey }[] = FEATURES.flatMap((f) =>
  f.routePrefixes.map((prefix) => ({ prefix, key: f.key })),
).sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Which feature governs a path, or null when the path is core product.
 *
 * Longest prefix wins, so `/dashboard/dtc-codes` belongs to `dtc` even though
 * `product_analytics` also claims `/dashboard`. Turning DTC off therefore
 * removes the DTC dashboards while leaving the rest of the analytics suite up.
 */
export function featureForPath(pathname: string): FeatureKey | null {
  for (const { prefix, key } of ROUTE_INDEX) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return key;
  }
  return null;
}

/** Which feature owns a sidebar href, or null when the item is core. */
export function featureForNavHref(href: string): FeatureKey | null {
  for (const f of FEATURES) {
    if (f.navHrefs.includes(href)) return f.key;
  }
  return null;
}
