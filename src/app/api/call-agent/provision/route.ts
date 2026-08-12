import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMember } from "@/lib/call-agent/auth";
import { loadCallAgentRow } from "@/lib/call-agent/settings";
import { provisionCallAgent } from "@/lib/call-agent/provision";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/call-agent/provision — create/update everything on the provider
 * side (agent, knowledge base, SIP number, initiation webhook) from the CRM.
 * Idempotent; this is the "Provision / Sync agent" button.
 */
export async function POST() {
  const auth = await requireMember();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL not set" }, { status: 500 });
  }

  const service = createServiceClient();
  const row = await loadCallAgentRow(service, auth.workspaceId);
  const result = await provisionCallAgent(service, row, appUrl);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
