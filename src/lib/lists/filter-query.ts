import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

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
  | 'is_null'
  | 'is_not_null';

export type FilterField =
  | 'status'
  | 'lead_status'
  | 'company_id'
  | 'country_code'
  | 'created_at'
  | 'last_contacted_at'
  | 'email'
  | 'first_name'
  | 'last_name'
  | 'custom_fields';

export interface ListFilter {
  field: FilterField;
  operator: FilterOperator;
  value: string | string[] | number | null;
  customFieldKey?: string;
}

export const FILTER_FIELDS: { value: FilterField; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'lead_status', label: 'Lead Status' },
  { value: 'company_id', label: 'Company' },
  { value: 'country_code', label: 'Country' },
  { value: 'created_at', label: 'Created Date' },
  { value: 'last_contacted_at', label: 'Last Contacted' },
  { value: 'email', label: 'Email' },
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'custom_fields', label: 'Custom Field' },
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
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'within_last_days', label: 'within last N days' },
    { value: 'older_than_days', label: 'more than N days ago' },
    { value: 'is_null', label: 'never contacted' },
    { value: 'is_not_null', label: 'has been contacted' },
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
  custom_fields: [
    { value: 'equals', label: 'equals' },
    { value: 'contains', label: 'contains' },
  ],
};

export const STATUS_OPTIONS = ['active', 'bounced', 'unsubscribed', 'archived'] as const;
export const LEAD_STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'customer', 'churned'] as const;

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
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

  for (const filter of filters) {
    const { field, operator, value } = filter;

    if (field === 'custom_fields') {
      const key = filter.customFieldKey;
      if (!key) continue;
      if (operator === 'equals') {
        query = query.contains('custom_fields', { [key]: value });
      } else if (operator === 'contains' && typeof value === 'string') {
        query = query.ilike(`custom_fields->>` + key, `%${value}%`);
      }
      continue;
    }

    switch (operator) {
      case 'equals':
        query = query.eq(field, value as string);
        break;
      case 'not_equals':
        query = query.neq(field, value as string);
        break;
      case 'contains':
        query = query.ilike(field, `%${value}%`);
        break;
      case 'in':
        query = query.in(field, value as string[]);
        break;
      case 'before':
        query = query.lt(field, value as string);
        break;
      case 'after':
        query = query.gt(field, value as string);
        break;
      case 'older_than_days':
        query = query.lte(field, daysAgo(value as number));
        break;
      case 'within_last_days':
        query = query.gte(field, daysAgo(value as number));
        break;
      case 'is_null':
        query = query.is(field, null);
        break;
      case 'is_not_null':
        query = query.not(field, 'is', null);
        break;
    }
  }

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

  if (filter.field === 'custom_fields' && filter.customFieldKey) {
    return `Custom field "${filter.customFieldKey}" ${opLabel} "${filter.value}"`;
  }

  if (filter.operator === 'older_than_days' || filter.operator === 'within_last_days') {
    return `${fieldLabel} ${opLabel} (${filter.value} days)`;
  }

  if (Array.isArray(filter.value)) {
    return `${fieldLabel} ${opLabel} ${filter.value.join(', ')}`;
  }

  return `${fieldLabel} ${opLabel} "${filter.value}"`;
}
