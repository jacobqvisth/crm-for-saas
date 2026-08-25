import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import {
  isInternalTestEmailWith,
  isInternalTestUserIdWith,
  isInternalTestWorkshopIdWith,
  loadInternalTestSets,
} from "@/lib/ceo/internal-test/loader";
import {
  couponTerms,
  type PromoCodeRow,
  type PromoEngagementBucket,
  type PromoMoneyTotal,
  type PromoOutreachBucket,
  type PromoUserRow,
  type PromoUsersData,
} from "@/lib/ceo/promo-users-shared";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";

// Promo Users (/dashboard/promo-users).
//
// Every user who was ever given a coupon or promotion code, and what happened
// next: did anyone follow it up (call, email, reply), and did they actually use
// the product (diagnostics, chats, feature events, logins)?
//
// The promo side comes from dashboard_promo_grants, written by the hourly
// Stripe sync (see sources/stripe.ts → buildPromoGrants). Before that table
// existed there was NO record of discounts anywhere in the warehouse, so this
// page is the first place the two halves meet.
//
// Join chain, and why it holds: a grant knows its Stripe customer and email.
// contacts.user_stripe_customer_id / contacts.email resolve that to a CRM
// contact (37 of 38 promo emails match one), which carries the outreach history
// AND contacts.wl_user_id — the app's internal user id. That id keys the
// warehouse product tables. Every read here is bounded by the promo population
// (a few dozen customers), so this page is cheap regardless of table size.

const NOTE =
  "A grant is one (Stripe customer, coupon) pair: a 90%-off coupon riding twelve " +
  "monthly invoices is ONE grant, not twelve. Promotion code is an attribute, not " +
  "the key — the same coupon is often applied both by code and by hand, and keying " +
  "on the code would double-count the customer. Money is per currency (SEK, USD and " +
  "EUR are all in use) and is never summed across them. Discount totals are exact " +
  "(Stripe attributes an amount per discount per invoice); 'paid alongside' is " +
  "attributed to the first coupon on an invoice only. Internal and partner comps are " +
  "shown but flagged, because a comp to a partner is a real category — they are NOT " +
  "silently dropped the way they are on the growth pages. Product activity comes from " +
  "the app export (diagnostics all-history; feature counters only from 2026-06-11), " +
  "outreach from the CRM (calls, sequence emails, inbox replies, logged activities).";

type GrantDbRow = {
  grant_id: string;
  stripe_customer_id: string | null;
  customer_email: string | null;
  workshop_id: string | null;
  internal_user_id: string | null;
  promotion_code: string | null;
  coupon_id: string;
  percent_off: number | null;
  amount_off_cents: number | null;
  duration: string | null;
  duration_in_months: number | null;
  source: "subscription" | "invoice" | "both";
  active_on_subscription: boolean;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  first_applied_at: string | null;
  last_applied_at: string | null;
  invoice_count: number;
  total_discount_cents: number;
  total_paid_cents: number;
  currency: string | null;
};

type ContactDbRow = {
  id: string;
  email: string | null;
  company_id: string | null;
  wl_user_id: string | null;
  country: string | null;
  last_contacted_at: string | null;
  last_active_at: string | null;
  login_count: number | null;
  active_days_count: number | null;
  signed_up_at: string | null;
  user_stripe_customer_id: string | null;
};

type WorkshopDbRow = {
  workshop_id: string;
  name: string | null;
  country: string | null;
};

type CompanyDbRow = { id: string; name: string | null };
type SubscriptionDbRow = {
  stripe_customer_id: string | null;
  metadata: Record<string, unknown> | null;
};
type CountRow = { contact_id: string | null };
type DiagnosticDbRow = { internal_user_id: string | null; has_chat: boolean | null };
type FeatureDbRow = { internal_user_id: string | null; usage_count: number | null };

function emptyData(error: string | null = null): PromoUsersData {
  return {
    kpis: {
      customers: 0,
      externalCustomers: 0,
      internalCustomers: 0,
      activeNow: 0,
      everPaid: 0,
      neverDiagnosed: 0,
      neverContacted: 0,
      everCalled: 0,
      distinctCodes: 0,
    },
    money: [],
    users: [],
    codes: [],
    engagement: [],
    outreach: [],
    unresolvedGrants: 0,
    note: NOTE,
    error,
  };
}

function tally(rows: CountRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.contact_id) continue;
    counts.set(row.contact_id, (counts.get(row.contact_id) ?? 0) + 1);
  }
  return counts;
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

async function getPromoUsersDataUncached(): Promise<PromoUsersData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyData("Supabase service client unavailable.");

  const sets = await loadInternalTestSets();

  const grantsResult = await pageAll<GrantDbRow>(({ from, to }) =>
    supabase
      .from(TABLES.promoGrants)
      .select(
        "grant_id, stripe_customer_id, customer_email, workshop_id, internal_user_id, promotion_code, coupon_id, percent_off, amount_off_cents, duration, duration_in_months, source, active_on_subscription, stripe_subscription_id, subscription_status, first_applied_at, last_applied_at, invoice_count, total_discount_cents, total_paid_cents, currency",
      )
      .order("grant_id", { ascending: true })
      .range(from, to),
  );

  if (grantsResult.error) {
    return emptyData(`Could not read promo grants: ${grantsResult.error.message}`);
  }

  const grants = grantsResult.data;
  if (grants.length === 0) {
    return {
      ...emptyData(),
      note: `${NOTE} No promo grants synced yet — click Update to run the Stripe sync.`,
    };
  }

  const emails = [
    ...new Set(
      grants
        .map((grant) => grant.customer_email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  const customerIds = [
    ...new Set(
      grants
        .map((grant) => grant.stripe_customer_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const workshopIds = [
    ...new Set(
      grants
        .map((grant) => grant.workshop_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  // Contacts are matched on email first (highest hit rate) and on the Stripe
  // customer id as a fallback, which catches contacts whose CRM email differs
  // from the billing email on the Stripe customer.
  const [byEmailResult, byCustomerResult, workshopsResult, subsResult] =
    await Promise.all([
      emails.length > 0
        ? pageAll<ContactDbRow>(({ from, to }) =>
            supabase
              .from("contacts")
              .select(
                "id, email, company_id, wl_user_id, country, last_contacted_at, last_active_at, login_count, active_days_count, signed_up_at, user_stripe_customer_id",
              )
              .in("email", emails)
              .order("id", { ascending: true })
              .range(from, to),
          )
        : Promise.resolve({ data: [] as ContactDbRow[], error: null }),
      customerIds.length > 0
        ? pageAll<ContactDbRow>(({ from, to }) =>
            supabase
              .from("contacts")
              .select(
                "id, email, company_id, wl_user_id, country, last_contacted_at, last_active_at, login_count, active_days_count, signed_up_at, user_stripe_customer_id",
              )
              .in("user_stripe_customer_id", customerIds)
              .order("id", { ascending: true })
              .range(from, to),
          )
        : Promise.resolve({ data: [] as ContactDbRow[], error: null }),
      workshopIds.length > 0
        ? pageAll<WorkshopDbRow>(({ from, to }) =>
            supabase
              .from(TABLES.workshops)
              .select("workshop_id, name, country")
              .in("workshop_id", workshopIds)
              .order("workshop_id", { ascending: true })
              .range(from, to),
          )
        : Promise.resolve({ data: [] as WorkshopDbRow[], error: null }),
      customerIds.length > 0
        ? pageAll<SubscriptionDbRow>(({ from, to }) =>
            supabase
              .from(TABLES.subscriptions)
              .select("stripe_customer_id, metadata")
              .in("stripe_customer_id", customerIds)
              .order("stripe_subscription_id", { ascending: true })
              .range(from, to),
          )
        : Promise.resolve({ data: [] as SubscriptionDbRow[], error: null }),
    ]);

  const contactByEmail = new Map<string, ContactDbRow>();
  const contactByCustomer = new Map<string, ContactDbRow>();
  for (const contact of [...byEmailResult.data, ...byCustomerResult.data]) {
    if (contact.email) {
      contactByEmail.set(contact.email.trim().toLowerCase(), contact);
    }
    if (contact.user_stripe_customer_id) {
      contactByCustomer.set(contact.user_stripe_customer_id, contact);
    }
  }

  const workshopById = new Map(
    workshopsResult.data.map((row) => [row.workshop_id, row]),
  );

  // ever_paid lives on the subscription rows, keyed by customer: a promo
  // customer counts as a payer if ANY of their subscriptions ever took money.
  const everPaidByCustomer = new Map<string, boolean>();
  for (const row of subsResult.data) {
    if (!row.stripe_customer_id) continue;
    const paid = row.metadata?.ever_paid === true;
    everPaidByCustomer.set(
      row.stripe_customer_id,
      (everPaidByCustomer.get(row.stripe_customer_id) ?? false) || paid,
    );
  }

  const contacts = [...new Set([...contactByEmail.values(), ...contactByCustomer.values()])];
  const contactIds = contacts.map((contact) => contact.id);
  const appUserIds = [
    ...new Set(
      contacts
        .map((contact) => contact.wl_user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const companyIds = [
    ...new Set(
      contacts
        .map((contact) => contact.company_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [
    callsResult,
    connectedResult,
    emailsResult,
    repliesResult,
    activitiesResult,
    diagnosticsResult,
    featureResult,
    companiesResult,
  ] = await Promise.all([
    contactIds.length > 0
      ? pageAll<CountRow>(({ from, to }) =>
          supabase
            .from("call_sessions")
            .select("contact_id")
            .in("contact_id", contactIds)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as CountRow[], error: null }),
    contactIds.length > 0
      ? pageAll<CountRow>(({ from, to }) =>
          supabase
            .from("call_sessions")
            .select("contact_id")
            .in("contact_id", contactIds)
            .not("connected_at", "is", null)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as CountRow[], error: null }),
    contactIds.length > 0
      ? pageAll<CountRow>(({ from, to }) =>
          supabase
            .from("email_queue")
            .select("contact_id")
            .in("contact_id", contactIds)
            .eq("status", "sent")
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as CountRow[], error: null }),
    contactIds.length > 0
      ? pageAll<CountRow>(({ from, to }) =>
          supabase
            .from("inbox_messages")
            .select("contact_id")
            .in("contact_id", contactIds)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as CountRow[], error: null }),
    contactIds.length > 0
      ? pageAll<CountRow>(({ from, to }) =>
          supabase
            .from("activities")
            .select("contact_id")
            .in("contact_id", contactIds)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as CountRow[], error: null }),
    appUserIds.length > 0
      ? pageAll<DiagnosticDbRow>(({ from, to }) =>
          supabase
            .from(TABLES.diagnostics)
            .select("internal_user_id, has_chat")
            .in("internal_user_id", appUserIds)
            .order("diagnostic_id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as DiagnosticDbRow[], error: null }),
    appUserIds.length > 0
      ? pageAll<FeatureDbRow>(({ from, to }) =>
          supabase
            .from(TABLES.featureUsage)
            .select("internal_user_id, usage_count")
            .in("internal_user_id", appUserIds)
            .order("internal_user_id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as FeatureDbRow[], error: null }),
    companyIds.length > 0
      ? pageAll<CompanyDbRow>(({ from, to }) =>
          supabase
            .from("companies")
            .select("id, name")
            .in("id", companyIds)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as CompanyDbRow[], error: null }),
  ]);

  const callCounts = tally(callsResult.data);
  const connectedCounts = tally(connectedResult.data);
  const emailCounts = tally(emailsResult.data);
  const replyCounts = tally(repliesResult.data);
  const activityCounts = tally(activitiesResult.data);
  const companyName = new Map(
    companiesResult.data.map((row) => [row.id, row.name]),
  );

  const diagnosticsByUser = new Map<string, number>();
  const chatsByUser = new Map<string, number>();
  for (const row of diagnosticsResult.data) {
    if (!row.internal_user_id) continue;
    diagnosticsByUser.set(
      row.internal_user_id,
      (diagnosticsByUser.get(row.internal_user_id) ?? 0) + 1,
    );
    if (row.has_chat) {
      chatsByUser.set(
        row.internal_user_id,
        (chatsByUser.get(row.internal_user_id) ?? 0) + 1,
      );
    }
  }

  const featureByUser = new Map<string, number>();
  for (const row of featureResult.data) {
    if (!row.internal_user_id) continue;
    featureByUser.set(
      row.internal_user_id,
      (featureByUser.get(row.internal_user_id) ?? 0) + Number(row.usage_count ?? 0),
    );
  }

  // ---- fold grants into rows ------------------------------------------------
  let unresolvedGrants = 0;
  const users: PromoUserRow[] = grants.map((grant) => {
    const email = grant.customer_email?.trim().toLowerCase() ?? null;
    const contact =
      (email ? contactByEmail.get(email) : undefined) ??
      (grant.stripe_customer_id
        ? contactByCustomer.get(grant.stripe_customer_id)
        : undefined) ??
      null;

    if (!contact) unresolvedGrants += 1;

    const workshop = grant.workshop_id
      ? (workshopById.get(grant.workshop_id) ?? null)
      : null;
    const appUserId = contact?.wl_user_id ?? grant.internal_user_id ?? null;

    const isInternal =
      isInternalTestEmailWith(sets, email) ||
      isInternalTestUserIdWith(sets, appUserId) ||
      isInternalTestWorkshopIdWith(sets, grant.workshop_id);

    const terms = couponTerms(
      grant.percent_off,
      grant.amount_off_cents,
      grant.currency,
      grant.duration,
      grant.duration_in_months,
    );

    return {
      grantId: grant.grant_id,
      email,
      company:
        workshop?.name ??
        (contact?.company_id ? (companyName.get(contact.company_id) ?? null) : null),
      country: workshop?.country ?? contact?.country ?? null,
      code: grant.promotion_code,
      couponId: grant.coupon_id,
      terms,
      discountLabel: terms,
      source: grant.source,
      activeNow: grant.active_on_subscription,
      subscriptionStatus: grant.subscription_status,
      currency: grant.currency,
      discountedCents: Number(grant.total_discount_cents ?? 0),
      paidCents: Number(grant.total_paid_cents ?? 0),
      invoiceCount: Number(grant.invoice_count ?? 0),
      firstAppliedAt: grant.first_applied_at,
      lastAppliedAt: grant.last_applied_at,
      everPaid: grant.stripe_customer_id
        ? (everPaidByCustomer.get(grant.stripe_customer_id) ?? false)
        : false,
      isInternal,

      contactId: contact?.id ?? null,
      calls: contact ? (callCounts.get(contact.id) ?? 0) : 0,
      callsConnected: contact ? (connectedCounts.get(contact.id) ?? 0) : 0,
      emailsSent: contact ? (emailCounts.get(contact.id) ?? 0) : 0,
      replies: contact ? (replyCounts.get(contact.id) ?? 0) : 0,
      activities: contact ? (activityCounts.get(contact.id) ?? 0) : 0,
      lastContactedAt: contact?.last_contacted_at ?? null,

      internalUserId: appUserId,
      diagnostics: appUserId ? (diagnosticsByUser.get(appUserId) ?? 0) : 0,
      diagnosticChats: appUserId ? (chatsByUser.get(appUserId) ?? 0) : 0,
      featureEvents: appUserId ? (featureByUser.get(appUserId) ?? 0) : 0,
      logins: Number(contact?.login_count ?? 0),
      activeDays: Number(contact?.active_days_count ?? 0),
      lastActiveAt: contact?.last_active_at ?? null,
      signedUpAt: contact?.signed_up_at ?? null,
    };
  });

  users.sort((a, b) => {
    if (a.activeNow !== b.activeNow) return a.activeNow ? -1 : 1;
    if (b.diagnostics !== a.diagnostics) return b.diagnostics - a.diagnostics;
    return b.discountedCents - a.discountedCents;
  });

  // ---- rollups --------------------------------------------------------------
  // KPIs count DISTINCT customers, not grants: one customer holding two coupons
  // is one discounted workshop, and counting grants would overstate reach.
  const byCustomer = new Map<string, PromoUserRow[]>();
  for (const row of users) {
    const key = row.email ?? row.grantId;
    const list = byCustomer.get(key) ?? [];
    list.push(row);
    byCustomer.set(key, list);
  }

  const customerRows = [...byCustomer.values()];
  const kpis = {
    customers: customerRows.length,
    externalCustomers: customerRows.filter((rows) =>
      rows.every((row) => !row.isInternal),
    ).length,
    internalCustomers: customerRows.filter((rows) =>
      rows.some((row) => row.isInternal),
    ).length,
    activeNow: customerRows.filter((rows) => rows.some((row) => row.activeNow))
      .length,
    everPaid: customerRows.filter((rows) => rows.some((row) => row.everPaid))
      .length,
    neverDiagnosed: customerRows.filter((rows) =>
      rows.every((row) => row.diagnostics === 0),
    ).length,
    neverContacted: customerRows.filter((rows) =>
      rows.every(
        (row) => row.calls === 0 && row.emailsSent === 0 && row.activities === 0,
      ),
    ).length,
    everCalled: customerRows.filter((rows) => rows.some((row) => row.calls > 0))
      .length,
    distinctCodes: new Set(
      users.map((row) => row.code ?? `coupon:${row.couponId}`),
    ).size,
  };

  const moneyByCurrency = new Map<string, PromoMoneyTotal>();
  for (const row of users) {
    const currency = row.currency ?? "—";
    const existing =
      moneyByCurrency.get(currency) ??
      { currency, discountedCents: 0, paidCents: 0 };
    existing.discountedCents += row.discountedCents;
    existing.paidCents += row.paidCents;
    moneyByCurrency.set(currency, existing);
  }
  const money = [...moneyByCurrency.values()].sort(
    (a, b) => b.discountedCents - a.discountedCents,
  );

  const codeMap = new Map<string, PromoCodeRow & { currencies: Map<string, number> }>();
  for (const row of users) {
    const key = row.code ?? `coupon:${row.couponId}`;
    const existing =
      codeMap.get(key) ??
      {
        key,
        code: row.code,
        couponId: row.couponId,
        terms: row.terms,
        customers: 0,
        activeNow: 0,
        everPaid: 0,
        withDiagnostics: 0,
        totalDiagnostics: 0,
        discountByCurrency: [],
        firstAppliedAt: null,
        lastAppliedAt: null,
        currencies: new Map<string, number>(),
      };

    existing.customers += 1;
    if (row.activeNow) existing.activeNow += 1;
    if (row.everPaid) existing.everPaid += 1;
    if (row.diagnostics > 0) existing.withDiagnostics += 1;
    existing.totalDiagnostics += row.diagnostics;
    existing.lastAppliedAt = latest(existing.lastAppliedAt, row.lastAppliedAt);
    if (
      row.firstAppliedAt &&
      (!existing.firstAppliedAt || row.firstAppliedAt < existing.firstAppliedAt)
    ) {
      existing.firstAppliedAt = row.firstAppliedAt;
    }
    const currency = row.currency ?? "—";
    existing.currencies.set(
      currency,
      (existing.currencies.get(currency) ?? 0) + row.discountedCents,
    );

    codeMap.set(key, existing);
  }

  const codes: PromoCodeRow[] = [...codeMap.values()]
    .map(({ currencies, ...row }) => ({
      ...row,
      discountByCurrency: [...currencies.entries()]
        .map(([currency, cents]) => ({ currency, cents }))
        .sort((a, b) => b.cents - a.cents),
    }))
    .sort((a, b) => b.customers - a.customers);

  const bucketOf = (rows: PromoUserRow[]): PromoEngagementBucket["key"] => {
    const diagnostics = Math.max(...rows.map((row) => row.diagnostics));
    const logins = Math.max(...rows.map((row) => row.logins));
    if (diagnostics === 0 && logins === 0) return "never_logged_in";
    if (diagnostics === 0) return "logged_in_no_diagnosis";
    if (diagnostics === 1) return "one_diagnosis";
    return "repeat";
  };

  const engagementDefs: Array<{
    key: PromoEngagementBucket["key"];
    label: string;
    description: string;
  }> = [
    {
      key: "never_logged_in",
      label: "Never logged in",
      description: "Got the discount and never came back at all.",
    },
    {
      key: "logged_in_no_diagnosis",
      label: "Logged in, never diagnosed",
      description: "Reached the app but never ran the core action.",
    },
    {
      key: "one_diagnosis",
      label: "One diagnosis",
      description: "Tried it once and stopped.",
    },
    {
      key: "repeat",
      label: "Repeat user",
      description: "Two or more diagnoses — the discount landed.",
    },
  ];

  const engagement: PromoEngagementBucket[] = engagementDefs.map((def) => {
    const matching = customerRows.filter((rows) => bucketOf(rows) === def.key);
    return {
      ...def,
      count: matching.length,
      emails: matching
        .map((rows) => rows[0]?.email ?? "(unknown)")
        .sort(),
    };
  });

  const outreachOf = (rows: PromoUserRow[]): PromoOutreachBucket["key"] => {
    const called = rows.some((row) => row.calls > 0);
    const emailed = rows.some((row) => row.emailsSent > 0);
    if (called && emailed) return "called_and_emailed";
    if (emailed) return "emailed_only";
    if (called) return "called_only";
    return "neither";
  };

  const outreachDefs: Array<{
    key: PromoOutreachBucket["key"];
    label: string;
  }> = [
    { key: "called_and_emailed", label: "Called and emailed" },
    { key: "emailed_only", label: "Emailed only" },
    { key: "called_only", label: "Called only" },
    { key: "neither", label: "Never called or emailed" },
  ];

  const outreach: PromoOutreachBucket[] = outreachDefs.map((def) => {
    const matching = customerRows.filter((rows) => outreachOf(rows) === def.key);
    return {
      ...def,
      count: matching.length,
      emails: matching.map((rows) => rows[0]?.email ?? "(unknown)").sort(),
    };
  });

  return {
    kpis,
    money,
    users,
    codes,
    engagement,
    outreach,
    unresolvedGrants,
    note: NOTE,
    error: null,
  };
}

export const getPromoUsersData = unstable_cache(
  getPromoUsersDataUncached,
  ["ceo-promo-users"],
  CEO_CACHE_OPTIONS,
);
