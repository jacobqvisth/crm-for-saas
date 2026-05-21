import type { SequenceSettings } from "@/lib/database.types";

const DAY_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

function getZonedParts(d: Date, timezone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hourRaw = parseInt(get("hour"));
  return {
    year: parseInt(get("year")),
    month: parseInt(get("month")),
    day: parseInt(get("day")),
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: parseInt(get("minute")),
    weekday: DAY_MAP[get("weekday").toLowerCase().slice(0, 3)] ?? 0,
  };
}

// Returns the UTC Date whose clock-time in `timezone` reads y-m-d h:min:00.
// Handles DST by measuring the tz offset at a first guess and correcting once.
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const observed = getZonedParts(guess, timezone);
  const observedUtc = Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute,
    0,
  );
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = observedUtc - desiredUtc;
  return new Date(guess.getTime() - offset);
}

export function isWithinSendWindow(
  settings: SequenceSettings,
  at: Date = new Date(),
): boolean {
  const tz = settings.timezone || "Europe/Stockholm";
  const startHour = settings.send_start_hour ?? 9;
  const endHour = settings.send_end_hour ?? 17;
  const allowedDays = new Set(settings.send_days);
  const parts = getZonedParts(at, tz);
  return (
    allowedDays.has(parts.weekday) &&
    parts.hour >= startHour &&
    parts.hour < endHour
  );
}

/**
 * Calculates the next valid send time within the sequence's send window.
 * Takes into account send_days, start/end hours, and timezone (DST-aware).
 */
export function getNextSendTime(
  settings: SequenceSettings,
  afterDate?: Date,
): Date {
  const now = afterDate || new Date();
  const tz = settings.timezone || "Europe/Stockholm";
  const startHour = settings.send_start_hour ?? 9;
  const allowedDays = new Set(settings.send_days);

  if (isWithinSendWindow(settings, now)) {
    return new Date(now.getTime() + 5000);
  }

  // Walk forward day-by-day in tz-local time. For each candidate day, compute
  // the UTC instant for startHour:00 in the target tz, and return the first
  // one that is on an allowed weekday and in the future.
  const today = getZonedParts(now, tz);
  let y = today.year;
  let m = today.month;
  let d = today.day;

  for (let i = 0; i < 8; i++) {
    const candidate = zonedToUtc(y, m, d, startHour, 0, tz);
    const cParts = getZonedParts(candidate, tz);
    if (allowedDays.has(cParts.weekday) && candidate > now) {
      return candidate;
    }
    const next = new Date(candidate.getTime() + 25 * 60 * 60 * 1000);
    const nParts = getZonedParts(next, tz);
    y = nParts.year;
    m = nParts.month;
    d = nParts.day;
  }

  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Calculates the scheduled time for a step, considering delays.
 */
export function calculateStepScheduleTime(
  settings: SequenceSettings,
  delayDays: number,
  delayHours: number,
  afterDate?: Date,
): Date {
  const base = afterDate || new Date();
  const totalMs = (delayDays * 24 + delayHours) * 60 * 60 * 1000;
  const afterDelay = new Date(base.getTime() + totalMs);
  return getNextSendTime(settings, afterDelay);
}
