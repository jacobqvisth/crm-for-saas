import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  userId: z.string().uuid().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ routeId: string }> },
) {
  const { routeId: id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: route, error: routeErr } = await supabase
    .from("daily_routes")
    .select("workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (routeErr) return NextResponse.json({ error: routeErr.message }, { status: 500 });
  if (!route) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Admin-only: requires workspace_members.role = 'admin' for current user.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", route.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (membership.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  if (parsed.data.userId) {
    // Validate target is a workspace member.
    const { data: target } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", route.workspace_id)
      .eq("user_id", parsed.data.userId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: "Target user is not a workspace member" }, { status: 400 });
    }
  }

  const { error: updErr } = await supabase
    .from("daily_routes")
    .update({ assigned_to: parsed.data.userId })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, assigned_to: parsed.data.userId });
}
