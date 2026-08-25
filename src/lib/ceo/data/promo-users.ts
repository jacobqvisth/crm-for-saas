import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import {
  isInternalTestEmailWith,
  isInternalTestUserIdWith,
  isInternalTestWorkshopIdWith,
  loadInternalTestSets,
} from "@/lib/ceo/internal-test/loader";
import {
  COHORT_LABELS,
  couponTerms,
  daysBetween,
  median,
  type BeforeAfterRow,
  type CallLogRow,
  type CohortKey,
  type CohortStats,
  type EmailLogRow,
  type FunnelStage,
  type PromoCodeRow,
  type PromoEngagementBucket,
  type PromoGrantRowView,
  type PromoMoneyTotal,
  type PromoOutreachBucket,
  type PromoUserRow,
  type PromoUsersData,
  type RelativePoint,
  type TermCount,
  type TimelineEvent,
  type TimelineUser,
  type WeeklyPoint,
} from "@/lib/ceo/promo-users-shared";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";

// Promo Users (/dashboard/promo-users).
//
// Everyone who was ever given a coupon or promotion code, what was done to
// them, what they did in the product, and whether the discount looks like it
// worked at all.
//
// GRAINS, because this page mixes three and confusing them produces wrong
// numbers (it already did once):
//   * MONEY lives at GRANT level, one row per (stripe customer, coupon).
//     Summing discount per app user multiplies the same grant by the number of
//     techs at the workshop, which inflated the total from 121,238 to 177,771.
//   * BEHAVIOUR lives at APP USER level. A diagnosis is run by a person.
//   * OUTREACH lives at CONTACT level. Two app users at one workshop usually
//     share one CRM contact, so outreach is deduped by contact_id before it is
//     counted, otherwise one phone call is counted twice.
//
// Cohort comparison uses THREE cohorts, not two. "Promo vs everyone else"
// mostly measures sold-to customer vs random free signup, because almost all
// non-promo users never went through checkout. `paid_no_promo` is the honest
// comparison: same commercial motion, no discount.
//
// The heavy aggregation is done by promo_user_analysis() / promo_weekly_activity()
// / promo_relative_activity() in Postgres (see the 20260825140000 migration) —
// PostgREST cannot GROUP BY, and paging ~50k activity rows into Node to group
// them there would blow both the 8s statement timeout and the 60s route budget.

const NOTE =
  "A grant is one (Stripe customer, coupon) pair: a 90%-off coupon riding twelve monthly " +
  "invoices is ONE grant, not twelve. Money is per currency (SEK, USD and EUR are all in use) " +
  "and never summed across them; discount amounts are exact (Stripe attributes an amount per " +
  "discount per invoice), while 'paid alongside' is attributed to the first coupon on an " +
  "invoice only. Behaviour is counted per app user, outreach per CRM contact (deduped, so a " +
  "workshop's shared phone call is not counted once per tech), and discount money per grant. " +
  "Diagnostics are all-history; feature counters only exist from 2026-06-11 onward, so a " +
  "long-standing user's feature total understates their lifetime usage. Internal and partner " +
  "comps are shown but flagged, never silently dropped.";

const CAUSALITY_NOTE =
  "This page shows association, not causation. Promo recipients were not randomly chosen: " +
  "they are workshops that were actively sold to and that reached checkout, so a naive " +
  "comparison against all other users mostly measures 'engaged customer vs random free " +
  "signup'. The 'Paid, no promo' cohort is the fair contrast — same commercial motion, no " +
  "discount. Even there, 'ever paid' is partly mechanical: a discounted subscription still " +
  "issues invoices, and several coupons were applied to customers who were already paying.";

type AnalysisRow = {
  internal_user_id: string;
  workshop_id: string | null;
  workshop_name: string | null;
  country: string | null;
  plan_key: string | null;
  subscription_status: string | null;
  payment_status: string | null;
  trial_end: string | null;
  signed_up_at: string | null;
  churned_at: string | null;
  is_internal_test: boolean;
  contact_id: string | null;
  contact_email: string | null;
  is_promo: boolean;
  promo_code: string | null;
  promo_coupon_id: string | null;
  promo_percent_off: number | null;
  promo_applied_at: string | null;
  promo_last_applied_at: string | null;
  promo_discount_cents: number | null;
  promo_currency: string | null;
  promo_active: boolean;
  promo_invoices: number | null;
  ever_paid: boolean;
  diagnostics_total: number;
  diagnostics_first_at: string | null;
  diagnostics_last_at: string | null;
  diagnostics_30d: number;
  diagnostics_before: number;
  diagnostics_after: number;
  diagnostics_after_30d: number;
  chats: number;
  feature_events: number;
  logins: number;
  active_days: number;
  last_active_at: string | null;
  calls: number;
  calls_connected: number;
  first_call_at: string | null;
  last_call_at: string | null;
  emails_sent: number;
  first_email_at: string | null;
  last_email_at: string | null;
  opens: number;
  clicks: number;
  replies: number;
  activity_count: number;
};

type GrantDbRow = {
  grant_id: string;
  stripe_customer_id: string | null;
  customer_email: string | null;
  workshop_id: string | null;
  promotion_code: string | null;
  coupon_id: string;
  percent_off: number | null;
  amount_off_cents: number | null;
  duration: string | null;
  duration_in_months: number | null;
  source: string;
  active_on_subscription: boolean;
  subscription_status: string | null;
  first_applied_at: string | null;
  last_applied_at: string | null;
  invoice_count: number;
  total_discount_cents: number;
  total_paid_cents: number;
  currency: string | null;
};

type CohortDbRow = {
  cohort: CohortKey;
  users: number;
  workshops: number;
  total_diagnostics: number;
  total_active_days: number;
  avg_diagnostics: number;
  median_diagnostics: number;
  max_diagnostics: number;
  pct_activated: number;
  pct_repeat: number;
  pct_power: number;
  avg_active_days: number;
  pct_active_30d: number;
  pct_ever_paid: number;
  avg_chats: number;
  avg_feature_events: number;
  avg_logins: number;
  stage_logged_in: number;
  stage_activated: number;
  stage_repeat: number;
  stage_habit: number;
  stage_paid: number;
  stage_active_30d: number;
};

type WeeklyDbRow = {
  week: string;
  cohort: string;
  active_users: number;
  diagnostics: number;
  chats: number;
};

type RelativeDbRow = {
  rel_week: number;
  diagnostics: number;
  active_users: number;
};

type CallDbRow = {
  id: string;
  contact_id: string | null;
  user_id: string | null;
  direction: string | null;
  started_at: string | null;
  connected_at: string | null;
  duration_seconds: number | null;
  summary: string | null;
};

type EmailDbRow = {
  id: string;
  contact_id: string | null;
  sender_account_id: string | null;
  step_id: string | null;
  subject: string | null;
  sent_at: string | null;
};

type EventDbRow = {
  email_queue_id: string | null;
  event_type: string;
};

type ReplyDbRow = {
  id: string;
  contact_id: string | null;
  from_email: string | null;
  subject: string | null;
  received_at: string | null;
};

type DiagnosticDbRow = {
  diagnostic_id: string;
  internal_user_id: string | null;
  created_at: string | null;
  has_chat: boolean | null;
  metadata: Record<string, unknown> | null;
};

type ProfileDbRow = { user_id: string; full_name: string | null };
type MailboxDbRow = {
  id: string;
  email_address: string | null;
  display_name: string | null;
};
type StepDbRow = { id: string; sequence_id: string | null };
type SequenceDbRow = { id: string; name: string | null };
type ActivityDbRow = {
  id: string;
  contact_id: string | null;
  type: string;
  outcome: string | null;
};

function emptyData(error: string | null = null): PromoUsersData {
  return {
    kpis: {
      recipients: 0,
      users: 0,
      externalRecipients: 0,
      internalRecipients: 0,
      activeNow: 0,
      everPaid: 0,
      neverDiagnosed: 0,
      neverContacted: 0,
      everCalled: 0,
      distinctCodes: 0,
      medianDaysToFirstUse: null,
    },
    money: [],
    cohorts: [],
    users: [],
    grants: [],
    codes: [],
    weekly: [],
    relative: [],
    beforeAfter: [],
    timeline: [],
    calls: [],
    emails: [],
    funnel: [],
    engagement: [],
    outreach: [],
    searchTerms: [],
    carMakes: [],
    dtcs: [],
    symptoms: [],
    unresolvedGrants: 0,
    note: `${NOTE} ${CAUSALITY_NOTE}`,
    error,
  };
}

/** Top N values of a metadata field, counted with the users behind them. */
function topTerms(
  rows: Array<{ uid: string | null; values: string[] }>,
  limit: number,
): TermCount[] {
  const counts = new Map<string, { count: number; users: Set<string> }>();

  for (const row of rows) {
    for (const raw of row.values) {
      const term = raw.trim();
      if (!term || term.length > 80) continue;
      const key = term.toLowerCase();
      const entry = counts.get(key) ?? { count: 0, users: new Set<string>() };
      entry.count += 1;
      if (row.uid) entry.users.add(row.uid);
      counts.set(key, entry);
    }
  }

  return [...counts.entries()]
    .map(([term, entry]) => ({
      term,
      count: entry.count,
      users: entry.users.size,
    }))
    .sort((a, b) => b.count - a.count || b.users - a.users)
    .slice(0, limit);
}

function asStrings(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      typeof item === "string"
        ? [item]
        : item && typeof item === "object"
          ? asStrings(
              (item as Record<string, unknown>).name ??
                (item as Record<string, unknown>).code ??
                (item as Record<string, unknown>).title ??
                (item as Record<string, unknown>).description,
            )
          : [],
    );
  }
  return [];
}

/**
 * Cohort stats come from Postgres, not from the rows above.
 *
 * promo_user_analysis(FALSE) is one row per app user (1,806 today) and
 * PostgREST truncates every response at db-max-rows (1000) SILENTLY — error is
 * null, the body just ends short. Computing cohorts in Node would therefore
 * have averaged an arbitrary 1,000-user slice and looked entirely plausible.
 * promo_cohort_stats() returns exactly three rows.
 */
function toCohortStats(row: CohortDbRow): CohortStats {
  const totalDiagnostics = Number(row.total_diagnostics ?? 0);
  const totalActiveDays = Number(row.total_active_days ?? 0);

  return {
    key: row.cohort,
    label: COHORT_LABELS[row.cohort] ?? row.cohort,
    users: Number(row.users ?? 0),
    workshops: Number(row.workshops ?? 0),
    totalDiagnostics,
    avgDiagnostics: Number(row.avg_diagnostics ?? 0),
    medianDiagnostics: Number(row.median_diagnostics ?? 0),
    maxDiagnostics: Number(row.max_diagnostics ?? 0),
    pctActivated: Number(row.pct_activated ?? 0),
    pctRepeat: Number(row.pct_repeat ?? 0),
    pctPower: Number(row.pct_power ?? 0),
    avgActiveDays: Number(row.avg_active_days ?? 0),
    pctActive30d: Number(row.pct_active_30d ?? 0),
    pctEverPaid: Number(row.pct_ever_paid ?? 0),
    avgChats: Number(row.avg_chats ?? 0),
    avgFeatureEvents: Number(row.avg_feature_events ?? 0),
    avgLogins: Number(row.avg_logins ?? 0),
    diagnosticsPerActiveDay:
      totalActiveDays === 0 ? 0 : totalDiagnostics / totalActiveDays,
  };
}

async function getPromoUsersDataUncached(): Promise<PromoUsersData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyData("Supabase service client unavailable.");

  const sets = await loadInternalTestSets();

  const [
    analysisResult,
    grantsResult,
    weeklyResult,
    relativeResult,
    cohortResult,
  ] = await Promise.all([
      // Defaults to promo users only (~53 rows). Never call it with
      // promo_only=false from here: that returns every app user and PostgREST
      // would silently cut the response at 1000 rows.
      supabase.rpc("promo_user_analysis"),
      pageAll<GrantDbRow>(({ from, to }) =>
        supabase
          .from(TABLES.promoGrants)
          .select(
            "grant_id, stripe_customer_id, customer_email, workshop_id, promotion_code, coupon_id, percent_off, amount_off_cents, duration, duration_in_months, source, active_on_subscription, subscription_status, first_applied_at, last_applied_at, invoice_count, total_discount_cents, total_paid_cents, currency",
          )
          .order("grant_id", { ascending: true })
          .range(from, to),
      ),
      supabase.rpc("promo_weekly_activity", { weeks: 26 }),
      supabase.rpc("promo_relative_activity", { span: 8 }),
      supabase.rpc("promo_cohort_stats"),
    ]);

  if (analysisResult.error) {
    return emptyData(
      `Could not run promo_user_analysis(): ${analysisResult.error.message}`,
    );
  }
  if (grantsResult.error) {
    return emptyData(`Could not read promo grants: ${grantsResult.error.message}`);
  }

  const analysis = (analysisResult.data ?? []) as AnalysisRow[];
  const grants = grantsResult.data;

  if (grants.length === 0) {
    return {
      ...emptyData(),
      note: `${NOTE} No promo grants synced yet — click Update to run the Stripe sync.`,
    };
  }

  // ---- cohorts, straight from Postgres ------------------------------------
  const cohortRows = (cohortResult.data ?? []) as CohortDbRow[];
  const cohortOrder: CohortKey[] = ["promo", "paid_no_promo", "free_no_promo"];
  const cohortByKey = new Map(cohortRows.map((row) => [row.cohort, row]));
  const cohorts: CohortStats[] = cohortOrder
    .map((key) => cohortByKey.get(key))
    .filter((row): row is CohortDbRow => Boolean(row))
    .map(toCohortStats);

  // ---- promo users (all, internal flagged) --------------------------------
  const promoAnalysis = analysis.filter((row) => row.is_promo);

  const users: PromoUserRow[] = promoAnalysis
    .map((row) => {
      const isInternal =
        row.is_internal_test ||
        isInternalTestEmailWith(sets, row.contact_email) ||
        isInternalTestUserIdWith(sets, row.internal_user_id) ||
        isInternalTestWorkshopIdWith(sets, row.workshop_id);

      return {
        userId: row.internal_user_id,
        email: row.contact_email,
        workshopId: row.workshop_id,
        workshop: row.workshop_name,
        country: row.country,
        contactId: row.contact_id,
        code: row.promo_code,
        couponId: row.promo_coupon_id,
        percentOff: row.promo_percent_off,
        terms: couponTerms(
          row.promo_percent_off,
          null,
          row.promo_currency,
          null,
          null,
        ),
        appliedAt: row.promo_applied_at,
        lastAppliedAt: row.promo_last_applied_at,
        promoActive: row.promo_active,
        workshopDiscountCents: Number(row.promo_discount_cents ?? 0),
        currency: row.promo_currency,
        planKey: row.plan_key,
        subscriptionStatus: row.subscription_status,
        everPaid: row.ever_paid,
        trialEnd: row.trial_end,
        signedUpAt: row.signed_up_at,
        churnedAt: row.churned_at,
        isInternal,
        diagnostics: row.diagnostics_total,
        diagnosticsFirstAt: row.diagnostics_first_at,
        diagnosticsLastAt: row.diagnostics_last_at,
        diagnostics30d: row.diagnostics_30d,
        diagnosticsBefore: row.diagnostics_before,
        diagnosticsAfter: row.diagnostics_after,
        diagnosticsAfter30d: row.diagnostics_after_30d,
        chats: row.chats,
        featureEvents: row.feature_events,
        logins: row.logins,
        activeDays: row.active_days,
        lastActiveAt:
          row.last_active_at && !row.last_active_at.startsWith("-infinity")
            ? row.last_active_at
            : null,
        calls: row.calls,
        callsConnected: row.calls_connected,
        firstCallAt: row.first_call_at,
        lastCallAt: row.last_call_at,
        emailsSent: row.emails_sent,
        firstEmailAt: row.first_email_at,
        lastEmailAt: row.last_email_at,
        opens: row.opens,
        clicks: row.clicks,
        replies: row.replies,
        activities: row.activity_count,
      } satisfies PromoUserRow;
    })
    .sort((a, b) => {
      if (a.promoActive !== b.promoActive) return a.promoActive ? -1 : 1;
      return b.diagnostics - a.diagnostics;
    });

  // ---- money and codes, from GRANT level ---------------------------------
  const grantViews: PromoGrantRowView[] = grants
    .map((grant) => ({
      grantId: grant.grant_id,
      email: grant.customer_email,
      workshop:
        users.find((user) => user.workshopId === grant.workshop_id)?.workshop ??
        null,
      code: grant.promotion_code,
      couponId: grant.coupon_id,
      terms: couponTerms(
        grant.percent_off,
        grant.amount_off_cents,
        grant.currency,
        grant.duration,
        grant.duration_in_months,
      ),
      active: grant.active_on_subscription,
      subscriptionStatus: grant.subscription_status,
      currency: grant.currency,
      discountedCents: Number(grant.total_discount_cents ?? 0),
      paidCents: Number(grant.total_paid_cents ?? 0),
      invoiceCount: Number(grant.invoice_count ?? 0),
      firstAppliedAt: grant.first_applied_at,
      lastAppliedAt: grant.last_applied_at,
      source: grant.source,
    }))
    .sort((a, b) => b.discountedCents - a.discountedCents);

  const moneyByCurrency = new Map<string, PromoMoneyTotal>();
  for (const grant of grantViews) {
    const currency = grant.currency ?? "—";
    const entry =
      moneyByCurrency.get(currency) ??
      { currency, discountedCents: 0, paidCents: 0, grants: 0, invoices: 0 };
    entry.discountedCents += grant.discountedCents;
    entry.paidCents += grant.paidCents;
    entry.grants += 1;
    entry.invoices += grant.invoiceCount;
    moneyByCurrency.set(currency, entry);
  }
  const money = [...moneyByCurrency.values()].sort(
    (a, b) => b.discountedCents - a.discountedCents,
  );

  // A "recipient" is a discounted billing identity (email, falling back to the
  // grant). This is the unit the KPI headline counts, so one workshop with
  // three techs counts once.
  const recipientKeys = new Set(
    grantViews.map((grant) => grant.email?.toLowerCase() ?? grant.grantId),
  );

  // Per-user lookup keyed by workshop, for code-level behaviour rollups.
  const usersByWorkshop = new Map<string, PromoUserRow[]>();
  for (const user of users) {
    if (!user.workshopId) continue;
    const list = usersByWorkshop.get(user.workshopId) ?? [];
    list.push(user);
    usersByWorkshop.set(user.workshopId, list);
  }
  const usersByEmail = new Map<string, PromoUserRow[]>();
  for (const user of users) {
    if (!user.email) continue;
    const key = user.email.toLowerCase();
    const list = usersByEmail.get(key) ?? [];
    list.push(user);
    usersByEmail.set(key, list);
  }

  const usersForGrant = (grant: PromoGrantRowView): PromoUserRow[] => {
    const byWorkshop = grantViews.length
      ? (grants.find((g) => g.grant_id === grant.grantId)?.workshop_id ?? null)
      : null;
    const fromWorkshop = byWorkshop
      ? (usersByWorkshop.get(byWorkshop) ?? [])
      : [];
    if (fromWorkshop.length > 0) return fromWorkshop;
    return grant.email ? (usersByEmail.get(grant.email.toLowerCase()) ?? []) : [];
  };

  const codeMap = new Map<
    string,
    PromoCodeRow & { currencies: Map<string, number>; daysToUse: number[] }
  >();
  for (const grant of grantViews) {
    const key = grant.code ?? `coupon:${grant.couponId}`;
    const entry =
      codeMap.get(key) ??
      {
        key,
        code: grant.code,
        couponId: grant.couponId,
        terms: grant.terms,
        recipients: 0,
        activeNow: 0,
        everPaid: 0,
        withDiagnostics: 0,
        totalDiagnostics: 0,
        avgDiagnostics: 0,
        medianDaysToFirstUse: null,
        discountByCurrency: [],
        firstAppliedAt: null,
        lastAppliedAt: null,
        currencies: new Map<string, number>(),
        daysToUse: [] as number[],
      };

    const grantUsers = usersForGrant(grant);
    const diagnostics = grantUsers.reduce(
      (sum, user) => sum + user.diagnostics,
      0,
    );

    entry.recipients += 1;
    if (grant.active) entry.activeNow += 1;
    if (grantUsers.some((user) => user.everPaid)) entry.everPaid += 1;
    if (diagnostics > 0) entry.withDiagnostics += 1;
    entry.totalDiagnostics += diagnostics;

    for (const user of grantUsers) {
      const days = daysBetween(grant.firstAppliedAt, user.diagnosticsFirstAt);
      if (days !== null) entry.daysToUse.push(days);
    }

    const currency = grant.currency ?? "—";
    entry.currencies.set(
      currency,
      (entry.currencies.get(currency) ?? 0) + grant.discountedCents,
    );
    if (
      grant.firstAppliedAt &&
      (!entry.firstAppliedAt || grant.firstAppliedAt < entry.firstAppliedAt)
    ) {
      entry.firstAppliedAt = grant.firstAppliedAt;
    }
    if (
      grant.lastAppliedAt &&
      (!entry.lastAppliedAt || grant.lastAppliedAt > entry.lastAppliedAt)
    ) {
      entry.lastAppliedAt = grant.lastAppliedAt;
    }

    codeMap.set(key, entry);
  }

  const codes: PromoCodeRow[] = [...codeMap.values()]
    .map(({ currencies, daysToUse, ...row }) => ({
      ...row,
      avgDiagnostics:
        row.recipients === 0 ? 0 : row.totalDiagnostics / row.recipients,
      medianDaysToFirstUse: daysToUse.length > 0 ? median(daysToUse) : null,
      discountByCurrency: [...currencies.entries()]
        .map(([currency, cents]) => ({ currency, cents }))
        .sort((a, b) => b.cents - a.cents),
    }))
    .sort((a, b) => b.recipients - a.recipients);

  // ---- weekly + relative series ------------------------------------------
  const weeklyRows = (weeklyResult.data ?? []) as WeeklyDbRow[];
  const weekMap = new Map<string, WeeklyPoint>();
  for (const row of weeklyRows) {
    const point =
      weekMap.get(row.week) ??
      {
        date: row.week,
        promoUsers: 0,
        promoDiagnostics: 0,
        controlUsers: 0,
        controlDiagnostics: 0,
        promoPerUser: 0,
        controlPerUser: 0,
      };
    if (row.cohort === "promo") {
      point.promoUsers = row.active_users;
      point.promoDiagnostics = row.diagnostics;
    } else {
      point.controlUsers = row.active_users;
      point.controlDiagnostics = row.diagnostics;
    }
    weekMap.set(row.week, point);
  }
  const weekly = [...weekMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((point) => ({
      ...point,
      promoPerUser:
        point.promoUsers === 0 ? 0 : point.promoDiagnostics / point.promoUsers,
      controlPerUser:
        point.controlUsers === 0
          ? 0
          : point.controlDiagnostics / point.controlUsers,
    }));

  const relative: RelativePoint[] = ((relativeResult.data ?? []) as RelativeDbRow[])
    .map((row) => ({
      date: row.rel_week === 0 ? "promo" : `w${row.rel_week > 0 ? "+" : ""}${row.rel_week}`,
      relWeek: row.rel_week,
      diagnostics: row.diagnostics,
      users: row.active_users,
    }))
    .sort((a, b) => a.relWeek - b.relWeek);

  const withAnchor = users.filter(
    (user) => user.appliedAt && !user.isInternal,
  );
  const beforeAfter: BeforeAfterRow[] = [
    {
      label: "Diagnoses, all time",
      before: withAnchor.reduce((s, u) => s + u.diagnosticsBefore, 0),
      after: withAnchor.reduce((s, u) => s + u.diagnosticsAfter, 0),
      delta: 0,
      users: withAnchor.length,
    },
    {
      label: "Users who had never diagnosed before the promo",
      before: withAnchor.filter((u) => u.diagnosticsBefore === 0).length,
      after: withAnchor.filter(
        (u) => u.diagnosticsBefore === 0 && u.diagnosticsAfter > 0,
      ).length,
      delta: 0,
      users: withAnchor.filter((u) => u.diagnosticsBefore === 0).length,
    },
    {
      label: "Diagnoses in the 30 days after the promo",
      before: 0,
      after: withAnchor.reduce((s, u) => s + u.diagnosticsAfter30d, 0),
      delta: 0,
      users: withAnchor.length,
    },
  ].map((row) => ({ ...row, delta: row.after - row.before }));

  // ---- event detail, promo contacts only ---------------------------------
  const contactIds = [
    ...new Set(users.map((user) => user.contactId).filter(Boolean) as string[]),
  ];
  const promoUserIds = [...new Set(users.map((user) => user.userId))];

  const [
    callRows,
    emailRows,
    replyRows,
    activityRows,
    diagnosticRows,
    profileRows,
    mailboxRows,
  ] = await Promise.all([
    contactIds.length > 0
      ? pageAll<CallDbRow>(({ from, to }) =>
          supabase
            .from("call_sessions")
            .select(
              "id, contact_id, user_id, direction, started_at, connected_at, duration_seconds, summary",
            )
            .in("contact_id", contactIds)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as CallDbRow[], error: null }),
    contactIds.length > 0
      ? pageAll<EmailDbRow>(({ from, to }) =>
          supabase
            .from("email_queue")
            .select("id, contact_id, sender_account_id, step_id, subject, sent_at")
            .in("contact_id", contactIds)
            .eq("status", "sent")
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as EmailDbRow[], error: null }),
    contactIds.length > 0
      ? pageAll<ReplyDbRow>(({ from, to }) =>
          supabase
            .from("inbox_messages")
            .select("id, contact_id, from_email, subject, received_at")
            .in("contact_id", contactIds)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as ReplyDbRow[], error: null }),
    contactIds.length > 0
      ? pageAll<ActivityDbRow>(({ from, to }) =>
          supabase
            .from("activities")
            .select("id, contact_id, type, outcome")
            .in("contact_id", contactIds)
            .eq("type", "call")
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as ActivityDbRow[], error: null }),
    promoUserIds.length > 0
      ? pageAll<DiagnosticDbRow>(({ from, to }) =>
          supabase
            .from(TABLES.diagnostics)
            .select("diagnostic_id, internal_user_id, created_at, has_chat, metadata")
            .in("internal_user_id", promoUserIds)
            .order("diagnostic_id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as DiagnosticDbRow[], error: null }),
    pageAll<ProfileDbRow>(({ from, to }) =>
      supabase
        .from("user_profiles")
        .select("user_id, full_name")
        .order("user_id", { ascending: true })
        .range(from, to),
    ),
    pageAll<MailboxDbRow>(({ from, to }) =>
      supabase
        .from("gmail_accounts")
        .select("id, email_address, display_name")
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const emailIds = emailRows.data.map((row) => row.id);
  const [eventRows, stepRows] = await Promise.all([
    emailIds.length > 0
      ? pageAll<EventDbRow>(({ from, to }) =>
          supabase
            .from("email_events")
            .select("email_queue_id, event_type")
            .in("email_queue_id", emailIds)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as EventDbRow[], error: null }),
    (() => {
      const stepIds = [
        ...new Set(
          emailRows.data.map((row) => row.step_id).filter(Boolean) as string[],
        ),
      ];
      return stepIds.length > 0
        ? pageAll<StepDbRow>(({ from, to }) =>
            supabase
              .from("sequence_steps")
              .select("id, sequence_id")
              .in("id", stepIds)
              .order("id", { ascending: true })
              .range(from, to),
          )
        : Promise.resolve({ data: [] as StepDbRow[], error: null });
    })(),
  ]);

  const sequenceIds = [
    ...new Set(
      stepRows.data.map((row) => row.sequence_id).filter(Boolean) as string[],
    ),
  ];
  const sequenceRows =
    sequenceIds.length > 0
      ? await pageAll<SequenceDbRow>(({ from, to }) =>
          supabase
            .from("sequences")
            .select("id, name")
            .in("id", sequenceIds)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : { data: [] as SequenceDbRow[], error: null };

  const repName = new Map(
    profileRows.data.map((row) => [row.user_id, row.full_name]),
  );
  const mailbox = new Map(
    mailboxRows.data.map((row) => [
      row.id,
      row.display_name || row.email_address,
    ]),
  );
  const sequenceOfStep = new Map(
    stepRows.data.map((row) => [row.id, row.sequence_id]),
  );
  const sequenceName = new Map(
    sequenceRows.data.map((row) => [row.id, row.name]),
  );
  const callOutcome = new Map<string, string | null>();
  for (const row of activityRows.data) {
    if (row.contact_id && row.outcome) {
      callOutcome.set(row.contact_id, row.outcome);
    }
  }

  const opened = new Set<string>();
  const clicked = new Set<string>();
  const repliedTo = new Set<string>();
  for (const event of eventRows.data) {
    if (!event.email_queue_id) continue;
    if (event.event_type === "open") opened.add(event.email_queue_id);
    if (event.event_type === "click") clicked.add(event.email_queue_id);
    if (event.event_type === "reply") repliedTo.add(event.email_queue_id);
  }

  // contact -> the promo user(s) sharing it, for labelling event rows
  const userByContact = new Map<string, PromoUserRow>();
  for (const user of users) {
    if (user.contactId && !userByContact.has(user.contactId)) {
      userByContact.set(user.contactId, user);
    }
  }
  const promoAnchorByContact = new Map<string, string | null>();
  for (const user of users) {
    if (user.contactId && !promoAnchorByContact.has(user.contactId)) {
      promoAnchorByContact.set(user.contactId, user.appliedAt);
    }
  }

  const calls: CallLogRow[] = callRows.data
    .map((row) => {
      const user = row.contact_id ? userByContact.get(row.contact_id) : undefined;
      const anchor = row.contact_id
        ? (promoAnchorByContact.get(row.contact_id) ?? null)
        : null;
      return {
        id: row.id,
        at: row.started_at,
        email: user?.email ?? null,
        workshop: user?.workshop ?? null,
        rep: row.user_id ? (repName.get(row.user_id) ?? null) : null,
        direction: row.direction,
        connected: row.connected_at !== null,
        durationSeconds: row.duration_seconds,
        outcome: row.contact_id
          ? (callOutcome.get(row.contact_id) ?? null)
          : null,
        summary: row.summary,
        daysFromPromo: daysBetween(anchor, row.started_at),
      } satisfies CallLogRow;
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  const emails: EmailLogRow[] = emailRows.data
    .map((row) => {
      const user = row.contact_id ? userByContact.get(row.contact_id) : undefined;
      const anchor = row.contact_id
        ? (promoAnchorByContact.get(row.contact_id) ?? null)
        : null;
      const sequenceId = row.step_id
        ? (sequenceOfStep.get(row.step_id) ?? null)
        : null;
      return {
        id: row.id,
        at: row.sent_at,
        email: user?.email ?? null,
        workshop: user?.workshop ?? null,
        sender: row.sender_account_id
          ? (mailbox.get(row.sender_account_id) ?? null)
          : null,
        subject: row.subject,
        sequence: sequenceId ? (sequenceName.get(sequenceId) ?? null) : null,
        opened: opened.has(row.id),
        clicked: clicked.has(row.id),
        replied: repliedTo.has(row.id),
        daysFromPromo: daysBetween(anchor, row.sent_at),
      } satisfies EmailLogRow;
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  // ---- per-user timeline --------------------------------------------------
  const diagnosticsByUser = new Map<string, DiagnosticDbRow[]>();
  for (const row of diagnosticRows.data) {
    if (!row.internal_user_id) continue;
    const list = diagnosticsByUser.get(row.internal_user_id) ?? [];
    list.push(row);
    diagnosticsByUser.set(row.internal_user_id, list);
  }

  const timeline: TimelineUser[] = users
    .map((user) => {
      const events: TimelineEvent[] = [];

      if (user.signedUpAt) {
        events.push({
          id: `signup-${user.userId}`,
          at: user.signedUpAt,
          kind: "signup",
          actor: null,
          title: "Signed up",
          detail: user.workshop,
          outcome: null,
        });
      }
      if (user.appliedAt) {
        events.push({
          id: `promo-${user.userId}`,
          at: user.appliedAt,
          kind: "promo",
          actor: null,
          title: `Promo applied: ${user.code ?? user.couponId ?? "coupon"}`,
          detail: user.terms,
          outcome: null,
        });
      }
      for (const call of calls) {
        if (call.email !== user.email) continue;
        events.push({
          id: `call-${call.id}`,
          at: call.at ?? "",
          kind: "call",
          actor: call.rep,
          title: `${call.direction === "inbound" ? "Inbound" : "Outbound"} call`,
          detail: call.summary,
          outcome: call.connected
            ? `connected${call.durationSeconds ? ` ${call.durationSeconds}s` : ""}`
            : "not connected",
        });
      }
      for (const mail of emails) {
        if (mail.email !== user.email) continue;
        events.push({
          id: `email-${mail.id}`,
          at: mail.at ?? "",
          kind: "email",
          actor: mail.sender,
          title: mail.subject ?? "(no subject)",
          detail: mail.sequence,
          outcome: [
            mail.opened ? "opened" : null,
            mail.clicked ? "clicked" : null,
            mail.replied ? "replied" : null,
          ]
            .filter(Boolean)
            .join(", ") || null,
        });
      }
      for (const reply of replyRows.data) {
        if (!reply.contact_id || reply.contact_id !== user.contactId) continue;
        events.push({
          id: `reply-${reply.id}`,
          at: reply.received_at ?? "",
          kind: "reply",
          actor: reply.from_email,
          title: reply.subject ?? "(no subject)",
          detail: null,
          outcome: null,
        });
      }
      for (const diagnostic of diagnosticsByUser.get(user.userId) ?? []) {
        const meta = diagnostic.metadata ?? {};
        const car = [meta.car_make, meta.car_model, meta.car_year]
          .filter((part) => typeof part === "string" || typeof part === "number")
          .join(" ");
        events.push({
          id: `diag-${diagnostic.diagnostic_id}`,
          at: diagnostic.created_at ?? "",
          kind: "diagnosis",
          actor: null,
          title: car || "Diagnosis",
          detail:
            typeof meta.description === "string" ? meta.description : null,
          outcome: diagnostic.has_chat ? "with chat" : null,
        });
      }

      return {
        userId: user.userId,
        email: user.email,
        workshop: user.workshop,
        code: user.code,
        appliedAt: user.appliedAt,
        diagnostics: user.diagnostics,
        events: events
          .filter((event) => event.at)
          .sort((a, b) => b.at.localeCompare(a.at)),
      } satisfies TimelineUser;
    })
    .sort((a, b) => b.events.length - a.events.length);

  // ---- product-use rollups ------------------------------------------------
  const metaRows = diagnosticRows.data.map((row) => ({
    uid: row.internal_user_id,
    meta: row.metadata ?? {},
  }));
  const searchTerms = topTerms(
    metaRows.map((row) => ({
      uid: row.uid,
      values: asStrings(row.meta.description),
    })),
    25,
  );
  const carMakes = topTerms(
    metaRows.map((row) => ({
      uid: row.uid,
      values: asStrings(row.meta.car_make),
    })),
    15,
  );
  const dtcs = topTerms(
    metaRows.map((row) => ({ uid: row.uid, values: asStrings(row.meta.dtcs) })),
    20,
  );
  const symptoms = topTerms(
    metaRows.map((row) => ({
      uid: row.uid,
      values: asStrings(row.meta.symptoms),
    })),
    20,
  );

  // ---- funnel by cohort ---------------------------------------------------
  const funnelDefs: Array<{
    key: string;
    label: string;
    description: string;
    pick: (row: CohortDbRow) => number;
  }> = [
    {
      key: "signed_up",
      label: "Signed up",
      description: "Every app user in the cohort.",
      pick: (row) => Number(row.users ?? 0),
    },
    {
      key: "logged_in",
      label: "Logged in",
      description: "At least one recorded login.",
      pick: (row) => Number(row.stage_logged_in ?? 0),
    },
    {
      key: "activated",
      label: "Ran a diagnosis",
      description: "The core action, at least once.",
      pick: (row) => Number(row.stage_activated ?? 0),
    },
    {
      key: "repeat",
      label: "Came back for a second",
      description: "Two or more diagnoses.",
      pick: (row) => Number(row.stage_repeat ?? 0),
    },
    {
      key: "habit",
      label: "Ten or more diagnoses",
      description: "Using it as part of the workflow.",
      pick: (row) => Number(row.stage_habit ?? 0),
    },
    {
      key: "paid",
      label: "Paid real money",
      description: "At least one invoice where money actually moved.",
      pick: (row) => Number(row.stage_paid ?? 0),
    },
    {
      key: "active_now",
      label: "Still active (30d)",
      description: "A diagnosis in the last 30 days.",
      pick: (row) => Number(row.stage_active_30d ?? 0),
    },
  ];

  const funnel: FunnelStage[] = funnelDefs.map((def) => {
    const counts = {} as Record<CohortKey, number>;
    const pct = {} as Record<CohortKey, number>;
    for (const key of cohortOrder) {
      const row = cohortByKey.get(key);
      const total = Number(row?.users ?? 0);
      const n = row ? def.pick(row) : 0;
      counts[key] = n;
      pct[key] = total === 0 ? 0 : (n / total) * 100;
    }
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      counts,
      pct,
    };
  });

  // ---- buckets and KPIs (recipient level) --------------------------------
  const byRecipient = new Map<string, PromoUserRow[]>();
  for (const user of users) {
    const key = user.email?.toLowerCase() ?? user.userId;
    const list = byRecipient.get(key) ?? [];
    list.push(user);
    byRecipient.set(key, list);
  }
  const recipientRows = [...byRecipient.values()];

  const bucketOf = (rows: PromoUserRow[]) => {
    const diagnostics = Math.max(...rows.map((row) => row.diagnostics));
    const logins = Math.max(...rows.map((row) => row.logins));
    if (diagnostics === 0 && logins === 0) return "never_logged_in" as const;
    if (diagnostics === 0) return "logged_in_no_diagnosis" as const;
    if (diagnostics === 1) return "one_diagnosis" as const;
    return "repeat" as const;
  };

  const engagementDefs = [
    {
      key: "never_logged_in" as const,
      label: "Never logged in",
      description: "Got the discount and never came back at all.",
    },
    {
      key: "logged_in_no_diagnosis" as const,
      label: "Logged in, never diagnosed",
      description: "Reached the app but never ran the core action.",
    },
    {
      key: "one_diagnosis" as const,
      label: "One diagnosis",
      description: "Tried it once and stopped.",
    },
    {
      key: "repeat" as const,
      label: "Repeat user",
      description: "Two or more diagnoses, the discount landed.",
    },
  ];

  const engagement: PromoEngagementBucket[] = engagementDefs.map((def) => {
    const matching = recipientRows.filter((rows) => bucketOf(rows) === def.key);
    return {
      ...def,
      count: matching.length,
      emails: matching.map((rows) => rows[0]?.email ?? "(unknown)").sort(),
    };
  });

  const outreachOf = (rows: PromoUserRow[]) => {
    // Deduped by contact so a shared workshop mailbox is not counted twice.
    const seen = new Set<string>();
    let called = false;
    let emailed = false;
    for (const row of rows) {
      const key = row.contactId ?? row.userId;
      if (seen.has(key)) continue;
      seen.add(key);
      if (row.calls > 0) called = true;
      if (row.emailsSent > 0) emailed = true;
    }
    if (called && emailed) return "called_and_emailed" as const;
    if (emailed) return "emailed_only" as const;
    if (called) return "called_only" as const;
    return "neither" as const;
  };

  const outreachDefs = [
    { key: "called_and_emailed" as const, label: "Called and emailed" },
    { key: "emailed_only" as const, label: "Emailed only" },
    { key: "called_only" as const, label: "Called only" },
    { key: "neither" as const, label: "Never called or emailed" },
  ];

  const outreach: PromoOutreachBucket[] = outreachDefs.map((def) => {
    const matching = recipientRows.filter((rows) => outreachOf(rows) === def.key);
    return {
      ...def,
      count: matching.length,
      emails: matching.map((rows) => rows[0]?.email ?? "(unknown)").sort(),
    };
  });

  const daysToFirstUse = users
    .map((user) => daysBetween(user.appliedAt, user.diagnosticsFirstAt))
    .filter((value): value is number => value !== null);

  const kpis = {
    recipients: recipientKeys.size,
    users: users.length,
    externalRecipients: recipientRows.filter((rows) =>
      rows.every((row) => !row.isInternal),
    ).length,
    internalRecipients: recipientRows.filter((rows) =>
      rows.some((row) => row.isInternal),
    ).length,
    activeNow: new Set(
      grantViews
        .filter((grant) => grant.active)
        .map((grant) => grant.email?.toLowerCase() ?? grant.grantId),
    ).size,
    everPaid: recipientRows.filter((rows) => rows.some((row) => row.everPaid))
      .length,
    neverDiagnosed: recipientRows.filter((rows) =>
      rows.every((row) => row.diagnostics === 0),
    ).length,
    neverContacted: recipientRows.filter(
      (rows) => outreachOf(rows) === "neither",
    ).length,
    everCalled: recipientRows.filter((rows) => rows.some((row) => row.calls > 0))
      .length,
    distinctCodes: new Set(
      grantViews.map((grant) => grant.code ?? `coupon:${grant.couponId}`),
    ).size,
    medianDaysToFirstUse:
      daysToFirstUse.length > 0 ? median(daysToFirstUse) : null,
  };

  const unresolvedGrants = grantViews.filter((grant) => {
    const key = grant.email?.toLowerCase();
    return !key || !usersByEmail.has(key);
  }).length;

  return {
    kpis,
    money,
    cohorts,
    users,
    grants: grantViews,
    codes,
    weekly,
    relative,
    beforeAfter,
    timeline,
    calls,
    emails,
    funnel,
    engagement,
    outreach,
    searchTerms,
    carMakes,
    dtcs,
    symptoms,
    unresolvedGrants,
    note: `${NOTE} ${CAUSALITY_NOTE}`,
    error: null,
  };
}

export const getPromoUsersData = unstable_cache(
  getPromoUsersDataUncached,
  ["ceo-promo-users"],
  CEO_CACHE_OPTIONS,
);
