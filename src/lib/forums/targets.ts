import type { ForumTarget } from "./types";

// The forums we seed posts into. Phase 1 = English Reddit (decided 2026-06-16).
// Reference data only — like the video channels / reviews platform lists, this
// is NOT in the DB. `tone` is handed to the model; `rulesNote` is the human
// reminder of each community's posting norms (most ban overt self-promotion,
// hence the mention-level toggle in the UI).
//
// Nordic/Swedish forums (Garaget.org etc.) are a planned phase-2 addition; add
// them here with language: "sv" and they flow through the rest of the UI
// unchanged.
export const FORUM_TARGETS: ForumTarget[] = [
  {
    key: "reddit:MechanicAdvice",
    platform: "reddit",
    name: "r/MechanicAdvice",
    url: "https://www.reddit.com/r/MechanicAdvice/",
    language: "en",
    blurb: "DIY owners asking pros + enthusiasts to help diagnose a problem.",
    tone: "Casual, first-person, slightly anxious DIY owner. Plain language, not jargon-heavy. People paste their symptoms and codes and ask 'what should I check?'.",
    rulesNote:
      "No overt advertising. Posts must be a genuine question or a genuine fix story. Self-promo gets removed — keep any tool mention incidental.",
  },
  {
    key: "reddit:AskMechanics",
    platform: "reddit",
    name: "r/AskMechanics",
    url: "https://www.reddit.com/r/AskMechanics/",
    language: "en",
    blurb: "Straight Q&A — owners ask, mechanics answer.",
    tone: "Direct question format. State the car, the symptom, the codes, the question. Less storytelling than r/MechanicAdvice.",
    rulesNote:
      "Questions only for owners; keep it focused. No promotion in the post itself.",
  },
  {
    key: "reddit:Cartalk",
    platform: "reddit",
    name: "r/Cartalk",
    url: "https://www.reddit.com/r/Cartalk/",
    language: "en",
    blurb: "General car discussion, troubleshooting and war stories.",
    tone: "Conversational, community feel. Story-friendly — a 'here's what happened with my car' framing works well.",
    rulesNote:
      "Discussion-friendly but still no spam. A fix story that helps others is welcome; a sales pitch is not.",
  },
  {
    key: "reddit:Justrolledintotheshop",
    platform: "reddit",
    name: "r/Justrolledintotheshop",
    url: "https://www.reddit.com/r/Justrolledintotheshop/",
    language: "en",
    blurb: "Mechanics' subreddit — shop-side war stories and odd finds.",
    tone: "Pro/shop voice, dry humor, insider. Written from the mechanic's chair, not the owner's.",
    rulesNote:
      "Audience is professionals. Helpful-answer / shop-perspective posts fit; consumer-app promotion will be downvoted hard.",
  },
  {
    key: "reddit:AutoRepair",
    platform: "reddit",
    name: "r/AutoRepair",
    url: "https://www.reddit.com/r/AutoRepair/",
    language: "en",
    blurb: "Repair-focused help for DIYers working on their own cars.",
    tone: "Hands-on DIY framing. People mid-repair asking whether they're on the right track.",
    rulesNote: "Genuine repair questions and write-ups only. No advertising.",
  },
];

export function getForumTarget(key: string): ForumTarget | undefined {
  return FORUM_TARGETS.find((t) => t.key === key);
}
