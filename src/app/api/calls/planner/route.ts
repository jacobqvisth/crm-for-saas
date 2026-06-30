import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildFilterQuery, type ListFilter } from "@/lib/lists/filter-query";
import { PLAYBOOKS, BOUNCED_SUB_STATUSES, type Playbook } from "@/lib/calls/playbooks";
import { scoreContact, isFreshToCall, type ScoreableContact } from "@/lib/calls/scoring";

// How many ranked contacts to surface as "today's top".
const TOP_LIMIT = 30;
// Hide anyone called within this many days so the list rolls forward daily.
const FRESH_CUTOFF_DAYS = 7;
const PHONE_FILTER: ListFilter = { field: "phone", operator: "is_not_null", value: null };

async function getWorkspaceId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  return data?.workspace_id ?? null;
}

type CandidateRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  company_id: string | null;
  lead_status: string | null;
  user_plan_type: string | null;
  user_subscription_status: string | null;
  user_stripe_customer_id: string | null;
  signed_up_at: string | null;
  diagnostics_total: number | null;
  diagnostics_last_30d: number | null;
  login_count: number | null;
  last_active_at: string | null;
  credits_remaining: number | null;
  last_contacted_at: string | null;
  companies: { name: string | null } | null;
};

// GET /api/calls/planner — the "who to call today" intelligence:
//  - topContacts: scored & ranked app users worth calling now
//  - playbooks: each segment with live total + with-phone counts
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getWorkspaceId(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 });

  const now = Date.now();

  // 1. Stripe customers with a bounced/failed payment (drives the
  //    payment_bounced playbook + the scoring flag). dashboard_subscriptions
  //    holds the raw Stripe status; contacts only carry a collapsed version.
  const { data: bouncedSubs } = await supabase
    .from("dashboard_subscriptions")
    .select("stripe_customer_id, status")
    .in("status", BOUNCED_SUB_STATUSES);
  const bouncedCustomerIds = new Set(
    (bouncedSubs ?? []).map((s) => s.stripe_customer_id).filter((id): id is string => !!id),
  );

  // 2. Candidate pool: every app-user contact in this workspace.
  const candidates: CandidateRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, email, phone, company_id, lead_status, user_plan_type, user_subscription_status, user_stripe_customer_id, signed_up_at, diagnostics_total, diagnostics_last_30d, login_count, last_active_at, credits_remaining, last_contacted_at, companies(name)",
      )
      .eq("workspace_id", workspaceId)
      .not("wl_user_id", "is", null)
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as unknown as CandidateRow[];
    candidates.push(...page);
    if (page.length < PAGE) break;
  }

  // 3. Score the fresh-to-call candidates and rank them.
  const scored = candidates
    .filter((c) => isFreshToCall(c, now, FRESH_CUTOFF_DAYS))
    .map((c) => {
      const snapshot: ScoreableContact = {
        user_plan_type: c.user_plan_type,
        user_subscription_status: c.user_subscription_status,
        signed_up_at: c.signed_up_at,
        diagnostics_total: c.diagnostics_total,
        diagnostics_last_30d: c.diagnostics_last_30d,
        login_count: c.login_count,
        last_active_at: c.last_active_at,
        credits_remaining: c.credits_remaining,
        last_contacted_at: c.last_contacted_at,
        paymentIssue: c.user_stripe_customer_id
          ? bouncedCustomerIds.has(c.user_stripe_customer_id)
          : false,
      };
      const result = scoreContact(snapshot, now);
      return { c, result };
    })
    .filter(({ result }) => result.score > 0)
    .sort((a, b) => {
      if (b.result.score !== a.result.score) return b.result.score - a.result.score;
      // Tie-break: more recently active first.
      const aa = a.c.last_active_at ? Date.parse(a.c.last_active_at) : 0;
      const bb = b.c.last_active_at ? Date.parse(b.c.last_active_at) : 0;
      return bb - aa;
    });

  const top = scored.slice(0, TOP_LIMIT).map(({ c, result }) => ({
    contactId: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.email,
    email: c.email,
    phone: c.phone,
    hasPhone: !!c.phone,
    companyId: c.company_id,
    companyName: c.companies?.name ?? null,
    leadStatus: c.lead_status,
    plan: c.user_plan_type,
    subscriptionStatus: c.user_subscription_status,
    score: result.score,
    priority: result.priority,
    reasons: result.reasons.slice(0, 3),
  }));

  const topWithPhone = top.filter((t) => t.hasPhone).length;

  // 4. Playbook counts (total + with-phone), all in parallel.
  const playbookResults = await Promise.all(
    PLAYBOOKS.map(async (pb) => countPlaybook(supabase, workspaceId, pb, bouncedCustomerIds)),
  );

  return NextResponse.json({
    topContacts: top,
    topWithPhone,
    candidateCount: candidates.length,
    freshCutoffDays: FRESH_CUTOFF_DAYS,
    playbooks: playbookResults,
  });
}

async function countPlaybook(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  pb: Playbook,
  bouncedCustomerIds: Set<string>,
): Promise<{ key: string; count: number; withPhone: number }> {
  if (pb.special === "payment_bounced") {
    const ids = [...bouncedCustomerIds];
    if (ids.length === 0) return { key: pb.key, count: 0, withPhone: 0 };
    const [{ count }, { count: withPhone }] = await Promise.all([
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .in("user_stripe_customer_id", ids),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .in("user_stripe_customer_id", ids)
        .not("phone", "is", null),
    ]);
    return { key: pb.key, count: count ?? 0, withPhone: withPhone ?? 0 };
  }

  const filters = pb.filters ?? [];
  const [{ count }, { count: withPhone }] = await Promise.all([
    buildFilterQuery(supabase, workspaceId, filters, "id", { count: "exact", head: true }),
    buildFilterQuery(supabase, workspaceId, [...filters, PHONE_FILTER], "id", {
      count: "exact",
      head: true,
    }),
  ]);
  return { key: pb.key, count: count ?? 0, withPhone: withPhone ?? 0 };
}
