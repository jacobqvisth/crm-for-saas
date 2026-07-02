import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { COLOR_TOKENS } from "@/lib/roadmap/colors";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const createSchema = z
  .object({
    roadmap_id: z.string().uuid(),
    group_id: z.string().uuid(),
    title: z.string().trim().max(500).optional(),
    description: z.string().max(5000).nullish(),
    start_date: dateStr,
    end_date: dateStr,
    status: z.string().max(100).nullish(),
    owner: z.string().max(200).nullish(),
    phase: z.string().max(100).nullish(),
    priority: z.string().max(100).nullish(),
    team: z.string().max(200).nullish(),
    color: z.enum(COLOR_TOKENS).nullish(),
    sort_order: z.number().int().optional(),
  })
  .refine((d) => d.end_date >= d.start_date, {
    message: "end_date must be on or after start_date",
    path: ["end_date"],
  });

// POST /api/roadmap/items → add a bar to a swimlane
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
    .from("roadmap_groups")
    .select("id")
    .eq("id", body.group_id)
    .eq("roadmap_id", body.roadmap_id)
    .eq("workspace_id", workspaceId)
    .single();
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  let order = body.sort_order;
  if (order === undefined) {
    const { count } = await supabase
      .from("roadmap_items")
      .select("id", { count: "exact", head: true })
      .eq("group_id", body.group_id);
    order = count ?? 0;
  }

  const { data: item, error } = await supabase
    .from("roadmap_items")
    .insert({
      workspace_id: workspaceId,
      roadmap_id: body.roadmap_id,
      group_id: body.group_id,
      title: body.title?.trim() || "New item",
      description: body.description ?? null,
      start_date: body.start_date,
      end_date: body.end_date,
      status: body.status ?? null,
      owner: body.owner ?? null,
      phase: body.phase ?? null,
      priority: body.priority ?? null,
      team: body.team ?? null,
      color: body.color ?? null,
      sort_order: order,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item }, { status: 201 });
}
