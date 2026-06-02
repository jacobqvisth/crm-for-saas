// Default board seeded on a workspace's first visit to /roadmap. Recreates
// the "WL Marketing — Project timeline" board from the design screenshots so
// the page looks alive immediately. Everything here is fully editable/deletable
// once seeded. Dates are inclusive (YYYY-MM-DD).

import type { ColorToken } from "./colors";

export interface SeedItem {
  title: string;
  start_date: string;
  end_date: string;
}

export interface SeedGroup {
  name: string;
  color: ColorToken;
  items: SeedItem[];
}

export const SEED_BOARD_NAME = "WL Marketing";

export const SEED_GROUPS: SeedGroup[] = [
  {
    name: "Email",
    color: "yellow",
    items: [
      { title: "🇸🇪 Sweden, United Kingdom, Czechia, Estland", start_date: "2026-06-01", end_date: "2026-06-28" },
      { title: "🇳🇴 Norway, Finland, Denmark", start_date: "2026-06-05", end_date: "2026-07-20" },
      { title: "Set up New Domains for Large Countris like; France, germany, Italy, Spain, Greece, Turkey", start_date: "2026-06-12", end_date: "2026-07-25" },
      { title: "Email Campaign rest of Europe", start_date: "2026-07-01", end_date: "2026-09-15" },
    ],
  },
  {
    name: "Ads",
    color: "green",
    items: [
      { title: "🦣 Google Max Campaign - UK, SE, NO, FI, DK, EE, LT, LI, BE, UAE, NL, IE, BG, RO, etc.", start_date: "2026-05-15", end_date: "2026-07-05" },
      { title: "🇩🇪 In German Language", start_date: "2026-06-15", end_date: "2026-07-25" },
      { title: "🇫🇷 French Language", start_date: "2026-06-25", end_date: "2026-08-05" },
      { title: "🇮🇹 Italien Language", start_date: "2026-07-01", end_date: "2026-08-12" },
      { title: "🇪🇸 Spain Language", start_date: "2026-07-08", end_date: "2026-08-20" },
    ],
  },
  {
    name: "Social Media",
    color: "blue",
    items: [
      { title: "✳️ Official - Wrenchlane account", start_date: "2026-06-08", end_date: "2026-07-15" },
      { title: "🌟 influencers - Isabel Lauda", start_date: "2026-06-20", end_date: "2026-07-20" },
      { title: "💡 influencers - Bosse Bildoktorn", start_date: "2026-06-20", end_date: "2026-07-22" },
      { title: "Tiktok", start_date: "2026-07-01", end_date: "2026-08-01" },
      { title: "Whatsapp", start_date: "2026-07-01", end_date: "2026-08-01" },
      { title: "Youtube", start_date: "2026-07-05", end_date: "2026-08-10" },
    ],
  },
  {
    name: "Reaction videos",
    color: "orange",
    items: [
      { title: "Reach out car influencers degree and react out videos and react out", start_date: "2026-06-15", end_date: "2026-07-30" },
    ],
  },
  {
    name: "Reviews",
    color: "red",
    items: [
      { title: "Google Review", start_date: "2026-06-10", end_date: "2026-07-10" },
      { title: "Trustpilot", start_date: "2026-06-15", end_date: "2026-07-15" },
      { title: "G2, Capterra, Getapp, Softwareadvice, Trustific", start_date: "2026-06-20", end_date: "2026-07-25" },
    ],
  },
  {
    name: "Lifecycle",
    color: "purple",
    items: [
      { title: "Communication to Users", start_date: "2026-06-05", end_date: "2026-06-20" },
      { title: "Activation", start_date: "2026-06-10", end_date: "2026-08-15" },
    ],
  },
];
