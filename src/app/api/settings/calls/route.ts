import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { readCallSettings } from "@/lib/calls/decision";
import { normalizePhone } from "@/lib/calls/phone";
import type { Json } from "@/lib/database.types";

// Workspace dialer config (the agent's phone + caller ID + master switch).
// Merges into settings.calls so it preserves the existing
// sequence_by_outcome / auto_followup_enabled keys written by logCall.

const Body = z.object({
  agent_phone: z.string().max(32).nullish(),
  caller_id: z.string().max(32).nullish(),
  calling_enabled: z.boolean().optional(),
});

async function resolveWorkspace(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return { error: NextResponse.json({ error: "No workspace" }, { status: 404 }) };
  return { workspaceId: membership.workspace_id };
}

export async function GET() {
  const supabase = await createClient();
  const auth = await resolveWorkspace(supabase);
  if ("error" in auth) return auth.error;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", auth.workspaceId)
    .maybeSingle();

  const cs = readCallSettings(workspace?.settings);
  return NextResponse.json({
    agent_phone: cs.agent_phone ?? "",
    caller_id: cs.caller_id ?? "",
    calling_enabled: cs.calling_enabled !== false,
    // Surface the env default so the UI can show what caller ID is used when blank.
    default_caller_id: process.env.CRM_CALL_FROM_NUMBER ?? null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await resolveWorkspace(supabase);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  // Normalize phones; reject anything that can't be dialed when non-empty.
  const agentRaw = parsed.data.agent_phone?.trim() || "";
  const callerRaw = parsed.data.caller_id?.trim() || "";
  const agentPhone = agentRaw ? normalizePhone(agentRaw) : null;
  const callerId = callerRaw ? normalizePhone(callerRaw) : null;
  if (agentRaw && !agentPhone) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }
  if (callerRaw && !callerId) {
    return NextResponse.json({ error: "Invalid caller ID number" }, { status: 400 });
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", auth.workspaceId)
    .maybeSingle();

  const existing =
    workspace?.settings && typeof workspace.settings === "object" && !Array.isArray(workspace.settings)
      ? (workspace.settings as Record<string, Json>)
      : {};
  const existingCalls =
    existing.calls && typeof existing.calls === "object" && !Array.isArray(existing.calls)
      ? (existing.calls as Record<string, Json>)
      : {};

  const mergedCalls: Record<string, Json> = {
    ...existingCalls,
    agent_phone: agentPhone,
    caller_id: callerId,
    calling_enabled: parsed.data.calling_enabled ?? true,
  };

  const merged: Record<string, Json> = { ...existing, calls: mergedCalls as unknown as Json };

  const { error } = await supabase
    .from("workspaces")
    .update({ settings: merged as unknown as Json })
    .eq("id", auth.workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    agent_phone: agentPhone ?? "",
    caller_id: callerId ?? "",
    calling_enabled: parsed.data.calling_enabled ?? true,
  });
}
