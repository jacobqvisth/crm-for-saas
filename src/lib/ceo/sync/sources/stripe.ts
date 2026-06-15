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
      // Expand the price's product so planName() resolves a human-readable
      // product name instead of falling back to the raw price id.
      expand: ["data.customer", "data.items.data.price.product"],
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
type InvoiceLike = {
  amount_paid?: number | null;
  status?: string | null;
  created?: number | null;
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

async function listPaidInvoices(stripe: Stripe) {
  const invoices: Stripe.Invoice[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await stripe.invoices.list({
      status: "paid",
      limit: 100,
      starting_after: startingAfter,
    });

    invoices.push(...page.data);
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return invoices;
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
    const [subscriptions, userStatsLookup, paidInvoices] = await Promise.all([
      listSubscriptions(stripe),
      loadUserStatsEmailLookupFromS3(),
      listPaidInvoices(stripe),
    ]);
    // subscription id → first real payment timestamp. Used to split churn
    // into "paid churn" (made a payment at least once) vs trial-only churn.
    const firstPaidBySubscription = buildPaidInvoiceMap(paidInvoices);
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

    return {
      sourceKey: "stripe",
      rowsRead: subscriptions.length,
      metrics,
      subscriptions: subscriptionRows,
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
