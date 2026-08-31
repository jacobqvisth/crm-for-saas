// Loader for /dashboard/paying-customers.
//
// Joins four things that have never been in one place: who an ad brought in
// (GA4 first-touch, already synced into dashboard_user_attribution), what they
// did (diagnostics), whether they entered a card (Stripe customer), and whether
// Stripe ever actually charged them. Then it puts Google Ads' own conversion
// counts alongside, because the gap between the two is the finding.
//
// Every read pages. dashboard_users alone is past 1,900 rows and PostgREST
// truncates any response at 1000 without an error, so a plain select here would
// silently drop a third of the users and quietly overstate every rate that has
// signups in the denominator.

import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";
import {
  ADS_ERA_START,
  USD_TO_SEK,
  channelLabel,
  type CampaignPayerRow,
  type ChannelFunnel,
  type ConversionActionRow,
  type PayingCustomerRow,
  type PayingCustomersData,
  type ReconciliationRow,
} from "@/lib/ceo/paying-customers/shared";
import {
  buildChannelFunnel,
  daysBetween,
  maturityCutoff,
  selectMatureCohort,
  pct,
  type WorkshopFacts,
} from "@/lib/ceo/paying-customers/funnel";

type AttributionRow = {
  internal_user_id: string | null;
  channel: string | null;
  google_ads_campaign: string | null;
  first_campaign: string | null;
};

type UserRow = {
  internal_user_id: string | null;
  workshop_id: string | null;
  signed_up_at: string | null;
};

type WorkshopRow = {
  workshop_id: string;
  name: string | null;
  country: string | null;
};

type SubscriptionRow = {
  workshop_id: string | null;
  status: string | null;
  plan_key: string | null;
  mrr_amount_cents: number | null;
  currency: string | null;
  metadata: Record<string, unknown> | null;
};

type DiagnosticRow = { workshop_id: string | null };

type SpendRow = { metric_key: string; period_start: string; value: number };

type ActionConfigRow = {
  conversion_action_id: string;
  name: string;
  category: string | null;
  status: string | null;
  primary_for_goal: boolean | null;
  include_in_conversions_metric: boolean | null;
  counting_type: string | null;
  synced_at: string | null;
};

type ActionStatRow = {
  conversion_action_id: string;
  campaign_id: string;
  stat_date: string;
  all_conversions: number | string | null;
  all_conversions_value: number | string | null;
};

function num(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthOf(iso: string | null): string | null {
  return iso ? iso.slice(0, 7) : null;
}

function emptyData(reason: string | null, configured: boolean): PayingCustomersData {
  return {
    generatedAt: new Date().toISOString(),
    configured,
    emptyReason: reason,
    adsLastSyncedAt: null,
    adPayersAllTime: 0,
    adCheckoutsAllTime: 0,
    adSignupsAllTime: 0,
    adSpendSek: 0,
    costPerAdPayerSek: null,
    costPerAdCheckoutSek: null,
    maturityCutoff: "",
    funnels: [],
    customers: [],
    reconciliation: [],
    conversionActions: [],
    campaigns: [],
  };
}

async function loadPayingCustomers(): Promise<PayingCustomersData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyData("Supabase is not configured.", false);

  const [
    attributionRes,
    usersRes,
    workshopsRes,
    subsRes,
    diagsRes,
    spendRes,
    actionsRes,
    statsRes,
  ] = await Promise.all([
    pageAll<AttributionRow>(({ from, to }) =>
      supabase
        .from(TABLES.userAttribution)
        .select("internal_user_id, channel, google_ads_campaign, first_campaign")
        .order("internal_user_id")
        .range(from, to),
    ),
    pageAll<UserRow>(({ from, to }) =>
      supabase
        .from(TABLES.users)
        .select("internal_user_id, workshop_id, signed_up_at")
        .eq("is_internal_test", false)
        .order("internal_user_id")
        .range(from, to),
    ),
    pageAll<WorkshopRow>(({ from, to }) =>
      supabase
        .from(TABLES.workshops)
        .select("workshop_id, name, country")
        .eq("is_internal_test", false)
        .order("workshop_id")
        .range(from, to),
    ),
    pageAll<SubscriptionRow>(({ from, to }) =>
      supabase
        .from(TABLES.subscriptions)
        .select("workshop_id, status, plan_key, mrr_amount_cents, currency, metadata")
        .order("stripe_subscription_id")
        .range(from, to),
    ),
    pageAll<DiagnosticRow>(({ from, to }) =>
      supabase
        .from(TABLES.diagnostics)
        .select("workshop_id")
        // `diagnostic_id` and not `created_at`: `.range()` slices are only
        // deterministic over a UNIQUE ordering, and a non-unique one both
        // duplicates and skips rows across page boundaries.
        .order("diagnostic_id")
        .range(from, to),
    ),
    pageAll<SpendRow>(({ from, to }) =>
      supabase
        .from(TABLES.metricSnapshots)
        .select("metric_key, period_start, value")
        // One row per (campaign, day) with no "total" dimension row, so sum
        // across campaigns rather than filtering on dimension_key.
        .eq("source_key", "google_ads")
        .in("metric_key", ["ad_spend"])
        .order("id")
        .range(from, to),
    ),
    pageAll<ActionConfigRow>(({ from, to }) =>
      supabase
        .from("dashboard_ad_conversion_actions")
        .select(
          "conversion_action_id, name, category, status, primary_for_goal, include_in_conversions_metric, counting_type, synced_at",
        )
        .order("conversion_action_id")
        .range(from, to),
    ),
    pageAll<ActionStatRow>(({ from, to }) =>
      supabase
        .from("dashboard_ad_conversion_stats")
        .select(
          "conversion_action_id, campaign_id, stat_date, all_conversions, all_conversions_value",
        )
        .eq("campaign_id", "")
        // Two columns because one is not unique. Within the campaign_id = ''
        // slice the primary key reduces to (conversion_action_id, stat_date),
        // so ordering on the date alone would page non-deterministically.
        .order("conversion_action_id")
        .order("stat_date")
        .range(from, to),
    ),
  ]);

  const firstError =
    attributionRes.error ??
    usersRes.error ??
    workshopsRes.error ??
    subsRes.error ??
    diagsRes.error ??
    spendRes.error ??
    actionsRes.error ??
    statsRes.error;
  if (firstError) return emptyData(`Could not read data: ${firstError.message}`, true);

  // ---- index -----------------------------------------------------------
  const channelByUser = new Map<string, string>();
  const campaignByUser = new Map<string, string | null>();
  for (const row of attributionRes.data) {
    if (!row.internal_user_id) continue;
    channelByUser.set(row.internal_user_id, row.channel ?? "none");
    campaignByUser.set(
      row.internal_user_id,
      row.google_ads_campaign ?? row.first_campaign ?? null,
    );
  }

  const activatedWorkshops = new Set<string>();
  for (const row of diagsRes.data) {
    if (row.workshop_id) activatedWorkshops.add(row.workshop_id);
  }

  // Checkout = a Stripe customer exists. First paid = Stripe actually charged.
  // Keeping these apart is the entire point of the page; `plan_key` is stamped
  // at checkout during the trial and would call both of them "paid".
  const checkoutAt = new Map<string, string>();
  const firstPaidAt = new Map<string, string>();
  const subByWorkshop = new Map<string, SubscriptionRow>();
  for (const sub of subsRes.data) {
    if (!sub.workshop_id) continue;
    const meta = sub.metadata ?? {};

    const created = typeof meta["customer_created_at"] === "string"
      ? (meta["customer_created_at"] as string)
      : null;
    if (created) {
      const existing = checkoutAt.get(sub.workshop_id);
      if (!existing || created < existing) checkoutAt.set(sub.workshop_id, created);
    }

    if (String(meta["ever_paid"]) === "true") {
      const paid = typeof meta["first_paid_at"] === "string"
        ? (meta["first_paid_at"] as string)
        : null;
      if (paid) {
        const existing = firstPaidAt.get(sub.workshop_id);
        if (!existing || paid < existing) firstPaidAt.set(sub.workshop_id, paid);
      } else if (!firstPaidAt.has(sub.workshop_id)) {
        // Charged, but Stripe never wrote the timestamp. Recording an empty
        // string would sort wrong and read as a date; the customer list shows
        // "date unknown" instead of dropping a real payer.
        firstPaidAt.set(sub.workshop_id, "");
      }
      subByWorkshop.set(sub.workshop_id, sub);
    } else if (!subByWorkshop.has(sub.workshop_id)) {
      subByWorkshop.set(sub.workshop_id, sub);
    }
  }

  const workshopMeta = new Map<string, WorkshopRow>();
  for (const w of workshopsRes.data) workshopMeta.set(w.workshop_id, w);

  // One record per workshop. A workshop can have several users; the earliest
  // signup and its channel is the acquisition event.
  const facts = new Map<string, WorkshopFacts & { campaign: string | null }>();
  for (const user of usersRes.data) {
    if (!user.workshop_id || !user.signed_up_at) continue;
    if (!workshopMeta.has(user.workshop_id)) continue; // internal-test filtered out
    const existing = facts.get(user.workshop_id);
    if (existing && existing.signedUpAt && existing.signedUpAt <= user.signed_up_at) {
      continue;
    }
    const channel = user.internal_user_id
      ? (channelByUser.get(user.internal_user_id) ?? "none")
      : "none";
    const campaign = user.internal_user_id
      ? (campaignByUser.get(user.internal_user_id) ?? null)
      : null;
    const paid = firstPaidAt.get(user.workshop_id);
    facts.set(user.workshop_id, {
      workshopId: user.workshop_id,
      channel,
      campaign,
      signedUpAt: user.signed_up_at,
      checkoutAt: checkoutAt.get(user.workshop_id) ?? null,
      firstPaidAt: paid === undefined ? null : paid,
      activated: activatedWorkshops.has(user.workshop_id),
    });
  }

  const allFacts = [...facts.values()];

  // ---- headline (all time, ads only) -----------------------------------
  const adFacts = allFacts.filter((f) => f.channel === "google_ads");
  const adPayersAllTime = adFacts.filter((f) => f.firstPaidAt !== null).length;
  const adCheckoutsAllTime = adFacts.filter((f) => f.checkoutAt !== null).length;

  let spendUsd = 0;
  for (const row of spendRes.data) spendUsd += num(row.value);
  const adSpendSek = spendUsd * USD_TO_SEK;

  // ---- funnels (mature ads-era cohort) ---------------------------------
  const now = new Date();
  const cutoff = maturityCutoff(now);
  const mature = selectMatureCohort(allFacts, ADS_ERA_START, cutoff);

  const channels = [...new Set(mature.map((f) => f.channel))];
  const funnels: ChannelFunnel[] = channels
    .map((c) => buildChannelFunnel(mature, c, channelLabel(c)))
    .filter((f) => f.workshops > 0)
    .sort((a, b) => b.workshops - a.workshops);

  // ---- named paying customers ------------------------------------------
  const customers: PayingCustomerRow[] = allFacts
    .filter((f) => f.firstPaidAt !== null && f.channel === "google_ads")
    .map((f) => {
      const meta = workshopMeta.get(f.workshopId);
      const sub = subByWorkshop.get(f.workshopId);
      const paidIso = f.firstPaidAt && f.firstPaidAt.length > 0 ? f.firstPaidAt : null;
      return {
        workshopId: f.workshopId,
        name: meta?.name ?? null,
        country: meta?.country ?? null,
        channel: f.channel,
        campaign: f.campaign,
        signedUpAt: f.signedUpAt,
        checkoutAt: f.checkoutAt,
        firstPaidAt: paidIso,
        daysSignupToPaid:
          f.signedUpAt && paidIso ? Math.round(daysBetween(f.signedUpAt, paidIso)) : null,
        planKey: sub?.plan_key ?? null,
        mrrMinorUnits: sub?.mrr_amount_cents ?? null,
        currency: sub?.currency ?? null,
        status: sub?.status ?? null,
      } satisfies PayingCustomerRow;
    })
    .sort((a, b) => (b.firstPaidAt ?? "").localeCompare(a.firstPaidAt ?? ""));

  // ---- per campaign ----------------------------------------------------
  const campaignAgg = new Map<string, { w: number; c: number; p: number }>();
  for (const f of adFacts) {
    const key = f.campaign ?? "(campaign unknown)";
    const e = campaignAgg.get(key) ?? { w: 0, c: 0, p: 0 };
    e.w += 1;
    if (f.checkoutAt !== null) e.c += 1;
    if (f.firstPaidAt !== null) e.p += 1;
    campaignAgg.set(key, e);
  }
  const campaigns: CampaignPayerRow[] = [...campaignAgg.entries()]
    .map(([campaign, e]) => ({
      campaign,
      workshops: e.w,
      checkouts: e.c,
      payers: e.p,
      paidPct: pct(e.p, e.w),
    }))
    .sort((a, b) => b.payers - a.payers || b.workshops - a.workshops);

  // ---- Google's own numbers --------------------------------------------
  const actionById = new Map<string, ActionConfigRow>();
  for (const a of actionsRes.data) actionById.set(a.conversion_action_id, a);

  const adsLastSyncedAt = actionsRes.data.reduce<string | null>((latest, row) => {
    if (!row.synced_at) return latest;
    return !latest || row.synced_at > latest ? row.synced_at : latest;
  }, null);

  const last30Start = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const per30 = new Map<string, { c: number; v: number }>();
  const byMonth = new Map<string, Map<string, { c: number; v: number }>>();
  for (const row of statsRes.data) {
    const month = row.stat_date.slice(0, 7);
    const m = byMonth.get(month) ?? new Map<string, { c: number; v: number }>();
    const e = m.get(row.conversion_action_id) ?? { c: 0, v: 0 };
    e.c += num(row.all_conversions);
    e.v += num(row.all_conversions_value);
    m.set(row.conversion_action_id, e);
    byMonth.set(month, m);

    if (row.stat_date >= last30Start) {
      const t = per30.get(row.conversion_action_id) ?? { c: 0, v: 0 };
      t.c += num(row.all_conversions);
      t.v += num(row.all_conversions_value);
      per30.set(row.conversion_action_id, t);
    }
  }

  const conversionActions: ConversionActionRow[] = actionsRes.data
    .filter((a) => a.status === "ENABLED" || (per30.get(a.conversion_action_id)?.c ?? 0) > 0)
    .map((a) => ({
      id: a.conversion_action_id,
      name: a.name,
      category: a.category,
      status: a.status,
      primaryForGoal: a.primary_for_goal,
      includeInConversionsMetric: a.include_in_conversions_metric,
      countingType: a.counting_type,
      drivesBidding:
        a.primary_for_goal === true && a.include_in_conversions_metric === true,
      last30dConversions: per30.get(a.conversion_action_id)?.c ?? 0,
      last30dValue: per30.get(a.conversion_action_id)?.v ?? 0,
    }))
    .sort((a, b) => b.last30dConversions - a.last30dConversions);

  // Match Google's actions by name rather than by a hard-coded id, so a
  // rebuilt action (this account has several REMOVED duplicates) keeps working.
  const signupIds = actionsRes.data
    .filter((a) => a.category === "SIGNUP")
    .map((a) => a.conversion_action_id);
  const purchaseIds = actionsRes.data
    .filter((a) => a.category === "PURCHASE")
    .map((a) => a.conversion_action_id);

  const months = new Set<string>([...byMonth.keys()]);
  for (const f of adFacts) {
    const c = monthOf(f.checkoutAt);
    const p = monthOf(f.firstPaidAt && f.firstPaidAt.length > 0 ? f.firstPaidAt : null);
    if (c && c >= ADS_ERA_START.slice(0, 7)) months.add(c);
    if (p && p >= ADS_ERA_START.slice(0, 7)) months.add(p);
  }

  const reconciliation: ReconciliationRow[] = [...months]
    .filter((m) => m >= ADS_ERA_START.slice(0, 7))
    .sort()
    .map((month) => {
      const m = byMonth.get(month);
      const sum = (ids: string[], field: "c" | "v") =>
        ids.reduce((acc, id) => acc + (m?.get(id)?.[field] ?? 0), 0);
      return {
        month,
        googleSignups: sum(signupIds, "c"),
        googlePurchases: sum(purchaseIds, "c"),
        googlePurchaseValue: sum(purchaseIds, "v"),
        ourAdCheckouts: adFacts.filter((f) => monthOf(f.checkoutAt) === month).length,
        ourAdFirstPayments: adFacts.filter(
          (f) =>
            monthOf(f.firstPaidAt && f.firstPaidAt.length > 0 ? f.firstPaidAt : null) ===
            month,
        ).length,
      } satisfies ReconciliationRow;
    });

  return {
    generatedAt: now.toISOString(),
    configured: true,
    emptyReason: null,
    adsLastSyncedAt,
    adPayersAllTime,
    adCheckoutsAllTime,
    adSignupsAllTime: adFacts.length,
    adSpendSek,
    costPerAdPayerSek: adPayersAllTime > 0 ? adSpendSek / adPayersAllTime : null,
    costPerAdCheckoutSek:
      adCheckoutsAllTime > 0 ? adSpendSek / adCheckoutsAllTime : null,
    maturityCutoff: cutoff,
    funnels,
    customers,
    reconciliation,
    conversionActions,
    campaigns,
  };
}

export const getPayingCustomersData = unstable_cache(
  loadPayingCustomers,
  ["ceo-paying-customers"],
  CEO_CACHE_OPTIONS,
);
