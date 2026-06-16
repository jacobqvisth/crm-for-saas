// Standalone attribution reconciler.
//
// discover-new.ts only stamps contacts.attributed_to_* at the moment a brand
// new wl-app signup is first discovered, and it bails early when the
// propagator has already claimed a contact (`if (existing.wl_user_id) continue`).
// That makes attribution fragile: a propagator/discover race, a late-arriving
// send, or a signup that pre-dated the prospect import all leave the contact
// permanently unattributed. This job re-derives attribution for every app-user
// contact that still has no send linked, using three signals (cheapest /
// strongest first):
//
//   1. self_email_merge — the app user's own contact row received a send
//      before they signed up.
//   2. company_match    — a sibling prospect contact at the same company
//      received a send before signup.
//   3. phone_match      — a prospect contact ANYWHERE (different company /
//      different email) shares this user's phone number and received a send
//      before signup. This is the "signed up with a different email" path.
//
// Every path keeps the temporal guard: the send must pre-date the signup, and
// we only attribute when we have a signup-time proxy (last_login_at /
// diagnostics_first_at). Safe + idempotent — only touches rows where
// attributed_to_send_id IS NULL.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  lookupSelfAttribution,
  lookupOutreachAttribution,
  normalizePhone,
  type OutreachAttribution,
} from "@/lib/wl-sync/matching";

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";

export type ReconcileResult = {
  candidates: number;
  stampedSelf: number;
  stampedCompany: number;
  stampedPhone: number;
  unmatched: number;
  errors: number;
};

// Build a phone -> prospect-contact-ids index across all non-app contacts that
// we've ever sent to. Done once per run (the candidate set is small but each
// candidate would otherwise need a fuzzy phone scan). Phones aren't normalized
// at rest, so we normalize in memory.
async function buildProspectPhoneIndex(
  supabase: SupabaseClient<Database>,
): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, phone")
      .eq("workspace_id", WORKSPACE_ID)
      .is("wl_user_id", null)
      .neq("source", "wl-app")
      .not("phone", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      const key = normalizePhone(r.phone);
      if (!key) continue;
      const arr = index.get(key);
      if (arr) arr.push(r.id);
      else index.set(key, [r.id]);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return index;
}

async function resolveSequenceId(
  supabase: SupabaseClient<Database>,
  enrollmentId: string | null,
): Promise<string | null> {
  if (!enrollmentId) return null;
  const { data } = await supabase
    .from("sequence_enrollments")
    .select("sequence_id")
    .eq("id", enrollmentId)
    .maybeSingle();
  return data?.sequence_id ?? null;
}

// Most-recent send (before signup) to any of the given prospect contact ids.
async function lookupPhoneAttribution(
  supabase: SupabaseClient<Database>,
  prospectContactIds: string[],
  signupAt: string | null,
): Promise<OutreachAttribution | null> {
  if (!signupAt || prospectContactIds.length === 0) return null;
  const { data: sends } = await supabase
    .from("email_queue")
    .select("id, enrollment_id, sent_at, status")
    .in("contact_id", prospectContactIds)
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .lt("sent_at", signupAt)
    .order("sent_at", { ascending: false })
    .limit(1);
  const send = sends?.[0];
  if (!send || !send.sent_at) return null;
  const sequenceId = await resolveSequenceId(supabase, send.enrollment_id);
  return { sendId: send.id, sequenceId, sentAt: send.sent_at };
}

export async function reconcileWlAttribution(
  supabase: SupabaseClient<Database>,
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<ReconcileResult> {
  const { dryRun = false, limit } = opts;
  const result: ReconcileResult = {
    candidates: 0,
    stampedSelf: 0,
    stampedCompany: 0,
    stampedPhone: 0,
    unmatched: 0,
    errors: 0,
  };

  // Candidates: app-user contacts with no send linked yet.
  const { data: candidates, error } = await supabase
    .from("contacts")
    .select(
      "id, phone, company_id, created_at, last_login_at, diagnostics_first_at",
    )
    .eq("workspace_id", WORKSPACE_ID)
    .not("wl_user_id", "is", null)
    .is("attributed_to_send_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const eligible = (candidates ?? []).slice(0, limit ?? Infinity);
  result.candidates = eligible.length;
  if (eligible.length === 0) return result;

  // Only pay for the phone index if at least one candidate has a phone.
  const anyPhone = eligible.some((c) => normalizePhone(c.phone));
  const phoneIndex = anyPhone
    ? await buildProspectPhoneIndex(supabase)
    : new Map<string, string[]>();

  for (const c of eligible) {
    const signupAt = c.last_login_at ?? c.diagnostics_first_at ?? null;

    let attr: OutreachAttribution | null = null;
    let via: "self_email_merge" | "company_match" | "phone_match" | null = null;

    attr = await lookupSelfAttribution(supabase, c.id, signupAt);
    if (attr) via = "self_email_merge";

    if (!attr && c.company_id) {
      attr = await lookupOutreachAttribution(
        supabase,
        WORKSPACE_ID,
        c.company_id,
        signupAt,
      );
      if (attr) via = "company_match";
    }

    if (!attr) {
      const key = normalizePhone(c.phone);
      const matches = key ? (phoneIndex.get(key) ?? []) : [];
      // Don't let a candidate match its own row via a shared phone.
      const prospectIds = matches.filter((id) => id !== c.id);
      attr = await lookupPhoneAttribution(supabase, prospectIds, signupAt);
      if (attr) via = "phone_match";
    }

    if (!attr || !via) {
      result.unmatched++;
      continue;
    }

    if (!dryRun) {
      const { error: upErr } = await supabase
        .from("contacts")
        .update({
          attributed_to_send_id: attr.sendId,
          attributed_to_sequence_id: attr.sequenceId,
          attributed_via: via,
          attributed_at: attr.sentAt,
        })
        .eq("id", c.id);
      if (upErr) {
        result.errors++;
        continue;
      }
    }

    if (via === "self_email_merge") result.stampedSelf++;
    else if (via === "company_match") result.stampedCompany++;
    else result.stampedPhone++;
  }

  return result;
}

// Re-export for callers that want the workspace constant.
export { WORKSPACE_ID as RECONCILE_WORKSPACE_ID };
