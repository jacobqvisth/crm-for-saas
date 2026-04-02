// 21-day conservative ramp schedule
// Never increases by more than ~20% per step
export const WARMUP_SCHEDULE: { minDay: number; maxDay: number; dailyLimit: number }[] = [
  { minDay: 1, maxDay: 3, dailyLimit: 5 },
  { minDay: 4, maxDay: 7, dailyLimit: 10 },
  { minDay: 8, maxDay: 10, dailyLimit: 20 },
  { minDay: 11, maxDay: 14, dailyLimit: 30 },
  { minDay: 15, maxDay: 18, dailyLimit: 40 },
  { minDay: 19, maxDay: 21, dailyLimit: 50 },
];

export const WARMUP_DURATION_DAYS = 21;
export const WARMUP_MIN_SENDS_TO_GRADUATE = 100;
export const WARMUP_MAX_BOUNCE_RATE = 0.03; // 3%

export function getWarmupDailyLimit(day: number): number {
  if (day <= 0) return 5;
  const step = WARMUP_SCHEDULE.find((s) => day >= s.minDay && day <= s.maxDay);
  return step ? step.dailyLimit : WARMUP_SCHEDULE[WARMUP_SCHEDULE.length - 1].dailyLimit;
}
