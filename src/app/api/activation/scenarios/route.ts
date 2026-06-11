import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { COLOR_TOKENS } from "@/lib/roadmap/colors";

const createSchema = z.object({
  plan_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullish(),
  color: z.enum(COLOR_TOKENS).optional(),
  sort_order: z.number().int().optional(),
});

// POST /api/activation/scenarios → add a journey scenario to a plan
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { plan_id, name, description, color, sort_order } = parsed.data;

  // Ensure the plan belongs to this workspace (RLS also enforces this).
  const { data: board } = await supabase
    .from("activation_plans")
    .select("id")
    .eq("id", plan_id)
    .eq("workspace_id", workspaceId)
    .single();
  if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

  let order = sort_order;
  if (order === undefined) {
    const { count } = await supabase
      .from("activation_plan_scenarios")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", plan_id);
    order = count ?? 0;
  }

  const { data: scenario, error } = await supabase
    .from("activation_plan_scenarios")
    .insert({
      workspace_id: workspaceId,
      plan_id,
      name: name ?? "New scenario",
      description: description ?? null,
      color: color ?? "blue",
      sort_order: order,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ scenario }, { status: 201 });
}
