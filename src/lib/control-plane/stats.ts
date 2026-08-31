// What a tenant is allowed to tell the control plane about itself.
//
// WHY THIS IS A CLOSED LIST, AND WHY IT IS ONLY NUMBERS
// ----------------------------------------------------
// The control plane holds no customer data and no tenant database keys. That is
// the property that makes it safe: compromise it and you can toggle features,
// not read anyone's CRM. A stats feature is the obvious way to lose that
// property by accident, in either of two ways:
//
//   1. By having the control plane READ each tenant's database, which needs a
//      service-role key per tenant — one credential that reads every customer's
//      entire CRM. That is the design this whole thing exists to avoid, so
//      stats are REPORTED BY the tenant, never pulled from it. The control
//      plane keeps no way in.
//
//   2. By accepting whatever the tenant sends. A free-form JSON blob is an
//      invitation for someone to "just add" a list of recent contacts or the
//      top accounts by revenue, and then customer data lives here after all.
//
// So the contract is: a fixed set of keys, every value a non-negative integer,
// anything else rejected. A count of rows is not customer data in the sense
// that matters — there is no name, address or message in it — and a closed list
// of counts cannot quietly become one.
//
// Adding a key is a deliberate edit here. Adding one that is not a count should
// be argued about first.

export const METRIC_KEYS = [
  "users",
  "contacts",
  "companies",
  "active_sequences",
  "mailboxes_connected",
  "emails_sent_7d",
  "replies_7d",
  "calls_7d",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Partial<Record<MetricKey, number>>;

/** Human labels for the console. */
export const METRIC_LABEL: Record<MetricKey, string> = {
  users: "Users",
  contacts: "Contacts",
  companies: "Companies",
  active_sequences: "Active sequences",
  mailboxes_connected: "Mailboxes",
  emails_sent_7d: "Emails sent (7d)",
  replies_7d: "Replies (7d)",
  calls_7d: "Calls (7d)",
};

/**
 * "3 h ago", or null when it has never happened.
 *
 * Takes `now` rather than reading the clock so it is pure. The console is
 * server-rendered and this is computed there: calling Date.now() while
 * rendering makes the component impure, which React's purity rule rejects and
 * which shows up in production as a hydration mismatch on a relative time.
 */
export function sinceText(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const mins = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * Has a tenant stopped reporting?
 *
 * Reports are daily, so a gap of more than two days is a tenant that has gone
 * quiet rather than one merely between reports.
 */
export function isStale(iso: string | null, now: number): boolean {
  if (!iso) return false;
  return now - new Date(iso).getTime() > 2 * 24 * 3600 * 1000;
}

export interface MetricsCheck {
  ok: boolean;
  metrics?: Metrics;
  error?: string;
}

/**
 * Validate a reported payload.
 *
 * Rejects rather than sanitises when it sees something unexpected. A silently
 * dropped key would let a tenant believe it is reporting something it is not,
 * and a silently accepted one is how the closed list stops being closed.
 */
export function parseMetrics(input: unknown): MetricsCheck {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "metrics must be an object" };
  }

  const allowed = new Set<string>(METRIC_KEYS);
  const out: Metrics = {};

  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.has(k)) {
      return { ok: false, error: `unknown metric: ${k}` };
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, error: `metric ${k} must be a finite number` };
    }
    if (!Number.isInteger(v) || v < 0) {
      return { ok: false, error: `metric ${k} must be a non-negative integer` };
    }
    // A count large enough to be nonsense is more likely a bug or an attempt to
    // stuff something odd through than a real number of rows.
    if (v > 1_000_000_000) {
      return { ok: false, error: `metric ${k} is implausibly large` };
    }
    out[k as MetricKey] = v;
  }

  return { ok: true, metrics: out };
}
