import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { COLOR_TOKENS } from "@/lib/roadmap/colors";
import { TRIGGER_TYPES } from "@/lib/activation/types";

const dayInt = z.number().int().min(0).max(3650);

// Every field optional — this PATCH handles drag-move/resize (day_start/day_end),
// moving between swimlanes (group_id), reordering (sort_order), and panel edits.
const patchSchema = z.object({
  title: z.string().trim().max(500).optional(),
  description: z.string().max(5000).nullish(),
  day_start: dayInt.optional(),
  day_end: dayInt.optional(),
  group_id: z.string().uuid().optional(),
  trigger_type: z.enum(TRIGGER_TYPES).optional(),
  anchor_event: z.string().max(100).nullish(),
  status: z.string().max(100).nullish(),
  color: z.enum(COLOR_TOKENS).nullish(),
  cio_campaign_id: z.string().max(100).nullish(),
  scenario_ids: z.array(z.string().uuid()).max(50).optional(),
  link_url: z.string().url().max(2000).nullish(),
  sort_order: z.number().int().optional(),
});

// PATCH /api/activation/items/[id]
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

  // If only one of the day offsets is changing, validate the pair against the
  // stored row so we never write day_start > day_end (DB CHECK would 500).
  if (
    (patch.day_start !== undefined || patch.day_end !== undefined) &&
    !(patch.day_start !== undefined && patch.day_end !== undefined)
  ) {
    const { data: existing } = await supabase
      .from("activation_plan_items")
      .select("day_start, day_end")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const start = patch.day_start ?? existing.day_start;
    const end = patch.day_end ?? existing.day_end;
    if (end < start) {
      return NextResponse.json({ error: "day_end must be on or after day_start" }, { status: 400 });
    }
  } else if (
    patch.day_start !== undefined &&
    patch.day_end !== undefined &&
    patch.day_end < patch.day_start
  ) {
    return NextResponse.json({ error: "day_end must be on or after day_start" }, { status: 400 });
  }

  if (patch.title !== undefined) patch.title = patch.title.trim() || "New touchpoint";

  const { data: item, error } = await supabase
    .from("activation_plan_items")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item });
}

// DELETE /api/activation/items/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const { error } = await supabase
    .from("activation_plan_items")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
