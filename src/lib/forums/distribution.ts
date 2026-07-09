// Forums → Distribution (/forums/distribution).
//
// A placement tracker for a single post *concept*: where to post it, which
// angle to use per community, whether it's been posted yet, and how much
// traction it got. The curated recommendation list lives here in code (like
// the forum targets in targets.ts) and is seeded per-workspace into the
// forum_distribution table on first load; the DB row then owns the tracking
// state (status / posted URL / traction).

import type { ForumCommentAssignment } from "./types";

export type DistributionTier = "best_fit" | "trade" | "ai_angle";
export type DistributionStatus = "recommended" | "posted" | "skipped";

// Topics you can rotate between on the Distribution page (dropdown at the top).
// Adding another = a new TOPICS entry + a new batch of DISTRIBUTION_SEED rows
// with that topic key. Keep more than one so we're not hammering the same subs
// with the same post every week — pick a fresh angle each time.
export const DEFAULT_TOPIC = "ai-diagnostics-takeover";
export const HORROR_TOPIC = "ai-repair-horror-stories";
export const WINS_TOPIC = "ai-diagnostics-wins";
export const CODE_TOPIC = "code-is-not-a-diagnosis";
export const DIY_TOPIC = "diy-confidence-with-ai";

export interface DistributionTopic {
  key: string;
  title: string; // human name of the post concept
  summary: string; // one-liner shown under the page header
  // Short label for the topic dropdown (falls back to title when absent).
  menuLabel?: string;
  // Why we're posting this angle — the internal goal, shown as a hint.
  goal?: string;
}

// Order here = order in the dropdown. First entry is the default selection.
export const TOPICS: Record<string, DistributionTopic> = {
  [DEFAULT_TOPIC]: {
    key: DEFAULT_TOPIC,
    title: "Will AI take over car diagnostics?",
    menuLabel: "Will AI take over diagnostics?",
    summary:
      "A discussion post asking mechanics whether AI diagnostics will replace real diagnostic work, is it good enough today, when will it be, or never.",
    goal: "Start a broad debate and surface where techs think AI diagnostics helps vs. falls flat.",
  },
  [HORROR_TOPIC]: {
    key: HORROR_TOPIC,
    title: "When your AI diagnosis went south",
    menuLabel: "AI repair horror stories",
    summary:
      "A story-bait post: open with one painful example of someone trusting an AI diagnosis and replacing the wrong part, then invite people to share the time AI diagnostics or a repair suggestion sent them the wrong way.",
    goal: "Harvest real failure stories. Every reply is a diagnostic gap we can test whether Wrenchlane would have caught, so log the good ones in the Gap log tab.",
  },
  [WINS_TOPIC]: {
    key: WINS_TOPIC,
    title: "When AI actually nailed a car diagnosis",
    menuLabel: "AI diagnosis wins",
    summary:
      "The flip side of the horror stories: ask people about the time AI or an app actually pointed them at the right fix, saved a shop trip, or caught something they missed.",
    goal: "Collect genuine wins for social proof and to learn which fault types AI already handles well.",
  },
  [CODE_TOPIC]: {
    key: CODE_TOPIC,
    title: "A trouble code is not a diagnosis",
    menuLabel: "A code is not a diagnosis",
    summary:
      "A pointed opinion post: too many people read a code, buy the part the internet named, and call it a diagnosis. Ask techs for the codes people most often misread and the parts they waste money on.",
    goal: "Own the 'a code points you where to start, it is not the answer' message and surface the most misdiagnosed codes.",
  },
  [DIY_TOPIC]: {
    key: DIY_TOPIC,
    title: "Has AI made you brave enough to DIY your car?",
    menuLabel: "AI and the DIY driver",
    summary:
      "Aimed at owners, not just pros: has typing your symptoms into an AI made you attempt a repair you would normally leave to a shop, and how did it actually go, win or disaster.",
    goal: "Reach the DIY owner audience and gather both confidence wins and the jobs where AI over-promised.",
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
  // Which Reddit account posted it (roster FK, picked when marking posted) and
  // the actual author handle auto-captured from Reddit on traction refresh.
  posted_by_account_id: string | null;
  posted_by_username: string | null;
  score: number | null;
  num_comments: number | null;
  upvote_ratio: number | null;
  traction_note: string | null;
  last_checked_at: string | null;
  suggested_comment: string | null;
  slack_notified_at: string | null;
  slack_thread_ts: string | null;
  slack_channel_id: string | null;
  slack_summary_ts: string | null;
  slack_summary_channel: string | null;
  created_at: string;
  updated_at: string;
  // Per-member comments attached on GET (not a column).
  assignments?: ForumCommentAssignment[];
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

  // ── Topic: AI repair horror stories (flagship story-bait) ──────────────
  // Open with one painful failure, then invite people to share theirs. Every
  // reply is a diagnostic gap to log in the Gap log tab.
  {
    topic: HORROR_TOPIC,
    subreddit: "r/AutoRepair",
    subreddit_url: "https://www.reddit.com/r/AutoRepair/",
    tier: "best_fit",
    fit_reason:
      "General auto-repair discussion, looser than r/MechanicAdvice. A story-collection thread fits fine and pulls replies. Lowest removal risk, post here first.",
    recommended_angle:
      "Open with the failure story, then hand the mic over. Warm, no judgement, no product mention.",
    suggested_title: "Tell me about the time an AI diagnosis sent you down the wrong road",
    suggested_body:
      "A buddy ran his misfire code through one of those AI chatbots, got told with total confidence it was the ignition coils, and replaced all of them. Four hundred dollars later, still misfiring. Turned out to be a cracked intake boot leaning one cylinder out. The AI never asked him a single follow-up question. It just sounded sure.\n\nI keep hearing versions of this and I want to collect them properly. Not to dunk on anyone, we have all thrown parts at a problem before. I am genuinely curious where these tools fall apart.\n\nSo tell me: when did your attempt at AI diagnostics or a repair go south? What did it tell you, what did you end up replacing, and what was it actually?",
    rules_note: "Genuine repair questions and discussion only. No advertising or links.",
    sort_order: 1,
  },
  {
    topic: HORROR_TOPIC,
    subreddit: "r/askcarguys",
    subreddit_url: "https://www.reddit.com/r/askcarguys/",
    tier: "best_fit",
    fit_reason:
      "Built for open-ended car questions and opinions. A share-your-story thread is squarely on-topic and will not get removed.",
    recommended_angle: "First-person confession, then an open question. The money angle pulls replies.",
    suggested_title: "When did AI steer you wrong on a car repair? Bonus points if it cost you money",
    suggested_body:
      "Last month I fed a dash light and a fault code into a chatbot because the shop wanted 180 just to look. It walked me confidently toward a failing ABS module. I found a used one, paid to have it coded, and the light was back on before I got home. Real problem was a corroded wheel speed sensor connector. A fifteen dollar fix.\n\nI do not think AI is useless for this. But it is way too confident for how often it is wrong, and it never tells you what it does not know.\n\nCurious if I am alone here. When did AI diagnostics or a repair suggestion steer you the wrong way? What did it say, what did you do, and what was actually wrong?",
    rules_note: "Open questions welcome; still no self-promo.",
    sort_order: 2,
  },
  {
    topic: HORROR_TOPIC,
    subreddit: "r/Cartalk",
    subreddit_url: "https://www.reddit.com/r/Cartalk/",
    tier: "best_fit",
    fit_reason:
      "General car discussion, story- and opinion-friendly. A worst-AI-advice thread fits naturally and invites war stories.",
    recommended_angle: "Conversational story-time tone. Ask for their worst one.",
    suggested_title: "The most expensive part you replaced because AI told you to, and it was wrong",
    suggested_body:
      "Story time. My neighbor described a rough idle to an AI assistant and it confidently said mass airflow sensor. He cleaned it, then replaced it, no change. Then a throttle body. Still rough. A real tech found a torn PCV hose in about ten minutes. Two hundred dollars of parts to fix a fifteen dollar hose.\n\nThe pattern I keep seeing is the same: the AI sounds certain, never asks what it cannot see, and points at a part instead of a test.\n\nSo what is your version? When did AI diagnostics send you the wrong way, and what did it actually turn out to be?",
    rules_note: "Discussion-friendly but no spam or links.",
    sort_order: 3,
  },
  {
    topic: HORROR_TOPIC,
    subreddit: "r/MechanicAdvice",
    subreddit_url: "https://www.reddit.com/r/MechanicAdvice/",
    tier: "best_fit",
    fit_reason:
      "Huge and really meant for 'here is my car's problem'. Framed as a pointed question to techs, a story thread does well. Read the sidebar first.",
    recommended_angle: "Ask techs for the worst customer-brought AI diagnosis. Keep it one clear question.",
    suggested_title: "Techs: what is the worst AI 'diagnosis' a customer has walked in with?",
    suggested_body:
      "Quick one for the techs. Customers are showing up more and more with a printout or a phone screen where an AI already diagnosed the car, and they want that exact part replaced.\n\nI want to hear the worst ones. The time the AI said head gasket and it was a loose clamp. The time it said transmission and it was a speed sensor. The confident wrong answer that would have cost the customer real money if you had just done what the app said.\n\nWhat did the AI claim, and what was actually wrong when you got hands on it?",
    rules_note: "Meant for specific car problems. Discussion may be removed, read the sidebar before posting.",
    sort_order: 4,
  },
  {
    topic: HORROR_TOPIC,
    subreddit: "r/Justrolledintotheshop",
    subreddit_url: "https://www.reddit.com/r/Justrolledintotheshop/",
    tier: "trade",
    fit_reason:
      "Working pros who live for these stories. Trade-discussion threads do well here and the failures write themselves.",
    recommended_angle: "Dry, insider shop-floor tone. Invite their best AI-was-wrong story.",
    suggested_title: "The AI told them it was the coils. It was a mouse nest. Share yours.",
    suggested_body:
      "Service writer hands me a phone. Customer's AI app already knows it is the coils, wants all four done. I pull the car in. It is a rodent nest packed against the harness with two chewed wires. Coils were fine.\n\nWe all get these now. The app is confident, the customer is convinced, and the actual fault is something no chatbot was ever going to find without hands on the car.\n\nDrop your best one. What did the AI swear it was, and what was it actually when you got under the hood?",
    rules_note: "Audience is pros. Any consumer-app promo gets downvoted hard, keep it 100% story and discussion.",
    sort_order: 5,
  },
  {
    topic: HORROR_TOPIC,
    subreddit: "r/mechanics",
    subreddit_url: "https://www.reddit.com/r/mechanics/",
    tier: "trade",
    fit_reason: "Actual working mechanics, smaller but high signal. A worst-you-have-seen question lands well.",
    recommended_angle: "Peer-to-peer question among pros. Ask about frequency and the worst case.",
    suggested_title: "How often are customers bringing you a wrong AI diagnosis, and what was the worst?",
    suggested_body:
      "For the working mechanics here. How often now does a customer show up already diagnosed by an AI, demanding a specific part?\n\nI am trying to get a feel for how wrong these things actually are in practice. Not the times it happened to guess a common code right, but the times following it would have cost the customer real money on a part that was never the problem.\n\nWhat is the worst AI diagnosis you have had to talk someone out of, and what was the real fault?",
    rules_note: "Pro crowd, keep it professional, no promotion.",
    sort_order: 6,
  },
  {
    topic: HORROR_TOPIC,
    subreddit: "r/artificial",
    subreddit_url: "https://www.reddit.com/r/artificial/",
    tier: "ai_angle",
    fit_reason:
      "Tech crowd. Reframe from horror story to 'why is AI so overconfident', which is on-topic here and pulls thoughtful replies plus examples.",
    recommended_angle: "AI-calibration framing rather than shop framing. Still ends by inviting real examples.",
    suggested_title:
      "AI confidently 'diagnoses' cars and people replace the wrong parts. Why so overconfident?",
    suggested_body:
      "A pattern worth talking about. People are feeding car symptoms and error codes into chatbots, getting a confident single answer, and replacing expensive parts that turn out to be fine. A trouble code like P0300 means a cylinder is misfiring, start looking here, not replace these three parts, but the model states a cause like it is certain.\n\nTwo things stand out to me:\n\n- The model almost never says what it cannot know. It has no scope trace, no test drive, no ability to wiggle a harness, yet it rarely flags that as a limit.\n- It anchors on the most common cause for a symptom and presents it as the diagnosis, even when the real fault is physical and not in any text.\n\nIs this a calibration problem, a missing-sensor-data problem, or a UX problem in how these answers get presented? And if you have a real example where an AI diagnosis was confidently wrong, car or otherwise, I would love to hear it.",
    rules_note: "Not car-specific, frame around AI overconfidence. No self-promo.",
    sort_order: 7,
  },

  // ── Topic: AI diagnosis wins (the flip side, social proof + coverage) ──
  {
    topic: WINS_TOPIC,
    subreddit: "r/AutoRepair",
    subreddit_url: "https://www.reddit.com/r/AutoRepair/",
    tier: "best_fit",
    fit_reason:
      "General repair discussion. A positive 'what worked' thread is easy to reply to and low removal risk.",
    recommended_angle: "Genuine curiosity, the good side of the story. No product mention.",
    suggested_title: "When has AI actually helped you fix a car instead of sending you the wrong way?",
    suggested_body:
      "There are plenty of stories about AI blowing a diagnosis. I want the other side.\n\nWhen has an AI tool or app genuinely helped you? Maybe it pointed you at a known issue you had not considered, confirmed a hunch before you spent money, or narrowed a weird intermittent down to something you could actually test.\n\nTrying to figure out what these tools are actually good at, from people who turn wrenches. What was the car, what did the AI get right, and did it save you time or money?",
    rules_note: "Genuine repair questions and discussion only. No advertising or links.",
    sort_order: 1,
  },
  {
    topic: WINS_TOPIC,
    subreddit: "r/askcarguys",
    subreddit_url: "https://www.reddit.com/r/askcarguys/",
    tier: "best_fit",
    fit_reason: "Open-ended car questions are the whole point of this sub. A wins thread fits cleanly.",
    recommended_angle: "Straight opinion-seeking question, positive framing.",
    suggested_title: "Has AI ever nailed a car problem for you? Looking for the real wins",
    suggested_body:
      "Serious question for the people who know cars. Has AI ever actually gotten a diagnosis right in a way that helped you?\n\nI am not talking about it guessing a common code. I mean a time it pointed you at the actual fix, caught something you would have missed, or stopped you from replacing the wrong part.\n\nWhat was the car, what did you type in, and what did it get right?",
    rules_note: "Open questions welcome; still no self-promo.",
    sort_order: 2,
  },
  {
    topic: WINS_TOPIC,
    subreddit: "r/Cartalk",
    subreddit_url: "https://www.reddit.com/r/Cartalk/",
    tier: "best_fit",
    fit_reason: "Story-friendly general car sub. The positive version invites just as many replies.",
    recommended_angle: "Conversational, ask for the times it earned its keep.",
    suggested_title: "The time AI actually saved you a shop trip or a wrong part",
    suggested_body:
      "Been reading a lot of AI-got-it-wrong stories and wanted to ask the opposite. When did an AI tool actually save you something?\n\nA shop visit you did not need, a part you almost replaced but did not, a weird symptom it helped you make sense of. The times it earned its keep.\n\nCurious what it is genuinely good at. What happened, and what was the car?",
    rules_note: "Discussion-friendly but no spam or links.",
    sort_order: 3,
  },
  {
    topic: WINS_TOPIC,
    subreddit: "r/MechanicAdvice",
    subreddit_url: "https://www.reddit.com/r/MechanicAdvice/",
    tier: "best_fit",
    fit_reason:
      "Large tech audience. Framed as a pointed question to pros, the positive angle is welcome. Check the sidebar.",
    recommended_angle: "Single clear question to techs, positive framing.",
    suggested_title: "Techs: has an AI tool ever given you a genuinely useful lead on a diagnosis?",
    suggested_body:
      "For the techs. Setting aside the times AI is confidently wrong, has one ever actually given you something useful?\n\nA known-issue or TSB it surfaced fast, a direction on an intermittent you had not tried, a pattern across cars you confirmed with a test. The times it made your diagnostic day faster instead of harder.\n\nWhat was the case, and what did it actually help with?",
    rules_note: "Meant for specific car problems. Discussion may be removed, read the sidebar before posting.",
    sort_order: 4,
  },
  {
    topic: WINS_TOPIC,
    subreddit: "r/mechanics",
    subreddit_url: "https://www.reddit.com/r/mechanics/",
    tier: "trade",
    fit_reason: "Pro mechanics, high signal. A practical 'where does it help' question lands well.",
    recommended_angle: "Peer-to-peer, practical, positive but honest about limits.",
    suggested_title: "Working mechanics: where does AI actually help in your diagnostic process?",
    suggested_body:
      "For the working mechanics. Where, if anywhere, has AI actually earned a place in how you diagnose?\n\nNot the hype, the real uses. Pulling likely causes and known failures fast, sanity-checking a hunch, helping a newer tech not go down a rabbit hole. The spots where it genuinely saves time.\n\nWhat do you actually use it for, and where does it stop being useful?",
    rules_note: "Pro crowd, keep it professional, no promotion.",
    sort_order: 5,
  },

  // ── Topic: A trouble code is not a diagnosis (opinion / education) ──────
  {
    topic: CODE_TOPIC,
    subreddit: "r/MechanicAdvice",
    subreddit_url: "https://www.reddit.com/r/MechanicAdvice/",
    tier: "best_fit",
    fit_reason:
      "Core audience for exactly this. Framed as a discussion prompt to techs it fits, read the sidebar first.",
    recommended_angle: "Educational, slightly opinionated. Ask which codes get misread.",
    suggested_title: "Reminder that a trouble code is where you start diagnosing, not the answer",
    suggested_body:
      "Seeing it constantly: someone pulls a code, types it into the internet or an AI, buys the part it names, and is surprised when the problem is still there.\n\nA P0171 is not replace the O2 sensor. A P0300 is not new coils. The code tells you which system is unhappy. The diagnosis is the work you do after that: the tests, the data, the process of elimination.\n\nFor the techs: what are the codes people most often treat as a diagnosis, and what does it actually end up being once you test properly?",
    rules_note: "Meant for specific car problems. Discussion may be removed, read the sidebar before posting.",
    sort_order: 1,
  },
  {
    topic: CODE_TOPIC,
    subreddit: "r/AutoRepair",
    subreddit_url: "https://www.reddit.com/r/AutoRepair/",
    tier: "best_fit",
    fit_reason: "General repair discussion, this is squarely on-topic and gets useful answers.",
    recommended_angle: "Open question with a concrete example to prime replies.",
    suggested_title: "What is the code people most often 'diagnose' wrong by just buying the part?",
    suggested_body:
      "A code points you to a system. It does not name the broken part. But between parts-store code readers and AI apps, a lot of people treat the code as the answer, buy the obvious part, and still have the problem.\n\nA classic one is P0420, everyone buys a catalytic converter, and half the time it is an exhaust leak or a lazy O2 sensor.\n\nWhat is the code you see misread the most, and what is it usually actually?",
    rules_note: "Genuine repair questions and discussion only. No advertising or links.",
    sort_order: 2,
  },
  {
    topic: CODE_TOPIC,
    subreddit: "r/askcarguys",
    subreddit_url: "https://www.reddit.com/r/askcarguys/",
    tier: "best_fit",
    fit_reason: "Opinion and explainer questions thrive here. Low removal risk.",
    recommended_angle: "Curious 'why do people do this' framing, then ask for examples.",
    suggested_title: "Why does everyone treat a check-engine code like it names the broken part?",
    suggested_body:
      "Genuine question. A trouble code tells you which system has a problem, not which part to replace. Yet the default move now is to read the code, look up what part is P-whatever, and buy it.\n\nSometimes you get lucky. Often you replace a good part and still have the fault, because the code was a symptom, not a cause.\n\nFor the people who actually diagnose cars: which codes get misread this way the most, and what is the real fix usually?",
    rules_note: "Open questions welcome; still no self-promo.",
    sort_order: 3,
  },
  {
    topic: CODE_TOPIC,
    subreddit: "r/Justrolledintotheshop",
    subreddit_url: "https://www.reddit.com/r/Justrolledintotheshop/",
    tier: "trade",
    fit_reason: "Pros who see this daily and enjoy the genre. Story thread does well.",
    recommended_angle: "Shop-floor tone, ask for their best code-misread story.",
    suggested_title: "Customers reading a code and demanding the part the internet named. Your best one?",
    suggested_body:
      "The new normal: customer reads a code at the parts store or in an app, decides that equals a specific part, and shows up wanting exactly that replaced. Then it is not that at all.\n\nP0128 so obviously it must be a thermostat, turns out they already put in a cheap aftermarket one that is also stuck open. Or P0303 and just do the coil, and it is a burnt valve.\n\nGive me your best code said X so they wanted Y story, and what it actually was.",
    rules_note: "Audience is pros. No consumer promo, keep it story and discussion.",
    sort_order: 4,
  },
  {
    topic: CODE_TOPIC,
    subreddit: "r/mechanics",
    subreddit_url: "https://www.reddit.com/r/mechanics/",
    tier: "trade",
    fit_reason: "Pro audience, high signal. A process-and-examples question lands well.",
    recommended_angle: "Peer question about the most-misread code and the real process.",
    suggested_title: "Which trouble code do you most often have to explain is not a diagnosis?",
    suggested_body:
      "For the working mechanics. Which code do you find yourself explaining the most, the one customers or newer techs read as an instant part order?\n\nI am curious both which codes get treated as a diagnosis and how you actually run them down once the code is just the starting point.\n\nWhat is your most-misread code, and what is your process from there?",
    rules_note: "Pro crowd, keep it professional, no promotion.",
    sort_order: 5,
  },
  {
    topic: CODE_TOPIC,
    subreddit: "r/ASE",
    subreddit_url: "https://www.reddit.com/r/ASE/",
    tier: "trade",
    fit_reason: "Serious, professional techs. A process-focused question is a good fit here.",
    recommended_angle: "Professional, credential-aware. Ask for process, not just the code.",
    suggested_title: "For ASE techs: the codes most misread as a diagnosis, and how you actually run them",
    suggested_body:
      "Question for the certified folks. With parts-store readers and AI apps everywhere, more people treat a stored code as the diagnosis and skip the actual work.\n\nFrom a trade standpoint, which codes do you see misdiagnosed this way most often, and what does your real diagnostic process look like once the code has only told you where to start?\n\nInterested in the thinking, not just the answer, from people who have earned the certs.",
    rules_note: "Small, professional sub. Keep it respectful and promo-free.",
    sort_order: 6,
  },

  // ── Topic: AI and the DIY driver (owner audience, both outcomes) ────────
  {
    topic: DIY_TOPIC,
    subreddit: "r/AutoRepair",
    subreddit_url: "https://www.reddit.com/r/AutoRepair/",
    tier: "best_fit",
    fit_reason: "DIY-heavy audience, this is right in the wheelhouse and gets lots of replies.",
    recommended_angle: "Owner and DIY framing. Ask for both wins and disasters.",
    suggested_title: "Has AI made you brave enough to attempt a repair you would normally pay for?",
    suggested_body:
      "Curious how AI is changing what people are willing to DIY. Has typing your symptoms or a code into an AI ever given you the confidence to tackle a job you would normally have handed to a shop?\n\nAnd more importantly, how did it go? Did it walk you through it fine, or did it leave out a step, underestimate the job, or point you at the wrong part halfway through?\n\nLooking for both the wins and the ones that went sideways. What was the job, and how did it turn out?",
    rules_note: "Genuine repair questions and discussion only. No advertising or links.",
    sort_order: 1,
  },
  {
    topic: DIY_TOPIC,
    subreddit: "r/askcarguys",
    subreddit_url: "https://www.reddit.com/r/askcarguys/",
    tier: "best_fit",
    fit_reason: "Opinion and experience questions fit well. Low removal risk.",
    recommended_angle: "Community question, invite both outcomes.",
    suggested_title: "Anyone else attempting bigger DIY jobs now because an AI talked them through it?",
    suggested_body:
      "With AI able to walk you through steps and read your codes, I am seeing more people attempt repairs they would have paid for before. Wondering how that is actually working out.\n\nHas AI given you the confidence to do a job yourself? Did it work, or did it gloss over the hard part, miss a special tool, or send you after the wrong cause?\n\nBoth stories welcome, the ones that saved you money and the ones that turned into a bigger bill.",
    rules_note: "Open questions welcome; still no self-promo.",
    sort_order: 2,
  },
  {
    topic: DIY_TOPIC,
    subreddit: "r/Cartalk",
    subreddit_url: "https://www.reddit.com/r/Cartalk/",
    tier: "best_fit",
    fit_reason: "Story-friendly general sub. This invites both triumph and disaster stories.",
    recommended_angle: "Story-time, ask how it turned out.",
    suggested_title: "The DIY repair you only tried because AI made it sound easy, how did it go?",
    suggested_body:
      "Story I keep hearing: someone asks an AI about a noise or a code, it lays out a confident step-by-step, and they attempt a job they would never have touched otherwise.\n\nSometimes it goes great and they save a few hundred dollars. Sometimes the AI skipped the part where you need a press, or the bolt that always snaps, or the real cause behind the symptom.\n\nWhat is the DIY job AI convinced you to try, and how did it actually turn out?",
    rules_note: "Discussion-friendly but no spam or links.",
    sort_order: 3,
  },
  {
    topic: DIY_TOPIC,
    subreddit: "r/MechanicAdvice",
    subreddit_url: "https://www.reddit.com/r/MechanicAdvice/",
    tier: "best_fit",
    fit_reason:
      "Large audience with lots of DIYers. Framed as a clear question it fits, check the sidebar.",
    recommended_angle: "Ask DIYers where AI helped vs. left them stuck. Single question.",
    suggested_title: "DIYers: has AI helped you finish a job, or left you stranded halfway?",
    suggested_body:
      "For the DIY crowd here. When you have used an AI to help with a repair, how complete was the help?\n\nDid it get you through the whole job, or did it leave out a torque spec, a special tool, or a step that mattered, and you ended up here or at a shop to finish it?\n\nTrying to get an honest read on where AI is actually useful for DIY and where it leaves people stuck. What was the job, and where did it help or fall short?",
    rules_note: "Meant for specific car problems. Discussion may be removed, read the sidebar before posting.",
    sort_order: 4,
  },
  {
    topic: DIY_TOPIC,
    subreddit: "r/artificial",
    subreddit_url: "https://www.reddit.com/r/artificial/",
    tier: "ai_angle",
    fit_reason:
      "Tech crowd. Reframe as 'how well does AI transfer to hands-on work', which is on-topic and invites examples.",
    recommended_angle: "AI-capability framing about transfer to physical work. Ends inviting examples.",
    suggested_title:
      "People are using AI to attempt car repairs they are not trained for. How is that going?",
    suggested_body:
      "An interesting real-world use of these tools: people describe a car problem to an AI and then attempt a physical repair based on its step-by-step, often something they have no training for.\n\nIt is a good test of how well AI transfers into hands-on, physical work. The knowledge part is text-friendly. The execution part, tools, torque, feel, knowing when you are in over your head, is not.\n\nFor anyone who has done this with cars or any other hands-on repair: did the AI guidance hold up in the real world, or did it break down the moment it met the physical job? Curious where the line is.",
    rules_note: "Not car-specific, frame around AI in hands-on tasks. No self-promo.",
    sort_order: 5,
  },
];

// Reddit traction helpers moved to src/lib/forums/reddit.ts (shared with the
// post generator). Re-exported here so existing imports keep working.
export {
  fetchRedditTraction,
  redditJsonUrl,
  type RedditTraction,
} from "./reddit";
