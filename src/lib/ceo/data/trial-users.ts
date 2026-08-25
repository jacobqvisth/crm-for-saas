import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import {
  isInternalTestEmailWith,
  isInternalTestUserIdWith,
  isInternalTestWorkshopIdWith,
  loadInternalTestSets,
} from "@/lib/ceo/internal-test/loader";
import {
  intervalOfPlanKey,
  planKeyFromPrice,
  planKeyLabel,
  tierOfPlanKey,
} from "@/lib/ceo/plan-prices";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import {
  COHORT_LABELS,
  COHORT_ORDER,
  CONVERTED_OUTCOMES,
  OUTCOME_DESCRIPTIONS,
  OUTCOME_LABELS,
  conversionPct,
  daysBetween,
  median,
  type CallLogRow,
  type CohortKey,
  type CohortStats,
  type ConversionCut,
  type ConversionCutRow,
  type EmailLogRow,
  type FunnelStage,
  type LiveTrialRow,
  type MoneyTotal,
  type OutcomeBucket,
  type TermCount,
  type TimelineEvent,
  type TimelineUser,
  type TrialOutcome,
  type TrialRow,
  type TrialStartSource,
  type TrialUserRow,
  type TrialUsersData,
  type WeeklyPoint,
} from "@/lib/ceo/trial-users-shared";
import { chunkedIn, pageAll } from "@/lib/supabase-paging";

// Trial Users (/dashboard/trial-users).
//
// Everyone who ever opened a One / Small / Large free trial: what they did with
// it, whether they were ever charged, and what actually separates the trials
// that converted from the ones that did not.
//
// GRAINS, because this page mixes three and confusing them produces wrong
// numbers (the promo page learned this the expensive way):
//   * A TRIAL is one dashboard_subscriptions row with a trial_end. 385 trials
//     across 364 workshops, because a few customers trialled twice. Conversion
//     is quoted per trial, and the workshop count is shown beside it rather
//     than swapped in for it.
//   * BEHAVIOUR is per APP USER. A diagnosis is run by a person, and a workshop
//     can have several techs.
//   * OUTREACH is per CRM CONTACT, deduped, so a workshop's shared phone call
//     is not counted once per tech.
//
// The heavy aggregation is done by trial_subscriptions() / trial_user_analysis()
// / trial_cohort_stats() / trial_weekly_flow() in Postgres (see the
// 20260825170000 migration) — PostgREST cannot GROUP BY, and paging diagnostics
// + feature usage + logins + five CRM tables into Node to group them there
// would blow both the 8s statement timeout and the 60s route budget.
//
// Plan TIER resolution stays in TypeScript (src/lib/ceo/plan-prices.ts) rather
// than being duplicated into SQL: dashboard_subscriptions.plan_key holds Stripe
// PRICE IDS on historical rows, the id -> tier table is hand-maintained, and a
// second copy of it is how it drifts. Anything the map does not recognise is
// surfaced as `unmappedPlanKeys` instead of being quietly mislabelled.

const NOTE =
  "A trial is one Stripe subscription that had a trial_end: 385 of them across 364 workshops, " +
  "because a handful of customers trialled twice. Conversion is always quoted against CONCLUDED " +
  "trials — a trial still running has no outcome, and folding it into the denominator makes every " +
  "recent slice look worse purely for being recent. 'Converted' means money actually moved " +
  "(dashboard_subscriptions.metadata.ever_paid), never plan_key or trial_end, both of which are " +
  "stamped at checkout before any payment. Behaviour is counted per app user, outreach per CRM " +
  "contact (deduped), and money per trial and per currency, never summed across currencies. " +
  "Diagnostics are all-history; feature counters only exist from 2026-06-11 onward, so a " +
  "long-standing user's feature total understates their lifetime usage. Internal-test and partner " +
  "trials are flagged and excluded from the rates, never silently dropped.";

const WINDOW_NOTE =
  "The trial WINDOW needs a start date, and Stripe's exact trial_start was not stored in the " +
  "warehouse until the sync change that shipped with this page. Until that sync has run, a " +
  "historical trial falls back to the Stripe customer creation date when that lands within 40 " +
  "days of trial_end, and otherwise to the product default of 14 days before it. That matters " +
  "because a Stripe customer is routinely created at an abandoned checkout weeks before any trial " +
  "opens: 142 of 335 rows had a gap over 40 days, so treating that gap as the trial window would " +
  "count activity from long before the trial began. Every window on this page reports which " +
  "source it used, and clicking Update runs the Stripe sync and makes them all exact.";

const CAUSALITY_NOTE =
  "Usage and conversion move together here, but the arrow is not obvious. A converted trial has " +
  "months of paying life after it, so counting 'diagnoses ever' against conversion measures the " +
  "subscription, not the trial. The cut that is anchored strictly inside the trial window is the " +
  "only one that can inform anything, and it says something uncomfortable: most converted trials " +
  "were never used at all before the card was charged.";

type TrialDbRow = {
  stripe_subscription_id: string;
  workshop_id: string | null;
  stripe_customer_id: string | null;
  customer_email: string | null;
  workshop_name: string | null;
  country: string | null;
  is_internal_test: boolean;
  status: string | null;
  plan_key: string | null;
  workshop_plan_key: string | null;
  currency: string | null;
  mrr_amount_cents: number | null;
  trial_start: string | null;
  trial_start_source: TrialStartSource;
  trial_end: string | null;
  trial_length_days: number | null;
  ever_paid: boolean;
  first_paid_at: string | null;
  canceled_at: string | null;
  cancel_at: string | null;
  has_promo: boolean;
  is_partner: boolean;
  extension_reason: string | null;
};

type UserDbRow = {
  internal_user_id: string;
  workshop_id: string | null;
  workshop_name: string | null;
  country: string | null;
  is_internal_test: boolean;
  contact_id: string | null;
  email: string | null;
  signed_up_at: string | null;
  churned_at: string | null;
  is_trialer: boolean;
  trial_count: number;
  trial_start: string | null;
  trial_start_source: TrialStartSource | null;
  trial_end: string | null;
  trial_length_days: number | null;
  trial_status: string | null;
  trial_plan_key: string | null;
  workshop_plan_key: string | null;
  trial_currency: string | null;
  trial_mrr_cents: number | null;
  ever_paid: boolean;
  first_paid_at: string | null;
  trial_canceled_at: string | null;
  has_promo: boolean;
  diagnostics_total: number;
  diagnostics_first_at: string | null;
  diagnostics_last_at: string | null;
  diagnostics_30d: number;
  diagnostics_before_trial: number;
  diagnostics_during_trial: number;
  diagnostics_after_trial: number;
  days_to_first_diagnosis: number | null;
  chats: number;
  feature_events: number;
  logins: number;
  active_days: number;
  active_days_during_trial: number;
  last_active_at: string | null;
  calls: number;
  calls_connected: number;
  calls_during_trial: number;
  first_call_at: string | null;
  last_call_at: string | null;
  emails_sent: number;
  emails_during_trial: number;
  first_email_at: string | null;
  last_email_at: string | null;
  opens: number;
  clicks: number;
  replies: number;
  activity_count: number;
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
  avg_diagnostics_during_trial: number;
  pct_used_during_trial: number;
  stage_logged_in: number;
  stage_activated: number;
  stage_used_in_trial: number;
  stage_repeat: number;
  stage_habit: number;
  stage_paid: number;
  stage_active_30d: number;
};

type WeeklyDbRow = {
  week: string;
  started: number;
  ended: number;
  converted: number;
  diagnostics: number;
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

type EventDbRow = { email_queue_id: string | null; event_type: string };

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

/** How many rows the per-user timeline and the two event logs render. */
const TIMELINE_USERS = 120;
const EVENT_LOG_ROWS = 400;

function emptyData(error: string | null = null): TrialUsersData {
  return {
    kpis: {
      trials: 0,
      workshops: 0,
      users: 0,
      live: 0,
      concluded: 0,
      converted: 0,
      conversionPct: null,
      stillPaying: 0,
      churnedAfterPaying: 0,
      usedDuringTrial: 0,
      convertedWithoutUsing: 0,
      neverContacted: 0,
      medianDaysToFirstUse: null,
      medianTrialLength: null,
      unmatchedTrials: 0,
      internalTrials: 0,
      estimatedWindows: 0,
      totalCalls: 0,
      totalEmails: 0,
    },
    money: [],
    outcomes: [],
    cohorts: [],
    cuts: [],
    trials: [],
    users: [],
    live: [],
    weekly: [],
    timeline: [],
    calls: [],
    emails: [],
    funnel: [],
    searchTerms: [],
    carMakes: [],
    dtcs: [],
    symptoms: [],
    unmappedPlanKeys: [],
    note: `${NOTE} ${WINDOW_NOTE} ${CAUSALITY_NOTE}`,
    error,
  };
}

/**
 * What happened to one trial.
 *
 * `ever_paid` is checked FIRST and unconditionally: a trial that was charged
 * and later cancelled is a conversion, and reading the status before the
 * payment flag would file it under "cancelled" and understate conversion.
 */
function classifyOutcome(row: {
  status: string | null;
  everPaid: boolean;
  trialEnd: string | null;
  now: number;
}): TrialOutcome {
  const { status, everPaid, trialEnd, now } = row;
  const stillInWindow = trialEnd ? new Date(trialEnd).getTime() > now : false;

  if (everPaid) {
    if (status === "active") return "converted_active";
    if (status === "past_due") return "converted_past_due";
    return "converted_churned";
  }
  if (stillInWindow) {
    // Inside the window but no longer trialing = cancelled while still trying
    // it, which is a decision, unlike simply lapsing at the end.
    return status === "trialing" ? "live" : "canceled_during_trial";
  }
  if (status === "past_due") return "payment_failed";
  if (status === "active") return "active_never_charged";
  if (status === "paused") return "paused";
  return "expired_unpaid";
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
    avgDiagnosticsDuringTrial: Number(row.avg_diagnostics_during_trial ?? 0),
    pctUsedDuringTrial: Number(row.pct_used_during_trial ?? 0),
    diagnosticsPerActiveDay:
      totalActiveDays === 0 ? 0 : totalDiagnostics / totalActiveDays,
    stageLoggedIn: Number(row.stage_logged_in ?? 0),
    stageActivated: Number(row.stage_activated ?? 0),
    stageUsedInTrial: Number(row.stage_used_in_trial ?? 0),
    stageRepeat: Number(row.stage_repeat ?? 0),
    stageHabit: Number(row.stage_habit ?? 0),
    stagePaid: Number(row.stage_paid ?? 0),
    stageActive30d: Number(row.stage_active_30d ?? 0),
  };
}

/**
 * Build one conversion cut. `bucket` returns null to drop a trial from the cut
 * entirely (an unknown country should not become a "—" row competing with real
 * ones); `order` sorts the resulting rows.
 */
function buildCut(
  trials: TrialRow[],
  config: {
    key: string;
    label: string;
    description: string;
    caveat?: string;
    bucket: (trial: TrialRow) => { key: string; label: string } | null;
    order?: (a: ConversionCutRow, b: ConversionCutRow) => number;
    minTrials?: number;
  },
): ConversionCut {
  const map = new Map<string, ConversionCutRow>();

  for (const trial of trials) {
    const bucket = config.bucket(trial);
    if (!bucket) continue;
    const entry =
      map.get(bucket.key) ??
      ({
        key: bucket.key,
        label: bucket.label,
        trials: 0,
        live: 0,
        concluded: 0,
        converted: 0,
        pct: null,
      } satisfies ConversionCutRow);

    entry.trials += 1;
    if (trial.outcome === "live") {
      entry.live += 1;
    } else {
      entry.concluded += 1;
      if (CONVERTED_OUTCOMES.has(trial.outcome)) entry.converted += 1;
    }
    map.set(bucket.key, entry);
  }

  const rows = [...map.values()]
    .filter((row) => row.trials >= (config.minTrials ?? 1))
    .map((row) => ({
      ...row,
      pct: conversionPct(row.converted, row.concluded),
    }))
    .sort(config.order ?? ((a, b) => b.trials - a.trials));

  return {
    key: config.key,
    label: config.label,
    description: config.description,
    caveat: config.caveat,
    rows,
  };
}

async function getTrialUsersDataUncached(): Promise<TrialUsersData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyData("Supabase service client unavailable.");

  const sets = await loadInternalTestSets();
  const now = Date.now();

  const [trialResult, userResult, cohortResult, weeklyResult] =
    await Promise.all([
      // 385 rows today. Well inside the 1000-row PostgREST ceiling, and the
      // function is the only place the trial WINDOW is derived.
      supabase.rpc("trial_subscriptions"),
      // Defaults to trial workshops only (~384 rows). Never call it with
      // trial_only=false from here: that returns every app user and PostgREST
      // would silently cut the response at 1000 rows.
      supabase.rpc("trial_user_analysis"),
      supabase.rpc("trial_cohort_stats"),
      supabase.rpc("trial_weekly_flow", { weeks: 26 }),
    ]);

  if (trialResult.error) {
    return emptyData(
      `Could not run trial_subscriptions(): ${trialResult.error.message}`,
    );
  }
  if (userResult.error) {
    return emptyData(
      `Could not run trial_user_analysis(): ${userResult.error.message}`,
    );
  }

  const trialRows = (trialResult.data ?? []) as TrialDbRow[];
  const userRows = (userResult.data ?? []) as UserDbRow[];

  if (trialRows.length === 0) {
    return {
      ...emptyData(),
      note: `${NOTE} No trials found — click Update to run the Stripe sync.`,
    };
  }

  // ---- app users ----------------------------------------------------------
  const users: TrialUserRow[] = userRows
    .map((row) => {
      const isInternal =
        row.is_internal_test ||
        isInternalTestEmailWith(sets, row.email) ||
        isInternalTestUserIdWith(sets, row.internal_user_id) ||
        isInternalTestWorkshopIdWith(sets, row.workshop_id);

      const resolvedPlanKey =
        planKeyFromPrice(row.trial_plan_key) ??
        (row.workshop_plan_key && row.workshop_plan_key !== "free"
          ? row.workshop_plan_key
          : null);

      return {
        userId: row.internal_user_id,
        email: row.email,
        workshopId: row.workshop_id,
        workshop: row.workshop_name,
        country: row.country,
        contactId: row.contact_id,
        isInternal,
        trialCount: Number(row.trial_count ?? 0),
        trialStart: row.trial_start,
        trialStartSource: row.trial_start_source ?? "assumed",
        trialEnd: row.trial_end,
        trialLengthDays: Number(row.trial_length_days ?? 0),
        trialStatus: row.trial_status,
        outcome: classifyOutcome({
          status: row.trial_status,
          everPaid: row.ever_paid,
          trialEnd: row.trial_end,
          now,
        }),
        planLabel: planKeyLabel(resolvedPlanKey ?? row.trial_plan_key),
        tier: tierOfPlanKey(resolvedPlanKey),
        currency: row.trial_currency,
        mrrCents: Number(row.trial_mrr_cents ?? 0),
        everPaid: row.ever_paid,
        firstPaidAt: row.first_paid_at,
        hasPromo: row.has_promo,
        signedUpAt: row.signed_up_at,
        churnedAt: row.churned_at,
        diagnostics: Number(row.diagnostics_total ?? 0),
        diagnosticsFirstAt: row.diagnostics_first_at,
        diagnosticsLastAt: row.diagnostics_last_at,
        diagnostics30d: Number(row.diagnostics_30d ?? 0),
        diagnosticsBeforeTrial: Number(row.diagnostics_before_trial ?? 0),
        diagnosticsDuringTrial: Number(row.diagnostics_during_trial ?? 0),
        diagnosticsAfterTrial: Number(row.diagnostics_after_trial ?? 0),
        daysToFirstDiagnosis:
          row.days_to_first_diagnosis === null
            ? null
            : Number(row.days_to_first_diagnosis),
        chats: Number(row.chats ?? 0),
        featureEvents: Number(row.feature_events ?? 0),
        logins: Number(row.logins ?? 0),
        activeDays: Number(row.active_days ?? 0),
        activeDaysDuringTrial: Number(row.active_days_during_trial ?? 0),
        lastActiveAt: row.last_active_at,
        calls: Number(row.calls ?? 0),
        callsConnected: Number(row.calls_connected ?? 0),
        callsDuringTrial: Number(row.calls_during_trial ?? 0),
        firstCallAt: row.first_call_at,
        lastCallAt: row.last_call_at,
        emailsSent: Number(row.emails_sent ?? 0),
        emailsDuringTrial: Number(row.emails_during_trial ?? 0),
        firstEmailAt: row.first_email_at,
        lastEmailAt: row.last_email_at,
        opens: Number(row.opens ?? 0),
        clicks: Number(row.clicks ?? 0),
        replies: Number(row.replies ?? 0),
        activities: Number(row.activity_count ?? 0),
      } satisfies TrialUserRow;
    })
    .sort((a, b) => b.diagnostics - a.diagnostics);

  // Workshop -> its app users, for rolling behaviour up onto a trial. Outreach
  // is deduped by contact inside the rollup so a workshop's shared phone call
  // is not counted once per tech.
  const usersByWorkshop = new Map<string, TrialUserRow[]>();
  for (const user of users) {
    if (!user.workshopId) continue;
    const list = usersByWorkshop.get(user.workshopId) ?? [];
    list.push(user);
    usersByWorkshop.set(user.workshopId, list);
  }

  const rollup = (workshopId: string | null) => {
    const list = workshopId ? (usersByWorkshop.get(workshopId) ?? []) : [];
    const seenContacts = new Set<string>();
    let calls = 0;
    let emails = 0;
    for (const user of list) {
      const key = user.contactId ?? user.userId;
      if (seenContacts.has(key)) continue;
      seenContacts.add(key);
      calls += user.callsDuringTrial;
      emails += user.emailsDuringTrial;
    }
    return {
      users: list.length,
      diagnosticsDuringTrial: list.reduce(
        (sum, user) => sum + user.diagnosticsDuringTrial,
        0,
      ),
      diagnosticsTotal: list.reduce((sum, user) => sum + user.diagnostics, 0),
      activeDaysDuringTrial: Math.max(
        0,
        ...list.map((user) => user.activeDaysDuringTrial),
        0,
      ),
      callsDuringTrial: calls,
      emailsDuringTrial: emails,
      contacted: list.some((user) => user.calls > 0 || user.emailsSent > 0),
      lastActiveAt:
        list
          .map((user) => user.lastActiveAt)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null,
    };
  };

  // ---- trials -------------------------------------------------------------
  const unmappedPlanKeys = new Set<string>();

  const trials: TrialRow[] = trialRows
    .map((row) => {
      const mapped = planKeyFromPrice(row.plan_key);
      // Fall back to the workshop's own plan the way resolveSubscriptionPlanKey
      // does, but remember the miss: the workshop reads "free" once a
      // subscription is cancelled, so this fallback is a guess, not a lookup.
      const resolved =
        mapped ??
        (row.workshop_plan_key && row.workshop_plan_key !== "free"
          ? row.workshop_plan_key
          : null);
      if (!mapped && row.plan_key) unmappedPlanKeys.add(row.plan_key);

      const outcome = classifyOutcome({
        status: row.status,
        everPaid: row.ever_paid,
        trialEnd: row.trial_end,
        now,
      });
      const rolled = rollup(row.workshop_id);

      return {
        subscriptionId: row.stripe_subscription_id,
        workshopId: row.workshop_id,
        customerId: row.stripe_customer_id,
        email: row.customer_email?.toLowerCase() ?? null,
        workshop: row.workshop_name,
        country: row.country,
        isInternal:
          row.is_internal_test ||
          isInternalTestEmailWith(sets, row.customer_email) ||
          isInternalTestWorkshopIdWith(sets, row.workshop_id),
        isPartner: row.is_partner,
        status: row.status,
        outcome,
        rawPlanKey: row.plan_key,
        planKey: resolved,
        planLabel: planKeyLabel(resolved ?? row.plan_key),
        tier: tierOfPlanKey(resolved),
        interval: intervalOfPlanKey(resolved),
        planUnmapped: !mapped,
        currency: row.currency,
        mrrCents: Number(row.mrr_amount_cents ?? 0),
        trialStart: row.trial_start,
        trialStartSource: row.trial_start_source ?? "assumed",
        trialEnd: row.trial_end,
        trialLengthDays: Number(row.trial_length_days ?? 0),
        daysLeft:
          outcome === "live" && row.trial_end
            ? Math.max(
                0,
                Math.round(
                  (new Date(row.trial_end).getTime() - now) / 86_400_000,
                ),
              )
            : null,
        everPaid: row.ever_paid,
        firstPaidAt: row.first_paid_at,
        daysToPay: daysBetween(row.trial_start, row.first_paid_at),
        canceledAt: row.canceled_at,
        hasPromo: row.has_promo,
        extensionReason: row.extension_reason,
        ...rolled,
      } satisfies TrialRow;
    })
    .sort((a, b) => (b.trialEnd ?? "").localeCompare(a.trialEnd ?? ""));

  // Rates are quoted on external trials only. Internal-test and partner comps
  // are kept in the tables (flagged) but never in a denominator, matching how
  // every other growth page here treats them.
  const external = trials.filter((row) => !row.isInternal && !row.isPartner);
  const concluded = external.filter((row) => row.outcome !== "live");
  const converted = concluded.filter((row) =>
    CONVERTED_OUTCOMES.has(row.outcome),
  );

  // ---- outcomes -----------------------------------------------------------
  const outcomeOrder: TrialOutcome[] = [
    "live",
    "converted_active",
    "converted_past_due",
    "converted_churned",
    "canceled_during_trial",
    "expired_unpaid",
    "payment_failed",
    "active_never_charged",
    "paused",
  ];
  const outcomes: OutcomeBucket[] = outcomeOrder
    .map((key) => {
      const matching = external.filter((row) => row.outcome === key);
      return {
        key,
        label: OUTCOME_LABELS[key],
        description: OUTCOME_DESCRIPTIONS[key],
        trials: matching.length,
        workshops: new Set(
          matching.map((row) => row.workshopId ?? row.subscriptionId),
        ).size,
      };
    })
    .filter((bucket) => bucket.trials > 0);

  // ---- money, per currency ------------------------------------------------
  const moneyByCurrency = new Map<string, MoneyTotal>();
  for (const trial of external) {
    const currency = trial.currency ?? "—";
    const entry =
      moneyByCurrency.get(currency) ??
      ({
        currency,
        activeMrrCents: 0,
        churnedMrrCents: 0,
        liveTrialMrrCents: 0,
        converted: 0,
        live: 0,
      } satisfies MoneyTotal);

    if (trial.outcome === "converted_active") {
      entry.activeMrrCents += trial.mrrCents;
      entry.converted += 1;
    } else if (
      trial.outcome === "converted_churned" ||
      trial.outcome === "converted_past_due"
    ) {
      entry.churnedMrrCents += trial.mrrCents;
      entry.converted += 1;
    } else if (trial.outcome === "live") {
      entry.liveTrialMrrCents += trial.mrrCents;
      entry.live += 1;
    }
    moneyByCurrency.set(currency, entry);
  }
  const money = [...moneyByCurrency.values()].sort(
    (a, b) => b.activeMrrCents - a.activeMrrCents,
  );

  // ---- cohorts, straight from Postgres ------------------------------------
  const cohortRows = (cohortResult.data ?? []) as CohortDbRow[];
  const cohortByKey = new Map(cohortRows.map((row) => [row.cohort, row]));
  const cohorts: CohortStats[] = COHORT_ORDER.map((key) =>
    cohortByKey.get(key),
  )
    .filter((row): row is CohortDbRow => Boolean(row))
    .map(toCohortStats);

  // ---- conversion cuts ----------------------------------------------------
  const monthKey = (value: string | null) =>
    value ? value.slice(0, 7) : null;

  const tierRank: Record<string, number> = { one: 0, small: 1, large: 2 };

  const cuts: ConversionCut[] = [
    buildCut(external, {
      key: "usage",
      label: "By what they did INSIDE the trial window",
      description:
        "Diagnoses run by anyone at the workshop between the trial opening and closing. This is the only usage cut that can inform anything: counting diagnoses over all time would mostly count the paying months that follow a conversion.",
      caveat:
        "The zero bucket carries most of the conversions, which is the finding, not a bug: with a card required up front, a trial that is never opened still charges when it ends.",
      bucket: (trial) => {
        const n = trial.diagnosticsDuringTrial;
        if (n === 0) return { key: "0", label: "Never used it" };
        if (n === 1) return { key: "1", label: "1 diagnosis" };
        if (n <= 3) return { key: "2", label: "2-3 diagnoses" };
        if (n <= 9) return { key: "3", label: "4-9 diagnoses" };
        return { key: "4", label: "10+ diagnoses" };
      },
      order: (a, b) => a.key.localeCompare(b.key),
    }),
    buildCut(external, {
      key: "country",
      label: "By country",
      description:
        "The workshop's country. This is the widest gap on the page by a distance, and it is the one worth acting on first.",
      bucket: (trial) =>
        trial.country
          ? { key: trial.country, label: trial.country }
          : { key: "unknown", label: "Unknown" },
      minTrials: 3,
    }),
    buildCut(external, {
      key: "tier",
      label: "By plan tier",
      description:
        "Which plan the trial was opened on. Monthly and yearly collapse into one tier here; the interval cut below separates them.",
      bucket: (trial) =>
        trial.tier
          ? { key: trial.tier, label: trial.tier.toUpperCase() }
          : { key: "unknown", label: "Unknown plan" },
      order: (a, b) => (tierRank[a.key] ?? 9) - (tierRank[b.key] ?? 9),
    }),
    buildCut(external, {
      key: "interval",
      label: "By billing interval",
      description:
        "Monthly against yearly. Yearly trials are few, so read the counts before the percentages.",
      bucket: (trial) =>
        trial.interval
          ? { key: trial.interval, label: trial.interval }
          : { key: "unknown", label: "Unknown" },
    }),
    buildCut(external, {
      key: "currency",
      label: "By billing currency",
      description:
        "A proxy for which market sold the trial, independent of the workshop's recorded country.",
      bucket: (trial) =>
        trial.currency
          ? { key: trial.currency, label: trial.currency }
          : { key: "unknown", label: "Unknown" },
    }),
    buildCut(external, {
      key: "length",
      label: "By trial length",
      description:
        "How long the window was. Extended trials are visible here as the buckets past 14 days.",
      caveat:
        "Length depends on the trial start date, so any row here inherits the window's estimation problem until the Stripe sync has run once.",
      bucket: (trial) => {
        const d = trial.trialLengthDays;
        if (d <= 8) return { key: "1", label: "7 days" };
        if (d <= 16) return { key: "2", label: "14 days" };
        if (d <= 34) return { key: "3", label: "30 days" };
        return { key: "4", label: "Over 30 days" };
      },
      order: (a, b) => a.key.localeCompare(b.key),
    }),
    buildCut(external, {
      key: "month",
      label: "By the month the trial opened",
      description:
        "Conversion by cohort. Recent months carry live trials, which sit in their own column and are kept out of the rate.",
      bucket: (trial) => {
        const key = monthKey(trial.trialStart);
        return key ? { key, label: key } : null;
      },
      order: (a, b) => a.key.localeCompare(b.key),
    }),
    buildCut(external, {
      key: "promo",
      label: "By whether a discount was attached",
      description:
        "Whether the trial's customer also carries a Stripe coupon or promotion code. Sales-touched trials are the ones that get a discount, so this cut is confounded by definition.",
      bucket: (trial) => ({
        key: trial.hasPromo ? "1_promo" : "0_none",
        label: trial.hasPromo ? "Had a discount" : "No discount",
      }),
      order: (a, b) => a.key.localeCompare(b.key),
    }),
    buildCut(external, {
      key: "outreach",
      label: "By whether we called or emailed during the trial",
      description:
        "Outreach landing inside the trial window, deduped per CRM contact. Reps pick who to call, so this measures who got attention as much as what attention does.",
      bucket: (trial) => {
        const called = trial.callsDuringTrial > 0;
        const emailed = trial.emailsDuringTrial > 0;
        if (called && emailed)
          return { key: "3", label: "Called and emailed" };
        if (called) return { key: "2", label: "Called only" };
        if (emailed) return { key: "1", label: "Emailed only" };
        return { key: "0", label: "Neither" };
      },
      order: (a, b) => a.key.localeCompare(b.key),
    }),
    buildCut(external, {
      key: "seats",
      label: "By how many app users the workshop has",
      description:
        "A workshop that put several techs into the product during its trial is a different prospect from a single owner poking at it.",
      bucket: (trial) => {
        const n = trial.users;
        if (n === 0) return { key: "0", label: "No app user matched" };
        if (n === 1) return { key: "1", label: "1 user" };
        if (n <= 3) return { key: "2", label: "2-3 users" };
        return { key: "3", label: "4+ users" };
      },
      order: (a, b) => a.key.localeCompare(b.key),
    }),
  ];

  // ---- live trials, with a rescue ranking ---------------------------------
  const live: LiveTrialRow[] = external
    .filter((trial) => trial.outcome === "live")
    .map((trial) => {
      const rolled = rollup(trial.workshopId);
      const daysLeft = trial.daysLeft ?? 0;
      const reasons: string[] = [];
      let risk = 0;

      if (trial.diagnosticsDuringTrial === 0) {
        risk += 40;
        reasons.push("no diagnosis yet");
      } else if (trial.diagnosticsDuringTrial < 3) {
        risk += 15;
        reasons.push("barely used");
      }
      if (!trial.contacted) {
        risk += 20;
        reasons.push("never called or emailed");
      }
      if (daysLeft <= 3) {
        risk += 25;
        reasons.push(`${daysLeft} days left`);
      } else if (daysLeft <= 7) {
        risk += 15;
        reasons.push("under a week left");
      }
      const lastActive = rolled.lastActiveAt;
      const quiet =
        !lastActive || now - new Date(lastActive).getTime() > 7 * 86_400_000;
      if (quiet) {
        risk += 15;
        reasons.push("nothing in 7 days");
      }

      return {
        subscriptionId: trial.subscriptionId,
        workshopId: trial.workshopId,
        workshop: trial.workshop,
        email: trial.email,
        country: trial.country,
        planLabel: trial.planLabel,
        currency: trial.currency,
        mrrCents: trial.mrrCents,
        trialStart: trial.trialStart,
        trialEnd: trial.trialEnd,
        daysLeft,
        users: trial.users,
        diagnosticsDuringTrial: trial.diagnosticsDuringTrial,
        diagnosticsTotal: trial.diagnosticsTotal,
        activeDaysDuringTrial: trial.activeDaysDuringTrial,
        lastActiveAt: lastActive,
        calls: rolled.callsDuringTrial,
        emailsSent: rolled.emailsDuringTrial,
        contacted: trial.contacted,
        hasPromo: trial.hasPromo,
        risk: Math.min(100, risk),
        riskReasons: reasons,
      } satisfies LiveTrialRow;
    })
    .sort((a, b) => b.risk - a.risk || a.daysLeft - b.daysLeft);

  // ---- weekly flow --------------------------------------------------------
  const weekly: WeeklyPoint[] = ((weeklyResult.data ?? []) as WeeklyDbRow[])
    .map((row) => ({
      date: row.week,
      started: Number(row.started ?? 0),
      ended: Number(row.ended ?? 0),
      converted: Number(row.converted ?? 0),
      diagnostics: Number(row.diagnostics ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ---- event detail, trial contacts only ---------------------------------
  // Both id lists run into the hundreds, past the point where a single
  // `.in(...)` fits in a PostgREST URL, so every read below goes through
  // chunkedIn rather than .in() directly.
  const contactIds = [
    ...new Set(
      users.map((user) => user.contactId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const trialUserIds = [...new Set(users.map((user) => user.userId))];

  const [
    callRows,
    emailRows,
    replyRows,
    activityRows,
    diagnosticRows,
    profileRows,
    mailboxRows,
  ] = await Promise.all([
    chunkedIn<CallDbRow>(
      (chunk, { from, to }) =>
        supabase
          .from("call_sessions")
          .select(
            "id, contact_id, user_id, direction, started_at, connected_at, duration_seconds, summary",
          )
          .in("contact_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      contactIds,
    ),
    chunkedIn<EmailDbRow>(
      (chunk, { from, to }) =>
        supabase
          .from("email_queue")
          .select("id, contact_id, sender_account_id, step_id, subject, sent_at")
          .in("contact_id", chunk)
          .eq("status", "sent")
          .order("id", { ascending: true })
          .range(from, to),
      contactIds,
    ),
    chunkedIn<ReplyDbRow>(
      (chunk, { from, to }) =>
        supabase
          .from("inbox_messages")
          .select("id, contact_id, from_email, subject, received_at")
          .in("contact_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      contactIds,
    ),
    chunkedIn<ActivityDbRow>(
      (chunk, { from, to }) =>
        supabase
          .from("activities")
          .select("id, contact_id, type, outcome")
          .in("contact_id", chunk)
          .eq("type", "call")
          .order("id", { ascending: true })
          .range(from, to),
      contactIds,
    ),
    chunkedIn<DiagnosticDbRow>(
      (chunk, { from, to }) =>
        supabase
          .from(TABLES.diagnostics)
          .select(
            "diagnostic_id, internal_user_id, created_at, has_chat, metadata",
          )
          .in("internal_user_id", chunk)
          .order("diagnostic_id", { ascending: true })
          .range(from, to),
      trialUserIds,
    ),
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
  const stepIds = [
    ...new Set(
      emailRows.data
        .map((row) => row.step_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [eventRows, stepRows] = await Promise.all([
    chunkedIn<EventDbRow>(
      (chunk, { from, to }) =>
        supabase
          .from("email_events")
          .select("email_queue_id, event_type")
          .in("email_queue_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      emailIds,
    ),
    chunkedIn<StepDbRow>(
      (chunk, { from, to }) =>
        supabase
          .from("sequence_steps")
          .select("id, sequence_id")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      stepIds,
    ),
  ]);

  const sequenceIds = [
    ...new Set(
      stepRows.data
        .map((row) => row.sequence_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const sequenceRows = await chunkedIn<SequenceDbRow>(
    (chunk, { from, to }) =>
      supabase
        .from("sequences")
        .select("id, name")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    sequenceIds,
  );

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

  const userByContact = new Map<string, TrialUserRow>();
  for (const user of users) {
    if (user.contactId && !userByContact.has(user.contactId)) {
      userByContact.set(user.contactId, user);
    }
  }

  const withinTrial = (
    user: TrialUserRow | undefined,
    at: string | null,
  ): boolean => {
    if (!user?.trialStart || !user.trialEnd || !at) return false;
    const t = new Date(at).getTime();
    return (
      t >= new Date(user.trialStart).getTime() &&
      t < new Date(user.trialEnd).getTime()
    );
  };

  const calls: CallLogRow[] = callRows.data
    .map((row) => {
      const user = row.contact_id
        ? userByContact.get(row.contact_id)
        : undefined;
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
        daysFromTrialStart: daysBetween(user?.trialStart ?? null, row.started_at),
        daysFromTrialEnd: daysBetween(user?.trialEnd ?? null, row.started_at),
        duringTrial: withinTrial(user, row.started_at),
      } satisfies CallLogRow;
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  const emails: EmailLogRow[] = emailRows.data
    .map((row) => {
      const user = row.contact_id
        ? userByContact.get(row.contact_id)
        : undefined;
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
        daysFromTrialStart: daysBetween(user?.trialStart ?? null, row.sent_at),
        daysFromTrialEnd: daysBetween(user?.trialEnd ?? null, row.sent_at),
        duringTrial: withinTrial(user, row.sent_at),
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
  // Indexed by id rather than scanned: `calls`/`emails` run to thousands of
  // rows for a few hundred contacts, and a .find() per source row would make
  // this quadratic on the email side for no reason.
  const callById = new Map(calls.map((call) => [call.id, call]));
  const emailById = new Map(emails.map((mail) => [mail.id, mail]));

  const callsByContact = new Map<string, CallLogRow[]>();
  for (const row of callRows.data) {
    if (!row.contact_id) continue;
    const view = callById.get(row.id);
    if (!view) continue;
    const list = callsByContact.get(row.contact_id) ?? [];
    list.push(view);
    callsByContact.set(row.contact_id, list);
  }
  const emailsByContact = new Map<string, EmailLogRow[]>();
  for (const row of emailRows.data) {
    if (!row.contact_id) continue;
    const view = emailById.get(row.id);
    if (!view) continue;
    const list = emailsByContact.get(row.contact_id) ?? [];
    list.push(view);
    emailsByContact.set(row.contact_id, list);
  }
  const repliesByContact = new Map<string, ReplyDbRow[]>();
  for (const row of replyRows.data) {
    if (!row.contact_id) continue;
    const list = repliesByContact.get(row.contact_id) ?? [];
    list.push(row);
    repliesByContact.set(row.contact_id, list);
  }

  const timeline: TimelineUser[] = users
    .slice(0, TIMELINE_USERS)
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
      if (user.trialStart) {
        events.push({
          id: `trial-start-${user.userId}`,
          at: user.trialStart,
          kind: "trial_start",
          actor: null,
          title: `Trial opened on ${user.planLabel}`,
          detail: `${user.trialLengthDays} days`,
          outcome:
            user.trialStartSource === "stripe" ? null : "start date estimated",
        });
      }
      if (user.trialEnd) {
        events.push({
          id: `trial-end-${user.userId}`,
          at: user.trialEnd,
          kind: "trial_end",
          actor: null,
          title: "Trial window closed",
          detail: OUTCOME_LABELS[user.outcome],
          outcome: null,
        });
      }
      if (user.firstPaidAt) {
        events.push({
          id: `paid-${user.userId}`,
          at: user.firstPaidAt,
          kind: "paid",
          actor: null,
          title: "First payment taken",
          detail: user.planLabel,
          outcome: null,
        });
      }
      if (user.churnedAt) {
        events.push({
          id: `churn-${user.userId}`,
          at: user.churnedAt,
          kind: "canceled",
          actor: null,
          title: "Churned",
          detail: null,
          outcome: null,
        });
      }
      for (const call of user.contactId
        ? (callsByContact.get(user.contactId) ?? [])
        : []) {
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
      for (const mail of user.contactId
        ? (emailsByContact.get(user.contactId) ?? [])
        : []) {
        events.push({
          id: `email-${mail.id}`,
          at: mail.at ?? "",
          kind: "email",
          actor: mail.sender,
          title: mail.subject ?? "(no subject)",
          detail: mail.sequence,
          outcome:
            [
              mail.opened ? "opened" : null,
              mail.clicked ? "clicked" : null,
              mail.replied ? "replied" : null,
            ]
              .filter(Boolean)
              .join(", ") || null,
        });
      }
      for (const reply of user.contactId
        ? (repliesByContact.get(user.contactId) ?? [])
        : []) {
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
        outcome: user.outcome,
        trialStart: user.trialStart,
        trialEnd: user.trialEnd,
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
      key: "used_in_trial",
      label: "Used it inside the trial",
      description:
        "At least one diagnosis between the trial opening and closing. Zero by construction for the never-trialed cohort.",
      pick: (row) => Number(row.stage_used_in_trial ?? 0),
    },
    {
      key: "activated",
      label: "Ran a diagnosis (ever)",
      description: "The core action, at least once, at any point.",
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
    for (const key of COHORT_ORDER) {
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

  // ---- KPIs ---------------------------------------------------------------
  const externalUsers = users.filter((user) => !user.isInternal);
  const daysToFirstUse = externalUsers
    .map((user) => user.daysToFirstDiagnosis)
    .filter((value): value is number => value !== null && value >= 0);
  const trialLengths = external
    .map((trial) => trial.trialLengthDays)
    .filter((value) => value > 0);

  const kpis = {
    trials: external.length,
    workshops: new Set(
      external.map((trial) => trial.workshopId ?? trial.subscriptionId),
    ).size,
    users: externalUsers.length,
    live: external.filter((trial) => trial.outcome === "live").length,
    concluded: concluded.length,
    converted: converted.length,
    conversionPct: conversionPct(converted.length, concluded.length),
    stillPaying: external.filter(
      (trial) => trial.outcome === "converted_active",
    ).length,
    churnedAfterPaying: external.filter(
      (trial) => trial.outcome === "converted_churned",
    ).length,
    usedDuringTrial: external.filter(
      (trial) => trial.diagnosticsDuringTrial > 0,
    ).length,
    convertedWithoutUsing: converted.filter(
      (trial) => trial.diagnosticsDuringTrial === 0,
    ).length,
    neverContacted: external.filter((trial) => !trial.contacted).length,
    medianDaysToFirstUse:
      daysToFirstUse.length > 0 ? median(daysToFirstUse) : null,
    medianTrialLength: trialLengths.length > 0 ? median(trialLengths) : null,
    // A trial whose Stripe customer never resolved to a workshop, so no product
    // or outreach data can be attached to it at all.
    unmatchedTrials: trials.filter((trial) => !trial.workshopId).length,
    internalTrials: trials.filter((trial) => trial.isInternal || trial.isPartner)
      .length,
    estimatedWindows: trials.filter(
      (trial) => trial.trialStartSource !== "stripe",
    ).length,
    totalCalls: calls.length,
    totalEmails: emails.length,
  };

  return {
    kpis,
    money,
    outcomes,
    cohorts,
    cuts,
    trials,
    users,
    live,
    weekly,
    timeline,
    calls: calls.slice(0, EVENT_LOG_ROWS),
    emails: emails.slice(0, EVENT_LOG_ROWS),
    funnel,
    searchTerms,
    carMakes,
    dtcs,
    symptoms,
    unmappedPlanKeys: [...unmappedPlanKeys].sort(),
    note: `${NOTE} ${WINDOW_NOTE} ${CAUSALITY_NOTE}`,
    error: null,
  };
}

export const getTrialUsersData = unstable_cache(
  getTrialUsersDataUncached,
  ["ceo-trial-users"],
  CEO_CACHE_OPTIONS,
);
