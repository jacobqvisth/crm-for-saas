import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PostBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  reason: z.string().max(200).optional().nullable(),
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
  if (!membership) {
    return { error: NextResponse.json({ error: "No workspace" }, { status: 404 }) };
  }
  return { user, workspaceId: membership.workspace_id };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await resolveWorkspace(supabase);
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const userIdQ = url.searchParams.get("userId");
  const targetUserId = userIdQ ?? auth.user.id;

  const { data, error } = await supabase
    .from("user_unavailable_dates")
    .select("id, date, reason, user_id")
    .eq("user_id", targetUserId)
    .eq("workspace_id", auth.workspaceId)
    .order("date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await resolveWorkspace(supabase);
  if ("error" in auth) return auth.error;

  const parsed = PostBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { error, data } = await supabase
    .from("user_unavailable_dates")
    .upsert(
      {
        user_id: auth.user.id,
        workspace_id: auth.workspaceId,
        date: parsed.data.date,
        reason: parsed.data.reason ?? null,
      },
      { onConflict: "user_id,date" },
    )
    .select("id, date, reason")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const auth = await resolveWorkspace(supabase);
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const date = url.searchParams.get("date");

  if (!id && !date) {
    return NextResponse.json({ error: "id or date required" }, { status: 400 });
  }

  const query = supabase
    .from("user_unavailable_dates")
    .delete()
    .eq("user_id", auth.user.id);
  const { error } = id ? await query.eq("id", id) : await query.eq("date", date!);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
