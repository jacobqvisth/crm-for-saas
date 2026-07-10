import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWorkspace } from "@/lib/forums/server";

// PATCH /api/forums/mentions/[id]  { status: "confirmed" | "dismissed" }
//
// Human review of a third-party Wrenchlane mention: confirm it's a real,
// relevant mention or dismiss it as noise. User-triggered from the Stats
// exposure list. reddit_mentions isn't in database.types.ts, so go through an
// untyped client view.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await ctx.params;

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.status !== "confirmed" && body.status !== "dismissed") {
    return NextResponse.json({ error: "status must be 'confirmed' or 'dismissed'" }, { status: 400 });
  }

  const raw = supabase as unknown as SupabaseClient;
  const { error } = await raw
    .from("reddit_mentions")
    .update({ status: body.status })
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id, status: body.status });
}
