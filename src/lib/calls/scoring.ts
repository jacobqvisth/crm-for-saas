// Relevance scoring for the Call Planner ("who should we call today").
//
// This is a pure, deterministic, fully-explainable model: given a contact's
// app-usage snapshot (the wl_* fields synced onto `contacts`) plus a couple of
// derived flags, it returns a numeric score and a list of human-readable
// reasons. The reasons are what the UI shows ("why is this person hot today")
// — the score only exists to rank.
//
// No data fetching here so it can be unit-tested in isolation. The API route
// is responsible for loading candidates and the payment-issue set, then calling
// scoreContact() on each.

export type ReasonTone = "danger" | "warn" | "good" | "info";

export interface ScoreReason {
  /** Short label shown as a chip, e.g. "Trial just closed". */
  label: string;
  tone: ReasonTone;
  /** Points this signal contributed — used to order the chips. */
  weight: number;
}

/** The subset of contact fields the scorer reads. */
export interface ScoreableContact {
  user_plan_type: string | null;
  user_subscription_status: string | null;
  signed_up_at: string | null;
  diagnostics_total: number | null;
  diagnostics_last_30d: number | null;
  login_count: number | null;
  last_active_at: string | null;
  credits_remaining: number | null;
  last_contacted_at: string | null;
  /** True when this contact's Stripe subscription is past_due / unpaid / etc. */
  paymentIssue?: boolean;
}

export interface ScoreResult {
  score: number;
  reasons: ScoreReason[];
  /** Coarse bucket for the UI badge. */
  priority: "high" | "medium" | "low";
}

const PAID_PLANS = new Set([
  "one_monthly",
  "small_monthly",
  "small_yearly",
  "large_monthly",
  "large_yearly",
]);

function daysBetween(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

/**
 * Score one contact for call-relevance.
 *
 * @param c   the contact's app snapshot
 * @param now epoch millis "now" — injectable so tests are deterministic
 */
export function scoreContact(c: ScoreableContact, now: number = Date.now()): ScoreResult {
  const reasons: ScoreReason[] = [];
  const add = (label: string, tone: ReasonTone, weight: number) => {
    reasons.push({ label, tone, weight });
  };

  const plan = c.user_plan_type ?? null;
  const sub = c.user_subscription_status ?? null;
  const isFree = plan === "free" || plan == null;
  const isPaid = plan != null && PAID_PLANS.has(plan);

  const total = c.diagnostics_total ?? 0;
  const d30 = c.diagnostics_last_30d ?? 0;
  const logins = c.login_count ?? 0;
  const credits = c.credits_remaining;

  const daysSinceSignup = daysBetween(c.signed_up_at, now);
  const daysSinceActive = daysBetween(c.last_active_at, now);
  const daysSinceContacted = daysBetween(c.last_contacted_at, now);

  const wasEngaged = total >= 3 || logins >= 3;

  // ---- Strong lifecycle triggers (the "why now") -------------------------
  let trialEnded = false;

  if (c.paymentIssue) {
    add("Payment failed — save before involuntary churn", "danger", 55);
  }

  if (sub === "trialing") {
    add("On a paid trial — convert before it lapses", "warn", 45);
  } else if (sub === "canceled" && daysSinceActive != null && daysSinceActive <= 45) {
    add("Recently canceled — win-back", "warn", 40);
  }

  if (
    isFree &&
    daysSinceSignup != null &&
    daysSinceSignup >= 12 &&
    daysSinceSignup <= 21 &&
    total >= 1
  ) {
    trialEnded = true;
    add("Trial window just closed without upgrading", "warn", 38);
  }

  if (daysSinceSignup != null && daysSinceSignup <= 7 && total >= 1) {
    add("New & already using it — onboard them", "good", 22);
  } else if (daysSinceSignup != null && daysSinceSignup <= 3) {
    add("Brand-new signup", "info", 14);
  }

  if (daysSinceSignup != null && daysSinceSignup > 3 && total === 0) {
    add("Signed up but never ran a diagnosis", "info", 18);
  }

  // ---- Engagement / warmth ----------------------------------------------
  if (d30 > 0) {
    add(`Active: ${d30} ${d30 === 1 ? "diagnosis" : "diagnoses"} in 30d`, "good", Math.min(d30 * 4, 24));
  }
  if (isFree && total >= 3) {
    add("Getting value on Free — upsell moment", "good", 16);
  }
  if (total >= 10) {
    add(`Power user (${total} diagnoses)`, "good", 8);
  }
  if (logins >= 5) {
    add("Frequent logins", "info", 5);
  }

  // ---- Churn-risk save ---------------------------------------------------
  if (!trialEnded && wasEngaged && daysSinceActive != null && daysSinceActive >= 14) {
    if (isPaid) {
      add(`Paying but quiet — inactive ${daysSinceActive}d`, "warn", 24);
    } else {
      add(`Gone quiet — was engaged, inactive ${daysSinceActive}d`, "warn", 20);
    }
  }

  // ---- Upsell timing -----------------------------------------------------
  if (isFree && credits != null && credits <= 2) {
    add("Low on credits — natural upgrade nudge", "info", 12);
  }

  // ---- Value (paid retention) -------------------------------------------
  if (isPaid && sub !== "canceled") {
    add("Paying customer — retention check-in", "good", 10);
  }

  // ---- Recency penalty (contacted recently but not in the 7d hard cut) ---
  if (daysSinceContacted != null && daysSinceContacted <= 30) {
    add(`Called ${daysSinceContacted}d ago`, "info", -8);
  }

  const score = reasons.reduce((s, r) => s + r.weight, 0);
  reasons.sort((a, b) => b.weight - a.weight);

  const priority: ScoreResult["priority"] = score >= 45 ? "high" : score >= 22 ? "medium" : "low";

  return { score, reasons, priority };
}

/**
 * Whether a contact is "fresh" enough to appear on today's list.
 * Anyone contacted within the cutoff is assumed already worked and is hidden,
 * so the next day surfaces a fresh batch. This is the dedup that makes the
 * daily list roll forward.
 */
export function isFreshToCall(
  c: Pick<ScoreableContact, "last_contacted_at">,
  now: number = Date.now(),
  cutoffDays = 7,
): boolean {
  const d = daysBetween(c.last_contacted_at, now);
  return d == null || d > cutoffDays;
}
