import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMember } from "@/lib/call-agent/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/call-agent/lists — every contact list in the workspace, for the
 * queue-from-list picker. Unlike /api/calls/lists (purpose='calling' only,
 * with expensive member counts), the agent can call ANY list — email lists
 * included — so nothing the user just created goes missing from the dropdown.
 * The enqueue endpoint re-checks phones/exclusions per contact anyway.
 */
export async function GET() {
  const auth = await requireMember();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data, error } = await service
    .from("contact_lists")
    .select("id, name, purpose, is_dynamic, created_at")
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ lists: data ?? [] });
}
