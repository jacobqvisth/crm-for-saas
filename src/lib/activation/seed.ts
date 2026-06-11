// Default board seeded on a workspace's first visit to /activation. Built from
// the 2026-06-10 touchpoint audit of the Wrenchlane app (codeoc-web-form),
// Customer.io and the backend: everything a user currently experiences after
// signup, plus known gaps marked as "Idea". Fully editable once seeded.
// Day offsets are inclusive, day 0 = signup day. Every item carries a
// source_note stating where the info came from and how trustworthy it is.

import type { ColorToken } from "@/lib/roadmap/colors";

export interface SeedItem {
  title: string;
  description?: string;
  day_start: number;
  day_end: number;
  trigger_type: "day_offset" | "event";
  anchor_event?: string;
  status: "Live" | "Planned" | "Idea" | "Paused";
  /** Provenance: where this info came from and how trustworthy it is. */
  source_note?: string;
}

export interface SeedGroup {
  name: string;
  color: ColorToken;
  items: SeedItem[];
}

export const SEED_BOARD_NAME = "User Activation";

export const SEED_GROUPS: SeedGroup[] = [
  {
    name: "Email (Customer.io)",
    color: "yellow",
    items: [
      {
        title: "Verify your email",
        description: "Cognito verification email at signup. Owned by the backend, not Customer.io.",
        day_start: 0,
        day_end: 0,
        trigger_type: "event",
        anchor_event: "signup",
        status: "Live",
        source_note:
          "Inferred backend behavior: the app proxies /api/verify-email to the backend (codeoc-web-form), so Cognito sends a verification email at signup. That it exists is near-certain; its wording/timing is not visible in any code I can read.",
      },
      {
        title: "Welcome email",
        description: "Customer.io journey triggered on signup. Link the exact campaign via the Customer.io import (PR 2).",
        day_start: 0,
        day_end: 0,
        trigger_type: "event",
        anchor_event: "signup",
        status: "Live",
        source_note:
          "Assumed Customer.io journey: campaign metrics sync hourly into this CRM, but no specific welcome campaign has been verified. Link the campaign on this card to confirm it and see its content.",
      },
      {
        title: "Getting-started tips",
        description: "Day-2 onboarding email: how to run your first diagnosis.",
        day_start: 2,
        day_end: 2,
        trigger_type: "day_offset",
        status: "Planned",
        source_note:
          'Suggested by Claude (2026-06-10 audit) — no verified day-2 email exists. "Planned" was a proposal, not a fact; verify in Customer.io or build it.',
      },
      {
        title: "First-diagnosis nudge",
        description: "If no diagnostic has been run yet: short nudge with a 1-minute video.",
        day_start: 4,
        day_end: 4,
        trigger_type: "day_offset",
        status: "Idea",
        source_note:
          "Suggested by Claude (2026-06-10 audit) — does not exist today. Proposed to close the gap for signups that never run a diagnosis.",
      },
      {
        title: "Upgrade pitch (free → paid)",
        description: "Sent to active free users: what Motor/InfoPro unlock, social proof, pricing link.",
        day_start: 10,
        day_end: 10,
        trigger_type: "day_offset",
        status: "Idea",
        source_note:
          "Suggested by Claude (2026-06-10 audit) — does not exist today. Proposed for active free users.",
      },
      {
        title: "Win-back: inactive 14 days",
        description: "Re-engagement email when a signup goes quiet without activating.",
        day_start: 14,
        day_end: 14,
        trigger_type: "event",
        anchor_event: "inactive_7d",
        status: "Idea",
        source_note:
          "Suggested by Claude (2026-06-10 audit) — does not exist today. Proposed re-engagement for quiet signups.",
      },
    ],
  },
  {
    name: "In-app",
    color: "blue",
    items: [
      {
        title: "Onboarding carousel (5 steps)",
        description: "First-login tutorial: welcome, vehicle selection, AI diagnostics, TSBs/docs, workshop data.",
        day_start: 0,
        day_end: 0,
        trigger_type: "event",
        anchor_event: "signup",
        status: "Live",
        source_note:
          "Verified in app code: codeoc-web-form src/components/onboarding/ — 5-step inline tutorial on first login. Accurate as of 2026-06-10.",
      },
      {
        title: "Get Started dialog",
        description: "Help-menu guide: getting started, diagnostics, service, TSB search, pictures, garage, feedback.",
        day_start: 0,
        day_end: 7,
        trigger_type: "day_offset",
        status: "Live",
        source_note:
          "Verified in app code: codeoc-web-form GetStartedDialog.tsx — help-menu guide with 6 sections. Accurate as of 2026-06-10.",
      },
      {
        title: "Upgrade prompts on gated features",
        description: "Motor, InfoPro, measurements and garage limits render UpgradePrompt for free users.",
        day_start: 0,
        day_end: 30,
        trigger_type: "day_offset",
        status: "Live",
        source_note:
          "Verified in app code: codeoc-web-form shared/UpgradePrompt.tsx — Motor, InfoPro, measurements and garage limits render an upgrade prompt for free-plan users (403 plan_feature_required).",
      },
      {
        title: "Daily quota banners (free plan)",
        description: "3 diagnoses/day + 3 chat messages/day + 10 VRM lookups/day on Free; 429 banner with countdown.",
        day_start: 0,
        day_end: 30,
        trigger_type: "event",
        anchor_event: "quota_hit",
        status: "Live",
        source_note:
          "Verified in app code: codeoc-web-form useSubscription.ts + quotaErrors.ts — Free plan: 3 diagnoses/day, 3 chat messages/day, 10 VRM lookups/day; 429 errors render a countdown banner.",
      },
      {
        title: "InfoPro trial feedback dialog",
        description: "Star rating + comment when closing the InfoPro manual during the trial window.",
        day_start: 3,
        day_end: 3,
        trigger_type: "event",
        status: "Live",
        source_note:
          "Verified in app code: codeoc-web-form InfoProTrialFeedbackDialog.tsx — star rating + comment on closing the InfoPro manual during the trial window; required for free users.",
      },
    ],
  },
  {
    name: "Activation milestones",
    color: "green",
    items: [
      {
        title: "First diagnosis run",
        description: "The core activation event — tracked in dashboard_diagnostics; cohort view on /dashboard/new-users.",
        day_start: 1,
        day_end: 1,
        trigger_type: "event",
        anchor_event: "first_diagnosis",
        status: "Live",
        source_note:
          'Verified data milestone: every diagnosis lands in dashboard_diagnostics (hourly sync); cohort activation is charted on /dashboard/new-users. The "day 1" placement is a typical value, not a rule.',
      },
      {
        title: "First completed diagnostic + invoice",
        description: "Work summary + parts logged, invoice generated.",
        day_start: 3,
        day_end: 3,
        trigger_type: "event",
        anchor_event: "first_completed_diagnostic",
        status: "Live",
        source_note:
          "Verified in app code: codeoc-web-form diagnostics-v2 complete + invoice endpoints (work summary, parts, PDF invoice).",
      },
      {
        title: "Review ask after first success",
        description: "MISSING TODAY — no Google/Trustpilot/App Store review prompt exists in the app. Prime candidate to build.",
        day_start: 5,
        day_end: 5,
        trigger_type: "event",
        anchor_event: "first_completed_diagnostic",
        status: "Idea",
        source_note:
          "Suggested by Claude (2026-06-10 audit) — no review prompt of any kind exists in the app today. Flagged as the biggest quick win.",
      },
    ],
  },
  {
    name: "Billing (Stripe)",
    color: "purple",
    items: [
      {
        title: "Checkout + purchase event",
        description: "Stripe Checkout from the pricing page; begin_checkout + purchase tracked to GA4.",
        day_start: 12,
        day_end: 12,
        trigger_type: "event",
        anchor_event: "first_payment",
        status: "Live",
        source_note:
          "Verified in app code: codeoc-web-form VehicleFirstRouter.tsx confirms the Stripe session on return and fires the GA4 purchase event (deduplicated per session).",
      },
      {
        title: "Trial-end redirect to pricing",
        description: "AuthInterceptor redirects paused/inactive subscriptions to the pricing page with a reason.",
        day_start: 14,
        day_end: 14,
        trigger_type: "event",
        anchor_event: "trial_end",
        status: "Live",
        source_note:
          "Verified in app code: codeoc-web-form AuthInterceptor.tsx redirects paused/inactive subscriptions to the pricing page with a reason (trial_ended / subscription_cancelled).",
      },
    ],
  },
  {
    name: "Manual / CS",
    color: "orange",
    items: [
      {
        title: "Personal check-in from founder",
        description: "Plain-text email to engaged free users: how is it going, what's missing?",
        day_start: 7,
        day_end: 7,
        trigger_type: "day_offset",
        status: "Idea",
        source_note:
          "Suggested by Claude (2026-06-10 audit) — proposed manual touch; nothing automated or scheduled exists.",
      },
    ],
  },
];
