// Forums → Distribution (/forums/distribution).
//
// A placement tracker for a single post *concept*: where to post it, which
// angle to use per community, whether it's been posted yet, and how much
// traction it got. The curated recommendation list lives here in code (like
// the forum targets in targets.ts) and is seeded per-workspace into the
// forum_distribution table on first load; the DB row then owns the tracking
// state (status / posted URL / traction).

export type DistributionTier = "best_fit" | "trade" | "ai_angle";
export type DistributionStatus = "recommended" | "posted" | "skipped";

// The one topic shipped so far. Adding another = a new TOPICS entry + a new
// batch of DISTRIBUTION_SEED rows with that topic key.
export const DEFAULT_TOPIC = "ai-diagnostics-takeover";

export interface DistributionTopic {
  key: string;
  title: string; // human name of the post concept
  summary: string; // one-liner shown under the page header
}

export const TOPICS: Record<string, DistributionTopic> = {
  [DEFAULT_TOPIC]: {
    key: DEFAULT_TOPIC,
    title: "Will AI take over car diagnostics?",
    summary:
      "A discussion post asking mechanics whether AI diagnostics will replace real diagnostic work — is it good enough today, when will it be, or never?",
  },
};

export const TIER_META: Record<
  DistributionTier,
  { label: string; blurb: string; badgeClass: string }
> = {
  best_fit: {
    label: "Best fit",
    blurb: "Discussion is on-topic here — lowest removal risk. Start with these.",
    badgeClass: "bg-green-50 text-green-700",
  },
  trade: {
    label: "Trade / pro techs",
    blurb: "Smaller but high-signal — where working mechanics give the sharpest takes.",
    badgeClass: "bg-blue-50 text-blue-700",
  },
  ai_angle: {
    label: "AI-angle crowd",
    blurb:
      "Flip the framing to 'can AI do a skilled trade yet?' for the tech-optimist counterpoint.",
    badgeClass: "bg-purple-50 text-purple-700",
  },
};

// A recommendation as it lives in a forum_distribution row.
export interface DistributionRec {
  id: string;
  topic: string;
  subreddit: string;
  subreddit_url: string;
  tier: DistributionTier;
  fit_reason: string | null;
  recommended_angle: string | null;
  suggested_title: string | null;
  suggested_body: string | null;
  rules_note: string | null;
  sort_order: number;
  status: DistributionStatus;
  posted_url: string | null;
  posted_at: string | null;
  score: number | null;
  num_comments: number | null;
  upvote_ratio: number | null;
  traction_note: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

// The shape we insert when seeding a workspace (DB fills the rest).
export type DistributionSeedRow = Pick<
  DistributionRec,
  | "topic"
  | "subreddit"
  | "subreddit_url"
  | "tier"
  | "fit_reason"
  | "recommended_angle"
  | "suggested_title"
  | "suggested_body"
  | "rules_note"
  | "sort_order"
>;

// The curated recommendations for the AI-diagnostics discussion post.
// Order = the order to actually post in (best fits first, spaced out).
export const DISTRIBUTION_SEED: DistributionSeedRow[] = [
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/AutoRepair",
    subreddit_url: "https://www.reddit.com/r/AutoRepair/",
    tier: "best_fit",
    fit_reason:
      "General auto-repair discussion, looser than r/MechanicAdvice about 'must be a specific car problem'. A future-of-diagnostics question fits fine. Lowest removal risk — post here first.",
    recommended_angle:
      "Open, curious discussion question. Neutral tone, tech-and-DIY mix. No links, no product mention.",
    suggested_title:
      "Will AI diagnostics actually replace real diagnostic work — or is it years off?",
    suggested_body:
      "Been chewing on this and want the honest take from people who actually turn wrenches, not the tech-hype crowd.\n\nEvery few months there's a new \"AI mechanic\" tool claiming it'll read your codes and tell you exactly what's wrong. Some are handy for pointing you in a direction. But every tech knows a P0300 doesn't mean \"replace these three parts\" — it means start diagnosing. A code is a starting point, not an answer.\n\nSo where do you actually land:\n\n- Is any of it good enough today? Has AI ever given you a genuinely useful diagnosis, or does it just regurgitate the same forum posts you'd have found yourself?\n- What can't it do — reading a scope pattern, feeling a driveability issue on a test drive, knowing this platform has a known connector-corrosion problem, wiggle-testing a harness? Is that the moat, or does it fall eventually too?\n- If it does get good, does that actually help you (faster path to the fix, more cars through the bay) — or does it just mean customers show up already \"knowing\" the answer and arguing with your diagnosis?\n- Timeline: never, 5 years, 20 years? Where's the line between \"assists the tech\" and \"replaces the tech\"?\n\nGenuinely curious whether the people doing the work see a real shift coming or just another gimmick that dies at the shop door.",
    rules_note: "Genuine repair questions and discussion only. No advertising or links.",
    sort_order: 1,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/askcarguys",
    subreddit_url: "https://www.reddit.com/r/askcarguys/",
    tier: "best_fit",
    fit_reason:
      "Explicitly built for open-ended car questions and opinions. Discussion posts are on-topic and won't get removed for not being a specific problem.",
    recommended_angle: "Straight opinion-seeking question to the community.",
    suggested_title:
      "Is AI good enough to diagnose cars yet — or will it never replace a real tech?",
    suggested_body:
      "Serious question for the people who know cars: how good is AI at actually diagnosing them right now?\n\nI keep seeing apps and chatbots that promise to tell you what's wrong from your codes and symptoms. Sometimes the suggestions aren't crazy. But a code is a starting point — P0300 doesn't tell you it's coils vs plugs vs injectors vs a vacuum leak, that's what the diagnosis is for.\n\nWhat I'm trying to figure out:\n\n- Has AI ever actually saved you time on a real diagnosis, or is it just confidently repeating stuff off forums?\n- What's the part you don't think it can touch — the hands-on, feel-it, scope-it, know-the-platform stuff?\n- Best guess on timeline — is it \"never replaces a good tech,\" or \"give it 10 years\"?\n\nNot looking for hype either direction, just where people who work on cars actually think this is headed.",
    rules_note: "Open questions welcome; still no self-promo.",
    sort_order: 2,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/Cartalk",
    subreddit_url: "https://www.reddit.com/r/Cartalk/",
    tier: "best_fit",
    fit_reason:
      "General car discussion and troubleshooting; story- and opinion-friendly, so a 'future of diagnostics' thread fits naturally.",
    recommended_angle: "Conversational 'here's what I've been wondering' framing.",
    suggested_title:
      "Are we close to AI replacing the mechanic's diagnosis, or is that just hype?",
    suggested_body:
      "Something I've been wondering about lately. There's a lot of noise about AI \"diagnosing\" cars now — you punch in the symptoms or codes and it spits out what's supposedly wrong.\n\nWhen I've messed with it, it's fine for a general nudge, but it doesn't know that a rough idle on this particular engine is a known intake-gasket thing, and it can't hear or feel anything. A code just says where to start looking.\n\nCurious what folks here think:\n\n- Have you seen AI actually nail a diagnosis, or does it fall apart the second it's a weird real-world case?\n- What's the part of diagnosing a car you don't think software will ever really replace?\n- Are we talking \"handy assistant\" territory, or genuinely \"replaces the guy with the scan tool and 20 years of experience\" someday?\n\nJust want a reality check from people who actually deal with this stuff.",
    rules_note: "Discussion-friendly but no spam or links.",
    sort_order: 3,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/Justrolledintotheshop",
    subreddit_url: "https://www.reddit.com/r/Justrolledintotheshop/",
    tier: "best_fit",
    fit_reason:
      "Working pro techs who love industry talk. Meme/photo culture, but trade-discussion threads do well. Best place for candid shop-floor opinions.",
    recommended_angle:
      "Write from the mechanic's chair — 'does this replace us / help us?'. Dry, insider tone.",
    suggested_title:
      "Serious question for the shop: is AI diagnostics coming for our jobs, or just another gimmick?",
    suggested_body:
      "Every few months a service writer or a customer waves some AI app at me that \"already knows what's wrong.\" Then I actually pull the car in and it's a chafed harness or a corroded connector the app never had a prayer of finding.\n\nBut I'm not going to pretend the tech is standing still either. So genuine question for the people in the bay:\n\n- Has any AI tool actually made your diagnostic day faster, or is it just more noise to talk the customer down from?\n- What's the stuff you're confident it can't do — scope patterns, test drives, knowing the platform's known failures, physically wiggle-testing things?\n- Do you see it as a tool that helps us, or something shops eventually lean on to skip paying for real diag skill?\n\nNot trying to start a doom thread, just want the shop-floor read on where this actually goes.",
    rules_note:
      "Audience is pros — any consumer-app promo gets downvoted hard. Keep it 100% discussion.",
    sort_order: 4,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/MechanicAdvice",
    subreddit_url: "https://www.reddit.com/r/MechanicAdvice/",
    tier: "best_fit",
    fit_reason:
      "Your original target and huge, but really meant for 'here's my car's problem'. General discussion has higher removal risk — reword as a pointed question and check the sidebar rules first.",
    recommended_angle: "Frame as one specific question, not an essay.",
    suggested_title:
      "Techs — has an AI diagnosis ever actually been useful to you, or is it always just a starting point?",
    suggested_body:
      "Quick one for the techs here. With all the AI \"diagnose your car\" tools floating around now, I'm trying to get a straight answer from people who actually fix cars.\n\nHas one of these ever given you something genuinely useful — a direction you hadn't considered, a known-issue you confirmed — or is it always just repeating the obvious \"P0171 = check for a vacuum leak\" stuff you already know?\n\nAnd where does it fall flat for you? My assumption is the moment it needs a scope, a test drive, or hands on the actual harness, it's done. But maybe I'm underrating it.\n\nWould rather hear real experiences than marketing claims.",
    rules_note:
      "Meant for specific car problems. Discussion may be removed — read the sidebar before posting.",
    sort_order: 5,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/mechanics",
    subreddit_url: "https://www.reddit.com/r/mechanics/",
    tier: "trade",
    fit_reason:
      "Actual working mechanics — smaller but high signal. Industry-shift questions land well here.",
    recommended_angle: "Peer-to-peer question among pros.",
    suggested_title: "Where do you see AI diagnostics in 5 years — assistant or replacement?",
    suggested_body:
      "For the working mechanics here — where do you honestly think AI diagnostics lands in ~5 years?\n\nRight now it feels like a slightly-better search engine: fine for common codes, useless the moment it's an intermittent or a one-off you have to feel out. But the tools are improving fast enough that I don't want to just dismiss it.\n\nTwo camps I keep seeing:\n\n1. It becomes a real assistant — pulls TSBs, known failures and likely causes instantly so you spend less time chasing and more time fixing.\n2. It's mostly hype that stalls out because the hard part of diagnosis is physical and experience-based, not information lookup.\n\nWhich way do you lean, and what would actually have to change for it to move the needle in your bay?",
    rules_note: "Pro crowd; keep it professional, no promotion.",
    sort_order: 6,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/ASE",
    subreddit_url: "https://www.reddit.com/r/ASE/",
    tier: "trade",
    fit_reason:
      "ASE-certified techs — serious and professional. Ideal for thoughtful 'does this replace me' takes.",
    recommended_angle: "Professional, credential-aware framing.",
    suggested_title:
      "For ASE techs: is AI diagnostics a real threat to the trade, or an overhyped tool?",
    suggested_body:
      "Question for the certified folks here. There's a steady stream of \"AI will diagnose your car\" products now, and I'm trying to separate the real signal from the marketing.\n\nFrom a trade standpoint:\n\n- Is any of it accurate enough today to trust on anything past the most common codes?\n- Does it threaten the value of real diagnostic skill, or does it actually raise the floor for less-experienced techs while the hard cases still need us?\n- What would you want to see from a tool before you'd let it anywhere near your diagnostic process?\n\nI'd rather hear it from people who've earned the certs than from a product page. Where do you think this genuinely goes?",
    rules_note: "Small, professional sub. Discussion is fine; keep it respectful and promo-free.",
    sort_order: 7,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/MobileMechanic",
    subreddit_url: "https://www.reddit.com/r/MobileMechanic/",
    tier: "trade",
    fit_reason:
      "Niche but engaged. Good angle on whether AI helps solo/mobile diag where you can't lug a full bay of tools around.",
    recommended_angle: "Solo / mobile-diag perspective.",
    suggested_title:
      "Mobile guys — does AI or app-based diagnostics actually help you in the field yet?",
    suggested_body:
      "For the mobile/independent crowd — you don't have a full bay of equipment on every call, so I'm curious how useful AI or app-based diagnostics actually is out in the field.\n\nWhen you're on a driveway with a limited kit, does an AI tool help you narrow things down before you commit to a repair, or does it just send you chasing the wrong part?\n\n- Any real wins where it saved you a trip or pointed you right?\n- Where does it let you down — the stuff that needs a scope, a test drive, or just knowing the platform?\n- Would you actually pay for a good one, or is it a solved problem with experience + a decent scan tool?\n\nTrying to get a practical read, not a sales pitch.",
    rules_note: "Small niche sub; keep it a genuine question.",
    sort_order: 8,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/artificial",
    subreddit_url: "https://www.reddit.com/r/artificial/",
    tier: "ai_angle",
    fit_reason:
      "Tech-optimist crowd. Flip the framing to 'can AI handle a skilled diagnostic trade yet?' for the opposite perspective. Less grounded in real shop reality.",
    recommended_angle: "AI-capability framing rather than shop framing.",
    suggested_title:
      "Can AI actually diagnose a car yet, or is skilled hands-on trade work still out of reach?",
    suggested_body:
      "Car diagnostics feels like an interesting test case for where AI actually hits a wall.\n\nOn paper it looks like a perfect AI problem: symptoms + error codes + a huge corpus of repair knowledge → most likely cause. And for common, well-documented faults, current tools do okay.\n\nBut a lot of real diagnosis is physical and sensory — listening to an engine, feeling a driveability issue on a test drive, probing a wiring harness, knowing that a specific model has a notorious connector that corrodes. None of that is in the text.\n\nSo I'm curious how people here see it:\n\n- Is this bottleneck fundamentally about missing sensor/robotics data, or about reasoning?\n- Which parts get solved first — the knowledge lookup, or the hands-on judgment?\n- Realistically, how far are we from AI matching an experienced mechanic on a genuinely tricky case?\n\nCurious where the skilled-trades line actually falls.",
    rules_note: "Not car-specific; frame around AI capability. No self-promo.",
    sort_order: 9,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/ArtificialInteligence",
    subreddit_url: "https://www.reddit.com/r/ArtificialInteligence/",
    tier: "ai_angle",
    fit_reason:
      "Large AI-discussion sub (yes, the sub name is misspelled — it's the real big one). Same flip; good for the tech-optimist counterpoint.",
    recommended_angle:
      "'Which skilled trades will AI reach first?' with car diagnostics as the case study.",
    suggested_title: "Will AI replace skilled diagnostic trades like auto mechanics — and how soon?",
    suggested_body:
      "A lot of the \"which jobs will AI take\" talk focuses on desk work. I think the skilled diagnostic trades are a more interesting question, and auto mechanics are a great example.\n\nDiagnosing a car is part information problem (codes, symptoms, known failures — very AI-friendly) and part physical judgment (hearing, feeling, test-driving, probing wiring, knowing a specific platform's quirks — much harder to automate).\n\nSo for the group:\n\n- Do trades like this get \"assisted\" long before they get \"replaced,\" or does capability jump faster than people expect?\n- What's the actual blocker — reasoning, or the missing real-world sensor/robotics layer?\n- If you had to bet, when does AI match a good mechanic on a hard, ambiguous diagnosis — 5 years, 20, never?\n\nInterested in where people think the human-in-the-loop line settles for hands-on trades.",
    rules_note: "Broad AI discussion; keep car diagnostics as a concrete example, no promotion.",
    sort_order: 10,
  },
];

// Reddit traction helpers moved to src/lib/forums/reddit.ts (shared with the
// post generator). Re-exported here so existing imports keep working.
export {
  fetchRedditTraction,
  redditJsonUrl,
  type RedditTraction,
} from "./reddit";
