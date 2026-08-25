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
export const WHERE_TO_BUILD: InfoPoint[] = [
  {
    heading: "Webflow ships today and is the wrong tool for this shape",
    body: "wrenchlane.com is Webflow, so a CMS collection there is live and indexing immediately, which is a real advantage. Against it: several hundred items is close to what a CMS is worst at, every page is an API call to create and another to update, item limits are a plan question rather than an engineering one, and the template itself is Designer work that sits outside the CMS-publishing carve-out. The comparison cluster was fifteen items and that was comfortable. This is thirty times that.",
  },
  {
    heading: "Astro generates the whole cluster from one file",
    body: "The wrenchlane-site repo builds every page from data at compile time, so four hundred pages is one route and one data source rather than four hundred records. It gives exact control over canonical tags, structured data and the internal-link graph between codes, families and makes, which is most of what makes a cluster of this kind rank. There are no item limits and no per-page API calls.",
  },
  {
    heading: "The catch is that Astro ships nothing until the cutover",
    body: "wrenchlane.com is still entirely Webflow. The Astro site is content-complete and parked behind a review and a two-record DNS change. Pages built there are real, previewable and indexed nowhere until that happens.",
  },
  {
    heading: "Recommendation: build it in Astro, and let it argue for the cutover",
    body: "This cluster is the first thing the new site can do that the old one structurally cannot, which makes it the strongest argument the migration has had. It is also fully reviewable before it goes anywhere, on a public test URL, which is exactly the Phase 6 review the cutover is waiting on. Building it in Webflow instead would mean doing the work twice, since the Webflow to MDX export already ran once.",
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
      "Point each at its own /vs page, and extend to the eleven rival pages that currently have no ads pointing at them.",
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
    state: "Needs a decision",
    actions: [
      "Build the fault-code route and template on the target the previous decision picks.",
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
    state: "Needs a decision",
    actions: [
      "Generate per family, review per family, publish per family.",
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
