import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/call-agent/auth";
import { normalizePhone } from "@/lib/calls/phone";
import { loadTargets } from "@/lib/switchboard/settings";

export const dynamic = "force-dynamic";

// Who the receptionist may put callers through to.

export async function GET() {
  const gate = await requireMember();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const supabase = await createClient();
  return NextResponse.json({ targets: await loadTargets(supabase, gate.workspaceId) });
}

const Upsert = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid().nullish(),
  label: z.string().min(1).max(40),
  aliases: z.array(z.string().min(1).max(40)).max(10).optional(),
  phone: z.string().nullish(),
  failover_target_id: z.string().uuid().nullish(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(999).optional(),
});

export async function POST(request: NextRequest) {
  const gate = await requireMember();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const parsed = Upsert.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { id, phone, ...rest } = parsed.data;

  let e164: string | null = null;
  if (phone) {
    e164 = normalizePhone(phone);
    if (!e164) {
      return NextResponse.json({ error: "That is not a valid phone number" }, { status: 400 });
    }
  }

  // A target with neither a CRM user nor an explicit number can never be rung,
  // so refuse it rather than silently creating a dead entry.
  if (!rest.user_id && !e164) {
    return NextResponse.json(
      { error: "Pick a team member, or give a phone number to ring." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const row = {
    workspace_id: gate.workspaceId,
    ...rest,
    aliases: rest.aliases ?? [],
    phone: e164,
  };

  const { error } = id
    ? await supabase.from("switchboard_targets").update(row).eq("id", id).eq("workspace_id", gate.workspaceId)
    : await supabase.from("switchboard_targets").insert(row);

  if (error) {
    const duplicate = error.code === "23505" || error.message.includes("duplicate");
    return NextResponse.json(
      { error: duplicate ? "Someone already uses that name" : error.message },
      { status: duplicate ? 409 : 500 },
    );
  }

  return NextResponse.json({ targets: await loadTargets(supabase, gate.workspaceId) });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireMember();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase
    .from("switchboard_targets")
    .delete()
    .eq("id", id)
    .eq("workspace_id", gate.workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ targets: await loadTargets(supabase, gate.workspaceId) });
}
