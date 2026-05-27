import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Filter shape for companies list / bulk-action endpoints.
 *
 * Multi-select fields accept either `string[]` (preferred, multi-select UI)
 * or a single `string` (legacy single-select callers). Both forms are
 * normalised below before query construction. Mirrors the filter logic in
 * components/companies/companies-page-client.tsx so server-side
 * "select all matching" resolves the exact same set the user sees.
 */
export type CompanyFilters = {
  search?: string;
  country_code?: string | string[];
  source?: string | string[];
  industry?: string | string[];
  lifecycle_stage?: string | string[];
  customer_status?: string | string[];
  plan?: string | string[];
  /**
   * `'yes'` → only companies with wl_workshop_id set.
   * `'no'`  → only companies without wl_workshop_id.
   * undefined → no filter.
   */
  has_account?: 'yes' | 'no';
  /** Match companies whose `tags` array overlaps any of these (OR semantics). */
  tags?: string | string[];
  has_phone?: boolean;
  has_domain?: boolean;
};

function toArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return v ? [v] : [];
}

export async function resolveCompanyIdsByFilters(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: CompanyFilters,
  cap = 5000
): Promise<string[]> {
  let query = supabase
    .from('companies')
    .select('id')
    .eq('workspace_id', workspaceId)
    .limit(cap);

  if (filters.search) {
    query = query.or(
      `name.ilike.%${filters.search}%,domain.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`
    );
  }

  const country = toArray(filters.country_code);
  if (country.length === 1) query = query.eq('country_code', country[0]);
  else if (country.length > 1) query = query.in('country_code', country);

  const source = toArray(filters.source);
  if (source.length === 1) query = query.eq('source', source[0]);
  else if (source.length > 1) query = query.in('source', source);

  const industry = toArray(filters.industry);
  if (industry.length === 1) query = query.eq('industry', industry[0]);
  else if (industry.length > 1) query = query.in('industry', industry);

  const lifecycle = toArray(filters.lifecycle_stage);
  if (lifecycle.length === 1) query = query.eq('lifecycle_stage', lifecycle[0]);
  else if (lifecycle.length > 1) query = query.in('lifecycle_stage', lifecycle);

  const customerStatus = toArray(filters.customer_status);
  if (customerStatus.length === 1) query = query.eq('customer_status', customerStatus[0]);
  else if (customerStatus.length > 1) query = query.in('customer_status', customerStatus);

  const plan = toArray(filters.plan);
  if (plan.length === 1) query = query.eq('plan', plan[0]);
  else if (plan.length > 1) query = query.in('plan', plan);

  if (filters.has_account === 'yes') query = query.not('wl_workshop_id', 'is', null);
  else if (filters.has_account === 'no') query = query.is('wl_workshop_id', null);

  const tags = toArray(filters.tags);
  if (tags.length > 0) query = query.overlaps('tags', tags);

  if (filters.has_phone) query = query.not('phone', 'is', null).neq('phone', '');
  if (filters.has_domain) query = query.not('domain', 'is', null).neq('domain', '');

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as Array<{ id: string }>).map((r) => r.id);
}
