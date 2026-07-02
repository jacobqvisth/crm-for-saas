import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/videos/server";

const patchSchema = z.object({
  marked: z.boolean().optional(),
  summary: z.string().max(20000).nullable().optional(),
  veo3_prompt: z.string().max(20000).nullable().optional(),
});

// PATCH /api/videos/[id] → toggle `marked`, or store a generated summary /
// Veo 3 prompt for a video.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data: video, error } = await supabase
    .from("diagnostic_videos")
    .update(parsed.data)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ video });
}

// DELETE /api/videos/[id] → remove a manually-added video. Seed videos can't be
// deleted here (they'd just reappear on the next reconcile); they're managed in
// src/lib/videos/seed.ts.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const { data: deleted, error } = await supabase
    .from("diagnostic_videos")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("source", "manual")
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted) {
    return NextResponse.json(
      { error: "Only manually-added videos can be deleted." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
