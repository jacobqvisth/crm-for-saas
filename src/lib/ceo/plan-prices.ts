// Stripe price id -> core-app plan tier, and the labels for both.
//
// This lived inline in metrics/calculations.ts until the Trial Users page
// needed the same mapping. Two copies of a hand-maintained price table is
// exactly the kind of thing that drifts silently: the copy in calculations.ts
// was already missing `price_1TTojNACX27zeuSMmBC419FD` (the One yearly price,
// seven live subscriptions), so those rows resolved to the workshop's current
// plan_key — which reads "free" once the subscription is canceled — and were
// labelled "unknown".
//
// Stripe has legacy duplicate prices per tier, so several ids map to one key.
// New subscriptions resolve their human name from the expanded product (see
// stripe.ts planName); this table only has to cover the historical price-id
// rows already sitting in dashboard_subscriptions.

export const PRICE_ID_TO_PLAN_KEY: Record<string, string> = {
  price_1TToj1ACX27zeuSMhRcYIAxa: "one_monthly",
  price_1TTojNACX27zeuSMmBC419FD: "one_yearly",
  price_1SG4zaACX27zeuSMaMCnWgPE: "small_monthly",
  price_1R3mE9ACX27zeuSMo0cj8JVt: "small_monthly",
  price_1SG50OACX27zeuSMQL37gjYY: "small_yearly",
  price_1RYNy4ACX27zeuSMeDeO98Sp: "small_yearly",
  price_1SG526ACX27zeuSM2slFf17x: "large_monthly",
  price_1R3mE2ACX27zeuSMzci4kmXy: "large_monthly",
  price_1RYNzfACX27zeuSM5DA97UTO: "large_yearly",
};

export const PLAN_KEY_LABELS: Record<string, string> = {
  free: "Free",
  one_monthly: "One · Monthly",
  one_yearly: "One · Yearly",
  small_monthly: "Small · Monthly",
  small_yearly: "Small · Yearly",
  large_monthly: "Large · Monthly",
  large_yearly: "Large · Yearly",
};

/** The three paid tiers, cheapest first. Yearly and monthly collapse into one. */
export const PLAN_TIERS = ["one", "small", "large"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const PLAN_TIER_LABELS: Record<PlanTier, string> = {
  one: "One",
  small: "Small",
  large: "Large",
};

/**
 * Resolve a subscription's plan key from its stored `plan_key`, which is a
 * Stripe PRICE ID on historical rows and a plan name on newer ones. Returns
 * null when the id is genuinely unrecognised, so callers can surface that
 * rather than quietly mislabel a tier.
 */
export function planKeyFromPrice(raw: string | null): string | null {
  if (!raw) return null;
  if (PRICE_ID_TO_PLAN_KEY[raw]) return PRICE_ID_TO_PLAN_KEY[raw];
  if (!raw.startsWith("price_")) return raw;
  return null;
}

/** "small_yearly" -> "small". Null for free and for anything unrecognised. */
export function tierOfPlanKey(planKey: string | null): PlanTier | null {
  if (!planKey) return null;
  const head = planKey.split("_")[0] as PlanTier;
  return PLAN_TIERS.includes(head) ? head : null;
}

/** "small_yearly" -> "yearly". Null when the key carries no interval. */
export function intervalOfPlanKey(planKey: string | null): string | null {
  if (!planKey) return null;
  const tail = planKey.split("_")[1];
  return tail === "monthly" || tail === "yearly" ? tail : null;
}

export function planKeyLabel(planKey: string | null): string {
  if (!planKey) return "Unknown";
  if (PLAN_KEY_LABELS[planKey]) return PLAN_KEY_LABELS[planKey];
  const resolved = planKeyFromPrice(planKey);
  if (resolved && PLAN_KEY_LABELS[resolved]) return PLAN_KEY_LABELS[resolved];
  return planKey;
}
