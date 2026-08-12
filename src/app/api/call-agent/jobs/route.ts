import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMember } from "@/lib/call-agent/auth";
import { loadCallAgentRow } from "@/lib/call-agent/settings";
import { resolveListContactIds } from "@/lib/lists/filter-query";
import { resolveExcludedContactIds } from "@/lib/lists/exclusions";
import { isDialable } from "@/lib/calls/phone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/call-agent/jobs?status=...&limit=... — queue + history feed. */
export async function GET(request: NextRequest) {
  const auth = await requireMember();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const status = request.nextUrl.searchParams.get("status");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 100), 300);

  const service = createServiceClient();
  let query = service
    .from("call_agent_jobs")
    .select(
      "id, contact_id, company_id, campaign_key, objective, status, scheduled_for, attempts, " +
        "skip_reason, error, call_session_id, provider_conversation_id, enqueued_at, started_at, finished_at, " +
        "contacts(id, first_name, last_name, phone, language, country_code, user_plan_type), " +
        "companies(id, name)",
    )
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) query = query.in("status", status.split(","));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data ?? [] });
}

interface EnqueueBody {
  contactIds?: string[];
  listId?: string;
  campaignKey?: string;
  objective?: string;
}

/**
 * POST /api/call-agent/jobs — enqueue calls for explicit contacts or a whole
 * list. Contacts without a dialable phone or on an exclusion set are reported
 * back as skipped rather than silently dropped (the enroll-toast lesson).
 * In approve_each mode jobs land as pending_approval.
 */
export async function POST(request: NextRequest) {
  const auth = await requireMember();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => null)) as EnqueueBody | null;
  if (!body || (!body.contactIds?.length && !body.listId)) {
    return NextResponse.json({ error: "contactIds or listId required" }, { status: 400 });
  }

  const service = createServiceClient();
  const settings = await loadCallAgentRow(service, auth.workspaceId);

  let contactIds = body.contactIds ?? [];
  if (body.listId) {
    const { data: list } = await service
      .from("contact_lists")
      .select("id, workspace_id, type, filters")
      .eq("id", body.listId)
      .eq("workspace_id", auth.workspaceId)
      .maybeSingle();
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
    contactIds = await resolveListContactIds(service, list as never);
  }
  contactIds = [...new Set(contactIds)];
  if (contactIds.length === 0) return NextResponse.json({ enqueued: 0, skipped: [] });

  const excluded = await resolveExcludedContactIds(service, auth.workspaceId, {
    groups: ["never_call", "internal_testers"],
    lists: [],
  });

  // Existing open jobs → don't double-queue.
  const { data: openJobs } = await service
    .from("call_agent_jobs")
    .select("contact_id")
    .eq("workspace_id", auth.workspaceId)
    .in("status", ["pending_approval", "queued", "processing", "calling"]);
  const alreadyQueued = new Set((openJobs ?? []).map((j) => j.contact_id));

  const skipped: Array<{ contactId: string; reason: string }> = [];
  const rows: Array<Record<string, unknown>> = [];

  // Hydrate phones in chunks (PostgREST .in() cap).
  const contacts = new Map<
    string,
    { id: string; phone: string | null; country_code: string | null; company_id: string | null }
  >();
  for (let i = 0; i < contactIds.length; i += 100) {
    const chunk = contactIds.slice(i, i + 100);
    const { data } = await service
      .from("contacts")
      .select("id, phone, country_code, company_id")
      .eq("workspace_id", auth.workspaceId)
      .in("id", chunk);
    for (const c of data ?? []) contacts.set(c.id, c);
  }

  const initialStatus = settings.mode === "autonomous" ? "queued" : "pending_approval";
  for (const id of contactIds) {
    const c = contacts.get(id);
    if (!c) {
      skipped.push({ contactId: id, reason: "not found" });
    } else if (alreadyQueued.has(id)) {
      skipped.push({ contactId: id, reason: "already queued" });
    } else if (excluded.has(id)) {
      skipped.push({ contactId: id, reason: "excluded (never_call / internal)" });
    } else if (!c.phone || !isDialable(c.phone, c.country_code)) {
      skipped.push({ contactId: id, reason: "no dialable phone" });
    } else {
      rows.push({
        workspace_id: auth.workspaceId,
        contact_id: id,
        company_id: c.company_id,
        list_id: body.listId ?? null,
        campaign_key: body.campaignKey ?? null,
        objective: body.objective ?? null,
        status: initialStatus,
        enqueued_by: auth.userId,
      });
    }
  }

  if (rows.length > 0) {
    const { error } = await service.from("call_agent_jobs").insert(rows as never);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ enqueued: rows.length, mode: settings.mode, skipped });
}
