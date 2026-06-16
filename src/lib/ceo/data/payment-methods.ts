import { unstable_cache } from "next/cache";
import Stripe from "stripe";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { getEnv } from "@/lib/ceo/env";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { pageAll } from "@/lib/supabase-paging";
import { TABLES } from "@/lib/ceo/tables";

export type LabeledCount = { label: string; count: number };

export type PaymentMethodsData = {
  generatedAtIso: string;

  // --- Live Stripe: customers ---
  stripeAvailable: boolean;
  totalCustomers: number;
  // Customers that currently have a payment method attached (card/SEPA/etc.)
  // OR a legacy default source — i.e. a real "card on file" right now.
  customersWithPaymentMethod: number;
  // Customers whose invoice_settings.default_payment_method is set.
  customersWithDefaultPm: number;
  pctWithPaymentMethod: number;
  // Mix of attached payment-method types/brands (one row per attached method).
  methodMix: LabeledCount[];

  // --- Live Stripe: subscriptions ---
  subscriptionsTotal: number;
  subscriptionsByStatus: LabeledCount[];
  // Subscriptions that reference a default payment method. Counts historical
  // attachments too — the PM may since have been detached, so this is the
  // "ever added a card" upper bound, not "card on file now".
  subscriptionsWithDefaultPm: number;
  // Subscriptions whose customer has been deleted in Stripe.
  deletedCustomerSubscriptions: number;
  // Of subscriptions whose customer currently has a PM on file, by status.
  withPmByStatus: LabeledCount[];

  // --- CRM mirror (dashboard_* synced tables) cross-reference ---
  mirrorAvailable: boolean;
  workshopsTotal: number;
  workshopsWithStripeCustomer: number;
  workshopsWithSubscription: number;
  planMix: LabeledCount[];
  paymentStatusBreakdown: LabeledCount[];
};

function emptyData(): PaymentMethodsData {
  return {
    generatedAtIso: new Date().toISOString(),
    stripeAvailable: false,
    totalCustomers: 0,
    customersWithPaymentMethod: 0,
    customersWithDefaultPm: 0,
    pctWithPaymentMethod: 0,
    methodMix: [],
    subscriptionsTotal: 0,
    subscriptionsByStatus: [],
    subscriptionsWithDefaultPm: 0,
    deletedCustomerSubscriptions: 0,
    withPmByStatus: [],
    mirrorAvailable: false,
    workshopsTotal: 0,
    workshopsWithStripeCustomer: 0,
    workshopsWithSubscription: 0,
    planMix: [],
    paymentStatusBreakdown: [],
  };
}

// Run an async mapper over items with a fixed concurrency ceiling so we don't
// fire 200+ simultaneous Stripe reads (live mode caps at ~100 reads/sec).
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function sortedCounts(map: Map<string, number>): LabeledCount[] {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

type StripePart = Pick<
  PaymentMethodsData,
  | "totalCustomers"
  | "customersWithPaymentMethod"
  | "customersWithDefaultPm"
  | "methodMix"
  | "subscriptionsTotal"
  | "subscriptionsByStatus"
  | "subscriptionsWithDefaultPm"
  | "deletedCustomerSubscriptions"
  | "withPmByStatus"
>;

async function loadStripePart(): Promise<StripePart | null> {
  const key = getEnv("STRIPE_SECRET_KEY");
  if (!key) return null;

  const stripe = new Stripe(key);

  // 1. All (non-deleted) customers.
  const customers: Stripe.Customer[] = [];
  let customerAfter: string | undefined;
  do {
    const page = await stripe.customers.list({
      limit: 100,
      starting_after: customerAfter,
    });
    for (const customer of page.data) {
      if (!customer.deleted) customers.push(customer);
    }
    customerAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (customerAfter);

  // 2. Attached payment methods per customer (bounded concurrency). A customer
  //    deleted mid-scan throws resource_missing — treat as no PM.
  const pmResults = await mapLimit(customers, 10, async (customer) => {
    try {
      const pms = await stripe.paymentMethods.list({
        customer: customer.id,
        limit: 100,
      });
      return { id: customer.id, methods: pms.data };
    } catch {
      return { id: customer.id, methods: [] as Stripe.PaymentMethod[] };
    }
  });

  const custById = new Map(customers.map((c) => [c.id, c]));
  const hasPm = new Set<string>();
  const methodMixMap = new Map<string, number>();
  let customersWithPaymentMethod = 0;
  let customersWithDefaultPm = 0;

  for (const customer of customers) {
    if (customer.invoice_settings?.default_payment_method) {
      customersWithDefaultPm += 1;
    }
  }

  for (const { id, methods } of pmResults) {
    const customer = custById.get(id);
    const hasDefaultSource = Boolean(customer?.default_source);
    if (methods.length > 0 || hasDefaultSource) {
      customersWithPaymentMethod += 1;
      hasPm.add(id);
    }
    for (const pm of methods) {
      const label =
        pm.type === "card" && pm.card
          ? `Card · ${pm.card.brand}`
          : pm.type;
      methodMixMap.set(label, (methodMixMap.get(label) ?? 0) + 1);
    }
  }

  // 3. All subscriptions (any status), customer expanded.
  const subscriptions: Stripe.Subscription[] = [];
  let subAfter: string | undefined;
  do {
    const page = await stripe.subscriptions.list({
      status: "all",
      limit: 100,
      starting_after: subAfter,
      expand: ["data.customer"],
    });
    subscriptions.push(...page.data);
    subAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (subAfter);

  const statusMap = new Map<string, number>();
  const withPmStatusMap = new Map<string, number>();
  let subscriptionsWithDefaultPm = 0;
  let deletedCustomerSubscriptions = 0;

  for (const sub of subscriptions) {
    statusMap.set(sub.status, (statusMap.get(sub.status) ?? 0) + 1);
    if (sub.default_payment_method) subscriptionsWithDefaultPm += 1;
    const customer = typeof sub.customer === "string" ? null : sub.customer;
    if (!customer || customer.deleted) {
      deletedCustomerSubscriptions += 1;
      continue;
    }
    if (hasPm.has(customer.id)) {
      withPmStatusMap.set(sub.status, (withPmStatusMap.get(sub.status) ?? 0) + 1);
    }
  }

  return {
    totalCustomers: customers.length,
    customersWithPaymentMethod,
    customersWithDefaultPm,
    methodMix: sortedCounts(methodMixMap),
    subscriptionsTotal: subscriptions.length,
    subscriptionsByStatus: sortedCounts(statusMap),
    subscriptionsWithDefaultPm,
    deletedCustomerSubscriptions,
    withPmByStatus: sortedCounts(withPmStatusMap),
  };
}

type MirrorPart = Pick<
  PaymentMethodsData,
  | "workshopsTotal"
  | "workshopsWithStripeCustomer"
  | "workshopsWithSubscription"
  | "planMix"
  | "paymentStatusBreakdown"
>;

type MirrorWorkshop = {
  core_stripe_customer_id: string | null;
  core_stripe_subscription_id: string | null;
  payment_status: string | null;
};

type MirrorSubscription = {
  plan_key: string | null;
  status: string | null;
};

async function loadMirrorPart(): Promise<MirrorPart | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const [{ data: workshops }, { data: subs }] = await Promise.all([
    pageAll<MirrorWorkshop>(({ from, to }) =>
      supabase
        .from(TABLES.workshops)
        .select(
          "workshop_id,core_stripe_customer_id,core_stripe_subscription_id,payment_status",
        )
        .order("workshop_id", { ascending: true })
        .range(from, to),
    ),
    pageAll<MirrorSubscription>(({ from, to }) =>
      supabase
        .from(TABLES.subscriptions)
        .select("stripe_subscription_id,plan_key,status")
        .order("stripe_subscription_id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const workshopRows = workshops ?? [];
  const isSet = (value: string | null) => Boolean(value && value.trim());

  const paymentStatusMap = new Map<string, number>();
  for (const row of workshopRows) {
    const label = isSet(row.payment_status) ? row.payment_status! : "(none)";
    paymentStatusMap.set(label, (paymentStatusMap.get(label) ?? 0) + 1);
  }

  const planMap = new Map<string, number>();
  for (const sub of subs ?? []) {
    if (sub.status !== "active" && sub.status !== "trialing") continue;
    const label = isSet(sub.plan_key) ? sub.plan_key! : "(unknown)";
    planMap.set(label, (planMap.get(label) ?? 0) + 1);
  }

  return {
    workshopsTotal: workshopRows.length,
    workshopsWithStripeCustomer: workshopRows.filter((row) =>
      isSet(row.core_stripe_customer_id),
    ).length,
    workshopsWithSubscription: workshopRows.filter((row) =>
      isSet(row.core_stripe_subscription_id),
    ).length,
    planMix: sortedCounts(planMap),
    paymentStatusBreakdown: sortedCounts(paymentStatusMap),
  };
}

async function getPaymentMethodsDataUncached(): Promise<PaymentMethodsData> {
  const result = emptyData();
  const [stripePart, mirrorPart] = await Promise.all([
    loadStripePart().catch(() => null),
    loadMirrorPart().catch(() => null),
  ]);

  if (stripePart) {
    result.stripeAvailable = true;
    Object.assign(result, stripePart);
    result.pctWithPaymentMethod =
      result.totalCustomers > 0
        ? (result.customersWithPaymentMethod / result.totalCustomers) * 100
        : 0;
  }

  if (mirrorPart) {
    result.mirrorAvailable = true;
    Object.assign(result, mirrorPart);
  }

  return result;
}

const getPaymentMethodsDataCached = unstable_cache(
  () => getPaymentMethodsDataUncached(),
  ["ceo-payment-methods-data"],
  CEO_CACHE_OPTIONS,
);

export function getPaymentMethodsData(): Promise<PaymentMethodsData> {
  return getPaymentMethodsDataCached();
}
