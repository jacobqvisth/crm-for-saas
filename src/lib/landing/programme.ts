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
    heading: "Built: the Webflow flagship batch, as drafts",
    body: "A Fault Codes collection with a nine-field schema, a template page bound to it, and the eight flagship codes as draft items at /en/fault-code/<code>. Every one is isDraft and has never been published, so nothing is public until reviewed. The template is deliberately thin, four bindings rather than thirty, because the batch exists to answer whether the live domain indexes these pages at all, not to build the final template twice.",
  },
  {
    heading: "The eight are built but not published, and that is deliberate",
    body: "Making them public needs a Webflow site publish, because a page's layout is part of the compiled site rather than per-item content. The site was last published at 19:40 on 2026-08-26 and the Pricing page carries an edit from 19:45 that nobody published. A site publish would ship that edit too. Publishing the items without the template would be worse still: eight live URLs rendering an empty page, which is exactly the thin content the programme is designed not to produce. So this waits on one decision about the Pricing edit, not on more building.",
  },
  {
    heading: "One real gap in the Webflow half, worth knowing",
    body: "Webflow has no build step, so those pages carry the landing-page identity into the signup link but cannot forward a click id at click time the way the Astro pages do. That makes the batch an indexation test rather than the measurement surface. Attribution works properly on the Astro cluster.",
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
      "Done: the eight flagship codes exist in Webflow as draft CMS items with a bound template page, so the live domain can be tested for indexation before the cutover.",
      "Remaining, and it is a human decision: review the eight drafts, then un-draft and publish the items to start the indexation clock.",
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
  /**
   * Removable after two guards the first pass lacked: keywords naming a marque
   * (C4500 is a Chevrolet, not a chassis code) and keywords that have ever
   * served an impression, which is evidence the shape argument is wrong about
   * them. 56 were model names and 2 had served 78 impressions between them.
   */
  removableKeywords: 13669,
  /** Removed so far. Explorer access allows 2,880 operations a day. */
  removedSoFar: 0,
  /** Keywords where EVERY code in them is structurally impossible. */
  impossibleKeywords: 13671,
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
    heading: "The evidence is stronger than the standard, and it corrects it",
    body: "Reading the standard is an argument. Lifetime impressions are evidence, and they say two things. The error codes campaign holds 26,196 keywords and exactly one has ever served a single impression in the account's history. And 56 keywords the shape test flagged are not codes at all: C4500 is a Chevrolet truck, not a chassis code, and those keywords have served real impressions. Both guards are now in the audit, which is why the removable count is 13,669 rather than the 13,727 first reported.",
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

/* ---------------------------------------------------------------------------
   What exists, and what is next.

   Kept as data next to the rest of the argument so the page can answer "what
   did we actually build" without anyone reconstructing it from commit history,
   and so the backlog is ranked in one place rather than remembered in several.
   --------------------------------------------------------------------------- */

export type BuiltThing = {
  what: string;
  where: string;
  detail: string;
  state: "Live" | "Merged, awaiting cutover" | "Draft, not public" | "Blocked";
};

/** Everything the programme has actually produced, with where it lives. */
export const WHAT_EXISTS: BuiltThing[] = [
  {
    what: "The planner",
    where: "src/lib/landing/plan.ts",
    state: "Live",
    detail:
      "Turns the diagnostics analysis into a ranked, tiered build queue. Pure, so it is testable without credentials, and it adds no queries: it reads the same analysis the DTC Codes page already computes. Decides which codes earn a page, which are excluded outright, and in what order the rest get built.",
  },
  {
    what: "The emitter",
    where: "scripts/emit-fault-code-pages.mts",
    state: "Live",
    detail:
      "Renders the queue into page payloads and refuses to write a bundle that fails validation. The invariant it guards hardest is that no manufacturer-specific code ever gets a standalone page. Re-run it after a data refresh and the whole cluster updates.",
  },
  {
    what: "896 pages in the Astro repo",
    where: "wrenchlane-site, PR #27",
    state: "Merged, awaiting cutover",
    detail:
      "417 code pages, 30 family hubs and a cluster root, emitted for en-us and en-gb. Took that site from 365 pages to 1,261 with no broken internal links anywhere in the build. Reviewable now on the public test URL; live on wrenchlane.com only at the DNS cutover.",
  },
  {
    what: "8 flagship pages in Webflow",
    where: "Fault Codes collection, live site",
    state: "Draft, not public",
    detail:
      "A collection, a bound template page at /en/fault-code, and the eight highest-evidence codes as draft items. Exists to test whether the live domain indexes these pages at all, months before the cutover. Publishing is blocked on a site publish, which would also ship an unrelated staged edit.",
  },
  {
    what: "The signup handoff",
    where: "src/lib/landing/tracking.ts",
    state: "Blocked",
    detail:
      "Every generated page carries its own slug and page kind into the signup link and forwards gclid, wbraid and gbraid from its own URL at click time. The page half is done. The core-app half, persisting those four parameters at signup, is owned elsewhere and is what the whole programme's measurability waits on.",
  },
  {
    what: "The ad reconciler",
    where: "/api/landing-pages/ads-sync",
    state: "Live",
    detail:
      "Diffs what every ad group actually buys against the fifteen verified comparison URLs. Dry run by default, and a dry run goes to Google with validateOnly rather than guessing locally. Retargets single-rival groups; refuses to split or create, because both commit structure and budget nobody has approved.",
  },
  {
    what: "The keyword pruner",
    where: "scripts/prune-impossible-keywords.mts",
    state: "Blocked",
    detail:
      "Removes keywords that can never match: no valid code, no marque named, and never a single impression. Guarded three ways and it never touches an enabled campaign. Built and shape-checked against the live account; what stops it is Explorer quota at 2,880 operations a day against 13,669 removals, so it needs about six daily runs or Basic access.",
  },
  {
    what: "The keyword audit",
    where: "scripts/audit-code-keywords.mts",
    state: "Live",
    detail:
      "Validates every fault code the account bids on against the same parser the dashboard uses, and measures how many now have a page. This is what found that half the codes bid on are not codes.",
  },
];

export type BacklogItem = {
  rank: number;
  what: string;
  why: string;
  effort: "Low" | "Medium" | "High";
  blockedBy?: string;
};

/**
 * What to build next, ranked.
 *
 * Ordered by value per unit of effort rather than by size, which is why two
 * ad-account chores outrank the content work: they are hours, not weeks, and
 * one of them stops us buying traffic that cannot exist.
 */
export const BACKLOG: BacklogItem[] = [
  {
    rank: 1,
    what: "Delete the 13,669 unmatchable keywords",
    effort: "Low",
    blockedBy:
      "Explorer access allows 2,880 API operations a day against 13,669 removals, so this needs about six daily runs or an upgrade to Basic access.",
    why: "They bid on strings no vehicle emits, so they can never match a search at any price, and they make every account-level coverage number meaningless. The script is built, guarded and re-runnable: it removes only keywords with no valid code, no marque named, and no impression ever served, and it never touches an enabled campaign. It stops cleanly when the daily quota runs out and resumes next run with no bookkeeping.",
  },
  {
    rank: 2,
    what: "Persist lp, wl_kind, plan and gclid at signup",
    effort: "Low",
    blockedBy: "Owned by the codeoc team, in app.wrenchlane.com.",
    why: "The single change that makes the entire programme measurable. Until it lands, every page built here is one nobody can rank, prune or learn from, and conversion imports stay stuck on the hashed-email route instead of the click-id one. It is a few lines against parameters that already arrive.",
  },
  {
    rank: 3,
    what: "Split the two competitor ad groups",
    effort: "Low",
    why: "Six rival names bought across two ad groups, all landing on a generic plan page, against fifteen comparison pages that are already published and indexed. The reconciler has the exact plan. It needs a human because splitting creates ad groups and sets bids, which is budget, not routing.",
  },
  {
    rank: 4,
    what: "Give Performance Max an asset group per plan",
    effort: "Low",
    why: "All three Performance Max campaigns hold exactly one asset group, and every one points at the homepage. The four plan pages are not used by Performance Max at all. Asset groups are how one campaign serves different pages to different audiences without splitting budget or competing with itself, and right now that mechanism is entirely unused.",
  },
  {
    rank: 5,
    what: "Build the make hubs",
    effort: "Medium",
    why: "The largest hole in the cluster as shipped. The honesty rule sends manufacturer-specific codes to make-scoped hubs, and those hubs do not exist, so roughly 340 codes we have seen appear on no page at all. It also opens the make-plus-code query, which is 8,787 keywords the account already bids on.",
  },
  {
    rank: 6,
    what: "Restart US - Fault Codes against the new pages",
    effort: "Low",
    blockedBy: "Needs the pages live, so it waits on the cutover or the Webflow batch.",
    why: "485 keywords, every one a real code, 99 percent of which now have a page written for them. Already in the make-model-year-code shape people actually type, and hand-built rather than enumerated. The cheapest possible test of whether the cluster earns clicks.",
  },
  {
    rank: 7,
    what: "Build /en/find-your-plan",
    effort: "Medium",
    why: "Shop size cannot be targeted in an auction but it can be asked on a page. Broad Performance Max and Demand Gen traffic currently lands on a plan page that guesses wrong most of the time. The qualifier also collects the firmographic data the CRM does not have, first-party and therefore usable later.",
  },
  {
    rank: 8,
    what: "A Swedish fault-code cluster",
    effort: "High",
    why: "Sweden is the largest single market in the CRM and the cluster is English only, so sv-se currently gets no Problem-stage pages at all. Most of the work is smaller than it looks: the evidence is language-neutral and only the code descriptions and template copy need translating. Doing it badly, by machine-translating into the Swedish tree, would be worse than leaving it empty.",
  },
  {
    rank: 9,
    what: "Symptom pages",
    effort: "Medium",
    why: "The half of Problem-stage demand that arrives without a code, which no page on the site answers. Deliberately curated rather than generated: symptom phrasing has no finite vocabulary, so a generator would invent queries nobody types.",
  },
  {
    rank: 10,
    what: "A brand campaign, and delete the duplicate PMax campaigns",
    effort: "Low",
    why: "Our own name is not bought by us, which leaves it available to anyone who wants it. Separately, two near-duplicate paused Performance Max campaigns sit at 1,700 and 750 SEK a day: harmless while paused and an expensive accident if either is ever resumed by mistake.",
  },
  {
    rank: 11,
    what: "Import activated users and payers as conversions",
    effort: "Medium",
    blockedBy:
      "Customer Match uploads are refused for a developer token with no prior history, so this goes through Data Manager rather than the API.",
    why: "Bidding optimises toward signups today. Activation is roughly thirty percent and only a fraction pay, so pointing far more traffic at that target buys more of the wrong people faster. This gets more urgent the moment the cluster ships, not less.",
  },
];
