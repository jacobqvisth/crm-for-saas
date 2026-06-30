// Call-planner "playbooks" — the named segments of app users worth calling.
//
// Each playbook is either:
//  - a dynamic segment expressed purely as `contacts` filters (reuses the same
//    filter engine as smart lists, so a created list rolls forward daily), or
//  - a "special" segment that needs data not on `contacts` (e.g. raw Stripe
//    status from dashboard_subscriptions), resolved server-side into a static
//    snapshot list at creation time.
//
// The same contact can match many playbooks — that's fine. Dedup happens at
// call time (logging a call bumps last_contacted_at), not here.

import type { ListFilter } from "@/lib/lists/filter-query";

export type PlaybookTone = "danger" | "warn" | "good" | "info";

export interface Playbook {
  key: string;
  /** Card title. */
  label: string;
  /** One-liner shown on the card. */
  hint: string;
  /** Why this segment is worth a call — shown in the card body. */
  rationale: string;
  tone: PlaybookTone;
  /** lucide-react icon name (resolved in the client). */
  icon: string;
  /** Default name for the call list this playbook creates. */
  listName: string;
  /**
   * Pure-`contacts` filters. Present for dynamic playbooks. Omitted for
   * `special` playbooks, which the API resolves a different way.
   */
  filters?: ListFilter[];
  /**
   * Special resolver key. Currently only "payment_bounced", which joins
   * dashboard_subscriptions. Special playbooks create static (snapshot) lists.
   */
  special?: "payment_bounced";
}

export const PLAYBOOKS: Playbook[] = [
  {
    key: "payment_bounced",
    label: "Payment bounced",
    hint: "Stripe subscription past-due / unpaid",
    rationale:
      "An active customer whose latest payment failed. A quick call recovers revenue before the subscription is cancelled involuntarily.",
    tone: "danger",
    icon: "CreditCard",
    listName: "Payment bounced",
    special: "payment_bounced",
  },
  {
    key: "trialing_now",
    label: "Trialing now",
    hint: "Paid-plan trial in progress",
    rationale:
      "Currently trialing a paid plan. Call before the trial lapses to answer questions and convert them.",
    tone: "warn",
    icon: "Clock",
    listName: "Trialing now",
    filters: [{ field: "user_subscription_status", operator: "equals", value: "trialing" }],
  },
  {
    key: "trial_ended",
    label: "Trial just ended",
    hint: "Signed up ~14d ago, still on Free",
    rationale:
      "Signed up 13–17 days ago and still on Free — the trial window just closed without converting. Best moment to win them back.",
    tone: "warn",
    icon: "TimerOff",
    listName: "Trial just ended",
    filters: [
      { field: "signed_up_at", operator: "older_than_days", value: 13 },
      { field: "signed_up_at", operator: "within_last_days", value: 17 },
      { field: "user_plan_type", operator: "equals", value: "free" },
    ],
  },
  {
    key: "recently_canceled",
    label: "Recently canceled",
    hint: "Subscription canceled",
    rationale:
      "Cancelled their subscription. A win-back call surfaces the reason and often recovers the account.",
    tone: "warn",
    icon: "UserX",
    listName: "Recently canceled",
    filters: [{ field: "user_subscription_status", operator: "equals", value: "canceled" }],
  },
  {
    key: "engaged_free",
    label: "Engaged free users",
    hint: "Free plan, ≥3 diagnoses",
    rationale:
      "Free-plan users getting real value (3+ diagnoses) but not paying yet. Prime upsell conversation.",
    tone: "good",
    icon: "Sparkles",
    listName: "Engaged free users",
    filters: [
      { field: "user_plan_type", operator: "equals", value: "free" },
      { field: "diagnostics_total", operator: "gte", value: 3 },
    ],
  },
  {
    key: "low_credits",
    label: "Low on credits",
    hint: "Free plan, ≤2 credits left",
    rationale:
      "Free users almost out of credits — they hit the wall soon. A timely call turns the paywall into an upgrade.",
    tone: "info",
    icon: "BatteryLow",
    listName: "Low on credits",
    filters: [
      { field: "user_plan_type", operator: "equals", value: "free" },
      { field: "credits_remaining", operator: "lte", value: 2 },
    ],
  },
  {
    key: "free_too_long",
    label: "On Free 30+ days",
    hint: "Free plan, signed up 30+ days ago",
    rationale:
      "Long-time free users who never upgraded. Worth a call to understand the blocker and pitch a plan.",
    tone: "info",
    icon: "Hourglass",
    listName: "On Free 30+ days",
    filters: [
      { field: "user_plan_type", operator: "equals", value: "free" },
      { field: "signed_up_at", operator: "older_than_days", value: 30 },
    ],
  },
  {
    key: "gone_quiet",
    label: "Gone quiet",
    hint: "Used the app, inactive 14+ days",
    rationale:
      "Free users who logged in at least twice but have been silent for 14+ days. Re-engage before they churn for good.",
    tone: "warn",
    icon: "Moon",
    listName: "Gone quiet",
    filters: [
      { field: "user_plan_type", operator: "equals", value: "free" },
      { field: "login_count", operator: "gte", value: 2 },
      { field: "last_active_at", operator: "older_than_days", value: 14 },
    ],
  },
  {
    key: "churn_risk_paid",
    label: "Paying but quiet",
    hint: "Paid plan, inactive 21+ days",
    rationale:
      "Paying customers who've gone quiet for 21+ days — at risk of cancelling at renewal. Proactive check-in saves the account.",
    tone: "warn",
    icon: "AlertTriangle",
    listName: "Paying but quiet",
    filters: [
      { field: "user_subscription_status", operator: "equals", value: "active" },
      { field: "last_active_at", operator: "older_than_days", value: 21 },
    ],
  },
  {
    key: "new_signups",
    label: "New signups",
    hint: "Signed up in the last 7 days",
    rationale:
      "Brand-new app users. An onboarding call gets them to first value fast and sets the relationship.",
    tone: "good",
    icon: "UserPlus",
    listName: "New signups (7 days)",
    filters: [{ field: "signed_up_at", operator: "within_last_days", value: 7 }],
  },
  {
    key: "never_activated",
    label: "Never activated",
    hint: "Signed up, zero diagnoses",
    rationale:
      "Signed up more than 3 days ago but never ran a single diagnosis. A nudge call can rescue a stalled activation.",
    tone: "info",
    icon: "PlugZap",
    listName: "Never activated",
    filters: [
      { field: "signed_up_at", operator: "older_than_days", value: 3 },
      { field: "diagnostics_total", operator: "equals", value: 0 },
    ],
  },
  {
    key: "paying_checkin",
    label: "Paying check-in",
    hint: "Active subscription",
    rationale:
      "Healthy paying customers. Regular check-ins protect retention and open expansion and referral conversations.",
    tone: "good",
    icon: "HeartHandshake",
    listName: "Paying customers check-in",
    filters: [{ field: "user_subscription_status", operator: "equals", value: "active" }],
  },
];

export function getPlaybook(key: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.key === key);
}

/** Stripe statuses that count as a bounced/failed payment. */
export const BOUNCED_SUB_STATUSES = ["past_due", "unpaid", "incomplete", "incomplete_expired"];
