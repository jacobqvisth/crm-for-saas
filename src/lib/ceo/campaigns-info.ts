// Content for the Info tab on /dashboard/campaigns.
//
// This is the "why", written for someone who did not set the account up:
// how the plans work, why the campaigns are structured the way they are,
// where that structure genuinely cannot reach, and what to build next.
//
// It is deliberately data, not JSX, so the argument can be edited without
// touching layout, and so the claims stay in one reviewable place.

export type PlanFact = {
  plan: string;
  price: string;
  builtFor: string;
  landingPage: string;
  /** Why this tier is hard or easy to buy traffic for. */
  reachability: string;
};

export const PLAN_FACTS: PlanFact[] = [
  {
    plan: "Free",
    price: "0 USD",
    builtFor: "Anyone. Fault codes, ranked causes, guided next steps, TSB search.",
    landingPage: "/en/free",
    reachability:
      "Easiest to buy. No price objection, no card, so the ad only has to argue that the tool is worth trying.",
  },
  {
    plan: "One",
    price: "19 USD / month",
    builtFor: "A single vehicle. Solo mechanic or a serious owner-operator.",
    landingPage: "/en/wrenchlane-one",
    reachability:
      "Hardest to isolate. The searches a one-vehicle user types are almost identical to a workshop's, just with fewer of them.",
  },
  {
    plan: "Small",
    price: "79 USD / month",
    builtFor:
      "Small workshops. Unlimited users, metered at 50 premium vehicles a month.",
    landingPage: "/en/small",
    reachability:
      "The most-picked paid tier, and the one where competitor searches actually signal the right buyer.",
  },
  {
    plan: "Large",
    price: "249 USD / month",
    builtFor:
      "Busy workshops. Unlimited users, metered at 200 premium vehicles a month.",
    landingPage: "/en/large",
    reachability:
      "Rare but valuable. Too few searches to run a campaign on volume, so worth reaching through sales and comparison content rather than raw keyword bidding.",
  },
];

export type InfoPoint = {
  heading: string;
  body: string;
};

/** How money actually moves through the product. */
export const FUNNEL_MECHANICS: InfoPoint[] = [
  {
    heading: "Every customer starts on Free",
    body: "There is no direct paid signup. A visitor creates a free account, and upgrading later opens a 14-day trial that requires a card. Cancelling, during the trial or after, reverts the workshop to Free.",
  },
  {
    heading: "So an ad cannot sell a plan, only a signup",
    body: "Whatever plan page someone lands on, the thing they can actually do is create a free account. The plan choice happens later, inside the product, once they have seen it work. That is why plan-targeted ads are really plan-flavoured signup ads.",
  },
  {
    heading: "Which means the paid tier is decided after the click, not before it",
    body: "The campaign influences who arrives and what they expect. It does not decide what they pay. Activation does. That is worth remembering before spending heavily to separate One from Small at the auction.",
  },
];

/** Why the current structure is defensible. */
export const WHY_THIS_WORKS: InfoPoint[] = [
  {
    heading: "Each ad matches the page it lands on",
    body: "A visitor who clicks an ad about workshops with one or two mechanics arrives on a page whose headline says exactly that. Message match is the single biggest lever on Quality Score and conversion rate, and it is free.",
  },
  {
    heading: "One campaign per plan means one budget per plan",
    body: "Budgets, bids and reporting are separable. If Large turns out to pay back three times better than One, that is visible and actionable, instead of being averaged away inside one campaign.",
  },
  {
    heading: "Existing free users are excluded from acquisition",
    body: "All three acquisition campaigns exclude the WL Free Users audience. Paying to re-acquire someone who already has an account is pure waste, and it also stops them polluting new-user conversion figures.",
  },
  {
    heading: "The upsell campaign is the only one pointed at people we already have",
    body: "It targets that same audience instead of excluding it, and sends them to pricing rather than signup. It is the cheapest possible conversion, because the hard part, getting them to try the product, already happened.",
  },
  {
    heading: "Manual bidding, deliberately, until there is data",
    body: "Smart Bidding needs conversion history to work. These campaigns have none. Handing them to an algorithm on day one would be asking it to optimise against noise.",
  },
];

/** The honest limits. This is the section most worth reading. */
export const WHY_TARGETING_IS_IMPRECISE: InfoPoint[] = [
  {
    heading: "Search ads target intent, not identity",
    body: "Nobody tells Google they run a four-bay workshop. All Google knows is the phrase someone typed. Plan tiers are defined by shop size, and shop size is not something a search query reliably reveals.",
  },
  {
    heading: "Google Search has no firmographic targeting",
    body: "There is no employee-count or company-revenue targeting on Search. That exists on LinkedIn, not here. Google's own audience segments are behavioural and consumer-shaped, which is a poor fit for sorting a solo mechanic from a ten-technician chain.",
  },
  {
    heading: "The same query comes from every tier",
    body: "\"workshop diagnostic software\" is typed by a one-man garage and by a chain evaluating a rollout. Splitting those into separate campaigns splits the budget, not the audience. Both still see whichever campaign wins the auction.",
  },
  {
    heading: "Our own CRM mostly does not know shop size either",
    body: "employee_count is empty for all 13,338 scraped prospects, and the employee size band is present on roughly 17 percent of them. Even if Google could target on it, we could not supply it for most of the market.",
  },
  {
    heading: "Where we do have size data, we are not allowed to use it",
    body: "The size bands come from the SCB and Google Maps scrape. Customer Match policy permits only first-party data that a customer shared with us directly, so uploading scraped prospects would breach policy and put the ad account at risk. That route is closed, not merely unbuilt.",
  },
  {
    heading: "Three narrow campaigns starve each other",
    body: "The keyword pool for this product is small. Split three ways at roughly 96 SEK a day each, no single campaign accumulates enough conversions for bidding to learn anything. Precision bought with volume you do not have is not precision, it is silence.",
  },
];

/** The broad-then-narrow argument, grounded in this account's own numbers. */
export const BROAD_THEN_NARROW: InfoPoint[] = [
  {
    heading: "The evidence is already in this account",
    body: "Performance Max, which targets almost nothing precisely, has delivered 962 attributed users at roughly 2.88 SEK a click. The three precisely-targeted Search campaigns have delivered, so far, ten impressions and no clicks at all.",
  },
  {
    heading: "Broad campaigns tell you the vocabulary you did not know to bid on",
    body: "You cannot write a keyword list for phrases you have never heard. A broad campaign plus the search terms report is a discovery engine: it surfaces what real mechanics actually type, which then becomes the input to a narrow campaign.",
  },
  {
    heading: "Bidding algorithms need volume before they need precision",
    body: "Smart Bidding wants a meaningful number of conversions per month before it can find patterns. One campaign gathering that is worth more than three campaigns each gathering a third of nothing.",
  },
  {
    heading: "Narrow is still the only way to control the landing page",
    body: "This is the real trade-off, and it cuts the other way. Performance Max chooses its own destination; a Search campaign points at exactly one page. So the choice is not broad versus narrow. It is broad to discover and to hold volume, narrow for the specific queries you have already proven convert.",
  },
  {
    heading: "The practical sequence",
    body: "Run broad to find the converting queries. Promote those specific queries into exact-match campaigns with a page written for them. Add the rest as negatives. Repeat. Precision should be the output of the process, not the starting assumption.",
  },
];

export type FunnelStage = {
  stage: string;
  question: string;
  campaignType: string;
  page: string;
  status: string;
};

export const FUNNEL_MAP: FunnelStage[] = [
  {
    stage: "Awareness",
    question: "Does not know we exist, is not searching for us",
    campaignType: "Demand Gen, Performance Max",
    page: "Homepage, chosen by Google",
    status: "Running",
  },
  {
    stage: "Problem",
    question: "Has a fault code or a symptom, right now",
    campaignType: "Search on codes and symptoms, Dynamic Search Ads",
    page: "Fault-code and article pages",
    status: "Built, awaiting the cutover",
  },
  {
    stage: "Evaluation",
    question: "Comparing us against a tool they already pay for",
    campaignType: "Competitor Search",
    page: "The 15 live /en/vs pages",
    status: "Pages live, ads point elsewhere",
  },
  {
    stage: "Decision",
    question: "Ready to pick a plan",
    campaignType: "Plan Search campaigns",
    page: "/en/free, /wrenchlane-one, /small, /large",
    status: "Live, barely serving",
  },
  {
    stage: "Expansion",
    question: "Already a free user, has not paid",
    campaignType: "Customer Match upsell",
    page: "/en/pricing",
    status: "Built, needs the audience to match",
  },
];

/**
 * How far a phase has got.
 *
 * Added once the plan stopped being purely a list of intentions. A phase that
 * has been designed, sized and built in the dashboard is in a genuinely
 * different state from one nobody has touched, and collapsing the two makes the
 * plan read as permanently untouched no matter how much work has landed.
 */
export type PlanPhaseState =
  | "Not started"
  | "Designed"
  | "Built"
  | "Needs a decision"
  | "Blocked externally";

export type PlanPhase = {
  phase: string;
  title: string;
  why: string;
  actions: string[];
  effort: "Low" | "Medium" | "High";
  state: PlanPhaseState;
  /** What has actually shipped against this phase, when anything has. */
  progress?: string;
  blocked?: string;
};

export const IMPROVEMENT_PLAN: PlanPhase[] = [
  {
    phase: "Phase 0",
    title: "Unblock what is already built",
    why: "Three campaigns are live and serving a handful of impressions a day with no clicks. Nothing else on this list matters while that is true.",
    effort: "Low",
    state: "Blocked externally",
    progress:
      "The page half of the capture is built. Every generated landing page carries its own slug and page kind into the signup link and forwards gclid, wbraid and gbraid from its own URL at click time, so a paid click keeps its identity across the domain hop. What is left is the core-app half: reading those parameters at signup and persisting them. That is tracked as an open contract on the Landing Pages page.",
    blocked:
      "Signup lives in app.wrenchlane.com, a different codebase owned by the codeoc team, so the persist step cannot be done from here.",
    actions: [
      "Raise the max CPC. The retired us-generic Search campaign paid about 46 SEK a click; anything far below that wins no auctions.",
      "Capture the GCLID at signup. It is stored nowhere today, which is what forces conversion imports down the hashed-email route instead of the click-ID one.",
      "Capture the landing page at signup too, in the same change. There is no landing page column on any table, which is the single reason we cannot say which page delivered a given customer. Two columns close that gap permanently.",
      "Make signup read ?plan=. All four plan pages currently send visitors to the same generic signup, so the plan intent we paid for is discarded at the handoff.",
    ],
  },
  {
    phase: "Phase 1",
    title: "Send competitor traffic to the competitor pages",
    why: "There are 15 published comparison pages at /en/vs, one per rival, in both languages. The alternatives ad group bids on five of those rival names, plus ShopKey which has no page at all, and sends every one of them to the generic Small plan page instead.",
    effort: "Low",
    state: "Built",
    progress:
      "Automated. A reconciler on the Landing Pages page reads what every ad group actually buys, compares it against all fifteen verified comparison-page URLs, and reports the difference. It matches on keywords rather than ad-group names, because the account names its groups by plan and the plan axis is exactly what is wrong here. Retargeting an ad group that already exists is a correction and it will make it; creating the ten missing ad groups commits budget nobody has agreed to, so those stay a plan for a human. It needs GOOGLE_ADS_DEVELOPER_TOKEN in the environment before it can run.",
    actions: [
      "Split the alternatives ad group into one ad group per competitor.",
      "Point each at its own /en/vs page: ALLDATA, Autodata, Mitchell 1 ProDemand, HaynesPro, Bosch ESI[tronic], Snap-on SureTrack, Identifix, Autel MaxiSYS and the rest.",
      "Keep rival trademarks in keywords only, never in ad text, which is Google policy.",
      "Extend beyond the five currently bid on: ten more comparison pages already exist and have no ads pointing at them.",
    ],
  },
  {
    phase: "Phase 2",
    title: "Let the landing page do the segmenting the auction cannot",
    why: "Shop size cannot be targeted in the auction, but it can simply be asked on the page. Move the segmentation to where it actually works.",
    effort: "Medium",
    state: "Designed",
    progress:
      "Carried into the landing-page programme as the qualifier page, and named there as the page broad Performance Max and Demand Gen traffic should land on instead of a specific plan page that guesses wrong two times in three. Not built.",
    actions: [
      "Build /en/find-your-plan: two or three questions (how many mechanics, how many cars a month, do you need shared access).",
      "Recommend a plan from the answers and hand off into signup with that plan preselected.",
      "Point broad campaigns at this page rather than at a specific plan page, so one campaign can serve all three tiers honestly.",
      "Record the answers. This becomes the firmographic data the CRM does not have, collected first-party and therefore usable for Customer Match later.",
    ],
  },
  {
    phase: "Phase 3",
    title: "Problem-first pages, the real volume play",
    why: "Mechanics search fault codes and symptoms, not pricing tiers. Every code query today has no honest destination on the site, so the most specific page we own for the highest-intent visitor this business can get is the homepage.",
    effort: "High",
    state: "Built",
    progress:
      "Built. 896 pages are live in the Astro repo: 417 code pages, 30 family hubs and a cluster root, emitted for en-us and en-gb, taking the site from 365 pages to 1,261. Every page leads with what the code means, then carries evidence no competitor has, how often we see it, at how many workshops, on which marque, and what it travels with. astro check is clean and no built page contains a broken internal link. The Landing Pages page sizes and ranks the whole programme from live diagnostics.",
    blocked:
      "It ships to wrenchlane.com only at the DNS cutover, which is still awaiting Phase 6 review. A flagship batch in Webflow is the separate piece that would get a live indexation signal sooner.",
    actions: [
      "Done: built in Astro, on the grounds that this cluster is the first thing the new site can do that the old one structurally cannot. It is reviewable now on the public test URL.",
      "Remaining: eight flagship codes as draft items in Webflow, so the live domain gets an indexation signal before the cutover.",
      "Correct the premise this phase was originally written on: the 802 codes are a single Mercedes service manual, not an SEO inventory. The real universe is about 1,070 codes seen in real diagnostics or nameable from the generic dictionary.",
      "Exclude manufacturer-specific codes from standalone pages entirely. They are the largest single group at roughly 460, and one page cannot honestly serve the same code across marques, so they roll up into make hubs.",
      "Publish in demand order and in batches, not all at once, and let the flagship tier index before releasing the next one.",
      "Run Dynamic Search Ads scoped to the fault-code folder, which only becomes possible once there is a folder for it to match against.",
      "Send this traffic to Free, not to a paid plan. Someone mid-repair wants an answer, not a pricing table.",
    ],
  },
  {
    phase: "Phase 4",
    title: "Make bidding chase revenue instead of signups",
    why: "Smart Bidding currently optimises toward registrations. Activation is roughly 30 percent and only a fraction ever pay, so Google is efficiently buying the wrong people.",
    effort: "Medium",
    state: "Blocked externally",
    progress:
      "Unchanged, and it gets more urgent the moment Phase 3 ships. Pointing a few hundred new pages at a bidding target that is already the wrong one would buy more of the wrong people, faster.",
    blocked:
      "Customer Match uploads via the API are refused for any developer token with no prior Customer Match history, so this has to go through Data Manager or Enhanced Conversions for Leads rather than the API.",
    actions: [
      "Emit activated users and payers, with a conversion value, from the gads schema Data Manager already reads.",
      "Import them as offline conversions so bidding optimises on revenue rather than account creation.",
      "Remember the 14-day window on warehouse sources: the view has to emit recent events on a rolling basis or they will not import.",
    ],
  },
  {
    phase: "Phase 5",
    title: "Campaign types worth testing once the above is working",
    why: "These are cheap to run and cover gaps the current three campaigns leave open.",
    effort: "Medium",
    state: "Not started",
    actions: [
      "A brand campaign, to hold our own name cheaply rather than letting competitors buy it.",
      "A Swedish-language campaign. The site is fully bilingual and Sweden is the largest single market in the CRM, but every campaign runs in English only.",
      "A win-back campaign for lapsed payers once that segment passes 100 matched members. It is 31 today, too small to serve.",
      "Retargeting for people who reached a plan page and did not sign up, which needs no new page and is the warmest audience available.",
    ],
  },
];

/* ---------------------------------------------------------------------------
   "Should we run a Performance Max campaign per plan, each pointed at a
   different landing page, so we can compare them?"

   A reasonable question with a mostly-no answer, written down here so it does
   not have to be re-argued from scratch every time it comes up.
   --------------------------------------------------------------------------- */

/** Measured from dashboard_metric_snapshots and dashboard_user_attribution. */
export const PMAX_BASELINE = {
  clicks: 38535,
  signups: 976,
  /** 976 / 38,535 */
  signupRatePct: 2.53,
  /** 38,535 clicks over roughly 99 serving days. */
  clicksPerDay: 389,
  signupsPerMonth: 250,
  /** What GA4 reports as "conversions" for this campaign. */
  ga4KeyEvents: 134158,
  keyEventsPerClick: 3.48,
};

export const PMAX_SPLIT_VERDICT: InfoPoint[] = [
  {
    heading: "Asset groups already give you a landing page per audience",
    body: "A Performance Max campaign can hold several asset groups, and each one carries its own final URL, its own creative and its own audience signal. Pointing different audiences at different plan pages does not need separate campaigns. It needs one campaign with four asset groups, which costs nothing and fragments nothing.",
  },
  {
    heading: "Separate campaigns split the learning, not just the budget",
    body: "Each Performance Max campaign needs roughly 20 to 30 conversions a month of its own before bidding leaves the learning phase. The common guidance is one or two campaigns at 30 to 50 conversions a month, and only segment past 100. Four campaigns would each be learning from a quarter of the signal.",
  },
  {
    heading: "They would also bid against each other",
    body: "Two Performance Max campaigns eligible for the same auction cannibalise one another. You would not get four independent tests, you would get four campaigns competing for the same inventory with your own money on both sides.",
  },
  {
    heading: "And it would not actually be a landing page test",
    body: "This is the decisive objection. Four campaigns would differ in creative, audience signal, budget pacing and bidding state as well as in landing page. Any difference in results could come from any of those. You would be comparing four different systems and crediting the one variable you happened to care about.",
  },
  {
    heading: "A real test randomises people, not campaigns",
    body: "To learn whether the wording on a page changes behaviour, hold everything before the click constant and split visitors at the page itself: one ad destination, with a server-side or edge split assigning each visitor to a variant. Then both variants see the same traffic mix from the same campaign on the same day, and the only thing that differs is the thing being tested.",
  },
];

export type PowerRow = {
  effect: string;
  clicksPerVariant: string;
  twoVariants: string;
  fourVariants: string;
};

/**
 * Sample sizes for a click-to-signup test at the measured 2.53% baseline,
 * 80% power, 95% confidence, using n = 16 p(1-p) / delta^2 per arm. Durations
 * assume Performance Max keeps delivering about 389 clicks a day and that the
 * whole campaign is pointed at the test.
 */
export const PMAX_POWER_TABLE: PowerRow[] = [
  {
    effect: "Large, 2.5% to 3.8% (+50%)",
    clicksPerVariant: "~3,100",
    twoVariants: "about 2 weeks",
    fourVariants: "about 1 month",
  },
  {
    effect: "Moderate, 2.5% to 3.2% (+25%)",
    clicksPerVariant: "~11,000",
    twoVariants: "about 8 weeks",
    fourVariants: "about 4 months",
  },
  {
    effect: "Small, 2.5% to 3.0% (+20%)",
    clicksPerVariant: "~17,100",
    twoVariants: "about 3 months",
    fourVariants: "about 6 months",
  },
];

export const PMAX_RECOMMENDATION: InfoPoint[] = [
  {
    heading: "The conversion setup is sound, contrary to what GA4 suggests",
    body: "GA4 reports 134,158 key events for this campaign against 976 signups, which looked like bidding was chasing engagement noise. Reading the ad account directly shows otherwise: the only enabled primary conversion actions are WrenchLane (web) sign_up and the Android sign_up, both categorised SIGNUP. Google Ads counted 305 conversions in the last 30 days, which lines up with real signups. GA4's keyEvents metric counts every event marked as a key event in GA4, most of which are set to Hidden in Google Ads and never reach bidding. The two numbers measure different things.",
  },
  {
    heading: "But revenue is watched, not chased",
    body: "WrenchLane (web) purchase is enabled and set to secondary, so purchases are recorded but bidding does not optimise toward them. That is still the change worth making: signups are a weak proxy for value when activation is around 30 percent and only a fraction of those ever pay.",
  },
  {
    heading: "One small counting bug",
    body: "The web sign_up action counts once per click, which is right for a signup. The Android sign_up counts many per click, which is not, and will inflate that action's numbers relative to the web one. Worth aligning.",
  },
  {
    heading: "Add asset groups to the campaign you already have",
    body: "One asset group per plan inside the existing Performance Max campaign, each with its own final URL and audience signal. That gives per-asset-group reporting and different pages for different audiences, with no budget fragmentation and no self-competition. It is the version of the idea that works.",
  },
  {
    heading: "Test two pages at a time, never four",
    body: "At the measured 2.53% signup rate a two-way test can detect a large difference in about a fortnight, but needs three months for a small one. A four-way test roughly doubles that and needs a stricter significance threshold on top, because more comparisons mean more chances to be fooled by noise.",
  },
  {
    heading: "Expect to detect only big differences",
    body: "This account's traffic can reliably tell a rewrite that changes behaviour by half from one that changes nothing. It cannot resolve a ten percent improvement in any useful timeframe. That is an argument for testing genuinely different propositions rather than button colours.",
  },
  {
    heading: "A second campaign is justified by a different goal, not a different page",
    body: "Splitting by language, market or budget ownership is a real reason to run another Performance Max campaign, because those genuinely need separate control. Splitting purely to compare landing pages is not, because asset groups already do that job and do it better.",
  },
];

/* ---------------------------------------------------------------------------
   The three follow-on questions: should we build more pages, can one campaign
   use several, and can we tell which one performs best.
   --------------------------------------------------------------------------- */

export const MORE_PAGES_ANSWER: InfoPoint[] = [
  {
    heading: "Yes, but for new intents rather than new wordings",
    body: "A new page earns its place when it answers a question no existing page answers. It does not earn its place by re-wording one that already does. That distinction is what separates a page that adds traffic from a page that only splits the traffic you already had.",
  },
  {
    heading: "The biggest gap is fault codes",
    body: "The product holds 802 manufacturer fault codes and a large article library, and none of it has a public page built for search. Mechanics type codes and symptoms, not plan names. This is the one page type that would reach demand that currently has nowhere to land.",
  },
  {
    heading: "Ten comparison pages already exist with no ads pointing at them",
    body: "Fifteen competitor pages are live at /en/vs and only five rival names are bid on, all of them routed to the generic Small page. Before building anything new, the cheapest win is pointing traffic at pages that were already built and are already indexed.",
  },
  {
    heading: "One genuinely new page worth building: a plan qualifier",
    body: "Shop size cannot be targeted in an auction but it can be asked on a page. A short qualifier that recommends a plan does the segmentation the campaign structure is currently attempting and failing to do, and it collects the firmographic data the CRM does not have.",
  },
];

export const MULTIPLE_PAGES_ANSWER: InfoPoint[] = [
  {
    heading: "Yes, through asset groups, deliberately",
    body: "Each asset group in a Performance Max campaign carries its own final URL. Four asset groups means four landing pages inside one campaign, with one budget and one pool of learning. This is the controlled way to do it.",
  },
  {
    heading: "Right now there is exactly one asset group, pointed at the homepage",
    body: "Read from the account directly: all three Performance Max campaigns hold a single asset group called \"Pmax eng\", and every one of them has the same final URL, wrenchlane.com/en. So the plan pages are not being used by Performance Max at all. The idea of a page per plan is not competing with an existing setup, it would be the first version of one.",
  },
  {
    heading: "And also through final URL expansion, whether you want it or not",
    body: "Final URL expansion lets Google replace your chosen page with any other page on the domain it thinks will convert better for that person. With every asset group pointing at the homepage, expansion is doing most of the routing decisions in this account today, and nobody chose those destinations.",
  },
  {
    heading: "There are already three Performance Max campaigns, two of them paused",
    body: "Pmax eng may 2026 runs at 750 SEK a day. Two near-duplicates sit paused behind it at 1,700 and 750 SEK a day. Before creating more, those are worth either deleting or repurposing, because a paused duplicate is a budget mistake waiting to be un-paused by accident.",
  },
];

export const TRACKING_ANSWER: InfoPoint[] = [
  {
    heading: "Google's own asset group reporting is real, but it is not a fair test",
    body: "You can see cost, clicks and conversions per asset group, and that maps one to one onto landing page when expansion is off. What you cannot read it as is a comparison. Google does not split traffic evenly; it sends each person to whichever asset group it predicts will convert for them. An asset group can look like the winner purely because it was handed the better users.",
  },
  {
    heading: "GA4 knows landing pages, but not the one that mattered",
    body: "GA4 can report landing page against conversions at session level. What it has no dimension for is the landing page of a user's FIRST visit. There is firstUserSource, firstUserMedium and firstUserCampaign, but no firstUserLandingPage. So GA4 can say which pages convert in-session; it cannot say which page brought in someone who signed up two visits later.",
  },
  {
    heading: "And our own warehouse does not capture it at all",
    body: "There is no landing page column and no gclid column on any table. dashboard_users carries a ga_client_id, but GA4's reporting API does not expose client ID as a queryable dimension, so it cannot be joined back without the BigQuery export. Today the honest answer to which page delivered a given signup is that we do not know.",
  },
  {
    heading: "The fix is two columns, and it is small",
    body: "Record the landing page and the gclid on the signup record, the same way a referrer would be captured. Then the join belongs to us, it is exact rather than modelled, and it survives every limitation above. Google's asset group report becomes a useful cross-check instead of the only available evidence.",
  },
  {
    heading: "Only after that is a page comparison worth running",
    body: "With landing page stored per signup, comparing pages stops being a reporting question and becomes a query. And a proper split test, one ad destination with visitors randomised at the page, becomes measurable end to end rather than inferred from whichever asset group Google favoured.",
  },
];
