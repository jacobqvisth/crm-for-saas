// Data loader for /dashboard/valdemar — every stat we can compute about
// Valdemar's outbound calls and emails, straight from the live CRM tables
// (call_sessions + call activities, email_queue + email_events +
// inbox_messages). No warehouse involved, so nothing here is cached: the page
// is force-dynamic and a reload is a refresh.

import { createServiceClient } from "@/lib/supabase/service";
import { chunkedIn, pageAll } from "@/lib/supabase-paging";
import {
  CALL_OUTCOME_LABEL,
  CONNECTED_BY_DEFAULT,
  type CallOutcome,
} from "@/lib/calls/decision";
import {
  addStockholmDays,
  getStockholmParts,
  startOfStockholmDay,
  startOfStockholmIsoWeek,
  toStockholmIsoDate,
} from "@/lib/ceo/dates";
import {
  DASHBOARD_TIME_RANGES,
  formatRangeDateSpan,
  isDashboardTimeRangeKey,
  resolveDashboardTimeRange,
  type DashboardTimeRangeKey,
} from "@/lib/ceo/time-ranges";
import {
  ACCOUNT_STATE_LABEL,
  ACCOUNT_STATE_ORDER,
  formatDurationSeconds,
  type AccountCard,
  type AccountStatePoint,
  type BucketPoint,
  type CallAccountState,
  type PostCallConversionRow,
  type PostCallEvent,
  type DurationBucket,
  type EmailEventItem,
  type FunnelStep,
  type HourPoint,
  type OutcomeSlice,
  type SentimentSlice,
  type SequenceSlice,
  type ValdemarCallRow,
  type ValdemarCallsData,
  type ValdemarEmailRow,
  type ValdemarEmailsData,
  type ValdemarKpi,
  type ValdemarStatsData,
  type WeekdayPoint,
} from "@/lib/ceo/valdemar-shared";

export const VALDEMAR_DEFAULT_RANGE_KEY: DashboardTimeRangeKey = "last_7_days";

const CALL_ROW_LIMIT = 200;
const EMAIL_ROW_LIMIT = 150;

// How long after a call a product event (signup, paid start, first charge)
// still counts as attributed to that call. Anything later is treated as
// unrelated: 30 days is long enough to cover "I'll look at it next week"
// without crediting a call for a signup two months out.
const POST_CALL_WINDOW_DAYS = 30;
const POST_CALL_WINDOW_MS = POST_CALL_WINDOW_DAYS * 86_400_000;

export function normalizeValdemarRangeKey(
  value: string | string[] | undefined,
): DashboardTimeRangeKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isDashboardTimeRangeKey(candidate)
    ? candidate
    : VALDEMAR_DEFAULT_RANGE_KEY;
}

// Calls and emails land in the CRM tables the moment they happen, so unlike
// the synced-warehouse pages the rolling windows here INCLUDE today: "Last 7
// days" means the 7 civil days ending today, not ending yesterday.
function resolveLiveRange(key: DashboardTimeRangeKey, now = new Date()) {
  const resolved = resolveDashboardTimeRange(key, now);
  const today = startOfStockholmDay(now);
  const tomorrow = addStockholmDays(today, 1);

  const rollingDays: Partial<Record<DashboardTimeRangeKey, number>> = {
    last_7_days: 7,
    last_30_days: 30,
    last_90_days: 90,
  };
  const days = rollingDays[resolved.key];
  if (days) {
    return {
      ...resolved,
      start: addStockholmDays(tomorrow, -days),
      end: tomorrow,
    };
  }
  return resolved;
}

type NameMaps = {
  contactName: Map<string, string>;
  contactPhone: Map<string, string | null>;
  companyName: Map<string, string>;
};

type Identity = {
  userIds: string[];
  accountIds: string[];
  displayName: string;
  accounts: GmailAccountRow[];
};

type GmailAccountRow = {
  id: string;
  user_id: string | null;
  email_address: string;
  display_name: string | null;
  status: string | null;
  daily_sends_count: number | null;
  max_daily_sends: number | null;
  health_score: number | null;
};

async function resolveIdentity(
  admin: ReturnType<typeof createServiceClient>,
): Promise<Identity> {
  const [{ data: profiles }, { data: accountsByName }] = await Promise.all([
    admin
      .from("user_profiles")
      .select("user_id, full_name")
      .ilike("full_name", "%valdemar%"),
    admin
      .from("mail_accounts")
      .select(
        "id, user_id, email_address, display_name, status, daily_sends_count, max_daily_sends, health_score",
      )
      .or("email_address.ilike.valdemar%,display_name.ilike.%valdemar%"),
  ]);

  const userIds = new Set<string>();
  for (const profile of profiles ?? []) {
    if (profile.user_id) userIds.add(profile.user_id);
  }
  for (const account of accountsByName ?? []) {
    if (account.user_id) userIds.add(account.user_id);
  }

  const accountMap = new Map<string, GmailAccountRow>();
  for (const account of accountsByName ?? []) {
    accountMap.set(account.id, account);
  }
  // A rep can own several mailboxes (aliases) — pick up every account on his
  // user ids, not only the ones whose address contains his name.
  if (userIds.size > 0) {
    const { data: accountsByUser } = await admin
      .from("mail_accounts")
      .select(
        "id, user_id, email_address, display_name, status, daily_sends_count, max_daily_sends, health_score",
      )
      .in("user_id", [...userIds]);
    for (const account of accountsByUser ?? []) {
      accountMap.set(account.id, account);
    }
  }

  const accounts = [...accountMap.values()];
  const displayName =
    profiles?.find((p) => p.full_name)?.full_name ??
    accounts.find((a) => a.display_name)?.display_name ??
    "Valdemar";

  return {
    userIds: [...userIds],
    accountIds: accounts.map((a) => a.id),
    displayName,
    accounts,
  };
}

// ---------------------------------------------------------------------------
// Bucketing — daily buckets, collapsing to ISO weeks past ~13 weeks of span.
// ---------------------------------------------------------------------------

type Buckets = {
  entries: { key: string; label: string }[];
  keyFor: (instant: Date) => string;
};

function buildBuckets(start: Date, endExclusive: Date): Buckets {
  const dayCount = Math.max(
    1,
    Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000),
  );
  const weekly = dayCount > 92;

  if (weekly) {
    const entries: { key: string; label: string }[] = [];
    const seen = new Set<string>();
    for (
      let cursor = startOfStockholmIsoWeek(start);
      cursor < endExclusive;
      cursor = addStockholmDays(cursor, 7)
    ) {
      const key = toStockholmIsoDate(cursor);
      if (seen.has(key)) break;
      seen.add(key);
      entries.push({ key, label: `wk ${key.slice(5)}` });
    }
    return {
      entries,
      keyFor: (instant) => toStockholmIsoDate(startOfStockholmIsoWeek(instant)),
    };
  }

  const entries: { key: string; label: string }[] = [];
  for (
    let cursor = startOfStockholmDay(start);
    cursor < endExclusive;
    cursor = addStockholmDays(cursor, 1)
  ) {
    const key = toStockholmIsoDate(cursor);
    entries.push({ key, label: key.slice(5) });
  }
  return {
    entries,
    keyFor: (instant) => toStockholmIsoDate(instant),
  };
}

function bucketSeries(
  buckets: Buckets,
  seriesCount: number,
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const entry of buckets.entries) {
    map.set(entry.key, new Array<number>(seriesCount).fill(0));
  }
  return map;
}

function toBucketPoints(
  buckets: Buckets,
  values: Map<string, number[]>,
): BucketPoint[] {
  return buckets.entries.map((entry) => ({
    key: entry.key,
    label: entry.label,
    values: values.get(entry.key) ?? [],
  }));
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function stockholmWeekdayIndex(instant: Date): number {
  const p = getStockholmParts(instant);
  // 0=Sunday from getUTCDay → shift to Monday-first.
  const sundayFirst = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

function safePercent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

function formatPercentValue(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function getValdemarStatsData(
  rangeKeyInput: string | string[] | undefined,
): Promise<ValdemarStatsData> {
  const rangeKey = normalizeValdemarRangeKey(rangeKeyInput);
  const now = new Date();
  const range = resolveLiveRange(rangeKey, now);
  const rangeDefinition = DASHBOARD_TIME_RANGES.find((r) => r.key === rangeKey);

  const admin = createServiceClient();
  const identity = await resolveIdentity(admin);

  const empty: ValdemarStatsData = {
    rangeKey,
    rangeLabel: rangeDefinition?.label ?? range.label,
    rangeSpan: formatRangeDateSpan(range),
    displayName: identity.displayName,
    identityFound: identity.userIds.length > 0 || identity.accountIds.length > 0,
    generatedAt: now.toISOString(),
    calls: {
      kpis: [],
      postCallKpis: [],
      seriesLabels: ["Calls", "Answered"],
      byBucket: [],
      talkTimeByBucket: [],
      byHour: [],
      byWeekday: [],
      outcomes: [],
      sentiments: [],
      durations: [],
      accountStates: [],
      noAccountFunnel: [],
      freeUserFunnel: [],
      conversions: [],
      postCallWindowDays: POST_CALL_WINDOW_DAYS,
      appStateResolved: false,
      rows: [],
      totalRows: 0,
    },
    emails: {
      kpis: [],
      sentOpensByBucket: [],
      clicksRepliesByBucket: [],
      byHour: [],
      funnel: [],
      statusBreakdown: [],
      topSequences: [],
      accounts: [],
      rows: [],
      totalRows: 0,
    },
  };

  if (!empty.identityFound) {
    return empty;
  }

  const [calls, emails] = await Promise.all([
    loadCalls(admin, identity, range.start, range.end),
    loadEmails(admin, identity, range.start, range.end),
  ]);

  const [nameMaps, appState] = await Promise.all([
    loadNames(
      admin,
      [...calls.contactIds, ...emails.contactIds],
      calls.companyIds,
    ),
    loadAppState(admin, calls.contactIds),
  ]);

  return {
    ...empty,
    calls: finishCalls(calls, nameMaps, appState, range.start, range.end),
    emails: finishEmails(emails, nameMaps, identity, range.start, range.end),
  };
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

type SessionRow = {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  status: string;
  direction: string;
  to_number: string | null;
  started_at: string | null;
  connected_at: string | null;
  duration_seconds: number | null;
  summary: string | null;
  ai_json: unknown;
  recording_url: string | null;
  recording_storage_path: string | null;
  activity_id: string | null;
  created_at: string | null;
};

type CallActivityRow = {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  outcome: string | null;
  metadata: unknown;
  created_at: string | null;
};

// The app-state fields are derived in finishCalls (they need the product-table
// join), so the raw loader builds rows without them.
type RawCallRow = Omit<
  ValdemarCallRow,
  "accountState" | "accountStateLabel" | "postCallEvent" | "postCallEventLabel"
>;

type CallsRaw = {
  rows: RawCallRow[];
  contactIds: string[];
  companyIds: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function loadCalls(
  admin: ReturnType<typeof createServiceClient>,
  identity: Identity,
  start: Date | null,
  end: Date,
): Promise<CallsRaw> {
  if (identity.userIds.length === 0) {
    return { rows: [], contactIds: [], companyIds: [] };
  }
  const endIso = end.toISOString();
  const startIso = start?.toISOString() ?? null;

  const sessionsQuery = pageAll<SessionRow>(({ from, to }) => {
    let query = admin
      .from("call_sessions")
      .select(
        "id, contact_id, company_id, status, direction, to_number, started_at, connected_at, duration_seconds, summary, ai_json, recording_url, recording_storage_path, activity_id, created_at",
      )
      .in("user_id", identity.userIds)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (startIso) query = query.gte("created_at", startIso);
    return query as unknown as PromiseLike<{
      data: SessionRow[] | null;
      error: { message: string } | null;
    }>;
  });

  const activitiesQuery = pageAll<CallActivityRow>(({ from, to }) => {
    let query = admin
      .from("activities")
      .select("id, contact_id, company_id, outcome, metadata, created_at")
      .eq("type", "call")
      .in("user_id", identity.userIds)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (startIso) query = query.gte("created_at", startIso);
    return query as unknown as PromiseLike<{
      data: CallActivityRow[] | null;
      error: { message: string } | null;
    }>;
  });

  const [sessionsResult, activitiesResult] = await Promise.all([
    sessionsQuery,
    activitiesQuery,
  ]);

  const sessions = sessionsResult.data ?? [];
  const activities = activitiesResult.data ?? [];

  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const consumedSessionIds = new Set<string>();
  const rows: RawCallRow[] = [];

  for (const activity of activities) {
    const metadata = asRecord(activity.metadata);
    const sessionId =
      typeof metadata.call_session_id === "string"
        ? metadata.call_session_id
        : null;
    const session = sessionId ? sessionById.get(sessionId) ?? null : null;
    if (sessionId) consumedSessionIds.add(sessionId);

    const aiJson = asRecord(session?.ai_json);
    const outcome = activity.outcome ??
      (typeof metadata.outcome === "string" ? metadata.outcome : null);
    const durationSeconds =
      typeof metadata.duration_seconds === "number"
        ? metadata.duration_seconds
        : session?.duration_seconds ?? null;

    rows.push({
      id: activity.id,
      sessionId,
      at: activity.created_at ?? new Date(0).toISOString(),
      contactId: activity.contact_id ?? session?.contact_id ?? null,
      contactName: "",
      companyId: activity.company_id ?? session?.company_id ?? null,
      companyName: null,
      phone: session?.to_number ?? null,
      direction:
        metadata.direction === "inbound" || session?.direction === "inbound"
          ? "inbound"
          : "outbound",
      outcome,
      outcomeLabel: outcome
        ? CALL_OUTCOME_LABEL[outcome as CallOutcome] ?? outcome
        : "Logged call",
      // Answered = the OUTCOME implies a conversation. Never trust
      // metadata.connected or 46elks connected_at here: both fire when only
      // the agent's own leg (browser auto-answer) picked up.
      answered: outcome
        ? CONNECTED_BY_DEFAULT[outcome as CallOutcome] ?? false
        : false,
      editable: true,
      durationSeconds,
      sentiment:
        typeof metadata.sentiment === "string"
          ? metadata.sentiment
          : typeof aiJson.sentiment === "string"
            ? (aiJson.sentiment as string)
            : null,
      summary: session?.summary ?? null,
      hasRecording: Boolean(
        session?.recording_url || session?.recording_storage_path,
      ),
      sessionStatus: session?.status ?? null,
    });
  }

  // Sessions that never produced an activity row (still dialing/processing,
  // or the log step failed) — show them too, without an outcome.
  for (const session of sessions) {
    if (consumedSessionIds.has(session.id)) continue;
    if (session.activity_id && rows.some((r) => r.id === session.activity_id)) {
      continue;
    }
    const aiJson = asRecord(session.ai_json);
    rows.push({
      id: `session-${session.id}`,
      sessionId: session.id,
      at: session.started_at ?? session.created_at ?? new Date(0).toISOString(),
      contactId: session.contact_id,
      contactName: "",
      companyId: session.company_id,
      companyName: null,
      phone: session.to_number,
      direction: session.direction === "inbound" ? "inbound" : "outbound",
      outcome: null,
      outcomeLabel:
        session.status === "dialing" || session.status === "in_progress"
          ? "In progress"
          : "No outcome logged",
      answered: false,
      editable: false,
      durationSeconds: session.duration_seconds,
      sentiment:
        typeof aiJson.sentiment === "string"
          ? (aiJson.sentiment as string)
          : null,
      summary: session.summary,
      hasRecording: Boolean(
        session.recording_url || session.recording_storage_path,
      ),
      sessionStatus: session.status,
    });
  }

  rows.sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    rows,
    contactIds: [...new Set(rows.map((r) => r.contactId).filter(Boolean))] as string[],
    companyIds: [...new Set(rows.map((r) => r.companyId).filter(Boolean))] as string[],
  };
}

const SENTIMENT_STYLE: Record<string, { label: string; colorClass: string }> = {
  positive: { label: "Positive", colorClass: "segment-active" },
  neutral: { label: "Neutral", colorClass: "segment-unknown" },
  negative: { label: "Negative", colorClass: "segment-risk" },
};

const DURATION_BUCKETS: { label: string; max: number }[] = [
  { label: "< 15s", max: 15 },
  { label: "15s – 1m", max: 60 },
  { label: "1 – 3m", max: 180 },
  { label: "3 – 10m", max: 600 },
  { label: "10m +", max: Number.POSITIVE_INFINITY },
];

function finishCalls(
  raw: CallsRaw,
  names: NameMaps,
  appState: AppStateMaps,
  start: Date | null,
  end: Date,
): ValdemarCallsData {
  const rows: ValdemarCallRow[] = raw.rows.map((row) => {
    const state = row.contactId
      ? appState.byContact.get(row.contactId)
      : undefined;
    const callAt = parseTime(row.at) ?? 0;
    const segment = accountStateAt(state, callAt);
    const strongest = strongestEvent(postCallEvents(state, callAt));
    return {
      ...row,
      contactName: row.contactId
        ? names.contactName.get(row.contactId) ?? "Unknown contact"
        : "Unknown contact",
      companyName: row.companyId
        ? names.companyName.get(row.companyId) ?? null
        : null,
      phone:
        row.phone ??
        (row.contactId ? names.contactPhone.get(row.contactId) ?? null : null),
      accountState: segment,
      accountStateLabel: ACCOUNT_STATE_LABEL[segment],
      postCallEvent: strongest?.event ?? null,
      postCallEventLabel: strongest
        ? POST_CALL_EVENT_LABEL[strongest.event]
        : null,
    };
  });

  const total = rows.length;
  const answeredRows = rows.filter((r) => r.answered);
  const answered = answeredRows.length;
  const talkSeconds = answeredRows.reduce(
    (sum, r) => sum + (r.durationSeconds ?? 0),
    0,
  );
  const avgDuration = answered ? talkSeconds / answered : 0;
  const longest = answeredRows.reduce(
    (best, r) => Math.max(best, r.durationSeconds ?? 0),
    0,
  );

  const outcomeCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.outcome) continue;
    outcomeCounts.set(row.outcome, (outcomeCounts.get(row.outcome) ?? 0) + 1);
  }
  const interested = outcomeCounts.get("interested") ?? 0;
  const callbacks = outcomeCounts.get("callback_scheduled") ?? 0;
  const closed = outcomeCounts.get("closed") ?? 0;
  const notInterested = outcomeCounts.get("not_interested") ?? 0;
  const noAnswer = outcomeCounts.get("no_answer") ?? 0;
  const voicemails = outcomeCounts.get("left_voicemail") ?? 0;
  const wrongNumbers = outcomeCounts.get("wrong_number") ?? 0;

  const uniqueContacts = new Set(rows.map((r) => r.contactId).filter(Boolean))
    .size;
  const uniqueCompanies = new Set(rows.map((r) => r.companyId).filter(Boolean))
    .size;

  const SOURCE = [
    "activities (type=call)",
    "call_sessions (46elks)",
  ];
  const ANSWERED_LOGIC =
    "Answered = the logged outcome implies a real conversation: Interested, Not interested, Callback booked, and Closed count as answered. No answer, Left voicemail, and Wrong number do not. This is deliberately NOT the phone network's \"connected\" signal — 46elks marks a call connected as soon as ANY leg picks up, including Valdemar's own browser auto-answering, which says nothing about the customer.";

  const kpis: ValdemarKpi[] = [
    {
      label: "Calls made",
      value: String(total),
      hint: `${uniqueContacts} contacts · ${uniqueCompanies} companies`,
      info: {
        title: "Calls made",
        body: "Every call Valdemar started in the selected range (plus any inbound callback to his number). One entry per dial, so calling the same contact twice counts twice. This IS the number of calls started — there is no separate 'started' metric.",
        sources: SOURCE,
        logic:
          "Logged calls (one activity row per call) merged with raw 46elks call sessions on call_session_id; sessions still ringing or without a logged outcome yet are included as 'In progress'.",
      },
    },
    {
      label: "Answered",
      value: String(answered),
      hint: `${formatPercentValue(safePercent(answered, total))} answer rate`,
      info: {
        title: "Answered",
        body: "Calls where a human actually picked up.",
        sources: SOURCE,
        logic: ANSWERED_LOGIC,
      },
    },
    {
      label: "No answer",
      value: String(noAnswer),
      hint: `${voicemails} voicemails left · ${wrongNumbers} wrong numbers`,
      info: {
        title: "No answer",
        body: "Calls logged with the 'No answer' outcome. Voicemails and wrong numbers are separate outcomes and are not included in this count (they're in the hint and the Outcomes chart).",
        sources: SOURCE,
      },
    },
    {
      label: "Talk time",
      value: formatDurationSeconds(talkSeconds),
      hint: `Avg ${formatDurationSeconds(avgDuration)} per answered call`,
      info: {
        title: "Talk time",
        body: "Total duration of ANSWERED calls only. Ring time on unanswered calls is excluded, so this approximates real conversation time.",
        sources: SOURCE,
        logic:
          "Sum of the 46elks call duration for every answered call. The duration clock starts when the call is bridged, so a few seconds of greeting/transfer are included.",
      },
    },
    {
      label: "Interested",
      value: String(interested),
      hint: `${formatPercentValue(safePercent(interested, answered))} of answered`,
      info: {
        title: "Interested",
        body: "Calls logged with the 'Interested' outcome — a real conversation where the contact showed buying interest. Outcomes are suggested by the AI from the transcript and can be corrected per call in the call log below.",
        sources: SOURCE,
      },
    },
    {
      label: "Callbacks booked",
      value: String(callbacks),
      hint: closed ? `${closed} closed` : "Follow-ups scheduled",
      info: {
        title: "Callbacks booked",
        body: "Calls that ended with a concrete agreement to call back at a specific time ('Callback booked' outcome). Each one also creates a follow-up task.",
        sources: SOURCE,
      },
    },
    {
      label: "Not interested",
      value: String(notInterested),
      hint: `${formatPercentValue(safePercent(notInterested, answered))} of answered`,
      info: {
        title: "Not interested",
        body: "Answered calls where the contact declined. Useful together with Interested to read the quality of the conversations, not just their volume.",
        sources: SOURCE,
      },
    },
    {
      label: "Longest call",
      value: formatDurationSeconds(longest),
      hint: `${answeredRows.filter((r) => (r.durationSeconds ?? 0) > 0).length} answered calls with talk time`,
      info: {
        title: "Longest call",
        body: "The single longest ANSWERED call in the range — a quick proxy for the deepest conversation. Open it in the call log for the transcript.",
        sources: SOURCE,
      },
    },
  ];

  // Buckets — anchor at the range start, or the earliest call for all-time.
  const earliest = rows.length
    ? new Date(rows[rows.length - 1].at)
    : addStockholmDays(end, -1);
  const buckets = buildBuckets(start ?? earliest, end);
  const perBucket = bucketSeries(buckets, 2);
  const talkPerBucket = bucketSeries(buckets, 1);
  const byHour: HourPoint[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}`,
    total: 0,
    answered: 0,
  }));
  const byWeekday: WeekdayPoint[] = WEEKDAY_LABELS.map((label) => ({
    label,
    total: 0,
    answered: 0,
  }));
  const durations: DurationBucket[] = DURATION_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: 0,
  }));
  const sentimentCounts = new Map<string, number>();

  for (const row of rows) {
    const at = new Date(row.at);
    const bucketValues = perBucket.get(buckets.keyFor(at));
    if (bucketValues) {
      bucketValues[0] += 1;
      if (row.answered) bucketValues[1] += 1;
    }
    const talkValues = talkPerBucket.get(buckets.keyFor(at));
    if (talkValues && row.answered) {
      talkValues[0] += row.durationSeconds ?? 0;
    }
    const hour = getStockholmParts(at).hour;
    byHour[hour].total += 1;
    if (row.answered) byHour[hour].answered += 1;
    const weekday = stockholmWeekdayIndex(at);
    byWeekday[weekday].total += 1;
    if (row.answered) byWeekday[weekday].answered += 1;

    // Conversation-length histogram: answered calls only — a duration on an
    // unanswered call is just ring/voicemail time and would skew the shape.
    if (row.answered && (row.durationSeconds ?? 0) > 0) {
      const seconds = row.durationSeconds ?? 0;
      const index = DURATION_BUCKETS.findIndex((b) => seconds < b.max);
      durations[index === -1 ? DURATION_BUCKETS.length - 1 : index].count += 1;
    }
    if (row.sentiment) {
      sentimentCounts.set(
        row.sentiment,
        (sentimentCounts.get(row.sentiment) ?? 0) + 1,
      );
    }
  }

  const outcomes: OutcomeSlice[] = [...outcomeCounts.entries()]
    .map(([outcome, count]) => ({
      outcome,
      label: CALL_OUTCOME_LABEL[outcome as CallOutcome] ?? outcome,
      count,
      answered: CONNECTED_BY_DEFAULT[outcome as CallOutcome] ?? false,
    }))
    .sort((a, b) => b.count - a.count);

  const sentiments: SentimentSlice[] = [...sentimentCounts.entries()]
    .map(([sentiment, count]) => ({
      sentiment,
      label: SENTIMENT_STYLE[sentiment]?.label ?? sentiment,
      count,
      colorClass: SENTIMENT_STYLE[sentiment]?.colorClass ?? "segment-unknown",
    }))
    .sort((a, b) => b.count - a.count);

  // ---- post-call conversion ------------------------------------------------
  //
  // Two questions, both about what the product did after the phone call:
  //   1. of the people with NO account, how many signed up (and then paid)?
  //   2. of the people already on the FREE plan, how many started a paid plan?
  //
  // The segment chart is call-level (every dial gets counted where it belongs),
  // while the funnels are contact-level — calling the same workshop three times
  // must not turn one signup into three. A contact is filed under the state it
  // was in at its FIRST call in range, which is the state Valdemar found.

  const INTERESTED_OUTCOMES = new Set(["interested", "closed"]);

  const segmentPoints = new Map<CallAccountState, AccountStatePoint>(
    ACCOUNT_STATE_ORDER.map((segment) => [
      segment,
      {
        segment,
        label: ACCOUNT_STATE_LABEL[segment],
        calls: 0,
        answered: 0,
        interested: 0,
        converted: 0,
        contacts: 0,
      },
    ]),
  );
  const segmentContacts = new Map<CallAccountState, Set<string>>(
    ACCOUNT_STATE_ORDER.map((segment) => [segment, new Set<string>()]),
  );

  type ContactProgress = {
    segment: CallAccountState;
    firstCallAt: number;
    answered: boolean;
    interested: boolean;
    signedUp: boolean;
    paidStart: boolean;
    charged: boolean;
  };
  const progressByContact = new Map<string, ContactProgress>();

  const EVENT_RANK: Record<PostCallEvent, number> = {
    signed_up: 1,
    paid_start: 2,
    charged: 3,
  };
  const conversionByContact = new Map<string, PostCallConversionRow>();

  for (const row of rows) {
    const callAt = parseTime(row.at) ?? 0;
    const state = row.contactId
      ? appState.byContact.get(row.contactId)
      : undefined;
    const events = postCallEvents(state, callAt);
    const isInterested = row.outcome
      ? INTERESTED_OUTCOMES.has(row.outcome)
      : false;
    const converted =
      events.signedUp !== null ||
      events.paidStart !== null ||
      events.charged !== null;

    const point = segmentPoints.get(row.accountState);
    if (point) {
      point.calls += 1;
      if (row.answered) point.answered += 1;
      if (isInterested) point.interested += 1;
      if (converted) point.converted += 1;
    }
    if (row.contactId) {
      segmentContacts.get(row.accountState)?.add(row.contactId);
    }

    if (!row.contactId) continue;

    const previous = progressByContact.get(row.contactId);
    const next: ContactProgress = previous ?? {
      segment: row.accountState,
      firstCallAt: callAt,
      answered: false,
      interested: false,
      signedUp: false,
      paidStart: false,
      charged: false,
    };
    // Rows arrive newest-first, so anything we meet later in the loop is an
    // earlier call and wins the "state Valdemar found" tie-break.
    if (previous && callAt <= previous.firstCallAt) {
      next.segment = row.accountState;
      next.firstCallAt = callAt;
    }
    next.answered = next.answered || row.answered;
    next.interested = next.interested || isInterested;
    next.signedUp = next.signedUp || events.signedUp !== null;
    next.paidStart = next.paidStart || events.paidStart !== null;
    next.charged = next.charged || events.charged !== null;
    progressByContact.set(row.contactId, next);

    const strongest = strongestEvent(events);
    if (strongest) {
      const candidate: PostCallConversionRow = {
        contactId: row.contactId,
        contactName: row.contactName,
        companyName: row.companyName,
        segment: row.accountState,
        segmentLabel: row.accountStateLabel,
        callAt: row.at,
        outcome: row.outcome,
        outcomeLabel: row.outcomeLabel,
        answered: row.answered,
        event: strongest.event,
        eventLabel: POST_CALL_EVENT_LABEL[strongest.event],
        eventAt: new Date(strongest.at).toISOString(),
        daysAfterCall: Math.max(
          0,
          Math.round((strongest.at - callAt) / 86_400_000),
        ),
      };
      const held = conversionByContact.get(row.contactId);
      // One row per contact: keep the furthest event, and for the same event
      // the call that sits closest before it.
      const better =
        !held ||
        EVENT_RANK[candidate.event] > EVENT_RANK[held.event] ||
        (candidate.event === held.event &&
          candidate.daysAfterCall < held.daysAfterCall);
      if (better) conversionByContact.set(row.contactId, candidate);
    }
  }

  for (const [segment, contactSet] of segmentContacts) {
    const point = segmentPoints.get(segment);
    if (point) point.contacts = contactSet.size;
  }

  const progress = [...progressByContact.values()];
  const bySegment = (segment: CallAccountState) =>
    progress.filter((entry) => entry.segment === segment);

  const noAccount = bySegment("no_account");
  const noAccountInterested = noAccount.filter((entry) => entry.interested);
  const noAccountFunnel: FunnelStep[] = [
    funnelStep("called", "Contacts called", noAccount.length, null),
    funnelStep(
      "answered",
      "Answered",
      noAccount.filter((entry) => entry.answered).length,
      noAccount.length,
    ),
    funnelStep(
      "interested",
      "Interested",
      noAccountInterested.length,
      noAccount.filter((entry) => entry.answered).length,
    ),
    funnelStep(
      "signed_up",
      "Created an account",
      noAccountInterested.filter((entry) => entry.signedUp).length,
      noAccountInterested.length,
    ),
    funnelStep(
      "paid_start",
      "Started a paid plan",
      noAccountInterested.filter((entry) => entry.signedUp && entry.paidStart)
        .length,
      noAccountInterested.filter((entry) => entry.signedUp).length,
    ),
    funnelStep(
      "charged",
      "First payment",
      noAccountInterested.filter((entry) => entry.signedUp && entry.charged)
        .length,
      noAccountInterested.filter((entry) => entry.signedUp && entry.paidStart)
        .length,
    ),
  ];

  const freeUsers = bySegment("free");
  const freeAnswered = freeUsers.filter((entry) => entry.answered);
  const freeInterested = freeUsers.filter((entry) => entry.interested);
  const freeUserFunnel: FunnelStep[] = [
    funnelStep("called", "Contacts called", freeUsers.length, null),
    funnelStep("answered", "Answered", freeAnswered.length, freeUsers.length),
    funnelStep(
      "interested",
      "Interested",
      freeInterested.length,
      freeAnswered.length,
    ),
    funnelStep(
      "paid_start",
      "Started a paid plan",
      freeInterested.filter((entry) => entry.paidStart).length,
      freeInterested.length,
    ),
    funnelStep(
      "charged",
      "First payment",
      freeInterested.filter((entry) => entry.charged).length,
      freeInterested.filter((entry) => entry.paidStart).length,
    ),
  ];

  // Unrestricted totals for the tiles: these count conversions after ANY call,
  // including calls Valdemar logged as "no answer" or "not interested". The
  // funnels above deliberately chain through Interested, so the tiles are where
  // an off-script signup still shows up.
  const accountsCreated = noAccount.filter((entry) => entry.signedUp).length;
  const paidStartsFromFree = freeUsers.filter((entry) => entry.paidStart).length;
  const firstPayments = progress.filter((entry) => entry.charged).length;
  const answeredContacts = progress.filter((entry) => entry.answered);
  const answeredConverted = answeredContacts.filter(
    (entry) => entry.signedUp || entry.paidStart || entry.charged,
  ).length;

  const POST_CALL_SOURCE = [
    "activities (type=call)",
    "contacts.wl_user_id + signed_up_at",
    "dashboard_users / dashboard_subscriptions",
  ];
  const ATTRIBUTION_LOGIC = `A product event counts as "after the call" when it happened later than the call and within ${POST_CALL_WINDOW_DAYS} days of it. Events can land after the end of the selected range: the CALL has to be in range, the signup or payment does not. Signup date is contacts.signed_up_at; a paid start is the Stripe customer appearing on a paid-plan subscription (that is the checkout moment in this product) or a first charge; a first payment is dashboard_subscriptions.metadata.first_paid_at. plan_key alone is never treated as paid, because it is written at checkout during the trial and includes people who were never charged.`;

  const postCallKpis: ValdemarKpi[] = [
    {
      label: "Accounts created",
      value: String(accountsCreated),
      hint: `of ${noAccount.length} contacts called without an account`,
      info: {
        title: "Accounts created after a call",
        body: "Contacts who had no Wrenchlane account when Valdemar called and created one afterwards. Counted per contact, not per call, and counted whatever the logged outcome was.",
        sources: POST_CALL_SOURCE,
        logic: `${ATTRIBUTION_LOGIC} A contact only appears here once the CRM has linked the new app user to the contact row, which happens on the hourly Customer.io email match — a person who signs up with a different email address than the one we called stays invisible.`,
      },
    },
    {
      label: "Free to paid starts",
      value: String(paidStartsFromFree),
      hint: `of ${freeUsers.length} free-plan contacts called`,
      info: {
        title: "Free to paid starts after a call",
        body: "Contacts who were on the free plan when Valdemar called and picked a paid plan afterwards. A trial on a paid plan counts: that is the upgrade decision, even before the first invoice clears. Brand-new signups who go straight onto a paid trial are NOT in this tile (they had no account, so they belong to the no-account funnel), which is why this can read 0 while that funnel shows paid starts.",
        sources: POST_CALL_SOURCE,
        logic: `${ATTRIBUTION_LOGIC} The blind spot is a repeat checkout: someone who trialled and cancelled long ago reuses the same Stripe customer, so a second checkout carries the OLD customer date and is only caught once it produces a charge.`,
      },
    },
    {
      label: "First payments",
      value: String(firstPayments),
      hint: `real charges within ${POST_CALL_WINDOW_DAYS} days of a call`,
      info: {
        title: "First payments after a call",
        body: "Contacts whose workshop was charged for the first time after the call. This is the only revenue-hard number on the page: it comes from the Stripe sync, not from a selected plan.",
        sources: POST_CALL_SOURCE,
        logic: ATTRIBUTION_LOGIC,
      },
    },
    {
      label: "Answered to conversion",
      value: formatPercentValue(
        safePercent(answeredConverted, answeredContacts.length),
      ),
      hint: `${answeredConverted} of ${answeredContacts.length} answered contacts`,
      info: {
        title: "Answered to conversion",
        body: "Of the contacts who actually picked up, the share that then did something in the product: created an account, started a paid plan, or paid. The single number for whether the conversations move people.",
        sources: POST_CALL_SOURCE,
        logic: ATTRIBUTION_LOGIC,
      },
    },
  ];

  const conversions = [...conversionByContact.values()].sort((a, b) =>
    a.eventAt < b.eventAt ? 1 : -1,
  );

  const accountStates = ACCOUNT_STATE_ORDER.map(
    (segment) => segmentPoints.get(segment)!,
  ).filter((point) => point.calls > 0);

  return {
    kpis,
    postCallKpis,
    seriesLabels: ["Calls", "Answered"],
    byBucket: toBucketPoints(buckets, perBucket),
    talkTimeByBucket: toBucketPoints(buckets, talkPerBucket),
    byHour,
    byWeekday,
    outcomes,
    sentiments,
    durations,
    accountStates,
    noAccountFunnel,
    freeUserFunnel,
    conversions,
    postCallWindowDays: POST_CALL_WINDOW_DAYS,
    appStateResolved: appState.resolved,
    rows: rows.slice(0, CALL_ROW_LIMIT),
    totalRows: total,
  };
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

type EmailQueueRow = {
  id: string;
  contact_id: string | null;
  to_email: string;
  subject: string;
  status: string;
  sent_at: string | null;
  scheduled_for: string | null;
  created_at: string | null;
  enrollment_id: string | null;
};

type EmailEventRow = {
  email_queue_id: string | null;
  event_type: string;
  link_url: string | null;
  created_at: string | null;
};

// A mail the rep typed in the Gmail web app. It never passed through
// email_queue, so it has no tracking pixel, no wrapped links and no queue row —
// mailbox-sync logs it as an activity and that is the only record of it.
type ManualSentRow = {
  id: string;
  at: string;
  to_email: string;
  subject: string;
  contact_id: string | null;
};

type EmailsRaw = {
  sent: EmailQueueRow[];
  manualSent: ManualSentRow[];
  eventsByEmail: Map<string, EmailEventRow[]>;
  replies: { received_at: string; contact_id: string | null }[];
  pendingCount: number;
  failedCount: number;
  sequenceNameByEnrollment: Map<string, string>;
  contactIds: string[];
};

async function loadEmails(
  admin: ReturnType<typeof createServiceClient>,
  identity: Identity,
  start: Date | null,
  end: Date,
): Promise<EmailsRaw> {
  if (identity.accountIds.length === 0) {
    return {
      sent: [],
      manualSent: [],
      eventsByEmail: new Map(),
      replies: [],
      pendingCount: 0,
      failedCount: 0,
      sequenceNameByEnrollment: new Map(),
      contactIds: [],
    };
  }
  const endIso = end.toISOString();
  const startIso = start?.toISOString() ?? null;

  const sentQuery = pageAll<EmailQueueRow>(({ from, to }) => {
    let query = admin
      .from("email_queue")
      .select(
        "id, contact_id, to_email, subject, status, sent_at, scheduled_for, created_at, enrollment_id",
      )
      .in("sender_account_id", identity.accountIds)
      .eq("status", "sent")
      .lt("sent_at", endIso)
      .order("sent_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (startIso) query = query.gte("sent_at", startIso);
    return query as unknown as PromiseLike<{
      data: EmailQueueRow[] | null;
      error: { message: string } | null;
    }>;
  });

  // Exact head-counts — a `.select()` read would silently cap at PostgREST's
  // 1000-row ceiling once the queue grows.
  const pendingCountQuery = admin
    .from("email_queue")
    .select("id", { count: "exact", head: true })
    .in("sender_account_id", identity.accountIds)
    .in("status", ["scheduled", "pending"]);
  const failedCountQuery = admin
    .from("email_queue")
    .select("id", { count: "exact", head: true })
    .in("sender_account_id", identity.accountIds)
    .eq("status", "failed");

  type ReplyRow = {
    id: string;
    received_at: string | null;
    contact_id: string | null;
    is_auto_reply: boolean | null;
    category: string | null;
  };
  const repliesQuery = pageAll<ReplyRow>(({ from, to }) => {
    let query = admin
      .from("inbox_messages")
      .select("id, received_at, contact_id, is_auto_reply, category")
      .in("gmail_account_id", identity.accountIds)
      .lt("received_at", endIso)
      .order("received_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (startIso) query = query.gte("received_at", startIso);
    return query as unknown as PromiseLike<{
      data: ReplyRow[] | null;
      error: { message: string } | null;
    }>;
  });

  // Mail typed by hand in the Gmail web app. It never touches email_queue, so
  // counting only that table made a rep who works out of Gmail look idle: the
  // page reported 9 sends for a month in which 23 external emails went out.
  // mailbox-sync logs each one as an activity, which is the only record there is.
  type ManualActivityRow = {
    id: string;
    created_at: string | null;
    subject: string | null;
    body: string | null;
    contact_id: string | null;
    metadata: Record<string, unknown> | null;
  };
  const manualSentQuery = pageAll<ManualActivityRow>(({ from, to }) => {
    let query = admin
      .from("activities")
      .select("id, created_at, subject, body, contact_id, metadata")
      .eq("type", "email_sent")
      .eq("metadata->>synced_from", "mailbox_sync")
      .in("metadata->>gmail_account_id", identity.accountIds)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (startIso) query = query.gte("created_at", startIso);
    return query as unknown as PromiseLike<{
      data: ManualActivityRow[] | null;
      error: { message: string } | null;
    }>;
  });

  const [
    sentResult,
    pendingResult,
    failedResult,
    repliesResult,
    manualSentResult,
  ] = await Promise.all([
    sentQuery,
    pendingCountQuery,
    failedCountQuery,
    repliesQuery,
    manualSentQuery,
  ]);

  const sent = sentResult.data ?? [];

  const manualSent: ManualSentRow[] = (manualSentResult.data ?? [])
    .filter((row) => row.created_at)
    .map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const recipients = Array.isArray(meta.to)
        ? (meta.to as unknown[]).filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      return {
        id: row.id,
        at: row.created_at as string,
        // `body` is the "Email sent to <address>" summary the cron writes; the
        // metadata list is the authoritative recipient set.
        to_email: recipients[0] ?? row.body?.replace(/^Email sent to /, "") ?? "",
        subject: row.subject ?? "(no subject)",
        contact_id: row.contact_id,
      };
    });
  // Reply-rate convention: exclude auto-replies / out-of-office (they stay in
  // the Inbox but never count as replies — same rule as the funnel loader).
  const replies = (repliesResult.data ?? [])
    .filter(
      (r) =>
        r.received_at && !r.is_auto_reply && r.category !== "out_of_office",
    )
    .map((r) => ({
      received_at: r.received_at as string,
      contact_id: r.contact_id,
    }));

  const sentIds = sent.map((row) => row.id);
  const eventsResult = await chunkedIn<EmailEventRow>(
    (chunk, { from, to }) =>
      admin
        .from("email_events")
        .select("email_queue_id, event_type, link_url, created_at")
        .in("email_queue_id", chunk)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: EmailEventRow[] | null;
        error: { message: string } | null;
      }>,
    sentIds,
  );

  const eventsByEmail = new Map<string, EmailEventRow[]>();
  for (const event of eventsResult.data ?? []) {
    if (!event.email_queue_id) continue;
    const list = eventsByEmail.get(event.email_queue_id) ?? [];
    list.push(event);
    eventsByEmail.set(event.email_queue_id, list);
  }

  // Sequence names for the sends that came from enrollments.
  const enrollmentIds = [
    ...new Set(sent.map((row) => row.enrollment_id).filter(Boolean)),
  ] as string[];
  const sequenceNameByEnrollment = new Map<string, string>();
  if (enrollmentIds.length > 0) {
    const enrollmentsResult = await chunkedIn<{
      id: string;
      sequence_id: string | null;
    }>(
      (chunk, { from, to }) =>
        admin
          .from("sequence_enrollments")
          .select("id, sequence_id")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: { id: string; sequence_id: string | null }[] | null;
          error: { message: string } | null;
        }>,
      enrollmentIds,
    );
    const enrollments = enrollmentsResult.data ?? [];
    const sequenceIds = [
      ...new Set(enrollments.map((e) => e.sequence_id).filter(Boolean)),
    ] as string[];
    if (sequenceIds.length > 0) {
      const { data: sequences } = await admin
        .from("sequences")
        .select("id, name")
        .in("id", sequenceIds);
      const nameById = new Map(
        (sequences ?? []).map((s) => [s.id, s.name ?? "Unnamed sequence"]),
      );
      for (const enrollment of enrollments) {
        if (enrollment.sequence_id) {
          sequenceNameByEnrollment.set(
            enrollment.id,
            nameById.get(enrollment.sequence_id) ?? "Unnamed sequence",
          );
        }
      }
    }
  }

  return {
    sent,
    manualSent,
    eventsByEmail,
    replies,
    pendingCount: pendingResult.count ?? 0,
    failedCount: failedResult.count ?? 0,
    sequenceNameByEnrollment,
    contactIds: [
      ...new Set(
        [...sent, ...manualSent].map((r) => r.contact_id).filter(Boolean),
      ),
    ] as string[],
  };
}

function finishEmails(
  raw: EmailsRaw,
  names: NameMaps,
  identity: Identity,
  start: Date | null,
  end: Date,
): ValdemarEmailsData {
  // Two populations, deliberately kept apart:
  //   trackedCount — sent through the CRM, so they carry a pixel and wrapped
  //                  links and can be measured for opens and clicks.
  //   manualCount  — typed in Gmail. Real mail that must be counted as sent,
  //                  but it can never register an open, so folding it into the
  //                  open-rate denominator would just invent a fake decline.
  const trackedCount = raw.sent.length;
  const manualCount = raw.manualSent.length;
  const sentCount = trackedCount + manualCount;

  const openedEmails = new Set<string>();
  const clickedEmails = new Set<string>();
  const bouncedEmails = new Set<string>();
  const unsubscribedEmails = new Set<string>();
  const repliedEmails = new Set<string>();
  let openEvents = 0;
  let clickEvents = 0;

  for (const [emailId, events] of raw.eventsByEmail.entries()) {
    for (const event of events) {
      if (event.event_type === "open") {
        openedEmails.add(emailId);
        openEvents += 1;
      } else if (event.event_type === "click") {
        clickedEmails.add(emailId);
        clickEvents += 1;
      } else if (event.event_type === "bounce") {
        bouncedEmails.add(emailId);
      } else if (event.event_type === "unsubscribe") {
        unsubscribedEmails.add(emailId);
      } else if (event.event_type === "reply") {
        repliedEmails.add(emailId);
      }
    }
  }

  const repliesReceived = raw.replies.length;
  const uniqueRecipients = new Set([
    ...raw.sent.map((r) => r.to_email),
    ...raw.manualSent.map((r) => r.to_email),
  ]).size;

  const EMAIL_SOURCE = ["email_queue", "email_events", "inbox_messages"];
  const ALL_SENDS_SOURCE = [...EMAIL_SOURCE, "activities"];
  const kpis: ValdemarKpi[] = [
    {
      label: "Emails sent",
      value: String(sentCount),
      hint:
        manualCount > 0
          ? `${uniqueRecipients} unique recipients · ${trackedCount} via CRM, ${manualCount} from Gmail`
          : `${uniqueRecipients} unique recipients`,
      info: {
        title: "Emails sent",
        body: "Every email that actually left Valdemar's mailboxes in the range: sequence steps, one-off composes, and mail he typed by hand in the Gmail web app. Scheduled-but-not-yet-sent emails are in the 'In queue' tile instead.",
        sources: ALL_SENDS_SOURCE,
        logic:
          "CRM sends come from email_queue (status=sent). Gmail-web sends have no queue row at all, so they are counted from the email_sent activities the mailbox-sync cron writes for each connected mailbox. Two consequences: that cron runs at :15 and :45, so mail sent in the last half hour may not be counted yet; and it only logs mail addressed to someone the CRM can place, so a note to a personal contact who is not in the CRM never appears here.",
      },
    },
    {
      label: "Open rate",
      value: formatPercentValue(safePercent(openedEmails.size, trackedCount)),
      hint: `${openedEmails.size} opened · ${openEvents} opens total`,
      info: {
        title: "Open rate",
        body: "Share of sent emails opened at least once, measured by the tracking pixel. Undercounts readers whose mail client blocks images; a single email opened five times still counts once in the rate.",
        sources: EMAIL_SOURCE,
        logic:
          manualCount > 0
            ? `Measured over the ${trackedCount} emails sent through the CRM, not all ${sentCount}. Mail typed in Gmail carries no tracking pixel, so it can never register an open — putting it in the denominator would report a drop in open rate that never happened.`
            : undefined,
      },
    },
    {
      label: "Click rate",
      value: formatPercentValue(safePercent(clickedEmails.size, trackedCount)),
      hint: `${clickedEmails.size} emails clicked · ${clickEvents} clicks`,
      info: {
        title: "Click rate",
        body: "Share of sent emails where the recipient clicked at least one tracked link (links are wrapped through the tracking domain).",
        sources: EMAIL_SOURCE,
        logic:
          manualCount > 0
            ? `Measured over the ${trackedCount} emails sent through the CRM. Links in a hand-written Gmail message are not wrapped through the tracking domain, so those clicks are invisible to us.`
            : undefined,
      },
    },
    {
      label: "Replies received",
      value: String(repliesReceived),
      hint: `${formatPercentValue(safePercent(repliesReceived, sentCount))} reply rate`,
      info: {
        title: "Replies received",
        body: "Human replies that landed in Valdemar's inbox during the range. Auto-replies and out-of-office messages are excluded (same rule as everywhere else in the CRM), so this reads engagement, not autoresponders.",
        sources: EMAIL_SOURCE,
        logic:
          "Counted from inbox_messages on his mailboxes with is_auto_reply=false and category ≠ out_of_office; the rate divides by emails sent in the same range, so a reply to last week's email can nudge a short range above 100%.",
      },
    },
    {
      label: "Bounces",
      value: String(bouncedEmails.size),
      hint: `${unsubscribedEmails.size} unsubscribes`,
      info: {
        title: "Bounces",
        body: "Sent emails that came back undeliverable. Bounced addresses are added to the suppression list automatically so they are not emailed again.",
        sources: EMAIL_SOURCE,
      },
    },
    {
      label: "In queue",
      value: String(raw.pendingCount),
      hint: `${raw.failedCount} failed (all time)`,
      info: {
        title: "In queue",
        body: "Emails scheduled from his mailboxes that have not gone out yet — a live number, independent of the selected time range (as is the failed count in the hint).",
        sources: ["email_queue"],
      },
    },
  ];

  // Both lists are newest-first, so the earliest send is whichever tail is older.
  const sendTimestamps = [
    ...raw.sent.map((r) => r.sent_at),
    ...raw.manualSent.map((r) => r.at),
  ].filter((value): value is string => Boolean(value));
  const earliest = sendTimestamps.length
    ? new Date(Math.min(...sendTimestamps.map((v) => new Date(v).getTime())))
    : addStockholmDays(end, -1);
  const buckets = buildBuckets(start ?? earliest, end);
  const sentOpens = bucketSeries(buckets, 2);
  const clicksReplies = bucketSeries(buckets, 2);
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}`,
    sent: 0,
  }));

  for (const iso of sendTimestamps) {
    const at = new Date(iso);
    const values = sentOpens.get(buckets.keyFor(at));
    if (values) values[0] += 1;
    byHour[getStockholmParts(at).hour].sent += 1;
  }
  for (const events of raw.eventsByEmail.values()) {
    for (const event of events) {
      if (!event.created_at) continue;
      const at = new Date(event.created_at);
      if (event.event_type === "open") {
        const values = sentOpens.get(buckets.keyFor(at));
        if (values) values[1] += 1;
      } else if (event.event_type === "click") {
        const values = clicksReplies.get(buckets.keyFor(at));
        if (values) values[0] += 1;
      }
    }
  }
  for (const reply of raw.replies) {
    const values = clicksReplies.get(buckets.keyFor(new Date(reply.received_at)));
    if (values) values[1] += 1;
  }

  const funnelSteps = [
    // Tracked sends only. Opens and clicks cannot exist for Gmail-web mail, so
    // seeding the funnel with the full send count would show a collapse at the
    // first step that is an artefact of measurement, not of engagement.
    {
      key: "sent",
      label: manualCount > 0 ? "Sent via CRM" : "Sent",
      value: trackedCount,
    },
    { key: "opened", label: "Opened", value: openedEmails.size },
    { key: "clicked", label: "Clicked", value: clickedEmails.size },
    { key: "replied", label: "Replied", value: repliesReceived },
  ];
  const funnel: FunnelStep[] = funnelSteps.map((step, index) => ({
    ...step,
    rateFromPrevious:
      index === 0
        ? null
        : safePercent(step.value, funnelSteps[index - 1].value),
  }));

  const sequenceAgg = new Map<string, { sent: number; replies: number }>();
  for (const row of raw.sent) {
    const name = row.enrollment_id
      ? raw.sequenceNameByEnrollment.get(row.enrollment_id) ?? "One-off emails"
      : "One-off emails";
    const agg = sequenceAgg.get(name) ?? { sent: 0, replies: 0 };
    agg.sent += 1;
    if (repliedEmails.has(row.id)) agg.replies += 1;
    sequenceAgg.set(name, agg);
  }
  if (manualCount > 0) {
    // Hand-written mail is its own "campaign" — no enrollment, no tracking.
    sequenceAgg.set("Sent from Gmail", { sent: manualCount, replies: 0 });
  }
  const topSequences: SequenceSlice[] = [...sequenceAgg.entries()]
    .map(([name, agg]) => ({ name, ...agg }))
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 10);

  const accounts: AccountCard[] = identity.accounts.map((account) => ({
    email: account.email_address,
    status: account.status ?? "unknown",
    sentToday: account.daily_sends_count ?? 0,
    dailyCap: account.max_daily_sends ?? 0,
    healthScore: account.health_score,
  }));

  const trackedRows: ValdemarEmailRow[] = raw.sent.map(
    (row) => {
      const events = raw.eventsByEmail.get(row.id) ?? [];
      const eventItems: EmailEventItem[] = events.slice(0, 20).map((event) => ({
        type: event.event_type,
        at: event.created_at ?? "",
        linkUrl: event.link_url,
      }));
      return {
        id: row.id,
        at: row.sent_at ?? row.created_at ?? "",
        toEmail: row.to_email,
        subject: row.subject,
        status: row.status,
        contactId: row.contact_id,
        contactName: row.contact_id
          ? names.contactName.get(row.contact_id) ?? null
          : null,
        sequenceName: row.enrollment_id
          ? raw.sequenceNameByEnrollment.get(row.enrollment_id) ?? null
          : null,
        opened: openedEmails.has(row.id),
        openCount: events.filter((e) => e.event_type === "open").length,
        clicked: clickedEmails.has(row.id),
        replied: repliedEmails.has(row.id),
        bounced: bouncedEmails.has(row.id),
        events: eventItems,
      };
    },
  );

  // Gmail-web sends carry no events, so every engagement flag is false rather
  // than unknown. The "Sent from Gmail" sequence label is what tells the reader
  // those blanks mean "not measurable", not "nobody opened it".
  const manualRows: ValdemarEmailRow[] = raw.manualSent.map((row) => ({
    id: row.id,
    at: row.at,
    toEmail: row.to_email,
    subject: row.subject,
    status: "sent",
    contactId: row.contact_id,
    contactName: row.contact_id
      ? names.contactName.get(row.contact_id) ?? null
      : null,
    sequenceName: "Sent from Gmail",
    opened: false,
    openCount: 0,
    clicked: false,
    replied: false,
    bounced: false,
    events: [],
  }));

  const rows: ValdemarEmailRow[] = [...trackedRows, ...manualRows]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, EMAIL_ROW_LIMIT);

  return {
    kpis,
    sentOpensByBucket: toBucketPoints(buckets, sentOpens),
    clicksRepliesByBucket: toBucketPoints(buckets, clicksReplies),
    byHour,
    funnel,
    statusBreakdown: [
      { status: "sent", count: sentCount },
      { status: "queued", count: raw.pendingCount },
      { status: "failed", count: raw.failedCount },
      { status: "bounced", count: bouncedEmails.size },
    ],
    topSequences,
    accounts,
    rows,
    totalRows: sentCount,
  };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

async function loadNames(
  admin: ReturnType<typeof createServiceClient>,
  contactIds: string[],
  companyIds: string[],
): Promise<NameMaps> {
  const uniqueContactIds = [...new Set(contactIds)];
  const uniqueCompanyIds = [...new Set(companyIds)];

  const [contactsResult, companiesResult] = await Promise.all([
    chunkedIn<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string;
      phone: string | null;
    }>(
      (chunk, { from, to }) =>
        admin
          .from("contacts")
          .select("id, first_name, last_name, email, phone")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data:
            | {
                id: string;
                first_name: string | null;
                last_name: string | null;
                email: string;
                phone: string | null;
              }[]
            | null;
          error: { message: string } | null;
        }>,
      uniqueContactIds,
    ),
    chunkedIn<{ id: string; name: string | null }>(
      (chunk, { from, to }) =>
        admin
          .from("companies")
          .select("id, name")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: { id: string; name: string | null }[] | null;
          error: { message: string } | null;
        }>,
      uniqueCompanyIds,
    ),
  ]);

  const contactName = new Map<string, string>();
  const contactPhone = new Map<string, string | null>();
  for (const contact of contactsResult.data ?? []) {
    const name = [contact.first_name, contact.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    contactName.set(contact.id, name || contact.email);
    contactPhone.set(contact.id, contact.phone);
  }

  const companyName = new Map<string, string>();
  for (const company of companiesResult.data ?? []) {
    companyName.set(company.id, company.name ?? "Unnamed company");
  }

  return { contactName, contactPhone, companyName };
}

// ---------------------------------------------------------------------------
// App state (did the person have an account / a paid plan, and when?)
// ---------------------------------------------------------------------------
//
// The call log alone can't answer "did this call produce a customer" — that
// answer lives in the product tables. The chain is:
//
//   contacts.wl_user_id          -> dashboard_users.internal_user_id
//   dashboard_users.workshop_id  -> dashboard_subscriptions.workshop_id
//
// Only three dates matter, and they're all we can trust:
//   signed_up_at                     when the account was created
//   metadata.customer_created_at     when the Stripe customer appeared, i.e.
//                                    when a paid plan was picked (checkout)
//   metadata.first_paid_at           whether and when money actually moved
//
// The two are deliberately kept apart. A dashboard_subscriptions row only
// proves a paid plan was CHOSEN, never that it was charged: the row is written
// at checkout, during the trial (42 of 126 "paid" workshops had never been
// charged on 2026-08-12). So "started a paid plan" and "first payment" are
// separate steps in the funnels, and only first_paid_at counts as revenue.
//
// NOTE on plan_key: dashboard_workshops.plan_key holds plan NAMES
// (small_monthly, ...) but dashboard_subscriptions.plan_key holds Stripe PRICE
// IDS, so PAID_PLANS (a set of names) must not be matched against it. Every
// price on this Stripe account is a paid price (mrr_amount_cents is 475 at the
// lowest, never 0), and free users have no subscription row at all, so the
// existence of the row with a non-zero mrr IS the paid-plan signal.

/** Everything we know about one contact's product life, as epoch millis. */
type ContactAppState = {
  linked: boolean;
  signedUpAt: number | null;
  /** Earliest evidence that a PAID plan was started (checkout or charge). */
  paidStartAt: number | null;
  /** Every paid-start timestamp found, so "started after the call" still
   *  catches a second checkout that follows an earlier cancel. */
  paidStarts: number[];
  firstPaidAt: number | null;
  trialEndAt: number | null;
  canceledAt: number | null;
  /** Current snapshot from the core_app export. Undated, so it is only a
   *  last-resort tiebreak when Stripe gave us nothing at all. */
  planType: string | null;
  hasSubscriptionRow: boolean;
};

type AppStateMaps = {
  byContact: Map<string, ContactAppState>;
  /** False when nothing resolved, so the UI can tell "no conversions" apart
   *  from "the app join returned nothing". */
  resolved: boolean;
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function minTime(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function maxTime(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

type ContactAppRow = {
  id: string;
  wl_user_id: string | null;
  signed_up_at: string | null;
  user_plan_type: string | null;
};

type DashboardUserRow = {
  internal_user_id: string | null;
  workshop_id: string | null;
};

type DashboardSubscriptionRow = {
  workshop_id: string | null;
  status: string | null;
  plan_key: string | null;
  mrr_amount_cents: number | null;
  trial_end: string | null;
  current_period_start: string | null;
  canceled_at: string | null;
  metadata: unknown;
};

async function loadAppState(
  admin: ReturnType<typeof createServiceClient>,
  contactIds: string[],
): Promise<AppStateMaps> {
  const uniqueContactIds = [...new Set(contactIds)];
  const byContact = new Map<string, ContactAppState>();
  if (uniqueContactIds.length === 0) {
    return { byContact, resolved: false };
  }

  const contactsResult = await chunkedIn<ContactAppRow>(
    (chunk, { from, to }) =>
      admin
        .from("contacts")
        .select("id, wl_user_id, signed_up_at, user_plan_type")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: ContactAppRow[] | null;
        error: { message: string } | null;
      }>,
    uniqueContactIds,
  );

  const contacts = contactsResult.data ?? [];
  for (const contact of contacts) {
    byContact.set(contact.id, {
      linked: Boolean(contact.wl_user_id),
      signedUpAt: parseTime(contact.signed_up_at),
      paidStartAt: null,
      paidStarts: [],
      firstPaidAt: null,
      trialEndAt: null,
      canceledAt: null,
      planType: contact.user_plan_type,
      hasSubscriptionRow: false,
    });
  }

  const userIds = [
    ...new Set(
      contacts.map((c) => c.wl_user_id).filter((v): v is string => Boolean(v)),
    ),
  ];
  if (userIds.length === 0) {
    return { byContact, resolved: contacts.length > 0 };
  }

  // dashboard_users.internal_user_id is TEXT while contacts.wl_user_id is a
  // uuid, so the ids travel as strings.
  const usersResult = await chunkedIn<DashboardUserRow>(
    (chunk, { from, to }) =>
      admin
        .from("dashboard_users")
        .select("internal_user_id, workshop_id")
        .in("internal_user_id", chunk)
        .order("internal_user_id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: DashboardUserRow[] | null;
        error: { message: string } | null;
      }>,
    userIds,
  );

  const workshopByUser = new Map<string, string>();
  for (const user of usersResult.data ?? []) {
    if (!user.internal_user_id || !user.workshop_id) continue;
    workshopByUser.set(user.internal_user_id, user.workshop_id);
  }

  const workshopIds = [...new Set(workshopByUser.values())];
  const subsByWorkshop = new Map<string, DashboardSubscriptionRow[]>();
  if (workshopIds.length > 0) {
    const subsResult = await chunkedIn<DashboardSubscriptionRow>(
      (chunk, { from, to }) =>
        admin
          .from("dashboard_subscriptions")
          .select(
            "workshop_id, status, plan_key, mrr_amount_cents, trial_end, current_period_start, canceled_at, metadata",
          )
          .in("workshop_id", chunk)
          .order("workshop_id", { ascending: true })
          .order("stripe_subscription_id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: DashboardSubscriptionRow[] | null;
          error: { message: string } | null;
        }>,
      workshopIds,
    );
    for (const sub of subsResult.data ?? []) {
      if (!sub.workshop_id) continue;
      const list = subsByWorkshop.get(sub.workshop_id);
      if (list) list.push(sub);
      else subsByWorkshop.set(sub.workshop_id, [sub]);
    }
  }

  for (const contact of contacts) {
    const state = byContact.get(contact.id);
    if (!state || !contact.wl_user_id) continue;
    const workshopId = workshopByUser.get(contact.wl_user_id);
    if (!workshopId) continue;
    for (const sub of subsByWorkshop.get(workshopId) ?? []) {
      state.hasSubscriptionRow = true;
      const meta = asRecord(sub.metadata);
      const firstPaidAt = parseTime(
        typeof meta.first_paid_at === "string" ? meta.first_paid_at : null,
      );
      const customerCreatedAt = parseTime(
        typeof meta.customer_created_at === "string"
          ? meta.customer_created_at
          : null,
      );
      // See the plan_key note above: the row's own existence on a non-zero
      // price is the paid-plan signal, not a name match.
      const onPaidPlan =
        sub.plan_key != null &&
        (sub.mrr_amount_cents == null || sub.mrr_amount_cents > 0);
      const periodStart = parseTime(sub.current_period_start);

      // A "paid start" is any dated evidence that this workshop picked a paid
      // plan: the Stripe customer appearing on a paid-plan subscription (that
      // IS the checkout in this product — the customer is created the moment
      // the plan is chosen), the first charge, or the first non-trial billing
      // period. Trial-only checkouts count: that is the upgrade intent we want
      // to see after a call, it just hasn't produced revenue yet.
      const candidates: (number | null)[] = [
        onPaidPlan ? customerCreatedAt : null,
        firstPaidAt,
        sub.status !== "trialing" && onPaidPlan ? periodStart : null,
      ];
      for (const candidate of candidates) {
        if (candidate === null) continue;
        state.paidStarts.push(candidate);
        state.paidStartAt = minTime(state.paidStartAt, candidate);
      }
      state.firstPaidAt = minTime(state.firstPaidAt, firstPaidAt);
      state.trialEndAt = maxTime(state.trialEndAt, parseTime(sub.trial_end));
      state.canceledAt = maxTime(state.canceledAt, parseTime(sub.canceled_at));
    }
  }

  return { byContact, resolved: contacts.length > 0 };
}

/**
 * Where the contact stood when this specific call was made.
 *
 * Only dated evidence is used, so the answer is about the moment of the call
 * and not about today: a contact who signed up two days after the call is
 * "No account" on that call's row, which is exactly what makes the post-call
 * funnels readable.
 */
function accountStateAt(
  state: ContactAppState | undefined,
  callAt: number,
): CallAccountState {
  if (!state || !state.linked) return "no_account";
  if (state.signedUpAt === null || state.signedUpAt > callAt) {
    return "no_account";
  }
  const chargedBefore =
    state.firstPaidAt !== null && state.firstPaidAt <= callAt;
  const canceledBefore =
    state.canceledAt !== null && state.canceledAt <= callAt;
  if (chargedBefore) return canceledBefore ? "churned" : "paying";

  // No money yet. A paid-plan checkout before the call with the trial still
  // running at the call is a live trial; a trial that already lapsed (or was
  // cancelled) leaves them on the free plan.
  const checkoutBefore =
    state.paidStartAt !== null && state.paidStartAt <= callAt;
  const trialLive = state.trialEndAt !== null && state.trialEndAt > callAt;
  if (checkoutBefore && trialLive && !canceledBefore) return "trial";

  // Last resort: the Stripe sync never matched this workshop (no subscription
  // row at all) but the product's own export says they are on a paid plan. One
  // such contact in the Valdemar set on 2026-08-24. The snapshot carries no
  // date so it can't be attributed to anything, but it is still wrong to file
  // a paid workshop under "free plan" and inflate that funnel's denominator.
  if (
    !state.hasSubscriptionRow &&
    state.planType != null &&
    state.planType !== "free"
  ) {
    return "paying";
  }
  return "free";
}

const POST_CALL_EVENT_LABEL: Record<PostCallEvent, string> = {
  signed_up: "Created an account",
  paid_start: "Started a paid plan",
  charged: "First payment",
};

type PostCallEvents = {
  signedUp: number | null;
  paidStart: number | null;
  charged: number | null;
};

/** Product events that happened AFTER this call, inside the attribution window. */
function postCallEvents(
  state: ContactAppState | undefined,
  callAt: number,
): PostCallEvents {
  const inWindow = (time: number | null): number | null =>
    time !== null && time > callAt && time - callAt <= POST_CALL_WINDOW_MS
      ? time
      : null;
  if (!state) return { signedUp: null, paidStart: null, charged: null };
  const paidStart =
    state.paidStarts
      .map(inWindow)
      .filter((time): time is number => time !== null)
      .sort((a, b) => a - b)[0] ?? null;
  return {
    signedUp: inWindow(state.signedUpAt),
    paidStart,
    charged: inWindow(state.firstPaidAt),
  };
}

/** The furthest the contact got after the call: charged > paid start > signup. */
function strongestEvent(
  events: PostCallEvents,
): { event: PostCallEvent; at: number } | null {
  if (events.charged !== null) return { event: "charged", at: events.charged };
  if (events.paidStart !== null) {
    return { event: "paid_start", at: events.paidStart };
  }
  if (events.signedUp !== null) {
    return { event: "signed_up", at: events.signedUp };
  }
  return null;
}

function funnelStep(
  key: string,
  label: string,
  value: number,
  previous: number | null,
): FunnelStep {
  return {
    key,
    label,
    value,
    rateFromPrevious:
      previous === null ? null : previous > 0 ? (value / previous) * 100 : 0,
  };
}
