import Stripe from "stripe";
import { secondsSinceEpoch } from "@/lib/ceo/dates";
import { getEnv } from "@/lib/ceo/env";
import { requireSourceEnv } from "../errors";
import {
  loadUserStatsEmailLookupFromS3,
  normalizeEmail,
} from "./user-stats-lookup";
import type {
  MetricPoint,
  PromoGrantRow,
  SourceConnector,
  SourceSyncWindow,
  SubscriptionRow,
} from "../types";

export function unixToIso(value?: number | null) {
  return value ? new Date(value * 1000).toISOString() : null;
}

function monthlyAmountCents(item: Stripe.SubscriptionItem) {
  const price = item.price;
  const amount = Number(price.unit_amount_decimal ?? price.unit_amount ?? 0);
  const quantity = item.quantity ?? 1;
  const interval = price.recurring?.interval ?? "month";
  const multiplier =
    interval === "year"
      ? 1 / 12
      : interval === "week"
        ? 52 / 12
        : interval === "day"
          ? 365 / 12
          : 1;

  return Math.round(amount * quantity * multiplier);
}

export function planName(subscription: Stripe.Subscription) {
  const price = subscription.items.data[0]?.price;
  const product = price?.product;

  if (price?.nickname) return price.nickname;
  if (product && typeof product === "object" && "name" in product) {
    return String(product.name);
  }

  return price?.id ?? "unknown";
}

export function subscriptionPeriod(subscription: Stripe.Subscription) {
  const legacy = subscription as Stripe.Subscription & {
    current_period_start?: number | null;
    current_period_end?: number | null;
  };

  return {
    start: legacy.current_period_start ?? null,
    end: legacy.current_period_end ?? null,
  };
}

export async function listSubscriptions(stripe: Stripe) {
  const subscriptions: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await stripe.subscriptions.list({
      status: "all",
      limit: 100,
      starting_after: startingAfter,
      // Stripe caps expand at 4 levels, and data.items.data.price.product is 5
      // (it errors: "cannot expand more than 4 levels"). We don't need the
      // product expanded — plan_key stays the price id and the dashboard maps
      // price ids → plan tiers (PRICE_ID_TO_PLAN_KEY in calculations.ts).
      //
      // data.discounts must be expanded or `subscription.discounts` comes back
      // as bare ids and the coupon behind a promo grant is unknowable.
      expand: ["data.customer", "data.discounts"],
    });

    subscriptions.push(...page.data);
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return subscriptions;
}

/**
 * Minimal shape we read off a Stripe invoice. The subscription id lives in a
 * couple of different places depending on API version, so we probe all of
 * them. We only treat an invoice as evidence of payment when money actually
 * moved (amount_paid > 0) — $0 trial invoices don't count.
 */
/**
 * Structural shape of a Stripe discount as it appears on a subscription or an
 * invoice. Declared locally rather than leaning on `Stripe.Discount` for the
 * same reason as InvoiceLike: the field moves around between API versions
 * (`discount` singular pre-2025, `discounts` array after), and `promotion_code`
 * is a bare id unless it was expanded.
 */
type CouponLike = {
  id?: string | null;
  name?: string | null;
  percent_off?: number | null;
  amount_off?: number | null;
  currency?: string | null;
  duration?: string | null;
  duration_in_months?: number | null;
};

type DiscountLike = {
  id?: string | null;
  /**
   * Pre-2026 API versions nest the whole coupon here. The SDK's pinned version
   * (2026-04-22.dahlia) does NOT: it moved the reference to `source.coupon` as
   * a bare id and stopped inlining the terms altogether. Both shapes are
   * accepted so the connector survives an API-version bump in either
   * direction — and this is exactly the bug that made the first run of this
   * code write zero grants while reporting success.
   */
  coupon?: string | CouponLike | null;
  source?: {
    coupon?: string | CouponLike | null;
    type?: string | null;
  } | null;
  promotion_code?: string | { id?: string | null; code?: string | null } | null;
  start?: number | null;
  end?: number | null;
};

type InvoiceLike = {
  amount_paid?: number | null;
  status?: string | null;
  created?: number | null;
  currency?: string | null;
  customer?: string | { id?: string | null; email?: string | null } | null;
  customer_email?: string | null;
  discounts?: Array<string | DiscountLike> | null;
  total_discount_amounts?: Array<{
    amount?: number | null;
    discount?: string | DiscountLike | null;
  }> | null;
  status_transitions?: { paid_at?: number | null } | null;
  subscription?: string | { id?: string } | null;
  parent?: {
    subscription_details?: {
      subscription?: string | { id?: string } | null;
    } | null;
  } | null;
  lines?: {
    data?: Array<{ subscription?: string | { id?: string } | null }> | null;
  } | null;
};

function invoiceSubscriptionId(invoice: InvoiceLike): string | null {
  const candidates: Array<string | { id?: string } | null | undefined> = [
    invoice.subscription,
    invoice.parent?.subscription_details?.subscription,
    ...(invoice.lines?.data ?? []).map((line) => line.subscription),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
    if (candidate && typeof candidate === "object" && candidate.id) {
      return candidate.id;
    }
  }

  return null;
}

/**
 * Map of subscription id → earliest ISO timestamp at which it had a paid
 * invoice. A subscription present in this map has paid at least once; the
 * timestamp is its first real payment. Pure so it can be unit-tested.
 */
export function buildPaidInvoiceMap(
  invoices: InvoiceLike[],
): Map<string, string> {
  const firstPaidAt = new Map<string, string>();

  for (const invoice of invoices) {
    if (invoice.status !== "paid" || Number(invoice.amount_paid ?? 0) <= 0) {
      continue;
    }

    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) continue;

    const paidUnix =
      invoice.status_transitions?.paid_at ?? invoice.created ?? null;
    const paidIso = unixToIso(paidUnix);
    if (!paidIso) continue;

    const existing = firstPaidAt.get(subscriptionId);
    if (!existing || paidIso < existing) {
      firstPaidAt.set(subscriptionId, paidIso);
    }
  }

  return firstPaidAt;
}

/**
 * Every invoice, not just the paid ones, with discounts expanded.
 *
 * This used to filter `status: "paid"` because its only consumer was
 * buildPaidInvoiceMap. Promo grants need the discount history too, including
 * invoices that were fully discounted to nothing (a 100%-off coupon produces a
 * paid invoice with amount_paid = 0) and drafts/voids that still record which
 * code was attached. buildPaidInvoiceMap does its own status + amount_paid
 * filtering, so widening the read cannot change what it returns.
 */
async function listInvoices(stripe: Stripe) {
  const invoices: Stripe.Invoice[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await stripe.invoices.list({
      limit: 100,
      starting_after: startingAfter,
      expand: ["data.discounts"],
    });

    invoices.push(...page.data);
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return invoices;
}

/**
 * Coupon terms (percent off, duration) are no longer inlined on a discount as
 * of API version 2026-04-22.dahlia, so they have to be looked up by id. There
 * are a few dozen coupons on the account, so one list call covers everything.
 */
async function listCoupons(stripe: Stripe) {
  const coupons: Stripe.Coupon[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await stripe.coupons.list({
      limit: 100,
      starting_after: startingAfter,
    });

    coupons.push(...page.data);
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return coupons;
}

async function listPromotionCodes(stripe: Stripe) {
  const codes: Stripe.PromotionCode[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await stripe.promotionCodes.list({
      limit: 100,
      starting_after: startingAfter,
    });

    codes.push(...page.data);
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return codes;
}

export type PromoIdentity = {
  email: string | null;
  workshopId: string | null;
  internalUserId: string | null;
};

export type SubscriptionDiscount = {
  subscriptionId: string;
  status: string;
  customerId: string | null;
  currency: string | null;
  discount: DiscountLike;
};

function discountObject(
  value: string | DiscountLike | null | undefined,
  byId: Map<string, DiscountLike>,
): DiscountLike | null {
  if (!value) return null;
  if (typeof value === "string") return byId.get(value) ?? null;
  return value;
}

/** The coupon id behind a discount, across both API shapes. */
function couponIdOf(discount: DiscountLike): string | null {
  const candidates: Array<string | CouponLike | null | undefined> = [
    discount.source?.coupon,
    discount.coupon,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
    if (candidate && typeof candidate === "object" && candidate.id) {
      return candidate.id;
    }
  }

  return null;
}

/**
 * Coupon terms for a discount: inline when the API version still provides them,
 * otherwise looked up by id from the coupons list.
 */
function couponTermsOf(
  discount: DiscountLike,
  couponId: string,
  couponsById: Map<string, CouponLike>,
): CouponLike {
  const inline = [discount.source?.coupon, discount.coupon].find(
    (candidate): candidate is CouponLike =>
      Boolean(candidate) && typeof candidate === "object",
  );

  if (inline && (inline.percent_off != null || inline.amount_off != null)) {
    return inline;
  }

  return couponsById.get(couponId) ?? inline ?? { id: couponId };
}

function promotionCodeOf(
  discount: DiscountLike,
  names: Map<string, string>,
): { id: string | null; code: string | null } {
  const raw = discount.promotion_code;
  if (!raw) return { id: null, code: null };

  if (typeof raw === "string") {
    return { id: raw, code: names.get(raw) ?? null };
  }

  return {
    id: raw.id ?? null,
    code: raw.code ?? (raw.id ? names.get(raw.id) ?? null : null),
  };
}

/**
 * Collapse Stripe's discount records into one row per (customer, coupon).
 *
 * Pure so it can be unit-tested: the caller does the API paging and the
 * customer→workshop/user matching, this only does the folding.
 *
 * Money notes: `total_discount_cents` is summed from the per-discount amounts
 * Stripe already attributes on each invoice, so it is exact. `total_paid_cents`
 * is attributed to the FIRST coupon on an invoice only — an invoice carrying two
 * coupons has no non-arbitrary split, and attributing the full amount to both
 * would double-count real revenue. Every amount stays in the grant's own
 * currency; callers must group by `currency` before summing.
 */
export function buildPromoGrants(params: {
  subscriptionDiscounts: SubscriptionDiscount[];
  invoices: InvoiceLike[];
  promotionCodeNames: Map<string, string>;
  identityByCustomer: Map<string, PromoIdentity>;
  couponsById?: Map<string, CouponLike>;
}): PromoGrantRow[] {
  const {
    subscriptionDiscounts,
    invoices,
    promotionCodeNames,
    identityByCustomer,
    couponsById = new Map<string, CouponLike>(),
  } = params;

  type Accumulator = PromoGrantRow & { codes: Set<string> };
  const grants = new Map<string, Accumulator>();

  const ensure = (
    customerId: string | null,
    discount: DiscountLike,
    fallbackEmail: string | null,
  ) => {
    const couponId = couponIdOf(discount);
    if (!couponId) return null;

    const coupon = couponTermsOf(discount, couponId, couponsById);

    const key = `${customerId ?? "unknown"}:${couponId}`;
    const existing = grants.get(key);
    if (existing) return existing;

    const identity = customerId ? identityByCustomer.get(customerId) : undefined;
    const created: Accumulator = {
      grant_id: key,
      stripe_customer_id: customerId,
      customer_email: identity?.email ?? fallbackEmail,
      workshop_id: identity?.workshopId ?? null,
      internal_user_id: identity?.internalUserId ?? null,
      promotion_code: null,
      promotion_code_id: null,
      coupon_id: couponId,
      coupon_name: coupon?.name ?? null,
      percent_off: coupon?.percent_off ?? null,
      amount_off_cents: coupon?.amount_off ?? null,
      duration: coupon?.duration ?? null,
      duration_in_months: coupon?.duration_in_months ?? null,
      source: "invoice",
      active_on_subscription: false,
      stripe_subscription_id: null,
      subscription_status: null,
      first_applied_at: null,
      last_applied_at: null,
      invoice_count: 0,
      total_discount_cents: 0,
      total_paid_cents: 0,
      currency: coupon?.currency ? coupon.currency.toUpperCase() : null,
      metadata: {},
      codes: new Set<string>(),
    };

    grants.set(key, created);
    return created;
  };

  const stampDate = (grant: Accumulator, iso: string | null) => {
    if (!iso) return;
    if (!grant.first_applied_at || iso < grant.first_applied_at) {
      grant.first_applied_at = iso;
    }
    if (!grant.last_applied_at || iso > grant.last_applied_at) {
      grant.last_applied_at = iso;
    }
  };

  const applyCode = (grant: Accumulator, discount: DiscountLike) => {
    const { id, code } = promotionCodeOf(discount, promotionCodeNames);
    if (code) grant.codes.add(code);
    if (!grant.promotion_code && code) {
      grant.promotion_code = code;
      grant.promotion_code_id = id;
    }
  };

  // ---- live state: discounts attached to a subscription right now ----------
  for (const entry of subscriptionDiscounts) {
    const grant = ensure(entry.customerId, entry.discount, null);
    if (!grant) continue;

    grant.source = "subscription";
    grant.active_on_subscription = true;
    grant.stripe_subscription_id = entry.subscriptionId;
    grant.subscription_status = entry.status;
    if (!grant.currency && entry.currency) {
      grant.currency = entry.currency.toUpperCase();
    }
    applyCode(grant, entry.discount);
    stampDate(grant, unixToIso(entry.discount.start));
  }

  // ---- billed history: what the discounts actually cost --------------------
  for (const invoice of invoices) {
    const byId = new Map<string, DiscountLike>();
    for (const raw of invoice.discounts ?? []) {
      if (typeof raw === "object" && raw?.id) byId.set(raw.id, raw);
    }

    const amounts = invoice.total_discount_amounts ?? [];
    const resolved: Array<{ discount: DiscountLike; amount: number }> = [];

    for (const entry of amounts) {
      const discount = discountObject(entry.discount, byId);
      if (discount) {
        resolved.push({ discount, amount: Number(entry.amount ?? 0) });
      }
    }

    // An invoice can carry a discount with no attributed amount (a 100%-off
    // coupon on an already-zero invoice, or a discount that did not bite in
    // this period). It still evidences the grant, so register it at 0.
    if (resolved.length === 0) {
      for (const raw of invoice.discounts ?? []) {
        const discount = discountObject(raw, byId);
        if (discount) resolved.push({ discount, amount: 0 });
      }
    }

    if (resolved.length === 0) continue;

    const customerId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : (invoice.customer?.id ?? null);
    const invoiceEmail =
      invoice.customer_email ??
      (typeof invoice.customer === "object"
        ? (invoice.customer?.email ?? null)
        : null);
    const createdIso = unixToIso(invoice.created);
    let paidAttributed = false;

    for (const { discount, amount } of resolved) {
      const grant = ensure(customerId, discount, invoiceEmail);
      if (!grant) continue;

      grant.source = grant.active_on_subscription ? "both" : "invoice";
      if (!grant.customer_email && invoiceEmail) {
        grant.customer_email = invoiceEmail;
      }
      if (invoice.currency) grant.currency = invoice.currency.toUpperCase();
      grant.invoice_count += 1;
      grant.total_discount_cents += amount;
      if (!paidAttributed) {
        grant.total_paid_cents += Number(invoice.amount_paid ?? 0);
        paidAttributed = true;
      }
      applyCode(grant, discount);
      stampDate(grant, createdIso);
    }
  }

  return [...grants.values()].map(({ codes, ...grant }) => ({
    ...grant,
    metadata: {
      ...grant.metadata,
      promotion_codes: [...codes].sort(),
    },
  }));
}

function customerWorkshopId(
  customer: Stripe.Customer | Stripe.DeletedCustomer | null,
) {
  if (!customer || customer.deleted) {
    return null;
  }

  return (
    customer.metadata.workshop_id ??
    customer.metadata.internal_workshop_id ??
    null
  );
}

function customerEmail(
  customer: Stripe.Customer | Stripe.DeletedCustomer | null,
) {
  if (!customer || customer.deleted) {
    return null;
  }

  return normalizeEmail(customer.email);
}

function customerCreatedAt(
  customer: Stripe.Customer | Stripe.DeletedCustomer | null,
) {
  if (!customer || customer.deleted) {
    return null;
  }

  return unixToIso(customer.created);
}

export const stripeConnector: SourceConnector = {
  sourceKey: "stripe",
  async fetchMetrics(window: SourceSyncWindow) {
    requireSourceEnv("Stripe", ["STRIPE_SECRET_KEY"]);

    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY")!);
    const [subscriptions, userStatsLookup, invoices, promotionCodes, coupons] =
      await Promise.all([
        listSubscriptions(stripe),
        loadUserStatsEmailLookupFromS3(),
        listInvoices(stripe),
        listPromotionCodes(stripe),
        listCoupons(stripe),
      ]);
    // subscription id → first real payment timestamp. Used to split churn
    // into "paid churn" (made a payment at least once) vs trial-only churn.
    const firstPaidBySubscription = buildPaidInvoiceMap(invoices);
    // Promotion code id → the human code people actually typed (WRENCHLANE90).
    // A discount only carries the id, and the same code string is reused across
    // several coupons over time, so the mapping has to come from the codes list.
    const promotionCodeNames = new Map(
      promotionCodes.map((code) => [code.id, code.code]),
    );
    // Coupon id → terms. Required, not an optimisation: the pinned API version
    // does not inline percent_off/duration on a discount any more.
    const couponsById = new Map<string, CouponLike>(
      coupons.map((coupon) => [coupon.id, coupon]),
    );
    const stripeCustomerIdsByEmail = new Map<string, Set<string>>();

    for (const subscription of subscriptions) {
      const customer =
        typeof subscription.customer === "string" ? null : subscription.customer;
      const email = customerEmail(customer);

      if (!email || !customer || customer.deleted) {
        continue;
      }

      const current = stripeCustomerIdsByEmail.get(email) ?? new Set<string>();
      current.add(customer.id);
      stripeCustomerIdsByEmail.set(email, current);
    }

    let matchedByCoreStripeSubscriptionId = 0;
    let matchedByCoreStripeCustomerId = 0;
    let matchedBySubscriptionMetadata = 0;
    let matchedByCustomerMetadata = 0;
    let matchedByEmail = 0;
    const active = subscriptions.filter((subscription) =>
      ["active", "trialing"].includes(subscription.status),
    );
    const activePaid = subscriptions.filter(
      (subscription) => subscription.status === "active",
    );
    const createdSince = secondsSinceEpoch(window.start);
    const endedBefore = secondsSinceEpoch(window.end);
    const newPaid = activePaid.filter(
      (subscription) =>
        subscription.created >= createdSince &&
        subscription.created < endedBefore,
    );
    const churned = subscriptions.filter(
      (subscription) =>
        subscription.canceled_at &&
        subscription.canceled_at >= createdSince &&
        subscription.canceled_at < endedBefore,
    );
    const mrrCents = active.reduce(
      (sum, subscription) =>
        sum +
        subscription.items.data.reduce(
          (itemSum, item) => itemSum + monthlyAmountCents(item),
          0,
        ),
      0,
    );
    const currency =
      active[0]?.currency?.toUpperCase() ??
      subscriptions[0]?.currency?.toUpperCase() ??
      "USD";
    const planCounts = new Map<string, number>();

    for (const subscription of active) {
      const plan = planName(subscription);
      planCounts.set(plan, (planCounts.get(plan) ?? 0) + 1);
    }

    const metrics: MetricPoint[] = [
      {
        sourceKey: "stripe",
        metricKey: "mrr",
        periodStart: window.start,
        periodEnd: window.end,
        value: mrrCents / 100,
        unit: "currency",
        currency,
      },
      {
        sourceKey: "stripe",
        metricKey: "active_subscriptions",
        periodStart: window.start,
        periodEnd: window.end,
        value: activePaid.length,
      },
      {
        sourceKey: "stripe",
        metricKey: "trialing_subscriptions",
        periodStart: window.start,
        periodEnd: window.end,
        value: active.filter((subscription) => subscription.status === "trialing")
          .length,
      },
      {
        sourceKey: "stripe",
        metricKey: "new_paid_workshops",
        periodStart: window.start,
        periodEnd: window.end,
        value: newPaid.length,
      },
      {
        sourceKey: "stripe",
        metricKey: "churned_subscriptions",
        periodStart: window.start,
        periodEnd: window.end,
        value: churned.length,
      },
      ...[...planCounts.entries()].map(([plan, count]) => ({
        sourceKey: "stripe" as const,
        metricKey: "plan_subscriptions",
        periodStart: window.start,
        periodEnd: window.end,
        value: count,
        dimensions: { plan },
      })),
    ];

    const subscriptionRows: SubscriptionRow[] = subscriptions.map(
      (subscription) => {
        const customer =
          typeof subscription.customer === "string" ? null : subscription.customer;
        const email = customerEmail(customer);
        const customerStripeId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;
        // Prefer the canonical first-party Stripe IDs from user_stats over
        // the email/metadata fallback chain.
        const coreStripeSubscriptionMatch =
          userStatsLookup &&
          !userStatsLookup.ambiguousCoreStripeSubscriptionIds.has(subscription.id)
            ? userStatsLookup.byCoreStripeSubscriptionId.get(subscription.id) ?? null
            : null;
        const coreStripeCustomerMatch =
          !coreStripeSubscriptionMatch &&
          userStatsLookup &&
          customerStripeId &&
          !userStatsLookup.ambiguousCoreStripeCustomerIds.has(customerStripeId)
            ? userStatsLookup.byCoreStripeCustomerId.get(customerStripeId) ?? null
            : null;
        const idIdentity = coreStripeSubscriptionMatch ?? coreStripeCustomerMatch;
        const emailIdentity =
          !idIdentity && email && userStatsLookup
            ? userStatsLookup.byEmail.get(email)
            : null;
        const emailCanMatch =
          Boolean(emailIdentity) &&
          Boolean(email) &&
          (stripeCustomerIdsByEmail.get(email!)?.size ?? 0) === 1;
        const subscriptionMetadataWorkshopId =
          subscription.metadata.workshop_id ??
          subscription.metadata.internal_workshop_id;
        const customerMetadataWorkshopId = customerWorkshopId(customer);
        const workshopId =
          idIdentity?.workshopId ??
          subscriptionMetadataWorkshopId ??
          customerMetadataWorkshopId ??
          (emailCanMatch ? emailIdentity?.workshopId ?? null : null);
        const matchedInternalUserId =
          idIdentity?.internalUserId ??
          (emailCanMatch ? emailIdentity?.internalUserId ?? null : null);
        const workshopMatchSource = coreStripeSubscriptionMatch
          ? "core_stripe_subscription_id"
          : coreStripeCustomerMatch
            ? "core_stripe_customer_id"
            : subscriptionMetadataWorkshopId
              ? "subscription_metadata"
              : customerMetadataWorkshopId
                ? "customer_metadata"
                : emailCanMatch
                  ? "customer_email"
                  : null;

        if (workshopMatchSource === "core_stripe_subscription_id") {
          matchedByCoreStripeSubscriptionId += 1;
        } else if (workshopMatchSource === "core_stripe_customer_id") {
          matchedByCoreStripeCustomerId += 1;
        } else if (workshopMatchSource === "subscription_metadata") {
          matchedBySubscriptionMetadata += 1;
        } else if (workshopMatchSource === "customer_metadata") {
          matchedByCustomerMetadata += 1;
        } else if (workshopMatchSource === "customer_email") {
          matchedByEmail += 1;
        }
        const period = subscriptionPeriod(subscription);
        const firstPaidAt =
          firstPaidBySubscription.get(subscription.id) ?? null;

        return {
          stripe_subscription_id: subscription.id,
          workshop_id: workshopId,
          stripe_customer_id:
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer.id,
          status: subscription.status,
          plan_key: planName(subscription),
          mrr_amount_cents: subscription.items.data.reduce(
            (sum, item) => sum + monthlyAmountCents(item),
            0,
          ),
          currency: subscription.currency.toUpperCase(),
          current_period_start: unixToIso(period.start),
          current_period_end: unixToIso(period.end),
          trial_end: unixToIso(subscription.trial_end),
          cancel_at: unixToIso(subscription.cancel_at),
          canceled_at: unixToIso(subscription.canceled_at),
          metadata: {
            ...subscription.metadata,
            customer_created_at: customerCreatedAt(customer),
            customer_email: email,
            customer_metadata_workshop_id: customerMetadataWorkshopId,
            matched_internal_user_id: matchedInternalUserId,
            workshop_match_source: workshopMatchSource,
            // Payment history: present + timestamped only when this
            // subscription has had at least one paid (amount_paid > 0) invoice.
            ever_paid: firstPaidAt !== null,
            first_paid_at: firstPaidAt,
          },
        };
      },
    );

    // Promo grants reuse the customer→workshop/user matching that the
    // subscription rows above already resolved, so a discounted customer lands
    // on the same workshop the rest of the dashboard knows them by.
    const identityByCustomer = new Map<string, PromoIdentity>();
    for (const row of subscriptionRows) {
      if (!row.stripe_customer_id) continue;

      const previous = identityByCustomer.get(row.stripe_customer_id);
      const email = (row.metadata.customer_email as string | null) ?? null;
      const internalUserId =
        (row.metadata.matched_internal_user_id as string | null) ?? null;

      identityByCustomer.set(row.stripe_customer_id, {
        email: email ?? previous?.email ?? null,
        workshopId: row.workshop_id ?? previous?.workshopId ?? null,
        internalUserId: internalUserId ?? previous?.internalUserId ?? null,
      });
    }

    const subscriptionDiscounts: SubscriptionDiscount[] = [];
    for (const subscription of subscriptions) {
      const raw =
        (subscription as unknown as {
          discounts?: Array<string | DiscountLike> | null;
        }).discounts ?? [];

      for (const discount of raw) {
        if (typeof discount !== "object" || !discount) continue;
        if (!couponIdOf(discount)) continue;

        subscriptionDiscounts.push({
          subscriptionId: subscription.id,
          status: subscription.status,
          customerId:
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer.id,
          currency: subscription.currency,
          discount,
        });
      }
    }

    const promoGrants = buildPromoGrants({
      subscriptionDiscounts,
      invoices,
      promotionCodeNames,
      identityByCustomer,
      couponsById,
    });

    return {
      sourceKey: "stripe",
      rowsRead: subscriptions.length,
      metrics,
      subscriptions: subscriptionRows,
      promoGrants,
      rawRows: subscriptions.map((subscription) => ({
        sourceKey: "stripe",
        externalId: subscription.id,
        periodStart: window.start,
        periodEnd: window.end,
        payload: subscription as unknown as Record<string, unknown>,
      })),
      metadata: {
        active: active.length,
        currency,
        paid_subscriptions: firstPaidBySubscription.size,
        promo_grants: promoGrants.length,
        promo_customers: new Set(
          promoGrants.map((grant) => grant.stripe_customer_id),
        ).size,
        matched_by_core_stripe_customer_id: matchedByCoreStripeCustomerId,
        matched_by_core_stripe_subscription_id:
          matchedByCoreStripeSubscriptionId,
        matched_by_customer_metadata: matchedByCustomerMetadata,
        matched_by_email: matchedByEmail,
        matched_by_subscription_metadata: matchedBySubscriptionMetadata,
      },
    };
  },
};
