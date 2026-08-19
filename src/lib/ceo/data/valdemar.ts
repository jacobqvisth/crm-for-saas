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
  formatDurationSeconds,
  type AccountCard,
  type BucketPoint,
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
      .from("gmail_accounts")
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
      .from("gmail_accounts")
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
      seriesLabels: ["Calls", "Answered"],
      byBucket: [],
      talkTimeByBucket: [],
      byHour: [],
      byWeekday: [],
      outcomes: [],
      sentiments: [],
      durations: [],
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

  const nameMaps = await loadNames(admin, [
    ...calls.contactIds,
    ...emails.contactIds,
  ], calls.companyIds);

  return {
    ...empty,
    calls: finishCalls(calls, nameMaps, range.start, range.end),
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

type CallsRaw = {
  rows: ValdemarCallRow[];
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
  const rows: ValdemarCallRow[] = [];

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
  start: Date | null,
  end: Date,
): ValdemarCallsData {
  const rows = raw.rows.map((row) => ({
    ...row,
    contactName: row.contactId
      ? names.contactName.get(row.contactId) ?? "Unknown contact"
      : "Unknown contact",
    companyName: row.companyId
      ? names.companyName.get(row.companyId) ?? null
      : null,
    phone: row.phone ??
      (row.contactId ? names.contactPhone.get(row.contactId) ?? null : null),
  }));

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

  return {
    kpis,
    seriesLabels: ["Calls", "Answered"],
    byBucket: toBucketPoints(buckets, perBucket),
    talkTimeByBucket: toBucketPoints(buckets, talkPerBucket),
    byHour,
    byWeekday,
    outcomes,
    sentiments,
    durations,
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

type EmailsRaw = {
  sent: EmailQueueRow[];
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

  const [sentResult, pendingResult, failedResult, repliesResult] =
    await Promise.all([
      sentQuery,
      pendingCountQuery,
      failedCountQuery,
      repliesQuery,
    ]);

  const sent = sentResult.data ?? [];
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
    eventsByEmail,
    replies,
    pendingCount: pendingResult.count ?? 0,
    failedCount: failedResult.count ?? 0,
    sequenceNameByEnrollment,
    contactIds: [
      ...new Set(sent.map((r) => r.contact_id).filter(Boolean)),
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
  const sentCount = raw.sent.length;

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
  const uniqueRecipients = new Set(raw.sent.map((r) => r.to_email)).size;

  const EMAIL_SOURCE = ["email_queue", "email_events", "inbox_messages"];
  const kpis: ValdemarKpi[] = [
    {
      label: "Emails sent",
      value: String(sentCount),
      hint: `${uniqueRecipients} unique recipients`,
      info: {
        title: "Emails sent",
        body: "Emails actually delivered to Gmail from Valdemar's mailboxes in the range — sequence steps and one-off composes alike. Scheduled-but-not-yet-sent emails are in the 'In queue' tile instead.",
        sources: EMAIL_SOURCE,
      },
    },
    {
      label: "Open rate",
      value: formatPercentValue(safePercent(openedEmails.size, sentCount)),
      hint: `${openedEmails.size} opened · ${openEvents} opens total`,
      info: {
        title: "Open rate",
        body: "Share of sent emails opened at least once, measured by the tracking pixel. Undercounts readers whose mail client blocks images; a single email opened five times still counts once in the rate.",
        sources: EMAIL_SOURCE,
      },
    },
    {
      label: "Click rate",
      value: formatPercentValue(safePercent(clickedEmails.size, sentCount)),
      hint: `${clickedEmails.size} emails clicked · ${clickEvents} clicks`,
      info: {
        title: "Click rate",
        body: "Share of sent emails where the recipient clicked at least one tracked link (links are wrapped through the tracking domain).",
        sources: EMAIL_SOURCE,
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

  const earliest = raw.sent.length
    ? new Date(raw.sent[raw.sent.length - 1].sent_at ?? Date.now())
    : addStockholmDays(end, -1);
  const buckets = buildBuckets(start ?? earliest, end);
  const sentOpens = bucketSeries(buckets, 2);
  const clicksReplies = bucketSeries(buckets, 2);
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}`,
    sent: 0,
  }));

  for (const row of raw.sent) {
    if (!row.sent_at) continue;
    const at = new Date(row.sent_at);
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
    { key: "sent", label: "Sent", value: sentCount },
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

  const rows: ValdemarEmailRow[] = raw.sent.slice(0, EMAIL_ROW_LIMIT).map(
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
