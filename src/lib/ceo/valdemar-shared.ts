// Shared types for the /dashboard/valdemar page. Kept free of server imports
// so the client content component can import them (same split as
// feature-usage-shared.ts / free-users-shared.ts).

import type { DashboardTimeRangeKey } from "@/lib/ceo/time-ranges";

export type ValdemarTab = "calls" | "emails";

/** Structurally matches ceo/source-info-data's SourceInfo so InfoHint takes it. */
export type ValdemarKpiInfo = {
  title: string;
  body: string;
  sources?: string[];
  logic?: string;
};

export type ValdemarKpi = {
  label: string;
  value: string;
  hint?: string;
  info?: ValdemarKpiInfo;
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
  answered: boolean;
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
  answered: number;
};

export type WeekdayPoint = {
  label: string;
  total: number;
  answered: number;
};

/** Where the contact stood in the product at the moment of the call. Derived
 *  per call, so the same contact can be "no account" on Monday's call and
 *  "free" on Friday's once they signed up in between. */
export type CallAccountState =
  | "no_account"
  | "free"
  | "trial"
  | "paying"
  | "churned";

export const ACCOUNT_STATE_LABEL: Record<CallAccountState, string> = {
  no_account: "No account",
  free: "Free plan",
  trial: "Paid trial",
  paying: "Paying",
  churned: "Churned",
};

export const ACCOUNT_STATE_ORDER: CallAccountState[] = [
  "no_account",
  "free",
  "trial",
  "paying",
  "churned",
];

/** One column group in the "by account state" chart. Call-level counts. */
export type AccountStatePoint = {
  segment: CallAccountState;
  label: string;
  calls: number;
  answered: number;
  interested: number;
  /** Calls followed by a signup or a paid-plan start inside the window. */
  converted: number;
  contacts: number;
};

/** What happened in the product after the call. */
export type PostCallEvent = "signed_up" | "paid_start" | "charged";

export type PostCallConversionRow = {
  contactId: string;
  contactName: string;
  companyName: string | null;
  segment: CallAccountState;
  segmentLabel: string;
  callAt: string;
  outcome: string | null;
  outcomeLabel: string;
  answered: boolean;
  /** The strongest event reached after the call (charged > paid_start > signed_up). */
  event: PostCallEvent;
  eventLabel: string;
  eventAt: string;
  daysAfterCall: number;
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
  direction: "outbound" | "inbound";
  outcome: string | null;
  outcomeLabel: string;
  /** A human picked up — derived from the logged outcome, never from 46elks
   *  leg state (the agent's own browser auto-answering is not an answer). */
  answered: boolean;
  /** True when the outcome row can be edited (it's a real activity row). */
  editable: boolean;
  durationSeconds: number | null;
  sentiment: string | null;
  summary: string | null;
  hasRecording: boolean;
  sessionStatus: string | null;
  /** App state at the moment of this call (see CallAccountState). */
  accountState: CallAccountState;
  accountStateLabel: string;
  /** Post-call product event attributed to this call, if any. */
  postCallEvent: PostCallEvent | null;
  postCallEventLabel: string | null;
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
  /** Second KPI row, all about what happened in the product after the call. */
  postCallKpis: ValdemarKpi[];
  seriesLabels: string[];
  byBucket: BucketPoint[];
  talkTimeByBucket: BucketPoint[];
  byHour: HourPoint[];
  byWeekday: WeekdayPoint[];
  outcomes: OutcomeSlice[];
  sentiments: SentimentSlice[];
  durations: DurationBucket[];
  /** Call volume + conversion split by app state at call time. */
  accountStates: AccountStatePoint[];
  /** Contacts with no account when Valdemar called them. */
  noAccountFunnel: FunnelStep[];
  /** Contacts already on the free plan when Valdemar called them. */
  freeUserFunnel: FunnelStep[];
  /** Every attributed post-call event, newest event first. */
  conversions: PostCallConversionRow[];
  /** How many days after a call a product event still counts as attributed. */
  postCallWindowDays: number;
  /** True when the app-state join produced at least one linked contact, so an
   *  all-zero conversion panel means "no conversions" and not "no data". */
  appStateResolved: boolean;
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
