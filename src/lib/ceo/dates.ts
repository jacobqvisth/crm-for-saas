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
