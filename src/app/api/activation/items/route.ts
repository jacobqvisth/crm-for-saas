import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { COLOR_TOKENS } from "@/lib/roadmap/colors";
import { TRIGGER_TYPES } from "@/lib/activation/types";

const dayInt = z.number().int().min(0).max(3650);

const createSchema = z
  .object({
    plan_id: z.string().uuid(),
    group_id: z.string().uuid(),
    title: z.string().trim().max(500).optional(),
    description: z.string().max(5000).nullish(),
    day_start: dayInt,
    day_end: dayInt,
    trigger_type: z.enum(TRIGGER_TYPES).optional(),
    anchor_event: z.string().max(100).nullish(),
    status: z.string().max(100).nullish(),
    color: z.enum(COLOR_TOKENS).nullish(),
    cio_campaign_id: z.string().max(100).nullish(),
    scenario_ids: z.array(z.string().uuid()).max(50).optional(),
    source_note: z.string().max(2000).nullish(),
    link_url: z.string().url().max(2000).nullish(),
    sort_order: z.number().int().optional(),
  })
  .refine((d) => d.day_end >= d.day_start, {
    message: "day_end must be on or after day_start",
    path: ["day_end"],
  });

// POST /api/activation/items → add a touchpoint to a swimlane
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const body = parsed.data;

  // Confirm the target group belongs to the board + workspace (RLS also guards).
  const { data: group } = await supabase
    .from("activation_plan_groups")
    .select("id")
    .eq("id", body.group_id)
    .eq("plan_id", body.plan_id)
    .eq("workspace_id", workspaceId)
    .single();
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  let order = body.sort_order;
  if (order === undefined) {
    const { count } = await supabase
      .from("activation_plan_items")
      .select("id", { count: "exact", head: true })
      .eq("group_id", body.group_id);
    order = count ?? 0;
  }

  const { data: item, error } = await supabase
    .from("activation_plan_items")
    .insert({
      workspace_id: workspaceId,
      plan_id: body.plan_id,
      group_id: body.group_id,
      title: body.title?.trim() || "New touchpoint",
      description: body.description ?? null,
      day_start: body.day_start,
      day_end: body.day_end,
      trigger_type: body.trigger_type ?? "day_offset",
      anchor_event: body.anchor_event ?? null,
      status: body.status ?? null,
      color: body.color ?? null,
      cio_campaign_id: body.cio_campaign_id ?? null,
      scenario_ids: body.scenario_ids ?? [],
      source_note: body.source_note ?? null,
      link_url: body.link_url ?? null,
      sort_order: order,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item }, { status: 201 });
}
