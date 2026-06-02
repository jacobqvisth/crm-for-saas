// Pure date<->pixel math for the Gantt timeline. Dates are inclusive DATEs
// stored as "YYYY-MM-DD"; we work in whole local days (no timezone drift).

import {
  parseISO,
  format,
  differenceInCalendarDays,
  addDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  eachMonthOfInterval,
  eachWeekOfInterval,
} from "date-fns";

export interface TimelineRange {
  start: Date; // inclusive, snapped to a Monday
  end: Date; // inclusive, snapped to a Sunday
  days: number; // total day count (end - start + 1)
}

const WEEK_OPTS = { weekStartsOn: 1 as const }; // Monday

/** Parse a "YYYY-MM-DD" DATE string to local midnight. */
export function parseDay(s: string): Date {
  return parseISO(s);
}

/** Format a Date as a "YYYY-MM-DD" DATE string. */
export function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Whole calendar days from a → b (b - a). */
export function dayDiff(a: Date, b: Date): number {
  return differenceInCalendarDays(b, a);
}

export { addDays };

/**
 * Compute the visible timeline window from the items, padded and snapped to
 * whole weeks so month/week gridlines line up. Falls back to a window around
 * `today` when there are no items.
 */
export function computeRange(
  items: { start_date: string; end_date: string }[],
  today: Date,
  padDays = 10
): TimelineRange {
  let min: Date;
  let max: Date;
  if (items.length === 0) {
    min = addDays(today, -14);
    max = addDays(today, 90);
  } else {
    min = items.reduce((acc, it) => {
      const d = parseDay(it.start_date);
      return d < acc ? d : acc;
    }, parseDay(items[0].start_date));
    max = items.reduce((acc, it) => {
      const d = parseDay(it.end_date);
      return d > acc ? d : acc;
    }, parseDay(items[0].end_date));
    // Keep today in view even if all work is in the past/future.
    if (today < min) min = today;
    if (today > max) max = today;
  }

  const start = startOfWeek(addDays(min, -padDays), WEEK_OPTS);
  const end = endOfWeek(addDays(max, padDays), WEEK_OPTS);
  return { start, end, days: dayDiff(start, end) + 1 };
}

/** Left pixel offset for a date within the range. */
export function xForDate(date: Date, range: TimelineRange, pxPerDay: number): number {
  return dayDiff(range.start, date) * pxPerDay;
}

/** Round a pixel offset back to the nearest day's date within the range. */
export function dateForX(x: number, range: TimelineRange, pxPerDay: number): Date {
  return addDays(range.start, Math.round(x / pxPerDay));
}

/** Left + width (px) of a bar. Width covers inclusive [start, end]. */
export function barGeometry(
  item: { start_date: string; end_date: string },
  range: TimelineRange,
  pxPerDay: number
): { left: number; width: number } {
  const start = parseDay(item.start_date);
  const end = parseDay(item.end_date);
  const left = xForDate(start, range, pxPerDay);
  const width = (dayDiff(start, end) + 1) * pxPerDay;
  return { left, width: Math.max(width, pxPerDay) };
}

export interface Tick {
  x: number;
  label: string;
}

/** Month boundary ticks (for the header's month row). */
export function monthTicks(range: TimelineRange, pxPerDay: number): Tick[] {
  return eachMonthOfInterval({ start: range.start, end: range.end }).map((m) => ({
    x: xForDate(startOfMonth(m) < range.start ? range.start : startOfMonth(m), range, pxPerDay),
    label: format(m, "MMMM"),
  }));
}

/** Week boundary ticks (Mondays) for vertical gridlines. */
export function weekTicks(range: TimelineRange, pxPerDay: number): Tick[] {
  return eachWeekOfInterval({ start: range.start, end: range.end }, WEEK_OPTS).map((w) => ({
    x: xForDate(w, range, pxPerDay),
    label: format(w, "d MMM"),
  }));
}

export function totalWidth(range: TimelineRange, pxPerDay: number): number {
  return range.days * pxPerDay;
}
