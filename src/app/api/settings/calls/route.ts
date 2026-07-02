import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/calls/phone";

// Per-user dialer config (this user's phone + caller ID + master switch + the
// no-answer failover / voicemail behaviour for inbound calls to their number).
//
// Stored on user_profiles so every member rings their OWN phone and shows their
// OWN caller ID. The workspace-level settings.calls keys that drive follow-up
// automation (auto_followup_enabled / sequence_by_outcome) are untouched here.

const Body = z.object({
  agent_phone: z.string().max(32).nullish(),
  caller_id: z.string().max(32).nullish(),
  calling_enabled: z.boolean().optional(),
  failover_user_id: z.string().uuid().nullish(),
  ring_seconds: z.number().int().min(5).max(60).optional(),
  voicemail_enabled: z.boolean().optional(),
});

async function requireUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { userId: user.id };
}

/** Other members of the caller's workspace, for the failover dropdown. */
async function listOtherMembers(userId: string): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!membership) return [];

  const { data: members } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", membership.workspace_id);
  const ids = (members ?? []).map((m) => m.user_id).filter((id): id is string => !!id && id !== userId);
  if (!ids.length) return [];

  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .in("user_id", ids);
  const nameById = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailById = new Map((usersList?.users ?? []).map((u) => [u.id, u.email ?? null]));

  return ids
    .map((id) => ({ id, name: nameById.get(id)?.trim() || emailById.get(id) || "Unknown user" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET() {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("error" in auth) return auth.error;

  // RLS scopes this to the caller's own profile row.
  const { data: profile } = await supabase
    .from("user_profiles")
    .select(
      "call_agent_phone, call_caller_id, call_enabled, call_failover_user_id, call_ring_seconds, call_voicemail_enabled",
    )
    .eq("user_id", auth.userId)
    .maybeSingle();

  const members = await listOtherMembers(auth.userId);

  return NextResponse.json({
    agent_phone: profile?.call_agent_phone ?? "",
    caller_id: profile?.call_caller_id ?? "",
    calling_enabled: profile?.call_enabled !== false,
    failover_user_id: profile?.call_failover_user_id ?? null,
    ring_seconds: profile?.call_ring_seconds ?? 25,
    voicemail_enabled: profile?.call_voicemail_enabled !== false,
    members,
    // Surface the env default so the UI can show what caller ID is used when blank.
    default_caller_id: process.env.CRM_CALL_FROM_NUMBER ?? null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
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

  const callEnabled = parsed.data.calling_enabled ?? true;
  // Can't fail over to yourself.
  const failoverUserId =
    parsed.data.failover_user_id && parsed.data.failover_user_id !== auth.userId
      ? parsed.data.failover_user_id
      : null;
  const ringSeconds = parsed.data.ring_seconds ?? 25;
  const voicemailEnabled = parsed.data.voicemail_enabled ?? true;

  // Upsert the caller's own profile row (RLS enforces user_id = auth.uid()).
  const { error } = await supabase.from("user_profiles").upsert(
    {
      user_id: auth.userId,
      call_agent_phone: agentPhone,
      call_caller_id: callerId,
      call_enabled: callEnabled,
      call_failover_user_id: failoverUserId,
      call_ring_seconds: ringSeconds,
      call_voicemail_enabled: voicemailEnabled,
    },
    { onConflict: "user_id" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    agent_phone: agentPhone ?? "",
    caller_id: callerId ?? "",
    calling_enabled: callEnabled,
    failover_user_id: failoverUserId,
    ring_seconds: ringSeconds,
    voicemail_enabled: voicemailEnabled,
  });
}
