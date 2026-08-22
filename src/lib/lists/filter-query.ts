import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { languageLabel, languageVariants } from '@/lib/i18n/languages';

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'in'
  | 'before'
  | 'after'
  | 'between'
  | 'older_than_days'
  | 'within_last_days'
  | 'gte'
  | 'lte'
  | 'is_null'
  | 'is_not_null';

export type FilterField =
  | 'status'
  | 'lead_status'
  | 'company_id'
  | 'country_code'
  | 'created_at'
  | 'last_contacted_at'
  | 'last_emailed_at'
  | 'last_called_at'
  | 'last_replied_at'
  | 'email'
  | 'email_status'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'language'
  | 'custom_fields'
  // Wrenchlane-app user fields (synced hourly from dashboard_users)
  | 'wl_user_id'
  | 'signed_up_at'
  | 'user_plan_type'
  | 'user_subscription_status'
  | 'payment_status'
  | 'diagnostics_total'
  | 'diagnostics_last_30d'
  | 'active_days_count'
  | 'login_count'
  | 'credits_remaining'
  | 'last_active_at';

export interface ListFilter {
  field: FilterField;
  operator: FilterOperator;
  value: string | string[] | number | null;
  customFieldKey?: string;
}

export const FILTER_FIELDS: { value: FilterField; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'lead_status', label: 'Lead Status' },
  { value: 'email_status', label: 'Email Status (verified)' },
  { value: 'company_id', label: 'Company' },
  { value: 'country_code', label: 'Country' },
  { value: 'created_at', label: 'Created Date' },
  { value: 'last_called_at', label: 'Last Called' },
  { value: 'last_emailed_at', label: 'Last Emailed (sent by us)' },
  { value: 'last_replied_at', label: 'Last Replied (heard back)' },
  { value: 'last_contacted_at', label: 'Last Touched (call or reply)' },
  { value: 'email', label: 'Email' },
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'language', label: 'Language (app UI)' },
  { value: 'custom_fields', label: 'Custom Field' },
  { value: 'wl_user_id', label: 'App: Is App User' },
  { value: 'signed_up_at', label: 'App: Signed Up' },
  { value: 'user_plan_type', label: 'App: Plan' },
  { value: 'user_subscription_status', label: 'App: Subscription Status' },
  { value: 'payment_status', label: 'App: Payment Status' },
  { value: 'diagnostics_total', label: 'App: Diagnoses (total)' },
  { value: 'diagnostics_last_30d', label: 'App: Diagnoses (last 30d)' },
  { value: 'active_days_count', label: 'App: Active Days (distinct)' },
  { value: 'login_count', label: 'App: Login Count' },
  { value: 'credits_remaining', label: 'App: Credits Remaining' },
  { value: 'last_active_at', label: 'App: Last Active' },
];

export const OPERATORS_BY_FIELD: Record<FilterField, { value: FilterOperator; label: string }[]> = {
  status: [
    { value: 'equals', label: 'is' },
    { value: 'not_equals', label: 'is not' },
    { value: 'in', label: 'is any of' },
  ],
  lead_status: [
    { value: 'equals', label: 'is' },
    { value: 'not_equals', label: 'is not' },
    { value: 'in', label: 'is any of' },
  ],
  email_status: [
    { value: 'equals', label: 'is' },
    { value: 'not_equals', label: 'is not' },
    { value: 'in', label: 'is any of' },
    { value: 'is_null', label: 'unverified (never checked)' },
    { value: 'is_not_null', label: 'has been verified' },
  ],
  company_id: [
    { value: 'equals', label: 'is' },
    { value: 'is_null', label: 'has no company' },
    { value: 'is_not_null', label: 'has a company' },
  ],
  country_code: [
    { value: 'equals', label: 'is' },
    { value: 'not_equals', label: 'is not' },
    { value: 'is_null', label: 'has no country' },
    { value: 'is_not_null', label: 'has a country' },
  ],
  created_at: [
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'within_last_days', label: 'within last N days' },
    { value: 'older_than_days', label: 'more than N days ago' },
  ],
  last_contacted_at: [
    { value: 'within_last_days', label: 'within the last' },
    { value: 'older_than_days', label: 'not since' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'is_null', label: 'never touched' },
    { value: 'is_not_null', label: 'has been touched' },
  ],
  last_emailed_at: [
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'within_last_days', label: 'within the last' },
    { value: 'older_than_days', label: 'not emailed since' },
    { value: 'is_null', label: 'never emailed' },
    { value: 'is_not_null', label: 'has been emailed' },
  ],
  last_called_at: [
    { value: 'within_last_days', label: 'within the last' },
    { value: 'older_than_days', label: 'not called since' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'is_null', label: 'never called' },
    { value: 'is_not_null', label: 'has been called' },
  ],
  last_replied_at: [
    { value: 'within_last_days', label: 'within the last' },
    { value: 'older_than_days', label: 'not since' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'is_null', label: 'never replied' },
    { value: 'is_not_null', label: 'has replied' },
  ],
  email: [
    { value: 'equals', label: 'equals' },
    { value: 'contains', label: 'contains' },
  ],
  first_name: [
    { value: 'equals', label: 'equals' },
    { value: 'contains', label: 'contains' },
  ],
  last_name: [
    { value: 'equals', label: 'equals' },
    { value: 'contains', label: 'contains' },
  ],
  phone: [
    { value: 'is_not_null', label: 'has a phone number' },
    { value: 'is_null', label: 'has no phone number' },
    { value: 'contains', label: 'contains' },
  ],
  language: [
    { value: 'equals', label: 'is' },
    { value: 'not_equals', label: 'is not' },
    { value: 'in', label: 'is any of' },
    { value: 'is_null', label: 'has no language set' },
    { value: 'is_not_null', label: 'has a language set' },
  ],
  custom_fields: [
    { value: 'equals', label: 'equals' },
    { value: 'contains', label: 'contains' },
  ],
  wl_user_id: [
    { value: 'is_not_null', label: 'is an app user' },
    { value: 'is_null', label: 'is not an app user' },
  ],
  signed_up_at: [
    { value: 'within_last_days', label: 'within last N days' },
    { value: 'older_than_days', label: 'more than N days ago' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'is_not_null', label: 'has a signup date' },
    { value: 'is_null', label: 'has no signup date' },
  ],
  user_plan_type: [
    { value: 'equals', label: 'is' },
    { value: 'not_equals', label: 'is not' },
    { value: 'in', label: 'is any of' },
    { value: 'is_null', label: 'has no plan' },
  ],
  user_subscription_status: [
    { value: 'equals', label: 'is' },
    { value: 'not_equals', label: 'is not' },
    { value: 'in', label: 'is any of' },
    { value: 'is_null', label: 'has no subscription' },
  ],
  payment_status: [
    { value: 'equals', label: 'is' },
    { value: 'not_equals', label: 'is not' },
    { value: 'in', label: 'is any of' },
    { value: 'is_null', label: 'never had a subscription' },
    { value: 'is_not_null', label: 'has billing history' },
  ],
  diagnostics_total: [
    { value: 'gte', label: 'at least' },
    { value: 'lte', label: 'at most' },
    { value: 'equals', label: 'exactly' },
  ],
  diagnostics_last_30d: [
    { value: 'gte', label: 'at least' },
    { value: 'lte', label: 'at most' },
    { value: 'equals', label: 'exactly' },
  ],
  active_days_count: [
    { value: 'gte', label: 'at least' },
    { value: 'lte', label: 'at most' },
    { value: 'equals', label: 'exactly' },
  ],
  login_count: [
    { value: 'gte', label: 'at least' },
    { value: 'lte', label: 'at most' },
    { value: 'equals', label: 'exactly' },
  ],
  credits_remaining: [
    { value: 'gte', label: 'at least' },
    { value: 'lte', label: 'at most' },
    { value: 'equals', label: 'exactly' },
  ],
  last_active_at: [
    { value: 'within_last_days', label: 'within last N days' },
    { value: 'older_than_days', label: 'more than N days ago' },
    { value: 'is_null', label: 'never active' },
    { value: 'is_not_null', label: 'has been active' },
  ],
};

// Grounded in prod values as of 2026-06-11 (contacts.user_plan_type /
// user_subscription_status distinct values).
export const PLAN_TYPE_OPTIONS = [
  'free',
  'one_monthly',
  'small_monthly',
  'small_yearly',
  'large_monthly',
  'large_yearly',
] as const;
export const PLAN_TYPE_LABELS: Record<string, string> = {
  free: 'Free',
  one_monthly: 'One (monthly)',
  small_monthly: 'Small (monthly)',
  small_yearly: 'Small (yearly)',
  large_monthly: 'Large (monthly)',
  large_yearly: 'Large (yearly)',
};
export const SUBSCRIPTION_STATUS_OPTIONS = [
  'trialing',
  'active',
  'past_due',
  'paused',
  'canceled',
] as const;

// contacts.payment_status mirrors dashboard_workshops.payment_status — the
// workshop's billing state, not the user's. Only two non-null values exist in
// the core_app export; null means "never had a subscription".
export const PAYMENT_STATUS_OPTIONS = ['active', 'payment_failed'] as const;
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  active: 'Paying fine',
  payment_failed: 'Payment failed',
};

/**
 * Day counts offered as one-click choices on any date/recency filter, so
 * "called in the last week / month / quarter" is a dropdown pick rather than
 * arithmetic. A custom number is still allowed — these are only shortcuts.
 */
export const RECENCY_PRESET_DAYS = [1, 7, 14, 30, 60, 90, 180, 365] as const;

export const RECENCY_PRESET_LABELS: Record<number, string> = {
  1: '24 hours',
  7: '7 days (1 week)',
  14: '14 days (2 weeks)',
  30: '30 days (1 month)',
  60: '60 days (2 months)',
  90: '90 days (3 months)',
  180: '180 days (6 months)',
  365: '365 days (1 year)',
};

/** Fields whose value is a date / relative day count. */
export const DATE_FIELDS: FilterField[] = [
  'created_at',
  'last_called_at',
  'last_emailed_at',
  'last_replied_at',
  'last_contacted_at',
  'signed_up_at',
  'last_active_at',
];

export const STATUS_OPTIONS = ['active', 'bounced', 'unsubscribed'] as const;
export const LEAD_STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'customer', 'churned'] as const;
export const EMAIL_STATUS_OPTIONS = ['valid', 'invalid', 'catch_all', 'risky', 'unknown'] as const;

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * True when a filter row is fully specified enough to run.
 *
 * `is_null` / `is_not_null` need no value; everything else needs a non-empty
 * value (and `in` needs a non-empty array). Used to guard the static-list
 * snapshot at creation so a half-filled filter row can't accidentally match
 * (and snapshot) every contact in the workspace.
 */
export function isCompleteFilter(filter: ListFilter): boolean {
  if (filter.operator === 'is_null' || filter.operator === 'is_not_null') return true;
  if (filter.field === 'custom_fields' && !filter.customFieldKey) return false;
  const v = filter.value;
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  // Relative-day operators need a real window. `0` is not "no filter" — it
  // would resolve to `now`, so `older_than_days: 0` matches every contact with
  // a value and `within_last_days: 0` matches none. Treat it as incomplete.
  if (filter.operator === 'within_last_days' || filter.operator === 'older_than_days') {
    return Number(v) >= 1;
  }
  if (typeof v === 'string') return v.trim() !== '';
  return true; // numbers (incl. 0) are valid
}

/**
 * Apply a list's stored filter rules onto an existing PostgREST query builder.
 *
 * Extracted from `buildFilterQuery` so the same dynamic-list semantics can be
 * layered onto another query — e.g. the /contacts page applying a selected
 * dynamic list as one more filter alongside its own dropdowns.
 */
export function applyListFilters<Q>(query: Q, filters: ListFilter[]): Q {
  let q: any = query;
  for (const filter of filters) {
    const { field, operator, value } = filter;

    if (field === 'custom_fields') {
      const key = filter.customFieldKey;
      if (!key) continue;
      if (operator === 'equals') {
        q = q.contains('custom_fields', { [key]: value });
      } else if (operator === 'contains' && typeof value === 'string') {
        q = q.ilike(`custom_fields->>` + key, `%${value}%`);
      }
      continue;
    }

    // `contacts.language` stores whatever tag the app wrote, so "Norwegian"
    // has to match `nb` as well as `no`. Every language comparison therefore
    // goes through .in()/.not-in() over the tag's variants rather than a bare
    // equality, which would silently return nothing for those contacts.
    if (
      field === 'language' &&
      (operator === 'equals' || operator === 'not_equals' || operator === 'in')
    ) {
      const requested = Array.isArray(value) ? value : [value];
      const variants = Array.from(
        new Set(requested.flatMap((code) => languageVariants(code as string))),
      );
      if (variants.length === 0) continue;
      q =
        operator === 'not_equals'
          ? q.not(field, 'in', `(${variants.join(',')})`)
          : q.in(field, variants);
      continue;
    }

    switch (operator) {
      case 'equals':
        q = q.eq(field, value as string);
        break;
      case 'not_equals':
        q = q.neq(field, value as string);
        break;
      case 'contains':
        q = q.ilike(field, `%${value}%`);
        break;
      case 'in':
        q = q.in(field, value as string[]);
        break;
      case 'before':
        q = q.lt(field, value as string);
        break;
      case 'after':
        q = q.gt(field, value as string);
        break;
      case 'older_than_days':
        q = q.lte(field, daysAgo(value as number));
        break;
      case 'within_last_days':
        q = q.gte(field, daysAgo(value as number));
        break;
      case 'gte':
        q = q.gte(field, value as number);
        break;
      case 'lte':
        q = q.lte(field, value as number);
        break;
      case 'is_null':
        q = q.is(field, null);
        break;
      case 'is_not_null':
        q = q.not(field, 'is', null);
        break;
    }
  }
  return q as Q;
}

export function buildFilterQuery(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  filters: ListFilter[],
  selectClause: string = '*, companies(name)',
  opts?: { count?: 'exact'; range?: [number, number]; head?: boolean }
): any {
  const selectOpts: { count?: 'exact'; head?: boolean } = {};
  if (opts?.count) selectOpts.count = opts.count;
  if (opts?.head) selectOpts.head = opts.head;

  let query: any = supabase
    .from('contacts')
    .select(selectClause, Object.keys(selectOpts).length > 0 ? selectOpts : undefined)
    .eq('workspace_id', workspaceId);

  query = applyListFilters(query, filters);

  if (opts?.range) {
    query = query.range(opts.range[0], opts.range[1]);
  }

  return query.order('created_at', { ascending: false });
}

/** Minimal list shape required for membership resolution. */
export type ResolvableList = {
  id: string;
  workspace_id: string;
  is_dynamic: boolean | null;
  filters: unknown;
};

/**
 * Resolve the full set of contact IDs for a list.
 * - Dynamic lists: runs the stored filter query and returns matching IDs.
 * - Static lists: queries contact_list_members.
 *
 * This is the single source of truth for list membership resolution.
 * Do NOT query contact_list_members directly for resolution purposes —
 * use this helper so dynamic lists work correctly.
 */
export async function resolveListContactIds(
  supabase: SupabaseClient<Database>,
  list: ResolvableList,
): Promise<string[]> {
  // Supabase REST caps result sets at 1000 rows by default. Paginate explicitly
  // so a list with > 1000 contacts (e.g. a country-wide dynamic list) returns
  // every member, not just the first page.
  const PAGE = 1000;

  if (list.is_dynamic === true) {
    const filters = (list.filters as ListFilter[] | null) ?? [];
    const out: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await buildFilterQuery(
        supabase,
        list.workspace_id,
        filters,
        'id',
        { range: [offset, offset + PAGE - 1] },
      );
      if (error) throw error;
      const page = (data ?? []) as { id: string }[];
      out.push(...page.map((c) => c.id));
      if (page.length < PAGE) break;
    }
    return out;
  }

  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('contact_list_members')
      .select('contact_id')
      .eq('list_id', list.id)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    out.push(...page.map((m) => m.contact_id));
    if (page.length < PAGE) break;
  }
  return out;
}

export function describeFilter(filter: ListFilter, companyName?: string): string {
  const fieldLabel = FILTER_FIELDS.find(f => f.value === filter.field)?.label || filter.field;
  const ops = OPERATORS_BY_FIELD[filter.field];
  const opLabel = ops?.find(o => o.value === filter.operator)?.label || filter.operator;

  if (filter.operator === 'is_null' || filter.operator === 'is_not_null') {
    return `${fieldLabel} ${opLabel}`;
  }

  if (filter.field === 'company_id' && companyName) {
    return `${fieldLabel} ${opLabel} ${companyName}`;
  }

  if (filter.field === 'country_code') {
    return `${fieldLabel} ${opLabel} ${filter.value}`;
  }

  if (filter.field === 'user_plan_type') {
    const pretty = Array.isArray(filter.value)
      ? filter.value.map((v) => PLAN_TYPE_LABELS[v] ?? v).join(', ')
      : PLAN_TYPE_LABELS[String(filter.value)] ?? String(filter.value);
    return `${fieldLabel} ${opLabel} ${pretty}`;
  }

  if (filter.field === 'payment_status') {
    const pretty = Array.isArray(filter.value)
      ? filter.value.map((v) => PAYMENT_STATUS_LABELS[v] ?? v).join(', ')
      : PAYMENT_STATUS_LABELS[String(filter.value)] ?? String(filter.value);
    return `${fieldLabel} ${opLabel} ${pretty}`;
  }

  if (filter.field === 'language') {
    const pretty = Array.isArray(filter.value)
      ? filter.value.map((v) => languageLabel(String(v))).join(', ')
      : languageLabel(String(filter.value));
    return `${fieldLabel} ${opLabel} ${pretty}`;
  }

  if (filter.operator === 'gte' || filter.operator === 'lte') {
    return `${fieldLabel} ${opLabel} ${filter.value}`;
  }

  if (filter.field === 'custom_fields' && filter.customFieldKey) {
    return `Custom field "${filter.customFieldKey}" ${opLabel} "${filter.value}"`;
  }

  if (filter.operator === 'older_than_days' || filter.operator === 'within_last_days') {
    const days = Number(filter.value);
    const pretty = RECENCY_PRESET_LABELS[days] ?? `${filter.value} days`;
    return `${fieldLabel} ${opLabel} ${pretty}`;
  }

  if (Array.isArray(filter.value)) {
    return `${fieldLabel} ${opLabel} ${filter.value.join(', ')}`;
  }

  return `${fieldLabel} ${opLabel} "${filter.value}"`;
}
