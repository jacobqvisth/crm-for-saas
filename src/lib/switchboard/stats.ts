// Aggregates for the Receptionist page. Pure and Supabase-free so the maths is
// unit-testable rather than tangled in JSX.

export interface CallRow {
  created_at: string;
  status: string;
  outcome: string | null;
  duration_seconds: number | null;
  requested_label: string | null;
  caller_number: string | null;
  contact_id: string | null;
  message_body: string | null;
  unanswered: string[] | null;
}

export interface SwitchboardStats {
  total: number;
  /** Calls in the last 7 and 30 days. */
  last7: number;
  last30: number;
  today: number;
  /** Counts per outcome, including a bucket for rows with none recorded. */
  byOutcome: Record<string, number>;
  /** Answered without needing a human. */
  handledAlone: number;
  /** Put through to a person who picked up. */
  transferred: number;
  /** A human was wanted but nobody answered. */
  missed: number;
  messagesTaken: number;
  /** Of the calls that reached a conclusion, the share handled without a human. */
  selfServeRate: number | null;
  /** Share of calls where the caller asked for a person. */
  transferRequestRate: number | null;
  avgDurationSeconds: number | null;
  longestSeconds: number | null;
  /** Callers we could match to a contact. */
  knownCallers: number;
  /** Who callers ask for, most-requested first. */
  topRequested: Array<{ label: string; count: number }>;
  /** Calls per day for the last 14 days, oldest first, for a sparkline. */
  daily: Array<{ day: string; count: number }>;
  /** Busiest hours in Stockholm time, most active first. */
  busiestHours: Array<{ hour: number; count: number }>;
  /** Distinct caller numbers seen. */
  uniqueCallers: number;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Hour of day in Stockholm, matching how the office hours are expressed. */
function stockholmHour(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  return h >= 0 ? h : null;
}

export function computeStats(rows: CallRow[], now: Date = new Date()): SwitchboardStats {
  const nowMs = now.getTime();
  const dayMs = 86_400_000;
  const todayKey = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const byOutcome: Record<string, number> = {};
  const requested = new Map<string, number>();
  const perDay = new Map<string, number>();
  const perHour = new Map<number, number>();
  const callers = new Set<string>();

  let last7 = 0;
  let last30 = 0;
  let today = 0;
  let durationSum = 0;
  let durationCount = 0;
  let longest: number | null = null;
  let knownCallers = 0;
  let messagesTaken = 0;

  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    const age = nowMs - t;
    if (age <= 7 * dayMs) last7 += 1;
    if (age <= 30 * dayMs) last30 += 1;
    if (dayKey(r.created_at) === todayKey) today += 1;

    const key = r.outcome ?? "unrecorded";
    byOutcome[key] = (byOutcome[key] ?? 0) + 1;

    if (r.requested_label?.trim()) {
      const label = r.requested_label.trim();
      requested.set(label, (requested.get(label) ?? 0) + 1);
    }

    // Only count durations we actually have; a null is "unknown", not zero, and
    // averaging nulls as zero would quietly understate every call.
    if (typeof r.duration_seconds === "number" && r.duration_seconds > 0) {
      durationSum += r.duration_seconds;
      durationCount += 1;
      if (longest === null || r.duration_seconds > longest) longest = r.duration_seconds;
    }

    if (r.contact_id) knownCallers += 1;
    if (r.message_body) messagesTaken += 1;
    if (r.caller_number) callers.add(r.caller_number);

    if (age <= 14 * dayMs) {
      const d = dayKey(r.created_at);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const hour = stockholmHour(r.created_at);
    if (hour !== null) perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
  }

  const handledAlone = byOutcome["handled_by_agent"] ?? 0;
  const transferred = byOutcome["forwarded"] ?? 0;
  const missed = byOutcome["no_answer"] ?? 0;
  const voicemail = byOutcome["voicemail"] ?? 0;
  const messageOutcome = (byOutcome["message_taken"] ?? 0) + (byOutcome["callback_booked"] ?? 0);

  // Conclusive calls only: an abandoned or unrecorded call says nothing about
  // whether the receptionist could have handled it.
  const conclusive = handledAlone + transferred + missed + voicemail + messageOutcome;
  const askedForHuman = transferred + missed;

  // Fill the 14-day series so quiet days show as zero rather than vanishing,
  // which otherwise makes a sparkline lie about the shape of the traffic.
  const daily: Array<{ day: string; count: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(nowMs - i * dayMs).toISOString().slice(0, 10);
    daily.push({ day: d, count: perDay.get(d) ?? 0 });
  }

  return {
    total: rows.length,
    last7,
    last30,
    today,
    byOutcome,
    handledAlone,
    transferred,
    missed,
    messagesTaken,
    selfServeRate: conclusive > 0 ? handledAlone / conclusive : null,
    transferRequestRate: conclusive > 0 ? askedForHuman / conclusive : null,
    avgDurationSeconds: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    longestSeconds: longest,
    knownCallers,
    topRequested: [...requested.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    daily,
    busiestHours: [...perHour.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    uniqueCallers: callers.size,
  };
}

/** "3 m 20 s", or a dash when we never recorded a duration. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
}

export function formatPercent(share: number | null): string {
  if (share === null) return "—";
  return `${Math.round(share * 100)}%`;
}
