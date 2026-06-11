// Default journey scenarios for the activation plan, lazily seeded per plan
// when it has none (see /api/activation GET). Existing touchpoints are tagged
// by exact title match against the original seed (src/lib/activation/seed.ts);
// touchpoints a journey needs that don't exist yet are created (EXTRA_ITEMS).
// Everything is editable afterwards — item membership lives in
// activation_plan_items.scenario_ids and is edited in the detail panel.
//
// Deleting every scenario on a plan resets it to these defaults on next load.

import type { ColorToken } from "@/lib/roadmap/colors";

export interface SeedScenario {
  /** Stable key used only to wire title→scenario membership at seed time. */
  key: string;
  name: string;
  description: string;
  color: ColorToken;
  /** Item titles (seed titles or EXTRA_ITEMS titles) that make up this journey. */
  itemTitles: string[];
}

/** Touchpoints required by the journeys that aren't in the original seed. */
export interface SeedExtraItem {
  title: string;
  description: string;
  groupName: string; // matched against existing swimlane names; skipped if absent
  day_start: number;
  day_end: number;
  trigger_type: "day_offset" | "event";
  anchor_event?: string;
  status: "Live" | "Planned" | "Idea" | "Paused";
}

export const EXTRA_ITEMS: SeedExtraItem[] = [
  {
    title: "Checkout started (begin_checkout)",
    description:
      "User clicks upgrade on the pricing page and lands in Stripe Checkout — begin_checkout fires to GA4.",
    groupName: "Billing (Stripe)",
    day_start: 10,
    day_end: 10,
    trigger_type: "event",
    anchor_event: "begin_checkout",
    status: "Live",
  },
  {
    title: "Abandoned-checkout recovery email",
    description:
      "MISSING TODAY — Customer.io email when begin_checkout fires but no purchase follows within ~2h: answer objections, link straight back to checkout.",
    groupName: "Email (Customer.io)",
    day_start: 11,
    day_end: 11,
    trigger_type: "event",
    anchor_event: "checkout_abandoned",
    status: "Idea",
  },
  {
    title: "Trial-ending reminder email",
    description:
      "MISSING TODAY — heads-up 2 days before the trial converts/expires: what they'll lose, one-click to pick a plan.",
    groupName: "Email (Customer.io)",
    day_start: 12,
    day_end: 12,
    trigger_type: "event",
    anchor_event: "trial_end",
    status: "Idea",
  },
];

export const SEED_SCENARIOS: SeedScenario[] = [
  {
    key: "happy-path",
    name: "Happy path: free → paying",
    description:
      "The journey we want for everyone: signs up, onboards, runs a first diagnosis the same week, sees the upgrade pitch and converts — then gets asked for a review.",
    color: "green",
    itemTitles: [
      "Verify your email",
      "Welcome email",
      "Onboarding carousel (5 steps)",
      "Getting-started tips",
      "First diagnosis run",
      "First completed diagnostic + invoice",
      "Upgrade pitch (free → paid)",
      "Checkout started (begin_checkout)",
      "Checkout + purchase event",
      "Review ask after first success",
    ],
  },
  {
    key: "abandoned-checkout",
    name: "Abandoned checkout",
    description:
      "Signs up free, later decides to upgrade but leaves Stripe Checkout without paying — the recovery email brings them back to finish the purchase.",
    color: "orange",
    itemTitles: [
      "Verify your email",
      "Welcome email",
      "Upgrade prompts on gated features",
      "Upgrade pitch (free → paid)",
      "Checkout started (begin_checkout)",
      "Abandoned-checkout recovery email",
      "Checkout + purchase event",
    ],
  },
  {
    key: "never-activates",
    name: "Signs up, never activates",
    description:
      "Creates an account but never runs a diagnosis. Everything here is about getting them to the first 'aha' — or learning why they bounced.",
    color: "red",
    itemTitles: [
      "Verify your email",
      "Welcome email",
      "Onboarding carousel (5 steps)",
      "Getting-started tips",
      "First-diagnosis nudge",
      "Win-back: inactive 14 days",
      "Personal check-in from founder",
    ],
  },
  {
    key: "power-free",
    name: "Power free user hits limits",
    description:
      "Active free user who keeps bumping into the 3/day quotas and gated features — the highest-intent upgrade segment we have.",
    color: "blue",
    itemTitles: [
      "Onboarding carousel (5 steps)",
      "First diagnosis run",
      "Daily quota banners (free plan)",
      "Upgrade prompts on gated features",
      "Upgrade pitch (free → paid)",
      "Checkout started (begin_checkout)",
      "Checkout + purchase event",
    ],
  },
  {
    key: "trial-no-convert",
    name: "Trial ends without converting",
    description:
      "Trialed the product but lets the trial lapse: reminder before it ends, the pricing redirect when it does, then win-back and a personal note.",
    color: "purple",
    itemTitles: [
      "Welcome email",
      "InfoPro trial feedback dialog",
      "Trial-ending reminder email",
      "Trial-end redirect to pricing",
      "Win-back: inactive 14 days",
      "Personal check-in from founder",
    ],
  },
  {
    key: "advocate",
    name: "Paying user → advocate",
    description:
      "Already paying and successful — turn them into reviews and referrals while the value is fresh.",
    color: "teal",
    itemTitles: [
      "Checkout + purchase event",
      "First completed diagnostic + invoice",
      "Review ask after first success",
      "Personal check-in from founder",
    ],
  },
];
