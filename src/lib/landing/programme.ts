/**
 * The written half of the landing-page programme.
 *
 * Structured the same way campaigns-info.ts is, and for the same reason: these
 * are arguments that would otherwise be re-had from scratch every time the
 * subject comes up, so they are written down once, next to the numbers that
 * support them.
 */

export type InfoPoint = { heading: string; body: string };

export const PROGRAMME_THESIS: InfoPoint[] = [
  {
    heading: "The gap is a stage of the funnel, not a shortage of pages",
    body: "Awareness is covered, Evaluation has pages, Decision has pages. Problem has nothing. Someone with a fault code in their hand right now is the highest-intent visitor this business can get, and the most specific page we own for them is the homepage. That is the entire case for this programme.",
  },
  {
    heading: "Our own diagnostics are a better demand signal than a keyword tool",
    body: "A keyword tool reports what everyone who owns a car searches. Our diagnostics report what the exact population we sell to actually met this month, at which workshop, on which make, and how often with nothing but the code to go on. That is a narrower and far more useful signal, and it is already computed on the DTC Codes page.",
  },
  {
    heading: "Volume orders the queue, honesty opens the gate",
    body: "A code earns a page when we can say something true and specific about it. Only then does demand decide when it gets built. Running those two tests in the other order is how programmatic content turns into a few hundred pages that each restate a template with one variable swapped.",
  },
  {
    heading: "Every page must be measurable on the day it ships",
    body: "There is no landing-page column and no click-id column on any table today, so which page delivered a customer is currently unanswerable. Building hundreds of pages on top of that would mean building hundreds of pages we cannot rank, prune or learn from. The capture is part of the page, not a follow-up task.",
  },
];

export const HONESTY_RULES: InfoPoint[] = [
  {
    heading: "Manufacturer-specific codes never get a page of their own",
    body: "The second character of a code says whether it is standardised. P1525 genuinely means different things on a Volvo and a Peugeot, so a single page about it would be a confident wrong answer published at scale. These go on make-scoped hubs, where the question becomes answerable, and nowhere else.",
  },
  {
    heading: "A page that cannot name the fault says so",
    body: "Structural pages open by stating that the code is not individually documented, then give what is genuinely known: the system, the functional family, the subsystem, the failure-mode decode, and the codes it travels with. Padding that gap with plausible text is the one thing that would make the whole cluster worthless.",
  },
  {
    heading: "Only the generic ranges get descriptions",
    body: "This is the same rule the DTC Codes dashboard already applies internally. Carrying it to the public site matters more, not less, because a wrong answer on a dashboard is a bad afternoon and a wrong answer on an indexed page is a technician pulling a good catalytic converter.",
  },
  {
    heading: "The floor is where the honest thing stops being a page",
    body: "A code seen once, with no name, has no companions, no workshop spread and no make skew. Everything a page could say about it comes from its family, and the family already has a page. It becomes a row on that hub instead.",
  },
];

/**
 * The objection that decides whether this programme is an asset or a
 * liability. Worth writing down in full, because "we built four hundred pages"
 * is exactly the shape of thing search engines are built to catch.
 */
export const DOORWAY_DEFENCES: InfoPoint[] = [
  {
    heading: "Every page carries data nobody else has",
    body: "How often this code appears in real diagnostics, which codes it travels with and how strongly, which makes send it, how many separate workshops met it, and how often it arrives with no description at all. None of that is on any other page about that code anywhere, because nobody else is running the diagnoses.",
  },
  {
    heading: "Every page carries a working tool, not only text",
    body: "The reason someone searches a code is to get an answer about their car. A page that ends in a lookup they can actually run is a destination. A page that ends in a pricing table is a doorway, and it reads as one.",
  },
  {
    heading: "The thin tier is honest instead of padded",
    body: "Structural pages are deliberately short and say why. A short page that answers what it can and routes onward is a legitimate page. A long page that reaches the same word count by restating a template is the thing that gets a cluster demoted.",
  },
  {
    heading: "Published in demand order, in batches, never all at once",
    body: "Ship the flagship tier, wait for it to index, measure whether it earns impressions, then release the next batch. Four hundred pages appearing on one day is a pattern in itself, independent of their quality.",
  },
  {
    heading: "Codes below the floor get no page at all",
    body: "Nearly two hundred codes are deliberately left unbuilt. Being willing to not publish is what makes the rest of the cluster credible, and it is the cheapest quality control available.",
  },
];

/**
 * Where the pages should physically live. The one decision on this page that
 * needs a human, because both answers are defensible and they are not
 * reversible against each other cheaply.
 */
/**
 * Where the pages live. Decided 2026-08-25: both, in sequence.
 */
export const WHERE_TO_BUILD: InfoPoint[] = [
  {
    heading: "Decided: Astro for the cluster, Webflow for a live indexation test",
    body: "The full cluster is built in the Astro repo, where several hundred pages is one route over one data file rather than several hundred CMS records. A small flagship batch goes into Webflow separately, so the live domain gets a real indexation signal months before the DNS cutover. The cost of doing both is the template twice and a re-export at cutover, paid knowingly.",
  },
  {
    heading: "Built: 896 pages in the Astro repo",
    body: "417 code pages, 30 family hubs and a cluster root, emitted for en-us and en-gb. The site goes from 365 pages to 1,261. astro check is clean and a scan of every link on every built page finds no broken internal links. It ships to wrenchlane.com at cutover and is reviewable now on the public test URL, which is the Phase 6 review the cutover has been waiting on.",
  },
  {
    heading: "Why a CMS was the wrong home for the bulk of it",
    body: "Several hundred items is close to what a CMS is worst at: every page is an API call to create and another to update, item limits become a plan question rather than an engineering one, and the internal-link graph between codes, families and makes has to be maintained by hand. Astro rebuilds all of it from the data file in about five seconds.",
  },
  {
    heading: "Still to do on the Webflow side",
    body: "A Fault Codes collection, a template page, and the eight flagship codes as draft items. That is Designer work on the live site, so it is a scoped piece of its own rather than something to fold into a build, and the items stay drafts until reviewed.",
  },
  {
    heading: "The cluster is now the strongest argument for finishing the cutover",
    body: "It is the first thing the new site can do that the old one structurally cannot. Every week before cutover is a week those 896 pages are indexed nowhere.",
  },
];

export type RolloutPhase = {
  phase: string;
  title: string;
  why: string;
  actions: string[];
  effort: "Low" | "Medium" | "High";
  state: "Built" | "Ready to run" | "Needs a decision" | "Blocked externally";
  blocked?: string;
};

export const ROLLOUT: RolloutPhase[] = [
  {
    phase: "Step 1",
    title: "Fix the routing before building anything",
    why: "Fifteen competitor pages are published and indexed, four rival names are bid on, and all four land on the generic Small plan page. This is a change to ad groups, not to pages, and it is the only item on this list with no build cost at all.",
    effort: "Low",
    state: "Ready to run",
    actions: [
      "Split the alternatives ad group into one ad group per competitor.",
      "Point each at its own /vs page, and extend to the ten rival pages that currently have no ads pointing at them.",
      "Keep rival trademarks in keywords only, never in ad text.",
      "Check the Expanded Final URL assets report and decide whether final URL expansion stays on, because until that is settled Google is picking landing pages nobody chose.",
    ],
  },
  {
    phase: "Step 2",
    title: "Make the pages measurable",
    why: "Which page delivered a signup is unanswerable today, and stays unanswerable no matter how many pages exist. Half the fix ships with the pages themselves; the other half is one change in the core app.",
    effort: "Low",
    state: "Built",
    blocked:
      "The core-app half is owned by the codeoc team and is listed as an open contract item on this page.",
    actions: [
      "Every generated page carries its own slug and page kind into the signup link.",
      "A click-time script forwards gclid, wbraid and gbraid from the landing page URL onto that link, so a paid click keeps its identity across the domain hop.",
      "Code pages hand off to Free with plan intent set, because someone mid-repair wants an answer rather than a pricing tier.",
      "The core app then reads those four parameters at signup and persists them, which is the two-column fix in full.",
    ],
  },
  {
    phase: "Step 3",
    title: "Ship the flagship codes and watch them index",
    why: "A small first batch is the cheapest possible test of whether the cluster earns impressions at all, and it is what makes the larger batches safe to release.",
    effort: "Medium",
    state: "Built",
    actions: [
      "Done: the fault-code route, templates and all 896 pages are built in the Astro repo and reviewable on the public test URL.",
      "Remaining: the eight flagship codes as draft items in Webflow, so the live domain gets an indexation signal before cutover.",
      "Publish the flagship tier only, each page reviewed by a human first.",
      "Submit the folder to Search Console and wait for indexation rather than for traffic.",
      "Point a Search campaign on those exact codes at them, and turn on Dynamic Search Ads scoped to the folder once there is a folder to scope to.",
    ],
  },
  {
    phase: "Step 4",
    title: "Release the named tier by family",
    why: "Three hundred pages is too many to review one at a time and too few to release unreviewed. Family is the natural batch, because a wrong claim about a subsystem is then caught once instead of repeatedly.",
    effort: "High",
    state: "Built",
    actions: [
      "Done: generation is per family already, and every page carries its family hub, so review can run family by family against the built site.",
      "Remaining: make hubs. Most manufacturer-specific codes classify into buckets that are not among the 30 built families, so they currently appear on no hub at all.",
      "Build the family hubs in the same pass, so every page has somewhere to send a reader whose exact code is not documented.",
      "Add the make hubs, which is where the manufacturer-specific codes finally become answerable.",
      "Hold the structural tier until the named tier has measurable indexation.",
    ],
  },
  {
    phase: "Step 5",
    title: "Point bidding at the outcome instead of the signup",
    why: "Smart Bidding optimises toward registrations today, activation is roughly thirty percent, and only a fraction ever pay. Sending far more traffic at a target that is already the wrong one would simply buy more of the wrong people, faster.",
    effort: "Medium",
    state: "Blocked externally",
    blocked:
      "Customer Match uploads through the API are refused for a developer token with no prior Customer Match history, so this has to go through Data Manager or Enhanced Conversions for Leads.",
    actions: [
      "Emit activated users and payers, with a conversion value, from the gads schema Data Manager already reads.",
      "Import them as offline conversions so bidding optimises on revenue rather than account creation.",
      "Remember the fourteen-day window on warehouse sources: the view has to emit recent events on a rolling basis or nothing imports.",
    ],
  },
];

/**
 * What the account has already bid on, measured against the cluster.
 *
 * Read from the live Google Ads account on 2026-08-25 via
 * `scripts/audit-code-keywords.mts`, and validated with the same
 * `isValidSaeSecondChar` the DTC dashboard uses. Baked in as measured
 * constants rather than fetched at render time: it is a 45,000-row read that
 * changes only when someone edits the account.
 *
 * The headline is not the coverage number. It is that half the codes this
 * account has ever bid on are not codes.
 */
export const KEYWORD_AUDIT = {
  measuredOn: "2026-08-25",
  keywords: 45965,
  codeKeywords: 44505,
  distinctCodes: 26204,
  validCodes: 12963,
  impossibleCodes: 13241,
  /** Keywords where EVERY code in them is structurally impossible. */
  impossibleKeywords: 13727,
  codesWithAPage: 341,
  landableKeywords: 5947,
  /** Share of the structurally valid code keywords that now have a page. */
  landableShareOfValidPct: 19,
};

export type KeywordCampaignRow = {
  campaign: string;
  status: string;
  codeKeywords: number;
  impossiblePct: number;
  landablePct: number;
  note: string;
};

export const KEYWORD_AUDIT_CAMPAIGNS: KeywordCampaignRow[] = [
  {
    campaign: "error codes",
    status: "Paused",
    codeKeywords: 26196,
    impossiblePct: 51,
    landablePct: 1,
    note: "Bare codes, enumerated rather than researched. Half of them are strings no scan tool can display, so half this campaign could never have matched a search at any bid.",
  },
  {
    campaign: "us-codes+make",
    status: "Paused",
    codeKeywords: 8787,
    impossiblePct: 3,
    landablePct: 28,
    note: "Make plus code, which is the right shape for the query. Mostly real codes, and a quarter of them now have somewhere to land.",
  },
  {
    campaign: "uk-codes+make",
    status: "Paused",
    codeKeywords: 8787,
    impossiblePct: 3,
    landablePct: 28,
    note: "Identical to the US set. Worth checking whether two copies of the same keyword list is what was intended.",
  },
  {
    campaign: "US - Fault Codes",
    status: "Paused",
    codeKeywords: 485,
    impossiblePct: 0,
    landablePct: 99,
    note: "Make, model, year and code. Every keyword is a real code and 99 percent of them now have a page. This is the one to restart first.",
  },
  {
    campaign: "Campaign TX / FL",
    status: "Paused",
    codeKeywords: 150,
    impossiblePct: 0,
    landablePct: 68,
    note: "Geographic variant of the same idea, all real codes.",
  },
  {
    campaign: "Campaign India",
    status: "Paused",
    codeKeywords: 100,
    impossiblePct: 0,
    landablePct: 100,
    note: "Small and fully covered, though the market is a separate question from the keywords.",
  },
];

export const KEYWORD_AUDIT_POINTS: InfoPoint[] = [
  {
    heading: "Half the codes this account has bid on are not codes",
    body: "SAE J2012 allows only 0 to 3 as a code's second character, so P8000, P5200 and P9982 are strings no vehicle emits and no scan tool displays. 13,241 of the 26,204 distinct codes bid on are in that class. They were not chosen, they were enumerated: someone generated P plus four digits and uploaded the lot.",
  },
  {
    heading: "That is 13,727 keywords that could never have matched anything",
    body: "Not keywords that matched badly, or matched expensively. Keywords for which no search query exists, because the string never appears on a scan tool. No bid would have fixed them, which is worth knowing before concluding that fault-code campaigns do not work here.",
  },
  {
    heading: "So the old campaigns had two independent problems, not one",
    body: "They had nowhere to land, which this programme fixes. They were also half aimed at nothing, which it does not. Restarting them without pruning the keyword list would repeat the second problem against much better pages.",
  },
  {
    heading: "US - Fault Codes is the one to restart first",
    body: "485 code keywords, every one a real code, 99 percent of which now have a page written for them. It is already in the make-model-year-code shape people actually type, and unlike the enumerated sets it was clearly built by hand.",
  },
  {
    heading: "The cluster covers 19 percent of the valid code keywords already",
    body: "341 of the codes this account has bid on now have a page. That share rises as the tiers ship, and the audit is re-runnable, so it is a progress measure rather than a one-off number.",
  },
];
