import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { COLOR_TOKENS } from "@/lib/roadmap/colors";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// Every field optional — this PATCH handles drag-move/resize (start_date/end_date),
// moving between swimlanes (group_id), reordering (sort_order), and detail-panel edits.
const patchSchema = z.object({
  title: z.string().trim().max(500).optional(),
  description: z.string().max(5000).nullish(),
  start_date: dateStr.optional(),
  end_date: dateStr.optional(),
  group_id: z.string().uuid().optional(),
  status: z.string().max(100).nullish(),
  owner: z.string().max(200).nullish(),
  phase: z.string().max(100).nullish(),
  priority: z.string().max(100).nullish(),
  team: z.string().max(200).nullish(),
  color: z.enum(COLOR_TOKENS).nullish(),
  sort_order: z.number().int().optional(),
});

// PATCH /api/roadmap/items/[id]
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
    return NextResponse.json(
      { error: parsed.success ? "No fields to update" : parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const patch = parsed.data;

  // If only one of the dates is changing, validate the pair against the stored row
  // so we never write start_date > end_date (the DB CHECK would otherwise 500).
  if ((patch.start_date || patch.end_date) && !(patch.start_date && patch.end_date)) {
    const { data: existing } = await supabase
      .from("roadmap_items")
      .select("start_date, end_date")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const start = patch.start_date ?? existing.start_date;
    const end = patch.end_date ?? existing.end_date;
    if (end < start) {
      return NextResponse.json({ error: "end_date must be on or after start_date" }, { status: 400 });
    }
  } else if (patch.start_date && patch.end_date && patch.end_date < patch.start_date) {
    return NextResponse.json({ error: "end_date must be on or after start_date" }, { status: 400 });
  }

  if (patch.title !== undefined) patch.title = patch.title.trim() || "New item";

  const { data: item, error } = await supabase
    .from("roadmap_items")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item });
}

// DELETE /api/roadmap/items/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const { error } = await supabase
    .from("roadmap_items")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
