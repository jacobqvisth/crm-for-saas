/**
 * Which ad surface is allowed to point at which page, and what is missing.
 *
 * THE RULE THIS TABLE ENFORCES
 *
 *   No ad group may point at a page more generic than the query it bids on.
 *
 * That single rule is what the current setup breaks. The alternatives ad group
 * bids on four rival names and sends every one of them to the generic Small
 * plan page, while fifteen comparison pages sit published and unfed. Someone
 * who typed a rival's name gets a pricing table for a plan they have not chosen
 * yet, which answers a question they did not ask.
 *
 * The rule also explains why the fault-code cluster is the largest gap rather
 * than merely the largest number. There is no page anywhere on the site that a
 * code query could honestly land on, so the most specific page available is the
 * homepage, and the homepage is maximally generic. Every code query is
 * therefore a guaranteed violation until the cluster exists.
 */

import type { LandingPageKind, LandingPageState } from "./types";

export type AdSurface = {
  key: string;
  /** What the person types, in their words. */
  query: string;
  /** The campaign or ad group that buys it. */
  adSurface: string;
  pageKind: LandingPageKind;
  /** URL shape, with the variable part in angle brackets. */
  urlPattern: string;
  state: LandingPageState;
  /** How many pages this row implies. A range or a count. */
  pages: string;
  /** What is true today, and what the gap costs. */
  note: string;
};

export const AD_SURFACE_MAP: readonly AdSurface[] = [
  {
    key: "fault_code",
    query: "p0420, p0299 turbo underboost, what does p0011 mean",
    adSurface: "Search on codes, plus Dynamic Search Ads over the cluster",
    pageKind: "fault_code",
    urlPattern: "/en/fault-code/<code>",
    state: "not_built",
    pages: "Hundreds, tiered by measured demand",
    note: "The largest gap on this page. A technician mid-repair types a code, and the most specific page we own is the homepage. Dynamic Search Ads cannot help either, because they match against pages that exist, and none of these do.",
  },
  {
    key: "fault_code_family",
    query: "catalytic converter codes, misfire codes list, dpf fault codes",
    adSurface: "Search on family terms",
    pageKind: "fault_code_family",
    urlPattern: "/en/fault-code/family/<family>",
    state: "not_built",
    pages: "One per functional family",
    note: "Hubs do double duty: they catch the broader query, and they give every long-tail code page somewhere honest to send a reader whose exact code we cannot document individually.",
  },
  {
    key: "make_hub",
    query: "bmw fault codes, volvo p1 codes, mercedes ec55a",
    adSurface: "Search on make plus code",
    pageKind: "make_hub",
    urlPattern: "/en/fault-code/make/<make>",
    state: "not_built",
    pages: "One per make with real volume",
    note: "Where manufacturer-specific codes go. They never get a standalone page, because one description cannot serve P1525 on a Volvo and a Peugeot, but scoped to a make the question becomes answerable.",
  },
  {
    key: "symptom",
    query: "car shakes when idling, check engine light after refuelling",
    adSurface: "Search on symptoms",
    pageKind: "symptom",
    urlPattern: "/en/symptom/<symptom>",
    state: "not_built",
    pages: "A curated set, not generated",
    note: "The half of Problem-stage demand that arrives without a code. Deliberately hand-picked rather than generated: symptom phrasing has no finite vocabulary to enumerate, so a generator would invent queries nobody types.",
  },
  {
    key: "competitor",
    query: "alldata alternative, haynespro vs, autodata pricing",
    adSurface: "Competitor Search, alternatives ad group",
    pageKind: "competitor",
    urlPattern: "/vs/<rival>",
    state: "exists_unrouted",
    pages: "15 published",
    note: "The cheapest win available. Fifteen pages are live and indexed, four rival names are bid on, and all four route to the generic Small plan page. Splitting the ad group and pointing each name at its own page is a routing change with no build cost.",
  },
  {
    key: "qualifier",
    query: "obd software for my workshop, diagnostic tool for 3 mechanics",
    adSurface: "Performance Max, Demand Gen, broad Search",
    pageKind: "qualifier",
    urlPattern: "/en/find-your-plan",
    state: "not_built",
    pages: "1",
    note: "Shop size cannot be targeted in an auction but it can be asked on a page. This is where broad traffic should land instead of at a specific plan page that guesses wrong two times in three.",
  },
  {
    key: "plan",
    query: "wrenchlane pricing, wrenchlane one price",
    adSurface: "Plan Search campaigns",
    pageKind: "plan",
    urlPattern: "/en/free, /wrenchlane-one, /small, /large",
    state: "live_and_routed",
    pages: "4 published",
    note: "Correctly routed and barely serving. The constraint here is the bid, not the page: these campaigns lose their auctions, so the pages never get the chance to convert.",
  },
  {
    key: "brand",
    query: "wrenchlane",
    adSurface: "Brand Search",
    pageKind: "brand",
    urlPattern: "/en",
    state: "not_built",
    pages: "0, the page exists",
    note: "The page needs nothing. The campaign does not exist, which leaves our own name available to anyone willing to bid on it.",
  },
];

/**
 * Pages that exist and are correctly fed need no work. Everything else is
 * either a routing fix or a build, and the two have wildly different costs, so
 * the page separates them rather than showing one undifferentiated backlog.
 */
export function routingFixes(): readonly AdSurface[] {
  return AD_SURFACE_MAP.filter((row) => row.state === "exists_unrouted");
}

export function buildGaps(): readonly AdSurface[] {
  return AD_SURFACE_MAP.filter((row) => row.state === "not_built");
}
