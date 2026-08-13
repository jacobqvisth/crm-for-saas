// Data loader for the top-level /funnel page.
//
// One read, three questions:
//   1. Shape: how many workshops sit at each funnel stage (signed up ->
//      activated -> ever paid -> active today), split by entry channel.
//   2. Origin of payers: for every workshop that ever paid, which channel
//      touched it BEFORE signup (outbound email / call / partner / pre-ads
//      organic / ads-era self-serve).
//   3. Trigger of payers: what happened between signup and first payment
//      (activated first? trial? paywall/quota friction? one of our CRM
//      emails or calls?), joined from PostHog + CRM activity.
//
// Counting rules (same as the funnel report, 2026-08-12): the unit is the
// WORKSHOP, internal-test is always excluded, and attribution is reported
// with an explicit "unknown" bucket rather than silently dropped.
import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { runPostHogQuery } from "@/lib/ceo/sync/sources/posthog";
import { TABLES } from "@/lib/ceo/tables";
import { PAID_PLANS } from "@/lib/calls/scoring";
import { chunkedIn, pageAll } from "@/lib/supabase-paging";

// Google Ads Pmax launched 2026-05-19 and 12x'd signups within weeks. Signups
// before this date cannot have come from ads; after it, unattributed signups
// are overwhelmingly ads/app-store driven.
const ADS_ERA_START = "2026-05-19";

export type FunnelStageCounts = {
  signedUp: number;
  activated: number;
  /** Workshops with charge evidence (ever_paid / converted trial / legacy paid plan). */
  everPaid: number;
  /** Paid plan_key but still trialing and never charged: pipeline, not payers. */
  paidPlanTrials: number;
  activeSubs: number;
  trialing: number;
};

export type PayerOriginBucket = {
  key:
    | "outbound_email"
    | "outbound_call"
    | "partner"
    | "pre_ads_organic"
    | "google_ads"
    | "self_serve_other"
    | "ads_era_self_serve"
    | "unknown";
  label: string;
  count: number;
  description: string;
};

export type PayerTriggerCounts = {
  // Product behaviour before first payment (all payers, from dashboard_*).
  activatedBeforePaying: number;
  paidWithoutActivating: number;
  /** Payers with no first-paid timestamp anywhere (legacy/comped plans). */
  paidDateUnknown: number;
  cameThroughTrial: number;
  directToPaid: number;
  // CRM touches between signup and first payment.
  crmEmailedBeforePaying: number;
  crmCalledBeforePaying: number;
  // PostHog friction events before subscription_started (June 2026+ payers
  // only; PostHog history starts 2026-06-08).
  posthogSubscribers: number;
  priorPaywallHit: number;
  priorQuotaExceeded: number;
  priorBillingPageOpened: number;
  priorUpgradeStarted: number;
  priorTrialStarted: number;
  priorDiagnosticRun: number;
  /** Subscribers with a paywall OR quota event before subscribing. */
  priorPaywallOrQuota: number;
  noFrictionEvent: number;
  /** All persons who ever hit a paywall or quota (subscribed or not). */
  frictionUsersTotal: number;
  posthogError?: string;
};

export type LifecycleCampaignRow = {
  campaignId: string;
  name: string;
  state: string;
  sent: number;
  opened: number;
  clicked: number;
  converted: number;
  conversionRate: number; // 0-100
};

export type MonthlySignups = { month: string; signups: number };

export type JourneyStep = {
  label: string;
  count: number;
  /** Small print under the count (unit, qualifier). */
  note?: string;
  /** What moves someone from the PREVIOUS step to this one; shown on the arrow. */
  trigger?: string;
};

export type Journey = {
  key: string;
  name: string;
  description: string;
  steps: JourneyStep[];
  /** Entrants used for the end-to-end conversion (first countable step). */
  entrants: number;
  payers: number;
  tone: "good" | "neutral" | "pending" | "dead";
};

export type CrmSequenceRow = {
  sequenceId: string;
  name: string;
  emailSteps: number;
  enrolled: number;
  sent: number;
  opened: number;
  replies: number;
  /** Enrolled but effectively not sending (verification-paused etc.). */
  stalled: boolean;
};

export type AdsSummary = {
  spendUsd: number;
  adSignups: number;
  costPerSignup: number | null;
  sinceDate: string;
};

export type OutboundSummary = {
  contactsEmailed: number;
  emailsSent: number;
  replies: number;
  callsLogged: number;
  emailedThenSignedUp: number;
  calledThenSignedUp: number;
};

export type FunnelData = {
  generatedAt: string;
  stages: FunnelStageCounts;
  signupsByMonth: MonthlySignups[];
  outbound: OutboundSummary;
  ads: AdsSummary;
  payerOrigins: PayerOriginBucket[];
  payerTriggers: PayerTriggerCounts;
  lifecycleCampaigns: LifecycleCampaignRow[];
  crmSequences: CrmSequenceRow[];
  journeys: Journey[];
  error?: string;
};

type WorkshopRow = {
  workshop_id: string;
  plan_key: string | null;
  country: string | null;
};

type UserRow = {
  internal_user_id: string;
  workshop_id: string | null;
  signed_up_at: string | null;
};

type DiagnosticRow = {
  workshop_id: string | null;
  created_at: string | null;
};

type SubscriptionRow = {
  workshop_id: string | null;
  status: string;
  trial_end: string | null;
  current_period_start: string | null;
  canceled_at: string | null;
  current_period_end: string | null;
  metadata: Record<string, unknown> | null;
};

type LinkedContactRow = {
  id: string;
  wl_user_id: string;
  attributed_via: string | null;
};

type SendRow = { contact_id: string | null; sent_at: string | null };
type CallRow = { contact_id: string | null; created_at: string | null };

type SnapshotRow = {
  metric_key: string;
  value: number | string | null;
  dimensions: Record<string, unknown> | null;
};

function toNumber(value: number | string | null): number {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
}

function minIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function emptyFunnelData(error: string): FunnelData {
  return {
    generatedAt: new Date().toISOString(),
    stages: {
      signedUp: 0,
      activated: 0,
      everPaid: 0,
      paidPlanTrials: 0,
      activeSubs: 0,
      trialing: 0,
    },
    signupsByMonth: [],
    outbound: {
      contactsEmailed: 0,
      emailsSent: 0,
      replies: 0,
      callsLogged: 0,
      emailedThenSignedUp: 0,
      calledThenSignedUp: 0,
    },
    ads: { spendUsd: 0, adSignups: 0, costPerSignup: null, sinceDate: "2026-04-17" },
    payerOrigins: [],
    payerTriggers: {
      activatedBeforePaying: 0,
      paidWithoutActivating: 0,
      paidDateUnknown: 0,
      cameThroughTrial: 0,
      directToPaid: 0,
      crmEmailedBeforePaying: 0,
      crmCalledBeforePaying: 0,
      posthogSubscribers: 0,
      priorPaywallHit: 0,
      priorQuotaExceeded: 0,
      priorBillingPageOpened: 0,
      priorUpgradeStarted: 0,
      priorTrialStarted: 0,
      priorDiagnosticRun: 0,
      priorPaywallOrQuota: 0,
      noFrictionEvent: 0,
      frictionUsersTotal: 0,
    },
    lifecycleCampaigns: [],
    crmSequences: [],
    journeys: [],
    error,
  };
}

async function loadFunnelData(): Promise<FunnelData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return emptyFunnelData("Supabase is not configured.");
  }

  const [
    workshopsRes,
    usersRes,
    diagnosticsRes,
    subscriptionsRes,
    linkedContactsRes,
    cioRes,
    adsRes,
    sequencesRes,
    stepsRes,
    enrollmentSeqRes,
    openEventsRes,
    replyMessagesRes,
    attributionRes,
  ] = await Promise.all([
    pageAll<WorkshopRow>(({ from, to }) =>
      supabase
        .from(TABLES.workshops)
        .select("workshop_id, plan_key, country")
        .eq("is_internal_test", false)
        .order("workshop_id")
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
    pageAll<DiagnosticRow>(({ from, to }) =>
      supabase
        .from(TABLES.diagnostics)
        .select("workshop_id, created_at")
        .order("diagnostic_id")
        .range(from, to),
    ),
    pageAll<SubscriptionRow>(({ from, to }) =>
      supabase
        .from(TABLES.subscriptions)
        .select(
          "workshop_id, status, trial_end, current_period_start, canceled_at, current_period_end, metadata",
        )
        .order("stripe_subscription_id")
        .range(from, to),
    ),
    pageAll<LinkedContactRow>(({ from, to }) =>
      supabase
        .from("contacts")
        .select("id, wl_user_id, attributed_via")
        .not("wl_user_id", "is", null)
        .order("id")
        .range(from, to),
    ),
    pageAll<SnapshotRow>(({ from, to }) =>
      supabase
        .from(TABLES.metricSnapshots)
        .select("metric_key, value, dimensions")
        .eq("source_key", "customer_io")
        .in("metric_key", ["cio_sent", "cio_opened", "cio_clicked", "cio_converted"])
        .order("id")
        .range(from, to),
    ),
    pageAll<SnapshotRow>(({ from, to }) =>
      supabase
        .from(TABLES.metricSnapshots)
        .select("metric_key, value, dimensions")
        .eq("source_key", "google_ads")
        .in("metric_key", ["ad_spend", "ad_signups", "ad_clicks"])
        .order("id")
        .range(from, to),
    ),
    pageAll<{ id: string; name: string }>(({ from, to }) =>
      supabase
        .from("sequences")
        .select("id, name")
        .eq("status", "active")
        .order("id")
        .range(from, to),
    ),
    pageAll<{ id: string; sequence_id: string; type: string }>(({ from, to }) =>
      supabase
        .from("sequence_steps")
        .select("id, sequence_id, type")
        .order("id")
        .range(from, to),
    ),
    pageAll<{ sequence_id: string }>(({ from, to }) =>
      supabase
        .from("sequence_enrollments")
        .select("sequence_id")
        .order("id")
        .range(from, to),
    ),
    pageAll<{ email_queue_id: string | null }>(({ from, to }) =>
      supabase
        .from("email_events")
        .select("email_queue_id")
        .eq("event_type", "open")
        .order("id")
        .range(from, to),
    ),
    pageAll<{ email_queue_id: string | null }>(({ from, to }) =>
      supabase
        .from("inbox_messages")
        .select("email_queue_id")
        .not("email_queue_id", "is", null)
        .eq("is_auto_reply", false)
        .order("id")
        .range(from, to),
    ),
    // GA4 first-touch per identified user (PR #656): both sites share one GTM
    // container, so the _ga cookie survives the wrenchlane.com ->
    // app.wrenchlane.com hop and GA4 stamps crm_user_id as a user-scoped dim.
    // Synced hourly into dashboard_user_attribution.
    pageAll<{ internal_user_id: string; channel: string }>(({ from, to }) =>
      supabase
        .from(TABLES.userAttribution)
        .select("internal_user_id, channel")
        .order("internal_user_id")
        .range(from, to),
    ),
  ]);

  const firstError =
    workshopsRes.error ??
    usersRes.error ??
    diagnosticsRes.error ??
    subscriptionsRes.error ??
    linkedContactsRes.error ??
    cioRes.error ??
    adsRes.error ??
    sequencesRes.error ??
    stepsRes.error ??
    enrollmentSeqRes.error ??
    openEventsRes.error ??
    replyMessagesRes.error;

  const workshops = workshopsRes.data;
  const users = usersRes.data;

  // ---- per-workshop derived timestamps -------------------------------------

  const workshopIds = new Set(workshops.map((w) => w.workshop_id));

  // Earliest signup per workshop (a workshop can have several users).
  const signupAtByWorkshop = new Map<string, string>();
  const usersByWorkshop = new Map<string, UserRow[]>();
  for (const user of users) {
    if (!user.workshop_id || !workshopIds.has(user.workshop_id)) continue;
    const list = usersByWorkshop.get(user.workshop_id) ?? [];
    list.push(user);
    usersByWorkshop.set(user.workshop_id, list);
    if (user.signed_up_at) {
      const prev = signupAtByWorkshop.get(user.workshop_id) ?? null;
      signupAtByWorkshop.set(
        user.workshop_id,
        minIso(prev, user.signed_up_at)!,
      );
    }
  }

  // Earliest diagnostic per workshop.
  const firstDiagnosticByWorkshop = new Map<string, string>();
  for (const diag of diagnosticsRes.data) {
    if (!diag.workshop_id || !diag.created_at) continue;
    if (!workshopIds.has(diag.workshop_id)) continue;
    const prev = firstDiagnosticByWorkshop.get(diag.workshop_id) ?? null;
    firstDiagnosticByWorkshop.set(
      diag.workshop_id,
      minIso(prev, diag.created_at)!,
    );
  }

  // Charge evidence per workshop. IMPORTANT: plan_key is set at CHECKOUT,
  // during the trial, so "paid plan_key" alone contains never-charged
  // trialers (42 of 126 on 2026-08-12, including the whole Hedin cluster).
  // The reliable signals live in dashboard_subscriptions.metadata:
  //   ever_paid = 'true'   -> a real charge happened
  //   first_paid_at        -> when (exists for most charged workshops)
  // Fallback first-paid: a past trial_end on a non-trialing sub (trial
  // converted), else current_period_start of a non-trialing sub.
  const firstPaidByWorkshop = new Map<string, string>();
  const everPaidWorkshops = new Set<string>();
  const trialedWorkshops = new Set<string>();
  const trialingWorkshops = new Set<string>();
  const activeOrPastDueWorkshops = new Set<string>();
  const partnerWorkshops = new Set<string>();
  let activeSubs = 0;
  let trialingSubs = 0;
  for (const sub of subscriptionsRes.data) {
    if (!sub.workshop_id || !workshopIds.has(sub.workshop_id)) continue;
    const meta = sub.metadata ?? {};
    if (sub.status === "active") activeSubs += 1;
    if (sub.status === "trialing") {
      trialingSubs += 1;
      trialingWorkshops.add(sub.workshop_id);
    }
    if (sub.status === "active" || sub.status === "past_due") {
      activeOrPastDueWorkshops.add(sub.workshop_id);
    }
    if (sub.trial_end) trialedWorkshops.add(sub.workshop_id);
    if (String(meta["ever_paid"]) === "true") {
      everPaidWorkshops.add(sub.workshop_id);
    }
    if (meta["partner"]) partnerWorkshops.add(sub.workshop_id);

    const metaFirstPaid =
      typeof meta["first_paid_at"] === "string"
        ? (meta["first_paid_at"] as string)
        : null;
    let paidStart: string | null = metaFirstPaid;
    if (!paidStart && sub.status !== "trialing") {
      paidStart =
        sub.trial_end &&
        sub.current_period_start &&
        sub.trial_end > sub.current_period_start
          ? sub.trial_end
          : sub.current_period_start;
    }
    if (!paidStart) continue;
    const prev = firstPaidByWorkshop.get(sub.workshop_id) ?? null;
    firstPaidByWorkshop.set(sub.workshop_id, minIso(prev, paidStart)!);
  }

  // ---- stage counts --------------------------------------------------------

  const paidPlanWorkshops = workshops.filter(
    (w) => w.plan_key != null && PAID_PLANS.has(w.plan_key),
  );
  // Cohort: paid plan now, or charge evidence at any point.
  const paidCohortIds = new Set(paidPlanWorkshops.map((w) => w.workshop_id));
  for (const workshopId of everPaidWorkshops) paidCohortIds.add(workshopId);

  // Paid-plan trials that have never been charged: trialing, no ever_paid,
  // no active/past_due sub. These are pipeline, not payers.
  const trialingUnpaidIds = new Set(
    [...paidCohortIds].filter(
      (id) =>
        trialingWorkshops.has(id) &&
        !everPaidWorkshops.has(id) &&
        !activeOrPastDueWorkshops.has(id),
    ),
  );
  const paidWorkshopIds = new Set(
    [...paidCohortIds].filter((id) => !trialingUnpaidIds.has(id)),
  );

  const stages: FunnelStageCounts = {
    signedUp: usersByWorkshop.size,
    activated: firstDiagnosticByWorkshop.size,
    everPaid: paidWorkshopIds.size,
    paidPlanTrials: trialingUnpaidIds.size,
    activeSubs,
    trialing: trialingSubs,
  };

  // ---- signups by month ----------------------------------------------------

  const byMonth = new Map<string, number>();
  for (const user of users) {
    if (!user.signed_up_at) continue;
    const month = user.signed_up_at.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }
  const signupsByMonth = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, signups]) => ({ month, signups }));

  // ---- CRM outbound joins --------------------------------------------------

  const linkedContacts = linkedContactsRes.data;
  const contactByUserId = new Map<string, LinkedContactRow>();
  for (const contact of linkedContacts) {
    contactByUserId.set(String(contact.wl_user_id), contact);
  }
  const linkedContactIds = linkedContacts.map((c) => c.id);

  const [sendsRes, callsRes, outboundTotalsRes] = await Promise.all([
    chunkedIn<SendRow, string>(
      (chunk, { from, to }) =>
        supabase
          .from("email_queue")
          .select("contact_id, sent_at")
          .not("sent_at", "is", null)
          .in("contact_id", chunk)
          .order("id")
          .range(from, to),
      linkedContactIds,
    ),
    chunkedIn<CallRow, string>(
      (chunk, { from, to }) =>
        supabase
          .from("activities")
          .select("contact_id, created_at")
          .eq("type", "call")
          .in("contact_id", chunk)
          .order("id")
          .range(from, to),
      linkedContactIds,
    ),
    // Cheap aggregate counts for the channel summary (head-count queries).
    Promise.all([
      supabase
        .from("email_queue")
        .select("id", { count: "exact", head: true })
        .not("sent_at", "is", null),
      supabase
        .from("inbox_messages")
        .select("id", { count: "exact", head: true })
        .not("email_queue_id", "is", null)
        .eq("is_auto_reply", false),
      supabase
        .from("activities")
        .select("id", { count: "exact", head: true })
        .eq("type", "call"),
      supabase
        .from("activities")
        .select("id", { count: "exact", head: true })
        .eq("type", "call")
        .in("outcome", [
          "interested",
          "callback_scheduled",
          "closed",
          "not_interested",
          "wrong_number",
        ]),
      supabase
        .from("activities")
        .select("id", { count: "exact", head: true })
        .eq("type", "call")
        .in("outcome", ["interested", "callback_scheduled"]),
    ]).then(([sent, replies, calls, reached, interested]) => ({
      emailsSent: sent.count ?? 0,
      replies: replies.count ?? 0,
      callsLogged: calls.count ?? 0,
      callsReached: reached.count ?? 0,
      callsInterested: interested.count ?? 0,
    })),
  ]);

  // Distinct contacts emailed (for the summary card). PostgREST cannot
  // express COUNT(DISTINCT ...), so page the contact ids and dedupe here
  // (~15k single-uuid rows).
  const sentContactsRes = await pageAll<{
    id: string;
    contact_id: string | null;
    step_id: string | null;
  }>(({ from, to }) =>
    supabase
      .from("email_queue")
      .select("id, contact_id, step_id")
      .not("sent_at", "is", null)
      .order("id")
      .range(from, to),
  );
  const distinctContactsEmailed = new Set(
    sentContactsRes.data.map((row) => row.contact_id).filter(Boolean),
  ).size;

  // Per linked-user earliest send / call.
  const firstSendByContact = new Map<string, string>();
  for (const send of sendsRes.data) {
    if (!send.contact_id || !send.sent_at) continue;
    const prev = firstSendByContact.get(send.contact_id) ?? null;
    firstSendByContact.set(send.contact_id, minIso(prev, send.sent_at)!);
  }
  const firstCallByContact = new Map<string, string>();
  for (const call of callsRes.data) {
    if (!call.contact_id || !call.created_at) continue;
    const prev = firstCallByContact.get(call.contact_id) ?? null;
    firstCallByContact.set(call.contact_id, minIso(prev, call.created_at)!);
  }

  // ---- payer origin buckets ------------------------------------------------

  let originEmail = 0;
  let originCall = 0;
  let originPartner = 0;
  let originPreAds = 0;
  let originGoogleAds = 0;
  let originSelfServeOther = 0;
  let originAdsEraUnknown = 0;
  let originUnknown = 0;
  let paidDateUnknown = 0;
  let emailedThenSignedUp = 0;
  let calledThenSignedUp = 0;
  let activatedBeforePaying = 0;
  let paidWithoutActivating = 0;
  let cameThroughTrial = 0;
  let crmEmailedBeforePaying = 0;
  let crmCalledBeforePaying = 0;

  // Journey cohorts across ALL signed-up workshops (not only payers): every
  // workshop gets one first-touch bucket, then we count how many of that
  // bucket reach each later stage.
  type JourneyCohort = {
    signedUp: number;
    activated: number;
    trialed: number;
    charged: number;
    activeToday: number;
  };
  const emptyCohort = (): JourneyCohort => ({
    signedUp: 0,
    activated: 0,
    trialed: 0,
    charged: 0,
    activeToday: 0,
  });
  const cohorts = {
    outbound_email: emptyCohort(),
    outbound_call: emptyCohort(),
    pre_ads: emptyCohort(),
    ads_era: emptyCohort(),
    // GA4 first-touch sub-split of the ads era. Pre-ads stays ring-fenced by
    // date regardless of GA4 (firstUser* is stamped at the first identified
    // session, which for pre-May-25 signups can postdate signup).
    ads_era_google: emptyCohort(),
    ads_era_other: emptyCohort(),
    ads_era_unknown: emptyCohort(),
  };

  // Per-workshop GA4 first-touch channel: first user with a classified
  // channel wins; "unknown" only if no user has anything better.
  const channelByUser = new Map<string, string>();
  for (const row of attributionRes.data) {
    channelByUser.set(row.internal_user_id, row.channel);
  }
  const ga4ChannelForWorkshop = (workshopUsers: UserRow[]): string | null => {
    let fallback: string | null = null;
    for (const user of workshopUsers) {
      const channel = channelByUser.get(user.internal_user_id);
      if (!channel) continue;
      if (channel !== "unknown") return channel;
      fallback = channel;
    }
    return fallback;
  };

  for (const [workshopId, workshopUsers] of usersByWorkshop) {
    const signupAt = signupAtByWorkshop.get(workshopId);
    if (!signupAt) continue;
    let emailedBefore = false;
    let calledBefore = false;
    for (const user of workshopUsers) {
      const contact = contactByUserId.get(user.internal_user_id);
      if (!contact) continue;
      const firstSend = firstSendByContact.get(contact.id);
      if (firstSend && firstSend < signupAt) emailedBefore = true;
      const firstCall = firstCallByContact.get(contact.id);
      if (firstCall && firstCall < signupAt) calledBefore = true;
    }
    if (emailedBefore) emailedThenSignedUp += 1;
    if (calledBefore) calledThenSignedUp += 1;

    const targets: JourneyCohort[] = [];
    if (emailedBefore) targets.push(cohorts.outbound_email);
    else if (calledBefore) targets.push(cohorts.outbound_call);
    else if (signupAt < ADS_ERA_START) targets.push(cohorts.pre_ads);
    else {
      targets.push(cohorts.ads_era);
      const channel = ga4ChannelForWorkshop(workshopUsers);
      if (channel === "google_ads") targets.push(cohorts.ads_era_google);
      else if (channel && channel !== "unknown") targets.push(cohorts.ads_era_other);
      else targets.push(cohorts.ads_era_unknown);
    }
    for (const cohort of targets) {
      cohort.signedUp += 1;
      if (firstDiagnosticByWorkshop.has(workshopId)) cohort.activated += 1;
      if (trialedWorkshops.has(workshopId)) cohort.trialed += 1;
      if (paidWorkshopIds.has(workshopId)) {
        cohort.charged += 1;
        if (activeOrPastDueWorkshops.has(workshopId)) cohort.activeToday += 1;
      }
    }
  }

  for (const workshopId of paidWorkshopIds) {
    const signupAt = signupAtByWorkshop.get(workshopId) ?? null;
    const firstPaid = firstPaidByWorkshop.get(workshopId) ?? null;
    const firstDiagnostic = firstDiagnosticByWorkshop.get(workshopId) ?? null;
    const workshopUsers = usersByWorkshop.get(workshopId) ?? [];

    // Behaviour side. Workshops with no first-paid timestamp at all (legacy
    // or comped plans with zero Stripe rows) are reported separately rather
    // than guessed into a bucket.
    if (!firstPaid) {
      paidDateUnknown += 1;
    } else if (firstDiagnostic && firstDiagnostic <= firstPaid) {
      activatedBeforePaying += 1;
    } else {
      // Never diagnosed, or diagnosed only after paying: either way the
      // diagnostic is not what made them pay.
      paidWithoutActivating += 1;
    }
    if (trialedWorkshops.has(workshopId)) cameThroughTrial += 1;

    // CRM touches between signup and first payment.
    let emailedBeforePaid = false;
    let calledBeforePaid = false;
    let emailedBeforeSignup = false;
    let calledBeforeSignup = false;
    for (const user of workshopUsers) {
      const contact = contactByUserId.get(user.internal_user_id);
      if (!contact) continue;
      const firstSend = firstSendByContact.get(contact.id) ?? null;
      const firstCall = firstCallByContact.get(contact.id) ?? null;
      if (firstSend && signupAt && firstSend < signupAt) emailedBeforeSignup = true;
      if (firstCall && signupAt && firstCall < signupAt) calledBeforeSignup = true;
      const paidCutoff = firstPaid ?? "9999";
      if (firstSend && firstSend < paidCutoff) emailedBeforePaid = true;
      if (firstCall && firstCall < paidCutoff) calledBeforePaid = true;
    }
    if (emailedBeforePaid) crmEmailedBeforePaying += 1;
    if (calledBeforePaid) crmCalledBeforePaying += 1;

    // Origin bucket (first touch wins, outbound beats era guesses; the ads
    // era splits by GA4 first-touch channel).
    if (emailedBeforeSignup) originEmail += 1;
    else if (calledBeforeSignup) originCall += 1;
    else if (partnerWorkshops.has(workshopId)) originPartner += 1;
    else if (!signupAt) originUnknown += 1;
    else if (signupAt < ADS_ERA_START) originPreAds += 1;
    else {
      const channel = ga4ChannelForWorkshop(workshopUsers);
      if (channel === "google_ads") originGoogleAds += 1;
      else if (channel && channel !== "unknown") originSelfServeOther += 1;
      else originAdsEraUnknown += 1;
    }
  }

  const originBuckets: PayerOriginBucket[] = [
    {
      key: "outbound_email",
      label: "Outbound email first",
      count: originEmail,
      description: "A CRM sequence or one-off email reached them before they signed up",
    },
    {
      key: "outbound_call",
      label: "Cold call first",
      count: originCall,
      description: "A logged call reached them before signup (and no earlier email)",
    },
    {
      key: "partner",
      label: "Partner / comped",
      count: originPartner,
      description: "Subscription carries a partner marker (e.g. comped deals)",
    },
    {
      key: "pre_ads_organic",
      label: "Pre-ads organic",
      count: originPreAds,
      description: `Signed up before ${ADS_ERA_START}, so before Google Ads existed`,
    },
    {
      key: "google_ads",
      label: "Google Ads (GA4 first touch)",
      count: originGoogleAds,
      description:
        "Ads-era signup whose GA4 first-touch is a paid campaign (Pmax / Demand Gen)",
    },
    {
      key: "self_serve_other",
      label: "Direct, organic, referral (GA4)",
      count: originSelfServeOther,
      description:
        "Ads-era signup whose GA4 first-touch is direct, organic search, email, referral, or App Store",
    },
    {
      key: "ads_era_self_serve",
      label: "Ads-era, no GA4 data",
      count: originAdsEraUnknown,
      description:
        "Signed up after Pmax launch, but GA4 never saw an identified session (mobile-app-only users, consent blockers, or churned before the 2-month event window)",
    },
    {
      key: "unknown",
      label: "Unknown",
      count: originUnknown,
      description: "No signup timestamp on record",
    },
  ];
  const payerOrigins = originBuckets.filter((bucket) => bucket.count > 0);

  // ---- PostHog friction-before-payment mix ----------------------------------

  const payerTriggers: PayerTriggerCounts = {
    activatedBeforePaying,
    paidWithoutActivating,
    paidDateUnknown,
    cameThroughTrial,
    directToPaid: paidWorkshopIds.size - cameThroughTrial,
    crmEmailedBeforePaying,
    crmCalledBeforePaying,
    posthogSubscribers: 0,
    priorPaywallHit: 0,
    priorQuotaExceeded: 0,
    priorBillingPageOpened: 0,
    priorUpgradeStarted: 0,
    priorTrialStarted: 0,
    priorDiagnosticRun: 0,
    priorPaywallOrQuota: 0,
    noFrictionEvent: 0,
    frictionUsersTotal: 0,
  };

  try {
    const response = await runPostHogQuery(
      `
      WITH subs AS (
        SELECT person_id, min(timestamp) AS sub_at
        FROM events
        WHERE event = 'subscription_started'
        GROUP BY person_id
      ),
      prior AS (
        SELECT
          s.person_id AS person_id,
          countIf(e.event = 'feature_paywall_hit') AS paywall,
          countIf(e.event = 'quota_exceeded') AS quota,
          countIf(e.event = 'billing_page_opened') AS billing,
          countIf(e.event = 'upgrade_started') AS upgrade,
          countIf(e.event = 'trial_started') AS trial,
          countIf(e.event = 'diagnostic_run') AS diagnosed
        FROM subs s
        LEFT JOIN events e
          ON e.person_id = s.person_id AND e.timestamp < s.sub_at
        GROUP BY s.person_id
      )
      SELECT
        count() AS subscribers,
        countIf(paywall > 0) AS prior_paywall,
        countIf(quota > 0) AS prior_quota,
        countIf(billing > 0) AS prior_billing,
        countIf(upgrade > 0) AS prior_upgrade,
        countIf(trial > 0) AS prior_trial,
        countIf(diagnosed > 0) AS prior_diagnosed,
        countIf(paywall = 0 AND quota = 0 AND billing = 0 AND upgrade = 0 AND trial = 0) AS no_friction,
        countIf(paywall > 0 OR quota > 0) AS friction_any
      FROM prior
      `,
    );
    const row = response.results?.[0];
    if (row) {
      payerTriggers.posthogSubscribers = toNumber(row[0] as number);
      payerTriggers.priorPaywallHit = toNumber(row[1] as number);
      payerTriggers.priorQuotaExceeded = toNumber(row[2] as number);
      payerTriggers.priorBillingPageOpened = toNumber(row[3] as number);
      payerTriggers.priorUpgradeStarted = toNumber(row[4] as number);
      payerTriggers.priorTrialStarted = toNumber(row[5] as number);
      payerTriggers.priorDiagnosticRun = toNumber(row[6] as number);
      payerTriggers.noFrictionEvent = toNumber(row[7] as number);
      payerTriggers.priorPaywallOrQuota = toNumber(row[8] as number);
    } else if (response.error || response.detail) {
      payerTriggers.posthogError = response.error ?? response.detail;
    }

    const frictionResponse = await runPostHogQuery(
      `SELECT count(DISTINCT person_id) FROM events WHERE event IN ('feature_paywall_hit', 'quota_exceeded')`,
    );
    const frictionRow = frictionResponse.results?.[0];
    if (frictionRow) {
      payerTriggers.frictionUsersTotal = toNumber(frictionRow[0] as number);
    }
  } catch (error) {
    payerTriggers.posthogError =
      error instanceof Error ? error.message : "PostHog query failed";
  }

  // ---- lifecycle campaign rollup --------------------------------------------

  const campaignAgg = new Map<
    string,
    { name: string; state: string; sent: number; opened: number; clicked: number; converted: number }
  >();
  for (const row of cioRes.data) {
    const dims = row.dimensions ?? {};
    const campaignId = String(dims["campaign_id"] ?? "all");
    if (campaignId === "all") continue;
    const entry = campaignAgg.get(campaignId) ?? {
      name: String(dims["campaign"] ?? `Campaign ${campaignId}`),
      state: String(dims["campaign_state"] ?? "unknown"),
      sent: 0,
      opened: 0,
      clicked: 0,
      converted: 0,
    };
    const value = toNumber(row.value);
    if (row.metric_key === "cio_sent") entry.sent += value;
    if (row.metric_key === "cio_opened") entry.opened += value;
    if (row.metric_key === "cio_clicked") entry.clicked += value;
    if (row.metric_key === "cio_converted") entry.converted += value;
    // Prefer a real name over the fallback if a later row carries one.
    if (dims["campaign"]) entry.name = String(dims["campaign"]);
    if (dims["campaign_state"]) entry.state = String(dims["campaign_state"]);
    campaignAgg.set(campaignId, entry);
  }
  const lifecycleCampaigns: LifecycleCampaignRow[] = [...campaignAgg.entries()]
    .map(([campaignId, entry]) => ({
      campaignId,
      name: entry.name,
      state: entry.state,
      sent: Math.round(entry.sent),
      opened: Math.round(entry.opened),
      clicked: Math.round(entry.clicked),
      converted: Math.round(entry.converted),
      conversionRate: entry.sent > 0 ? (entry.converted / entry.sent) * 100 : 0,
    }))
    .filter((row) => row.sent > 0 || row.converted > 0)
    .sort((a, b) => b.sent - a.sent);

  // ---- ads summary -----------------------------------------------------------

  let spendUsd = 0;
  let adSignups = 0;
  let adClicks = 0;
  for (const row of adsRes.data) {
    const value = toNumber(row.value);
    if (row.metric_key === "ad_spend") spendUsd += value;
    if (row.metric_key === "ad_signups") adSignups += value;
    if (row.metric_key === "ad_clicks") adClicks += value;
  }
  const ads: AdsSummary = {
    spendUsd: Math.round(spendUsd * 100) / 100,
    adSignups: Math.round(adSignups),
    costPerSignup: adSignups > 0 ? Math.round((spendUsd / adSignups) * 100) / 100 : null,
    sinceDate: "2026-04-17",
  };

  // ---- CRM sequence rollup ----------------------------------------------------
  // Everything the CRM itself sends, per active sequence: cold country
  // sequences plus the post-signup check-ins. "Stalled" = a real audience is
  // enrolled but sends never happen (the unverified-address pause).

  const stepToSequence = new Map<string, string>();
  const emailStepsBySequence = new Map<string, number>();
  for (const step of stepsRes.data) {
    stepToSequence.set(step.id, step.sequence_id);
    if (step.type === "email") {
      emailStepsBySequence.set(
        step.sequence_id,
        (emailStepsBySequence.get(step.sequence_id) ?? 0) + 1,
      );
    }
  }

  const enrolledBySequence = new Map<string, number>();
  for (const enrollment of enrollmentSeqRes.data) {
    enrolledBySequence.set(
      enrollment.sequence_id,
      (enrolledBySequence.get(enrollment.sequence_id) ?? 0) + 1,
    );
  }

  const queueToSequence = new Map<string, string>();
  const sentBySequence = new Map<string, number>();
  for (const row of sentContactsRes.data) {
    const sequenceId = row.step_id ? stepToSequence.get(row.step_id) : undefined;
    if (!sequenceId) continue;
    queueToSequence.set(row.id, sequenceId);
    sentBySequence.set(sequenceId, (sentBySequence.get(sequenceId) ?? 0) + 1);
  }

  const openedQueueIds = new Set(
    openEventsRes.data.map((row) => row.email_queue_id).filter(Boolean) as string[],
  );
  const openedBySequence = new Map<string, number>();
  for (const queueId of openedQueueIds) {
    const sequenceId = queueToSequence.get(queueId);
    if (!sequenceId) continue;
    openedBySequence.set(sequenceId, (openedBySequence.get(sequenceId) ?? 0) + 1);
  }

  const repliesBySequence = new Map<string, number>();
  for (const row of replyMessagesRes.data) {
    if (!row.email_queue_id) continue;
    const sequenceId = queueToSequence.get(row.email_queue_id);
    if (!sequenceId) continue;
    repliesBySequence.set(sequenceId, (repliesBySequence.get(sequenceId) ?? 0) + 1);
  }

  const crmSequences: CrmSequenceRow[] = sequencesRes.data
    .map((sequence) => {
      const enrolled = enrolledBySequence.get(sequence.id) ?? 0;
      const sent = sentBySequence.get(sequence.id) ?? 0;
      return {
        sequenceId: sequence.id,
        name: sequence.name,
        emailSteps: emailStepsBySequence.get(sequence.id) ?? 0,
        enrolled,
        sent,
        opened: openedBySequence.get(sequence.id) ?? 0,
        replies: repliesBySequence.get(sequence.id) ?? 0,
        stalled: enrolled >= 20 && sent <= 1,
      };
    })
    .filter((row) => row.enrolled > 0 || row.sent > 0)
    .sort((a, b) => b.sent - a.sent || b.enrolled - a.enrolled);

  const outbound: OutboundSummary = {
    contactsEmailed: distinctContactsEmailed,
    emailsSent: outboundTotalsRes.emailsSent,
    replies: outboundTotalsRes.replies,
    callsLogged: outboundTotalsRes.callsLogged,
    emailedThenSignedUp,
    calledThenSignedUp,
  };

  // ---- journeys: one left-to-right strip per acquisition path ---------------

  const contactsOpened = new Set(
    sentContactsRes.data
      .filter((row) => openedQueueIds.has(row.id) && row.contact_id)
      .map((row) => row.contact_id),
  ).size;

  const paywallCampaignSent = lifecycleCampaigns
    .filter((row) => /paywall|quota/i.test(row.name))
    .reduce((sum, row) => sum + row.sent, 0);

  const journeys: Journey[] = [
    {
      key: "pre_ads_organic",
      name: "Organic and word of mouth (pre-ads era)",
      description:
        "Workshops that found Wrenchlane on their own before Google Ads existed (before 2026-05-19): search, guides, the App Store, other mechanics talking.",
      tone: "good",
      entrants: cohorts.pre_ads.signedUp,
      payers: cohorts.pre_ads.charged,
      steps: [
        {
          label: "Signed up",
          count: cohorts.pre_ads.signedUp,
          note: "workshops, own initiative",
        },
        {
          label: "Activated",
          count: cohorts.pre_ads.activated,
          trigger: "welcome email + first diagnostic",
        },
        {
          label: "Started a trial",
          count: cohorts.pre_ads.trialed,
          trigger: "hit paywall or quota, opened billing",
        },
        {
          label: "Paid",
          count: cohorts.pre_ads.charged,
          trigger: "trial converts, median 48 days from signup",
        },
        {
          label: "Still paying",
          count: cohorts.pre_ads.activeToday,
          trigger: "keeps using it",
        },
      ],
    },
    {
      key: "ads_era_google",
      name: "Google Ads (GA4 first touch, since May 2026)",
      description:
        "Workshops whose GA4 first-touch is a paid campaign. Per-user attribution works because both sites share one GTM container and the app stamps each user's id into GA4 (reliable from ~June 2026; synced hourly).",
      tone: "neutral",
      entrants: cohorts.ads_era_google.signedUp,
      payers: cohorts.ads_era_google.charged,
      steps: [
        {
          label: "Ad clicks",
          count: Math.round(adClicks),
          note: "Google Ads, since Apr 17",
        },
        {
          label: "Signed up",
          count: cohorts.ads_era_google.signedUp,
          note: "workshops, GA4 first-touch = paid",
          trigger: "landing page, $10.67 per ads signup",
        },
        {
          label: "Activated",
          count: cohorts.ads_era_google.activated,
          trigger: "welcome email + first diagnostic",
        },
        {
          label: "Started a trial",
          count: cohorts.ads_era_google.trialed,
          trigger: "hit paywall or quota, opened billing",
        },
        {
          label: "Paid",
          count: cohorts.ads_era_google.charged,
          trigger: "trial converts",
        },
        {
          label: "Still paying",
          count: cohorts.ads_era_google.activeToday,
          trigger: "keeps using it",
        },
      ],
    },
    {
      key: "ads_era_other",
      name: "Direct, organic and referral (since May 2026)",
      description:
        "Ads-era workshops whose GA4 first-touch is direct, organic search, email, referral, or the App Store: the word-of-mouth engine still running underneath the ads.",
      tone: "good",
      entrants: cohorts.ads_era_other.signedUp,
      payers: cohorts.ads_era_other.charged,
      steps: [
        {
          label: "Signed up",
          count: cohorts.ads_era_other.signedUp,
          note: "workshops, own initiative",
        },
        {
          label: "Activated",
          count: cohorts.ads_era_other.activated,
          trigger: "welcome email + first diagnostic",
        },
        {
          label: "Started a trial",
          count: cohorts.ads_era_other.trialed,
          trigger: "hit paywall or quota, opened billing",
        },
        {
          label: "Paid",
          count: cohorts.ads_era_other.charged,
          trigger: "trial converts",
        },
        {
          label: "Still paying",
          count: cohorts.ads_era_other.activeToday,
          trigger: "keeps using it",
        },
      ],
    },
    {
      key: "ads_era_unknown",
      name: "Ads era, no GA4 data",
      description:
        "Signed up after Pmax launch but GA4 never saw an identified session: mobile-app-only users, cookie-consent blockers, and users who churned before the 2-month GA4 event window. Mostly App Store in practice.",
      tone: "pending",
      entrants: cohorts.ads_era_unknown.signedUp,
      payers: cohorts.ads_era_unknown.charged,
      steps: [
        {
          label: "Signed up",
          count: cohorts.ads_era_unknown.signedUp,
          note: "workshops",
        },
        {
          label: "Activated",
          count: cohorts.ads_era_unknown.activated,
          trigger: "welcome email + first diagnostic",
        },
        {
          label: "Started a trial",
          count: cohorts.ads_era_unknown.trialed,
          trigger: "hit paywall or quota",
        },
        {
          label: "Paid",
          count: cohorts.ads_era_unknown.charged,
          trigger: "trial converts",
        },
      ],
    },
    {
      key: "cold_email",
      name: "Cold email outreach",
      description:
        "The CRM's 3-email sequences over ~12 days to scraped and verified workshop contacts. A reply stops the sequence and becomes a human conversation.",
      tone: "neutral",
      entrants: distinctContactsEmailed,
      payers: cohorts.outbound_email.charged,
      steps: [
        {
          label: "Contacted",
          count: distinctContactsEmailed,
          note: "distinct contacts, 3 emails each",
        },
        {
          label: "Opened",
          count: contactsOpened,
          note: "distinct contacts",
          trigger: "subject line + sender reputation",
        },
        {
          label: "Replied",
          count: outboundTotalsRes.replies,
          note: "real replies, OOO excluded",
          trigger: "email content; the day-12 email pulls best",
        },
        {
          label: "Signed up",
          count: cohorts.outbound_email.signedUp,
          trigger: "human reply with signup link",
        },
        {
          label: "Activated",
          count: cohorts.outbound_email.activated,
          trigger: "first diagnostic",
        },
        {
          label: "Paid",
          count: cohorts.outbound_email.charged,
          trigger: "trial + paywall",
        },
      ],
    },
    {
      key: "cold_call",
      name: "Cold calling",
      description:
        "46elks dial-outs with AI transcription and auto-logging. Started recently, volume is still tiny: judge the shape, not the rates.",
      tone: "pending",
      entrants: outboundTotalsRes.callsLogged,
      payers: cohorts.outbound_call.charged,
      steps: [
        {
          label: "Called",
          count: outboundTotalsRes.callsLogged,
          note: "logged dials",
        },
        {
          label: "Reached",
          count: outboundTotalsRes.callsReached,
          trigger: "picks up the phone",
        },
        {
          label: "Interested or callback",
          count: outboundTotalsRes.callsInterested,
          trigger: "pitch lands, callback booked",
        },
        {
          label: "Signed up",
          count: cohorts.outbound_call.signedUp,
          trigger: "follow-up after the call",
        },
        {
          label: "Paid",
          count: cohorts.outbound_call.charged,
          trigger: "trial + paywall",
        },
      ],
    },
    {
      key: "paywall_path",
      name: "Inside the app: the paywall path (user-level)",
      description:
        "The strongest payment trigger, counted in users via PostHog (events since June 2026). Free usage runs into a locked feature or an exhausted quota, and that moment starts most subscriptions.",
      tone: "good",
      entrants: payerTriggers.frictionUsersTotal,
      payers: payerTriggers.priorPaywallOrQuota,
      steps: [
        {
          label: "Hit a paywall or quota",
          count: payerTriggers.frictionUsersTotal,
          note: "users, since June",
        },
        {
          label: "Got the upsell email",
          count: paywallCampaignSent,
          note: "Customer.io, +3-4h after the hit",
          trigger: "feature_paywall_hit / quota_exceeded event",
        },
        {
          label: "Subscribed after friction",
          count: payerTriggers.priorPaywallOrQuota,
          note: `${payerTriggers.posthogSubscribers} subscribers total; 66% had friction first`,
          trigger: "mostly the paywall itself, barely the email",
        },
      ],
    },
    {
      key: "partner",
      name: "Partner: Hedin (from the 2026-08-12 analysis)",
      description:
        "Sales-assisted signups carrying partner_source=hedin, the US/CA July cluster. Static snapshot: PostHog partner data is not joined live yet.",
      tone: "pending",
      entrants: 16,
      payers: 0,
      steps: [
        { label: "Partner signups", count: 16, note: "users, July 2026" },
        {
          label: "In paid-plan trials",
          count: 15,
          note: "workshops",
          trigger: "sales-assisted checkout",
        },
        { label: "Paid", count: 0, trigger: "trial has to convert first" },
      ],
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    stages,
    signupsByMonth,
    outbound,
    ads,
    payerOrigins,
    payerTriggers,
    lifecycleCampaigns,
    crmSequences,
    journeys,
    error: firstError ? firstError.message : undefined,
  };
}

export const getFunnelData = unstable_cache(
  loadFunnelData,
  ["funnel-page-data"],
  CEO_CACHE_OPTIONS,
);
