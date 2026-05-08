import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Filter shape for contacts list / bulk-action endpoints.
 *
 * Multi-select fields accept either `string[]` (preferred, multi-select UI)
 * or a single `string` (legacy single-select callers). Both forms are
 * normalised below before query construction.
 */
export type ContactFilters = {
  search?: string;
  lead_status?: string | string[];
  status?: string | string[];
  email_status?: string | string[];
  source?: string | string[];
  language?: string | string[];
  country_code?: string | string[];
  /** Filter by company.lifecycle_stage via inner join. */
  lifecycle_stage?: string | string[];
  /** Filter by company.customer_status via inner join. */
  customer_status?: string | string[];
  /**
   * `'yes'` → only contacts whose company has wl_workshop_id set.
   * `'no'`  → only contacts whose company has no wl_workshop_id (or no company).
   * undefined → no filter.
   */
  has_account?: 'yes' | 'no';
  has_phone?: boolean;
  company_id?: string;
};

function toArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return v ? [v] : [];
}

/**
 * Apply the same filter logic used on the /contacts page so server-side
 * "select all matching" resolves the exact same set the user sees.
 */
export async function resolveContactIdsByFilters(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: ContactFilters,
  cap = 5000
): Promise<string[]> {
  const lifecycle = toArray(filters.lifecycle_stage);
  const customerStatus = toArray(filters.customer_status);
  const hasAccount = filters.has_account;
  const needsCompanyJoin = lifecycle.length > 0 || customerStatus.length > 0 || hasAccount != null;

  // Use !inner join only when company-side filters apply, so contacts without
  // a company are not silently dropped from unrelated queries.
  const selectExpr = needsCompanyJoin ? 'id, companies!inner(id)' : 'id';

  let query = supabase
    .from('contacts')
    .select(selectExpr)
    .eq('workspace_id', workspaceId)
    .limit(cap);

  if (filters.search) {
    query = query.or(
      `first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
    );
  }

  const leadStatus = toArray(filters.lead_status);
  if (leadStatus.length === 1) query = query.eq('lead_status', leadStatus[0]);
  else if (leadStatus.length > 1) query = query.in('lead_status', leadStatus);

  const status = toArray(filters.status);
  if (status.length === 1) query = query.eq('status', status[0]);
  else if (status.length > 1) query = query.in('status', status);

  if (filters.company_id) query = query.eq('company_id', filters.company_id);

  const country = toArray(filters.country_code);
  if (country.length === 1) query = query.eq('country_code', country[0]);
  else if (country.length > 1) query = query.in('country_code', country);

  const emailStatus = toArray(filters.email_status);
  if (emailStatus.length > 0) {
    const includesUnverified = emailStatus.includes('unverified');
    const concrete = emailStatus.filter((s) => s !== 'unverified');
    const orParts: string[] = [];
    if (concrete.length === 1) orParts.push(`email_status.eq.${concrete[0]}`);
    if (concrete.length > 1) orParts.push(`email_status.in.(${concrete.join(',')})`);
    if (includesUnverified) {
      orParts.push('email_status.is.null');
      orParts.push('email_status.eq.unknown');
    }
    if (orParts.length > 0) query = query.or(orParts.join(','));
  }

  if (filters.has_phone) query = query.not('phone', 'is', null).neq('phone', '');

  const source = toArray(filters.source);
  if (source.length === 1) query = query.eq('source', source[0]);
  else if (source.length > 1) query = query.in('source', source);

  const language = toArray(filters.language);
  if (language.length === 1) query = query.eq('language', language[0]);
  else if (language.length > 1) query = query.in('language', language);

  if (lifecycle.length === 1) query = query.eq('companies.lifecycle_stage', lifecycle[0]);
  else if (lifecycle.length > 1) query = query.in('companies.lifecycle_stage', lifecycle);

  if (customerStatus.length === 1) query = query.eq('companies.customer_status', customerStatus[0]);
  else if (customerStatus.length > 1) query = query.in('companies.customer_status', customerStatus);

  if (hasAccount === 'yes') query = query.not('companies.wl_workshop_id', 'is', null);
  else if (hasAccount === 'no') query = query.is('companies.wl_workshop_id', null);

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as Array<{ id: string }>).map((r) => r.id);
}
