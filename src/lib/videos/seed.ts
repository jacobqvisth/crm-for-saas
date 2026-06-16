// The 10 curated car-diagnosis videos seeded into diagnostic_videos on a
// workspace's first visit to /videos. Every youtube_id was verified to resolve
// via YouTube oembed on 2026-06-16 (title + channel are the real values).
//
// Chosen for variety across the common fault families a DIY owner hits:
// general method, no-spark, misfire, crank/no-start, no-crank, parasitic draw.

export interface SeedVideo {
  youtube_id: string;
  title: string;
  channel: string;
  category: string;
  description: string;
}

export const SEED_VIDEOS: SeedVideo[] = [
  {
    youtube_id: "DUfJFhzVm_E",
    title: "How Mechanics REALLY Diagnose Your Car",
    channel: "Ben Johnson Automotive",
    category: "Diagnostic method",
    description: "The professional fault-finding mindset — a great 'this is the slow way' framing video.",
  },
  {
    youtube_id: "BwMAP_YW4T4",
    title: "Chapter 22 No Start, No Spark Diagnosis (Part 3)",
    channel: "ScannerDanner",
    category: "No-spark",
    description: "Tracing a no-start / no-spark condition with a scope and wiring diagrams.",
  },
  {
    youtube_id: "7nHbctRwyys",
    title: "No Spark Diagnostics \"Control Testing\" Part 1",
    channel: "ScannerDanner",
    category: "No-spark",
    description: "Control-side testing of the ignition system to isolate a no-spark fault.",
  },
  {
    youtube_id: "u_XgjiLXVX0",
    title: "Diagnosing a Misfire Without a Scanner",
    channel: "MR. DIAGNOSTECH",
    category: "Misfire",
    description: "Finding a misfire with a vacuum gauge — no scan tool. Very relatable for a stranded owner.",
  },
  {
    youtube_id: "iHPYGsUOLtQ",
    title: "Diagnose a Misfire LIKE A BOSS (DIY vs \"Pro\" Mechanic!)",
    channel: "Schrodingers Box",
    category: "Misfire",
    description: "DIY single-cylinder misfire hunt on a Suburban, contrasted with the shop approach.",
  },
  {
    youtube_id: "NxeSM1kuNiw",
    title: "Chevrolet Express - Crank / No Start",
    channel: "South Main Auto LLC",
    category: "Crank / no-start",
    description: "Field diagnosis of a van that cranks but won't start.",
  },
  {
    youtube_id: "_HLxEmei-6s",
    title: "Service Call - No Crank, No Start",
    channel: "South Main Auto LLC",
    category: "No-crank",
    description: "After-hours service call on a no-crank / no-start — the classic 'won't even turn over'.",
  },
  {
    youtube_id: "TH7S4bVfCU8",
    title: "No crank no start: let's repair together",
    channel: "Robinson's Automotive",
    category: "No-crank",
    description: "Step-by-step walk through a no-crank / no-start repair.",
  },
  {
    youtube_id: "LKBqRs2bdYU",
    title: "Have Never Seen THIS Kill a Battery Before... (Parasitic Ram - Part 1)",
    channel: "Pine Hollow Auto Diagnostics",
    category: "Parasitic draw",
    description: "Hunting a parasitic draw that keeps killing the battery on a Ram 1500.",
  },
  {
    youtube_id: "bS6xak6Xmyo",
    title: "Customer is Tired of this PARASITIC DRAW!! (Toyota Avalon)",
    channel: "Pine Hollow Auto Diagnostics",
    category: "Parasitic draw",
    description: "Battery goes flat if the car sits a few days — tracking the draw on a Toyota Avalon.",
  },
];
