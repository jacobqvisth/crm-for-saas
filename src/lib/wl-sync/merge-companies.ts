// Atomically merge two company rows into one. Used by /companies/duplicates
// to resolve company_merge_candidates queue entries.
//
// Strategy:
//   - Keep the row identified by `keepId`. Delete the other one (`dropId`).
//   - Move all contacts, deals, deal_contacts, activities, and
//     contact_list_members that reference `dropId` over to `keepId`.
//   - Fill nulls on `keepId` from `dropId` (never overwrites existing data).
//   - Union the tags arrays.
//   - Mark the matching company_merge_candidates row as 'merged'.
//
// All work goes through a single RPC call so it runs atomically server-side.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type MergeCompaniesResult = {
  keepCompanyId: string;
  droppedCompanyId: string;
  contactsMoved: number;
  dealsMoved: number;
  activitiesMoved: number;
  listMembershipsMoved: number;
  tagsAfter: string[];
};

export async function mergeCompanies(
  supabase: SupabaseClient<Database>,
  args: {
    keepId: string;
    dropId: string;
    candidateRowId: string | null;
    reviewerUserId: string | null;
  },
): Promise<MergeCompaniesResult> {
  const { data, error } = await supabase.rpc("merge_companies", {
    p_keep_id: args.keepId,
    p_drop_id: args.dropId,
    p_candidate_row_id: args.candidateRowId ?? undefined,
    p_reviewer_id: args.reviewerUserId ?? undefined,
  });
  if (error) throw error;
  if (!data || (Array.isArray(data) && data.length === 0)) {
    throw new Error("merge_companies returned no result");
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    keep_company_id: string;
    dropped_company_id: string;
    contacts_moved: number;
    deals_moved: number;
    activities_moved: number;
    list_memberships_moved: number;
    tags_after: string[];
  };
  return {
    keepCompanyId: row.keep_company_id,
    droppedCompanyId: row.dropped_company_id,
    contactsMoved: row.contacts_moved,
    dealsMoved: row.deals_moved,
    activitiesMoved: row.activities_moved,
    listMembershipsMoved: row.list_memberships_moved,
    tagsAfter: row.tags_after ?? [],
  };
}
