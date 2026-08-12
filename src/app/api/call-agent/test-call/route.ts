import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMember } from "@/lib/call-agent/auth";
import { loadCallAgentRow, providerApiKey } from "@/lib/call-agent/settings";
import { dialJob } from "@/lib/call-agent/queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/call-agent/test-call { contactId } — dial one contact NOW,
 * bypassing exclusion/hours/cap rails (this is how the team tests the agent
 * against their own contact cards). Requires the agent to be provisioned.
 * The one rail that still applies: a valid phone number.
 */
export async function POST(request: NextRequest) {
  const auth = await requireMember();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => null)) as { contactId?: string } | null;
  if (!body?.contactId) return NextResponse.json({ error: "contactId required" }, { status: 400 });

  const service = createServiceClient();
  const settings = await loadCallAgentRow(service, auth.workspaceId);
  if (!providerApiKey(settings)) {
    return NextResponse.json({ error: "No provider API key configured" }, { status: 400 });
  }
  const agentIds = (settings.provider_agent_ids ?? {}) as Record<string, string>;
  if (!agentIds.default) {
    return NextResponse.json({ error: "Agent not provisioned yet" }, { status: 400 });
  }

  const { data: contact } = await service
    .from("contacts")
    .select("id, company_id")
    .eq("id", body.contactId)
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const { data: job, error } = await service
    .from("call_agent_jobs")
    .insert({
      workspace_id: auth.workspaceId,
      contact_id: contact.id,
      company_id: contact.company_id,
      campaign_key: "test",
      objective: "Test call placed from the CRM settings page",
      status: "processing",
      enqueued_by: auth.userId,
    })
    .select("*")
    .single();
  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "job insert failed" }, { status: 500 });
  }

  const result = await dialJob(service, settings, job, { skipRails: true });
  return NextResponse.json(result, { status: result.outcome === "dialed" ? 200 : 502 });
}
