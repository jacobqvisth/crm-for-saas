export type DateWindow = {
  start: Date;
  end: Date;
  days: number;
};

export function startOfUtcDay(input: Date): Date {
  return new Date(
    Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()),
  );
}

export function addUtcDays(input: Date, days: number): Date {
  const next = new Date(input);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function getRollingWindow(days: number, now = new Date()): DateWindow {
  const end = addUtcDays(startOfUtcDay(now), 1);
  const start = addUtcDays(end, -days);

  return { start, end, days };
}

export function toIsoDate(input: Date): string {
  return input.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Stockholm-time helpers
//
// The CEO dashboard is read by a Sweden-based team, so every user-facing
// "day", "week", and "month" boundary must be anchored to Europe/Stockholm —
// NOT UTC. (The UTC helpers above stay as-is: the sync jobs that pull GA4 /
// App Store / Stripe windows are deliberately UTC-aligned.) These helpers are
// zero-dependency (Intl-based) and DST-safe — Stockholm flips at 02:00/03:00,
// never at midnight, so civil-day boundaries are always unambiguous.
// ---------------------------------------------------------------------------

export const DASHBOARD_TIME_ZONE = "Europe/Stockholm";

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
};

const stockholmPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: DASHBOARD_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// Wall-clock components of an instant as seen in Stockholm.
export function getStockholmParts(input: Date): ZonedParts {
  const parts = stockholmPartsFormatter.formatToParts(input);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0; // some engines emit "24" for midnight
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

// Milliseconds Stockholm is ahead of UTC at the given instant.
function stockholmOffsetMs(input: Date): number {
  const p = getStockholmParts(input);
  const asIfUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  const flooredInstant = Math.floor(input.getTime() / 1000) * 1000;
  return asIfUtc - flooredInstant;
}

// The UTC instant for a given Stockholm wall-clock time. Day/month overflow is
// handled by Date.UTC (e.g. day = 0 or 32, month = 0 or 13 all normalize).
function stockholmWallToUtc(
  year: number,
  month: number, // 1-12 (overflow OK)
  day: number, // overflow OK
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  // Treat the wall time as UTC, then correct by the offset at that approximate
  // instant. One correction is exact away from the DST switch (never midnight).
  const guessMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = stockholmOffsetMs(new Date(guessMs));
  return new Date(guessMs - offset);
}

// Midnight (00:00 Stockholm) of the civil day that `input` falls on.
export function startOfStockholmDay(input: Date): Date {
  const p = getStockholmParts(input);
  return stockholmWallToUtc(p.year, p.month, p.day);
}

// Add `days` Stockholm civil days, returning midnight of the resulting day.
export function addStockholmDays(input: Date, days: number): Date {
  const p = getStockholmParts(input);
  return stockholmWallToUtc(p.year, p.month, p.day + days);
}

// First of the Stockholm month that `input` falls in (00:00 Stockholm).
export function startOfStockholmMonth(input: Date): Date {
  const p = getStockholmParts(input);
  return stockholmWallToUtc(p.year, p.month, 1);
}

// Add `months` Stockholm calendar months, anchored to the 1st at 00:00.
export function addStockholmMonths(input: Date, months: number): Date {
  const p = getStockholmParts(input);
  return stockholmWallToUtc(p.year, p.month + months, 1);
}

// Monday 00:00 (Stockholm) of the ISO week that `input` falls in.
export function startOfStockholmIsoWeek(input: Date): Date {
  const p = getStockholmParts(input);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0=Sun
  const daysSinceMonday = (dow + 6) % 7;
  return stockholmWallToUtc(p.year, p.month, p.day - daysSinceMonday);
}

// "YYYY-MM-DD" of the instant's Stockholm civil day.
export function toStockholmIsoDate(input: Date): string {
  const p = getStockholmParts(input);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// ISO-8601 week key ("YYYYWW") of the instant's Stockholm civil day. Weeks run
// Monday-Sunday; week 1 is the week containing the year's first Thursday.
export function stockholmYearWeek(input: Date): string {
  const p = getStockholmParts(input);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // shift to that week's Thursday
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDow = (firstThursday.getUTCDay() + 6) % 7;
  const week =
    1 +
    Math.round(
      (d.getTime() - firstThursday.getTime()) / 86_400_000 / 7 +
        (firstThursdayDow - 3) / 7,
    );
  return `${isoYear}${String(week).padStart(2, "0")}`;
}

export function formatIsoDate(input: string | Date): string {
  return typeof input === "string" ? input.slice(0, 10) : toIsoDate(input);
}

export function parseGa4Date(value: string): Date {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`Invalid GA4 date: ${value}`);
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));

  return new Date(Date.UTC(year, month, day));
}

export function secondsSinceEpoch(input: Date): number {
  return Math.floor(input.getTime() / 1000);
}

export function hoursSince(input?: string | null, now = new Date()): number {
  if (!input) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (now.getTime() - new Date(input).getTime()) / 3_600_000);
}
