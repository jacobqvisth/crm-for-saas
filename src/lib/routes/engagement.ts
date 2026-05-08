// Engagement signal fetcher for Phase 5.
//
// Two outputs per company in the candidate pool:
//   - lastEmailedAt — most-recent email sent in the last 90 days (cluster-rank
//     "outreach restraint" signal).
//   - hasRecentPositiveEngagement — any open/reply/click event in the last 30
//     days (stop-score "recent positive engagement" signal).
//
// Walks contacts → email_queue → email_events. All `.in()` calls are chunked
// at 200 to stay under PostgREST URL limits (see PR #99 / project memory).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const CHUNK = 200;
const OUTREACH_LOOKBACK_DAYS = 90;
const ENGAGEMENT_LOOKBACK_DAYS = 30;
const POSITIVE_EVENT_TYPES = ["open", "click", "reply"] as const;

export type EngagementSignals = {
  /** companyId → ISO timestamp of most-recent email sent (last 90 days only). */
  lastEmailedAt: Map<string, string>;
  /** companyIds with a positive event in the last 30 days. */
  recentPositiveCompanies: Set<string>;
};

export async function fetchEngagementSignals(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  companyIds: string[],
): Promise<EngagementSignals> {
  const result: EngagementSignals = {
    lastEmailedAt: new Map(),
    recentPositiveCompanies: new Set(),
  };
  if (companyIds.length === 0) return result;

  // 1) contacts in the candidate companies — we need contactId → companyId.
  const contactToCompany = new Map<string, string>();
  for (let i = 0; i < companyIds.length; i += CHUNK) {
    const slice = companyIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("contacts")
      .select("id, company_id")
      .eq("workspace_id", workspaceId)
      .in("company_id", slice);
    if (error) throw new Error(`engagement contacts query failed: ${error.message}`);
    for (const c of data ?? []) {
      if (c.company_id) contactToCompany.set(c.id, c.company_id);
    }
  }
  const contactIds = Array.from(contactToCompany.keys());
  if (contactIds.length === 0) return result;

  // 2) email_queue rows in the outreach window. We track sent_at per queue row
  //    and keep a queue → company mapping for the events lookup below.
  const queueToCompany = new Map<string, string>();
  const outreachCutoff = new Date(Date.now() - OUTREACH_LOOKBACK_DAYS * 86_400_000).toISOString();
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const slice = contactIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("email_queue")
      .select("id, contact_id, sent_at")
      .eq("workspace_id", workspaceId)
      .in("contact_id", slice)
      .not("sent_at", "is", null)
      .gte("sent_at", outreachCutoff);
    if (error) throw new Error(`engagement queue query failed: ${error.message}`);
    for (const row of data ?? []) {
      const companyId = contactToCompany.get(row.contact_id);
      if (!companyId || !row.sent_at) continue;
      queueToCompany.set(row.id, companyId);
      const prev = result.lastEmailedAt.get(companyId);
      if (!prev || row.sent_at > prev) {
        result.lastEmailedAt.set(companyId, row.sent_at);
      }
    }
  }

  if (queueToCompany.size === 0) return result;

  // 3) email_events with positive event types in the engagement window.
  const queueIds = Array.from(queueToCompany.keys());
  const engagementCutoff = new Date(
    Date.now() - ENGAGEMENT_LOOKBACK_DAYS * 86_400_000,
  ).toISOString();
  for (let i = 0; i < queueIds.length; i += CHUNK) {
    const slice = queueIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("email_events")
      .select("email_queue_id, event_type, created_at")
      .in("email_queue_id", slice)
      .in("event_type", POSITIVE_EVENT_TYPES as unknown as string[])
      .gte("created_at", engagementCutoff);
    if (error) throw new Error(`engagement events query failed: ${error.message}`);
    for (const ev of data ?? []) {
      if (!ev.email_queue_id) continue;
      const companyId = queueToCompany.get(ev.email_queue_id);
      if (companyId) result.recentPositiveCompanies.add(companyId);
    }
  }

  return result;
}
