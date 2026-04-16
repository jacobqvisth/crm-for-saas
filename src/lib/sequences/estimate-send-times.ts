import type { SequenceSettings } from "@/lib/database.types";

export interface QueueRowForEstimate {
  enrollment_id: string;
  scheduled_for: string;
  created_at: string;
  status: string;
  sent_at: string | null;
}

export interface EstimateSendTimesParams {
  queueRows: QueueRowForEstimate[];
  settings: SequenceSettings;
}

/** Average interval between sends (75s = cron cadence + mid-jitter). */
const AVG_INTERVAL_MS = 75_000;

/**
 * Returns { weekday (0=Sun), hour, minute, second } for `date` in the given IANA timezone.
 */
function getTimeInTZ(
  date: Date,
  timezone: string
): { weekday: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const weekdayStr = get("weekday");
  const WEEKDAYS: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    weekday: WEEKDAYS[weekdayStr] ?? 0,
    hour: parseInt(get("hour")),
    minute: parseInt(get("minute")),
    second: parseInt(get("second")),
  };
}

/**
 * Returns a stable string key representing "which calendar day in the timezone"
 * this date falls on — used to detect day boundaries for the daily-limit reset.
 */
function getDayKeyInTZ(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Shifts `date` so that its hour-of-day in `timezone` equals `targetHour`,
 * zeroing out minutes and seconds.  Works by computing the UTC-millisecond
 * difference between the current hour and the target hour in that timezone.
 */
function setHourInTZ(date: Date, targetHour: number, timezone: string): Date {
  const { hour, minute, second } = getTimeInTZ(date, timezone);
  const secondsToTopOfCurrentHour = -(minute * 60 + second);
  const hoursToAdd = targetHour - hour;
  return new Date(
    date.getTime() + secondsToTopOfCurrentHour * 1_000 + hoursToAdd * 3_600_000
  );
}

/**
 * Returns the start of the next valid send window — i.e., `start_hour` on
 * the earliest allowed weekday that is strictly after `date`.
 */
function advanceToNextWindowStart(date: Date, settings: SequenceSettings): Date {
  const timezone = settings.timezone || "Europe/Stockholm";
  const sendDays = new Set(settings.send_days);
  const startHour = settings.send_start_hour ?? 9;

  // Move at least one full day forward, then look for an allowed weekday.
  let candidate = new Date(date.getTime() + 24 * 3_600_000);

  for (let i = 0; i < 7; i++) {
    const { weekday } = getTimeInTZ(candidate, timezone);
    if (sendDays.has(weekday)) break;
    candidate = new Date(candidate.getTime() + 24 * 3_600_000);
  }

  return setHourInTZ(candidate, startHour, timezone);
}

/**
 * If `date` falls within the send window, returns it unchanged.
 * Otherwise advances it to the start of the next valid send window.
 */
function advanceIntoWindow(date: Date, settings: SequenceSettings): Date {
  const timezone = settings.timezone || "Europe/Stockholm";
  const sendDays = new Set(settings.send_days);
  const startHour = settings.send_start_hour ?? 9;
  const endHour = settings.send_end_hour ?? 17;

  const { weekday, hour } = getTimeInTZ(date, timezone);

  // Already in window
  if (sendDays.has(weekday) && hour >= startHour && hour < endHour) {
    return date;
  }

  // Valid day but before the start hour — advance to start_hour today
  if (sendDays.has(weekday) && hour < startHour) {
    return setHourInTZ(date, startHour, timezone);
  }

  // Invalid day or past end hour — jump to next window
  return advanceToNextWindowStart(date, settings);
}

/**
 * Estimates the send time for every *scheduled* queue row, returning a Map
 * keyed by `enrollment_id`.
 *
 * Pure function — no Supabase calls, no side effects.
 */
export function estimateSendTimes(
  params: EstimateSendTimesParams
): Map<string, Date> {
  const { queueRows, settings } = params;
  const result = new Map<string, Date>();

  const timezone = settings.timezone || "Europe/Stockholm";
  const dailyLimit = Math.max(1, settings.daily_limit_per_sender || 80);

  // Work only with the "scheduled" rows, sorted by queue position
  const scheduledRows = queueRows
    .filter((r) => r.status === "scheduled")
    .sort((a, b) => {
      const byScheduled = a.scheduled_for.localeCompare(b.scheduled_for);
      if (byScheduled !== 0) return byScheduled;
      return a.created_at.localeCompare(b.created_at);
    });

  if (scheduledRows.length === 0) return result;

  const now = new Date();
  const firstScheduled = new Date(scheduledRows[0].scheduled_for);

  // Start from the later of "now" and the earliest scheduled time, then
  // make sure we're inside the send window.
  let currentTime = advanceIntoWindow(
    new Date(Math.max(now.getTime(), firstScheduled.getTime())),
    settings
  );

  let dailyCount = 0;
  let currentDayKey = getDayKeyInTZ(currentTime, timezone);

  for (let i = 0; i < scheduledRows.length; i++) {
    const row = scheduledRows[i];

    // After the first email, advance by the average interval, then re-check
    // the send window (the interval might push us past end_hour).
    if (i > 0) {
      currentTime = advanceIntoWindow(
        new Date(currentTime.getTime() + AVG_INTERVAL_MS),
        settings
      );
    }

    // Detect a calendar-day boundary (advanceIntoWindow may have jumped ahead)
    const newDayKey = getDayKeyInTZ(currentTime, timezone);
    if (newDayKey !== currentDayKey) {
      dailyCount = 0;
      currentDayKey = newDayKey;
    }

    // If we've hit the daily cap, push to the next valid send day
    if (dailyCount >= dailyLimit) {
      currentTime = advanceToNextWindowStart(currentTime, settings);
      dailyCount = 0;
      currentDayKey = getDayKeyInTZ(currentTime, timezone);
    }

    result.set(row.enrollment_id, new Date(currentTime));
    dailyCount++;
  }

  return result;
}
