// Pure day-offset <-> pixel math for the activation timeline. Unlike the
// roadmap (calendar dates), the x-axis here is relative: whole days since
// signup, day 0 = the signup day. Offsets are inclusive integers.

export interface OffsetRange {
  start: number; // inclusive, always 0 (signup)
  end: number; // inclusive, snapped up to a whole week
  days: number; // total day count (end - start + 1)
}

/**
 * Compute the visible window from the items, padded and snapped to whole
 * weeks. Always starts at day 0 and defaults to 4 weeks. Only point
 * touchpoints (and span *starts*) widen the window — a long background span
 * (e.g. "quota banners, day 0-30") is clipped by the canvas instead of
 * stretching the axis with empty weeks.
 */
export function computeRange(
  items: { day_start: number; day_end: number }[],
  padDays = 3
): OffsetRange {
  const anchorDay = items.reduce(
    (acc, it) => Math.max(acc, it.day_start === it.day_end ? it.day_end : it.day_start),
    0
  );
  const padded = Math.max(anchorDay + padDays, 27); // >= 4 weeks
  const end = Math.ceil((padded + 1) / 7) * 7 - 1; // snap to whole weeks
  return { start: 0, end, days: end + 1 };
}

/** Left pixel offset for a day within the range. */
export function xForDay(day: number, pxPerDay: number): number {
  return day * pxPerDay;
}

/** Round a pixel offset back to the nearest whole day. */
export function dayForX(x: number, pxPerDay: number): number {
  return Math.round(x / pxPerDay);
}

/** Left + width (px) of a bar. Width covers inclusive [day_start, day_end]. */
export function barGeometry(
  item: { day_start: number; day_end: number },
  pxPerDay: number
): { left: number; width: number } {
  const left = xForDay(item.day_start, pxPerDay);
  const width = (item.day_end - item.day_start + 1) * pxPerDay;
  return { left, width: Math.max(width, pxPerDay) };
}

export interface Tick {
  x: number;
  label: string;
}

/** Week band ticks ("Week 1", "Week 2", ...) for the header's top row. */
export function weekTicks(range: OffsetRange, pxPerDay: number): Tick[] {
  const out: Tick[] = [];
  for (let d = 0; d <= range.end; d += 7) {
    out.push({ x: xForDay(d, pxPerDay), label: `Week ${d / 7 + 1}` });
  }
  return out;
}

/**
 * Day ticks for the header's bottom row and vertical gridlines. At wide zooms
 * a tick per day is unreadable, so the step grows as pxPerDay shrinks.
 */
export function dayTicks(range: OffsetRange, pxPerDay: number): Tick[] {
  const step = pxPerDay >= 20 ? 1 : 7;
  const out: Tick[] = [];
  for (let d = 0; d <= range.end; d += step) {
    out.push({ x: xForDay(d, pxPerDay), label: `Day ${d}` });
  }
  return out;
}

export function totalWidth(range: OffsetRange, pxPerDay: number): number {
  return range.days * pxPerDay;
}
