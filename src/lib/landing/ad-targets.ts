/**
 * The desired state: which ad group should point at which URL.
 *
 * This is the half of the programme that Google Ads has to agree with. The
 * landing-page side decides what pages exist; this decides which query is
 * allowed to reach each one. Keeping it as data rather than as instructions in
 * a document is what lets the reconciler in ads-sync.ts diff it against the
 * live account instead of someone checking by hand.
 *
 * SLUGS ARE VERIFIED, NOT GUESSED
 *
 * Every path below was read from wrenchlane.com/sitemap.xml rather than
 * inferred from the rival's name, because the failure mode of guessing is an ad
 * group pointing at a 404, which is strictly worse than the generic page it
 * points at today. `mitchell1-prodemand`, `jayda-ai` and `autel-maxisys` are all
 * cases where the obvious guess would have been wrong.
 */

export type CompetitorTarget = {
  key: string;
  /** How the rival is written in prose. Never used in ad text. */
  name: string;
  /** Verified live path. */
  path: string;
  /**
   * Keyword terms for this rival, without match-type punctuation. The
   * reconciler wraps them; keeping them bare means the match-type decision
   * lives in one place instead of fifteen.
   */
  terms: string[];
  /** Currently bid on somewhere in the account. */
  currentlyBid: boolean;
};

/**
 * All fifteen live comparison pages.
 *
 * `currentlyBid` marks the five that the Small plan campaign's `alternatives`
 * ad group already buys and misroutes. Read from the live account, not from
 * `campaigns-creative.ts`, which mirrors ad copy by hand and lists only four:
 * the real keyword set also carries `prodemand alternative`, `identifix
 * alternative`, `shopkey alternative` and `alldata competitor`. The other ten
 * pages are published, indexed, and have never had an ad pointed at them.
 *
 * Every one of the five lands on https://wrenchlane.com/en/small.
 */

/**
 * Keywords the alternatives ad group buys that have no comparison page at all.
 *
 * ShopKey is Mitchell 1's other product. It gets the same generic destination
 * as the rest, and unlike them there is not even a right page to send it to, so
 * it is either a page worth writing or a keyword worth dropping. Recorded here
 * rather than silently ignored, because a reconciler that only reports what it
 * can fix hides the things it cannot.
 */
export const UNMATCHED_COMPETITOR_TERMS: readonly string[] = ["shopkey"];
export const COMPETITOR_TARGETS: readonly CompetitorTarget[] = [
  {
    key: "alldata",
    name: "ALLDATA",
    path: "/en/vs/alldata",
    terms: ["alldata", "alldata alternative", "alternative to alldata"],
    currentlyBid: true,
  },
  {
    key: "autodata",
    name: "Autodata",
    path: "/en/vs/autodata",
    terms: ["autodata", "autodata alternative", "alternative to autodata"],
    currentlyBid: true,
  },
  {
    key: "mitchell1-prodemand",
    name: "Mitchell 1 ProDemand",
    path: "/en/vs/mitchell1-prodemand",
    terms: ["mitchell 1", "prodemand", "mitchell 1 alternative"],
    currentlyBid: true,
  },
  {
    key: "haynespro",
    name: "HaynesPro",
    path: "/en/vs/haynespro",
    terms: ["haynespro", "haynespro alternative"],
    currentlyBid: true,
  },
  {
    key: "bosch-esitronic",
    name: "Bosch ESI[tronic]",
    path: "/en/vs/bosch-esitronic",
    terms: ["esitronic", "bosch esitronic", "bosch esi tronic"],
    currentlyBid: false,
  },
  {
    key: "identifix",
    name: "Identifix Direct-Hit",
    path: "/en/vs/identifix",
    terms: ["identifix", "identifix alternative"],
    currentlyBid: true,
  },
  {
    key: "snap-on-suretrack",
    name: "Snap-on SureTrack",
    path: "/en/vs/snap-on-suretrack",
    terms: ["suretrack", "snap on suretrack"],
    currentlyBid: false,
  },
  {
    key: "autel-maxisys",
    name: "Autel MaxiSYS",
    path: "/en/vs/autel-maxisys",
    terms: ["autel maxisys", "maxisys"],
    currentlyBid: false,
  },
  {
    key: "elektro-partner",
    name: "Elektro Partner",
    path: "/en/vs/elektro-partner",
    terms: ["elektro partner", "elektropartner"],
    currentlyBid: false,
  },
  {
    key: "iatn",
    name: "iATN",
    path: "/en/vs/iatn",
    terms: ["iatn", "international automotive technicians network"],
    currentlyBid: false,
  },
  {
    key: "qira",
    name: "Qira",
    path: "/en/vs/qira",
    terms: ["qira", "qira diagnostics"],
    currentlyBid: false,
  },
  {
    key: "mech-ai",
    name: "MECH AI",
    path: "/en/vs/mech-ai",
    terms: ["mech ai", "mechai"],
    currentlyBid: false,
  },
  {
    key: "jayda-ai",
    name: "Jayda",
    path: "/en/vs/jayda-ai",
    terms: ["jayda", "jayda ai"],
    currentlyBid: false,
  },
  {
    key: "torquebot",
    name: "TorqueBot",
    path: "/en/vs/torquebot",
    terms: ["torquebot", "torque bot"],
    currentlyBid: false,
  },
  {
    key: "chatgpt",
    name: "ChatGPT",
    path: "/en/vs/chatgpt",
    terms: ["chatgpt for car repair", "chatgpt diagnostics", "ai car diagnosis"],
    currentlyBid: false,
  },
];

/**
 * Ad-group naming.
 *
 * One ad group per rival, named so the account reads as a map of the programme
 * rather than as a pile of history. The reconciler matches on this name, so
 * changing the scheme renames ad groups rather than creating duplicates, which
 * is why it lives in a function instead of being typed out fifteen times.
 */
export function competitorAdGroupName(target: CompetitorTarget) {
  return `Competitor | ${target.name}`;
}

/**
 * Keywords for one rival.
 *
 * Exact match for the rival's own name, phrase match for the intent variants.
 * Exact is right for a brand term because the query set is small and known;
 * phrase is right for "alternative to x" because the wording varies and the
 * intent does not.
 *
 * Rival trademarks appear here and never in ad text. That is Google's policy on
 * comparative advertising and also the guardrail the comparison pages were
 * written under.
 */
export function competitorKeywords(target: CompetitorTarget) {
  return target.terms.map((term, index) => ({
    text: term,
    matchType: index === 0 ? ("EXACT" as const) : ("PHRASE" as const),
  }));
}

/** Rivals with a live page and no ad pointing at it. */
export function unfedCompetitors(): readonly CompetitorTarget[] {
  return COMPETITOR_TARGETS.filter((target) => !target.currentlyBid);
}
