import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { COLOR_TOKENS } from "@/lib/roadmap/colors";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullish(),
  color: z.enum(COLOR_TOKENS).optional(),
  sort_order: z.number().int().optional(),
});

// PATCH /api/activation/scenarios/[id] → rename / describe / recolor / reorder
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

  const { data: scenario, error } = await supabase
    .from("activation_plan_scenarios")
    .update(parsed.data)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!scenario) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ scenario });
}

// DELETE /api/activation/scenarios/[id] → delete a scenario and prune its id
// from every item's scenario_ids (membership is an array, not a FK).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const { data: members } = await supabase
    .from("activation_plan_items")
    .select("id, scenario_ids")
    .eq("workspace_id", workspaceId)
    .contains("scenario_ids", [id]);

  for (const item of members ?? []) {
    const pruned = (item.scenario_ids ?? []).filter((sid) => sid !== id);
    const { error } = await supabase
      .from("activation_plan_items")
      .update({ scenario_ids: pruned })
      .eq("id", item.id)
      .eq("workspace_id", workspaceId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error } = await supabase
    .from("activation_plan_scenarios")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
