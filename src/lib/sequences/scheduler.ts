import type { SequenceSettings } from "@/lib/database.types";

const DAY_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/**
 * Calculates the next valid send time within the sequence's send window.
 * Takes into account send_days, start/end hours, and timezone.
 */
export function getNextSendTime(
  settings: SequenceSettings,
  afterDate?: Date
): Date {
  const now = afterDate || new Date();

  // Convert send_days (number[]) to day-of-week numbers
  // The DB stores them as numbers (0-6) already based on the type
  const allowedDays = new Set(settings.send_days);

  // Create a date in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: settings.timezone || "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value || "0";

  let currentHour = parseInt(getPart("hour"));
  const currentDay = now.getDay();

  const startHour = settings.send_start_hour ?? 9;
  const endHour = settings.send_end_hour ?? 17;

  // Check if current time is within the send window
  if (allowedDays.has(currentDay) && currentHour >= startHour && currentHour < endHour) {
    // We're in the window — schedule for now (or a few seconds from now)
    return new Date(now.getTime() + 5000);
  }

  // Find the next valid send time
  let candidate = new Date(now);

  // If we're past the end hour today or today isn't an allowed day,
  // move to the start of the next allowed day
  if (currentHour >= endHour || !allowedDays.has(currentDay)) {
    candidate.setDate(candidate.getDate() + 1);
  }

  // Find next allowed day (max 7 iterations)
  for (let i = 0; i < 7; i++) {
    if (allowedDays.has(candidate.getDay())) {
      break;
    }
    candidate.setDate(candidate.getDate() + 1);
  }

  // Set to start hour in the target timezone
  // We approximate by setting the hour directly (timezone offset handled by DB function for precision)
  candidate.setHours(startHour, 0, 0, 0);

  // If the candidate is still in the past (e.g., today before start hour),
  // and current time is before start hour on an allowed day
  if (candidate <= now) {
    candidate.setDate(candidate.getDate() + 1);
    for (let i = 0; i < 7; i++) {
      if (allowedDays.has(candidate.getDay())) break;
      candidate.setDate(candidate.getDate() + 1);
    }
    candidate.setHours(startHour, 0, 0, 0);
  }

  return candidate;
}

/**
 * Calculates the scheduled time for a step, considering delays.
 */
export function calculateStepScheduleTime(
  settings: SequenceSettings,
  delayDays: number,
  delayHours: number,
  afterDate?: Date
): Date {
  const base = afterDate || new Date();
  const totalMs = (delayDays * 24 + delayHours) * 60 * 60 * 1000;
  const afterDelay = new Date(base.getTime() + totalMs);
  return getNextSendTime(settings, afterDelay);
}

