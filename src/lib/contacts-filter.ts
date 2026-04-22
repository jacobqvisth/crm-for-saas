import type { SupabaseClient } from "@supabase/supabase-js";

export type ContactFilters = {
  search?: string;
  lead_status?: string;
  status?: string;
  company_id?: string;
  country_code?: string;
  email_status?: string;
  has_phone?: boolean;
  source?: string;
  language?: string;
};

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
  let query = supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(cap);

  if (filters.search) {
    query = query.or(
      `first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
    );
  }
  if (filters.lead_status) {
    query = query.eq("lead_status", filters.lead_status);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.company_id) {
    query = query.eq("company_id", filters.company_id);
  }
  if (filters.country_code) {
    query = query.eq("country_code", filters.country_code);
  }
  if (filters.email_status === "unverified") {
    query = query.or("email_status.is.null,email_status.eq.unknown");
  } else if (filters.email_status) {
    query = query.eq("email_status", filters.email_status);
  }
  if (filters.has_phone) {
    query = query.not("phone", "is", null).neq("phone", "");
  }
  if (filters.source) {
    query = query.eq("source", filters.source);
  }
  if (filters.language) {
    query = query.eq("language", filters.language);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((r: { id: string }) => r.id);
}
