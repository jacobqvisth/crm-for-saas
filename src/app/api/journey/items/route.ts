import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/roadmap/server";

const createItemSchema = z.object({
  board_id: z.string().uuid(),
  type: z.enum(["note", "label", "image", "frame"]),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  z: z.number().int().optional(),
  content: z.string().max(10000).nullable().optional(),
  image_url: z.string().url().max(2000).nullable().optional(),
  color: z.string().max(30).nullable().optional(),
});

// POST /api/journey/items → create one item, returns the row
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = createItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data: item, error } = await supabase
    .from("journey_items")
    .insert({ ...parsed.data, workspace_id: workspaceId })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item }, { status: 201 });
}

const patchSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().positive().optional(),
        h: z.number().positive().optional(),
        z: z.number().int().optional(),
        content: z.string().max(10000).nullable().optional(),
        color: z.string().max(30).nullable().optional(),
      })
    )
    .min(1)
    .max(200),
});

// PATCH /api/journey/items → bulk update (drag/resize autosave)
export async function PATCH(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  for (const { id, ...fields } of parsed.data.items) {
    if (Object.keys(fields).length === 0) continue;
    const { error } = await supabase
      .from("journey_items")
      .update(fields)
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/journey/items?ids=<uuid,uuid,...>
export async function DELETE(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const { searchParams } = new URL(request.url);
  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0 || ids.length > 200) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("journey_items")
    .delete()
    .in("id", ids)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
