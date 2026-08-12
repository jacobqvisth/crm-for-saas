import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMember } from "@/lib/call-agent/auth";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/call-agent/jobs/[id] — approve / dismiss / retry a job.
 *   approve: pending_approval → queued (the cron dials it)
 *   dismiss: pending_approval|queued → dismissed
 *   retry:   failed|skipped → queued (attempts preserved)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMember();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;

  const service = createServiceClient();
  const { data: job } = await service
    .from("call_agent_jobs")
    .select("id, status")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const transitions: Record<string, { from: string[]; to: string }> = {
    approve: { from: ["pending_approval"], to: "queued" },
    dismiss: { from: ["pending_approval", "queued", "skipped", "failed"], to: "dismissed" },
    retry: { from: ["failed", "skipped"], to: "queued" },
  };
  const t = action ? transitions[action] : undefined;
  if (!t) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!t.from.includes(job.status)) {
    return NextResponse.json(
      { error: `Cannot ${action} a job in status ${job.status}` },
      { status: 409 },
    );
  }

  const updates: Record<string, unknown> = { status: t.to };
  if (action === "approve" || action === "retry") {
    updates.skip_reason = null;
    updates.error = null;
    updates.scheduled_for = new Date().toISOString();
  }
  const { error } = await service.from("call_agent_jobs").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: t.to });
}
