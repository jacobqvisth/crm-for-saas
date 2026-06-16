// The curated car-diagnosis videos seeded into diagnostic_videos. We target
// videos built around one or more specific DTC fault codes (P0420, P0171,
// P0301, …) — those are the ones that map cleanly onto the Wrenchlane app
// reading the code and walking a DIY owner through the fix.
//
// Every youtube_id was verified to resolve via YouTube oembed on 2026-06-16
// (title + channel are the real values). `dtc_codes` lists the codes the video
// actually diagnoses; `category` is the human-readable fault family.
//
// This list is the single source of truth for the page: GET /api/videos
// reconciles the DB against it (inserts new entries, prunes removed ones that
// haven't been marked or worked on), so curating the page = editing this file.

export interface SeedVideo {
  youtube_id: string;
  title: string;
  channel: string;
  category: string;
  dtc_codes: string[];
  description: string;
}

export const SEED_VIDEOS: SeedVideo[] = [
  {
    youtube_id: "9VZ5K8n5jj0",
    title: "P0420 How To Diagnose A Bad Catalytic Converter",
    channel: "EricTheCarGuy",
    category: "Catalyst efficiency",
    dtc_codes: ["P0420"],
    description: "Why P0420 is misdiagnosed ~30% of the time — O2 sensor / exhaust leak vs an actually-dead cat.",
  },
  {
    youtube_id: "tv5iziPJYh0",
    title: "Vauxhall Corsa D 1.2 – P0171 Lean Code Fixed Fast!",
    channel: "Stanhope Auto repair Centre Wardak",
    category: "Lean fuel trim",
    dtc_codes: ["P0171"],
    description: "Real-world P0171 lean fix using a scanner, vacuum gauge and smoke machine.",
  },
  {
    youtube_id: "gCV11HGqRaI",
    title: "How to Diagnose Codes P0171 & P0174 - Lean Bank 1 & 2",
    channel: "ThePeoplesGarage",
    category: "Lean fuel trim",
    dtc_codes: ["P0171", "P0174"],
    description: "Lean on both banks — reading fuel trims and hunting the vacuum leak.",
  },
  {
    youtube_id: "WN7M0xirtPk",
    title: "Engine Misfire Cylinder 1 [P0301]: Easy Fix That Anyone Could Do At Home",
    channel: "Hunter & Chavy",
    category: "Cylinder misfire",
    dtc_codes: ["P0301"],
    description: "Cylinder-1 misfire fixed at home — the exact DIY path a stranded owner can follow.",
  },
  {
    youtube_id: "RnTZDmZi_ok",
    title: "P0301 Code FIXED: How to Diagnose Cylinder 1 Misfire (Toyota, Ford, Chevy Explained)",
    channel: "Auto V Fix",
    category: "Cylinder misfire",
    dtc_codes: ["P0301"],
    description: "P0301 across Toyota/Ford/Chevy — coil vs plug vs injector decision logic.",
  },
  {
    youtube_id: "DJFrCtigrZU",
    title: "P0410, P0300 Secondary AIR and Random Misfire Diagnosis Pt-2",
    channel: "Schrodingers Box",
    category: "Random misfire",
    dtc_codes: ["P0300", "P0410"],
    description: "Random-misfire + secondary-air diagnosis with a scope — a tougher, multi-code case.",
  },
  {
    youtube_id: "Nyj-P_3UmRU",
    title: "P0011 Code Causes: \"A\" Camshaft Position Timing Over-Advanced Or System Performance (Bank 1)",
    channel: "EasyAutoFix",
    category: "VVT / cam timing",
    dtc_codes: ["P0011"],
    description: "Cam timing over-advanced (VVT) — causes and how to confirm before throwing parts.",
  },
  {
    youtube_id: "fM40jUfPsRA",
    title: "How to Test & Fix P0340 Camshaft Position Sensor Circuit Fault Code | Fix Engine Starting Problem",
    channel: "Automotive Diagnosis: Cars Repair &Training Guides",
    category: "Cam position sensor",
    dtc_codes: ["P0340"],
    description: "P0340 cam-sensor circuit fault causing a no-start — testing and the fix.",
  },
  {
    youtube_id: "yS4To7JoUHk",
    title: "How to Diagnose & Replace Camshaft Sensors (P0340/P0365) on a Dodge Journey or Fiat Freemont",
    channel: "Electrical Car Repair LIVE",
    category: "Cam position sensor",
    dtc_codes: ["P0340", "P0365"],
    description: "Diagnose + replace both cam sensors on a Dodge Journey / Fiat Freemont.",
  },
  {
    youtube_id: "IRSc3uXr1D8",
    title: "How to Find EVAP Leak P0442, P0455 with AutoLine Pro Smoke Machine",
    channel: "TeamDIYNow",
    category: "EVAP leak",
    dtc_codes: ["P0442", "P0455"],
    description: "Finding an EVAP leak with a smoke machine — the satisfying 'smoke shows the leak' moment.",
  },
  {
    youtube_id: "02pqO527ej4",
    title: "P0455 Trouble Code: Evaporative Emission System Leak Detected (The Most Common Causes)",
    channel: "EasyAutoFix",
    category: "EVAP leak",
    dtc_codes: ["P0455"],
    description: "The most common causes of a P0455 large EVAP leak — start with the cheap stuff.",
  },
];
