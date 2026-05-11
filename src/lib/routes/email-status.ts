import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const CHUNK = 200;

export async function fetchLastEmailedByCompany(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  companyIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (companyIds.length === 0) return result;

  const contactsByCompany = new Map<string, string[]>();
  for (let i = 0; i < companyIds.length; i += CHUNK) {
    const slice = companyIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("contacts")
      .select("id, company_id")
      .eq("workspace_id", workspaceId)
      .in("company_id", slice)
      .not("company_id", "is", null);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!row.company_id) continue;
      const arr = contactsByCompany.get(row.company_id) ?? [];
      arr.push(row.id);
      contactsByCompany.set(row.company_id, arr);
    }
  }

  const contactIds: string[] = [];
  const contactToCompany = new Map<string, string>();
  for (const [companyId, ids] of contactsByCompany) {
    for (const cid of ids) {
      contactIds.push(cid);
      contactToCompany.set(cid, companyId);
    }
  }
  if (contactIds.length === 0) return result;

  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const slice = contactIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("email_queue")
      .select("contact_id, sent_at")
      .eq("workspace_id", workspaceId)
      .in("contact_id", slice)
      .not("sent_at", "is", null);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!row.contact_id || !row.sent_at) continue;
      const companyId = contactToCompany.get(row.contact_id);
      if (!companyId) continue;
      const prev = result.get(companyId);
      if (!prev || prev < row.sent_at) result.set(companyId, row.sent_at);
    }
  }

  return result;
}
