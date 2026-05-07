// Field-rep productive day window. Hans wants ≤7.5 hours of drive + 30 min per
// stop visit so a route fits inside one workday.

export const VISIT_MINUTES = 30;
export const PRODUCTIVE_DAY_SECONDS = 7.5 * 3600;

export function estimatedDaySeconds(
  totalDriveSeconds: number,
  stopCount: number,
): number {
  return totalDriveSeconds + VISIT_MINUTES * 60 * stopCount;
}

export function exceedsDayWindow(estimatedDaySec: number): boolean {
  return estimatedDaySec > PRODUCTIVE_DAY_SECONDS;
}
