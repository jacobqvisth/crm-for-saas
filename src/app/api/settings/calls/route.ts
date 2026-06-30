import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/calls/phone";

// Per-user dialer config (this user's phone + caller ID + master switch).
//
// Stored on user_profiles so every member rings their OWN phone and shows their
// OWN caller ID — the dialer is no longer one shared workspace number. The
// workspace-level settings.calls keys that drive follow-up automation
// (auto_followup_enabled / sequence_by_outcome) are written elsewhere and are
// intentionally untouched here.

const Body = z.object({
  agent_phone: z.string().max(32).nullish(),
  caller_id: z.string().max(32).nullish(),
  calling_enabled: z.boolean().optional(),
});

async function requireUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { userId: user.id };
}

export async function GET() {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("error" in auth) return auth.error;

  // RLS scopes this to the caller's own profile row.
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("call_agent_phone, call_caller_id, call_enabled")
    .eq("user_id", auth.userId)
    .maybeSingle();

  return NextResponse.json({
    agent_phone: profile?.call_agent_phone ?? "",
    caller_id: profile?.call_caller_id ?? "",
    calling_enabled: profile?.call_enabled !== false,
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

  // Upsert the caller's own profile row (RLS enforces user_id = auth.uid()).
  const { error } = await supabase.from("user_profiles").upsert(
    {
      user_id: auth.userId,
      call_agent_phone: agentPhone,
      call_caller_id: callerId,
      call_enabled: callEnabled,
    },
    { onConflict: "user_id" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    agent_phone: agentPhone ?? "",
    caller_id: callerId ?? "",
    calling_enabled: callEnabled,
  });
}
