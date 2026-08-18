// Shared types for the /dashboard/valdemar page. Kept free of server imports
// so the client content component can import them (same split as
// feature-usage-shared.ts / free-users-shared.ts).

import type { DashboardTimeRangeKey } from "@/lib/ceo/time-ranges";

export type ValdemarTab = "calls" | "emails";

export type ValdemarKpi = {
  label: string;
  value: string;
  hint?: string;
};

/** One chart bucket (a Stockholm civil day, or an ISO week for long ranges). */
export type BucketPoint = {
  key: string;
  label: string;
  values: number[];
};

export type OutcomeSlice = {
  outcome: string;
  label: string;
  count: number;
  connected: boolean;
};

export type SentimentSlice = {
  sentiment: string;
  label: string;
  count: number;
  colorClass: string;
};

export type DurationBucket = {
  label: string;
  count: number;
};

export type HourPoint = {
  hour: number;
  label: string;
  total: number;
  connected: number;
};

export type WeekdayPoint = {
  label: string;
  total: number;
  connected: number;
};

export type ValdemarCallRow = {
  id: string;
  sessionId: string | null;
  at: string;
  contactId: string | null;
  contactName: string;
  companyId: string | null;
  companyName: string | null;
  phone: string | null;
  outcome: string | null;
  outcomeLabel: string;
  connected: boolean;
  durationSeconds: number | null;
  sentiment: string | null;
  summary: string | null;
  hasRecording: boolean;
  sessionStatus: string | null;
};

export type EmailEventItem = {
  type: string;
  at: string;
  linkUrl: string | null;
};

export type ValdemarEmailRow = {
  id: string;
  at: string;
  toEmail: string;
  subject: string;
  status: string;
  contactId: string | null;
  contactName: string | null;
  sequenceName: string | null;
  opened: boolean;
  openCount: number;
  clicked: boolean;
  replied: boolean;
  bounced: boolean;
  events: EmailEventItem[];
};

export type FunnelStep = {
  key: string;
  label: string;
  value: number;
  rateFromPrevious: number | null;
};

export type SequenceSlice = {
  name: string;
  sent: number;
  replies: number;
};

export type AccountCard = {
  email: string;
  status: string;
  sentToday: number;
  dailyCap: number;
  healthScore: number | null;
};

export type ValdemarCallsData = {
  kpis: ValdemarKpi[];
  seriesLabels: string[];
  byBucket: BucketPoint[];
  talkTimeByBucket: BucketPoint[];
  byHour: HourPoint[];
  byWeekday: WeekdayPoint[];
  outcomes: OutcomeSlice[];
  sentiments: SentimentSlice[];
  durations: DurationBucket[];
  rows: ValdemarCallRow[];
  totalRows: number;
};

export type ValdemarEmailsData = {
  kpis: ValdemarKpi[];
  sentOpensByBucket: BucketPoint[];
  clicksRepliesByBucket: BucketPoint[];
  byHour: { hour: number; label: string; sent: number }[];
  funnel: FunnelStep[];
  statusBreakdown: { status: string; count: number }[];
  topSequences: SequenceSlice[];
  accounts: AccountCard[];
  rows: ValdemarEmailRow[];
  totalRows: number;
};

export type ValdemarStatsData = {
  rangeKey: DashboardTimeRangeKey;
  rangeLabel: string;
  rangeSpan: string;
  displayName: string;
  identityFound: boolean;
  generatedAt: string;
  calls: ValdemarCallsData;
  emails: ValdemarEmailsData;
};

export function formatDurationSeconds(value: number | null | undefined): string {
  const seconds = Math.max(0, Math.round(value ?? 0));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}
