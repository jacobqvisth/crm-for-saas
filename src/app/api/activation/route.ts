import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { SEED_GROUPS, SEED_BOARD_NAME } from "@/lib/activation/seed";
import { SEED_SCENARIOS, EXTRA_ITEMS } from "@/lib/activation/seed-scenarios";
import type { ActivationBoard } from "@/lib/activation/types";

// GET /api/activation            → { boards: ActivationPlan[], board: ActivationBoard }
// GET /api/activation?id=<uuid>  → { boards, board } where board is the requested one
//
// On a workspace's first visit (no plans), the default "User Activation" board
// is seeded from src/lib/activation/seed.ts — the audited inventory of every
// current post-signup touchpoint plus known gaps.
export async function GET(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  let { data: boards } = await supabase
    .from("activation_plans")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!boards || boards.length === 0) {
    const seeded = await seedDefaultBoard(supabase, workspaceId);
    if ("error" in seeded) {
      return NextResponse.json({ error: seeded.error }, { status: 500 });
    }
    boards = [seeded.board];
  }

  const { searchParams } = new URL(request.url);
  const requestedId = searchParams.get("id");
  const selected = boards.find((b) => b.id === requestedId) ?? boards[0];

  let board = await loadBoard(supabase, workspaceId, selected.id);
  if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

  // Lazily seed the default journey scenarios for plans that have touchpoints
  // but no scenarios yet (also: deleting every scenario resets to defaults).
  if (board.scenarios.length === 0 && board.items.length > 0) {
    const err = await seedScenarios(supabase, workspaceId, board);
    if (err) return NextResponse.json({ error: err }, { status: 500 });
    board = await loadBoard(supabase, workspaceId, selected.id);
    if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  return NextResponse.json({ boards, board });
}

const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

// POST /api/activation → create a new (empty) board
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = createBoardSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { count } = await supabase
    .from("activation_plans")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  const { data: board, error } = await supabase
    .from("activation_plans")
    .insert({
      workspace_id: workspaceId,
      name: parsed.data.name ?? "New plan",
      sort_order: count ?? 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { board: { ...board, groups: [], items: [], scenarios: [] } },
    { status: 201 }
  );
}

type DB = NonNullable<Awaited<ReturnType<typeof resolveWorkspace>>["supabase"]>;

async function loadBoard(
  supabase: DB,
  workspaceId: string,
  planId: string
): Promise<ActivationBoard | null> {
  const { data: board } = await supabase
    .from("activation_plans")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", planId)
    .single();
  if (!board) return null;

  const [{ data: groups }, { data: items }, { data: scenarios }] = await Promise.all([
    supabase
      .from("activation_plan_groups")
      .select("*")
      .eq("plan_id", planId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("activation_plan_items")
      .select("*")
      .eq("plan_id", planId)
      .order("sort_order", { ascending: true })
      .order("day_start", { ascending: true }),
    supabase
      .from("activation_plan_scenarios")
      .select("*")
      .eq("plan_id", planId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  return { ...board, groups: groups ?? [], items: items ?? [], scenarios: scenarios ?? [] };
}

async function seedDefaultBoard(
  supabase: DB,
  workspaceId: string
): Promise<{ board: ActivationBoard } | { error: string }> {
  const { data: board, error: boardErr } = await supabase
    .from("activation_plans")
    .insert({ workspace_id: workspaceId, name: SEED_BOARD_NAME, sort_order: 0 })
    .select()
    .single();
  if (boardErr || !board) return { error: boardErr?.message ?? "Failed to seed board" };

  for (let g = 0; g < SEED_GROUPS.length; g++) {
    const sg = SEED_GROUPS[g];
    const { data: group, error: groupErr } = await supabase
      .from("activation_plan_groups")
      .insert({
        workspace_id: workspaceId,
        plan_id: board.id,
        name: sg.name,
        color: sg.color,
        sort_order: g,
      })
      .select()
      .single();
    if (groupErr || !group) return { error: groupErr?.message ?? "Failed to seed group" };

    const rows = sg.items.map((it, i) => ({
      workspace_id: workspaceId,
      plan_id: board.id,
      group_id: group.id,
      title: it.title,
      description: it.description ?? null,
      day_start: it.day_start,
      day_end: it.day_end,
      trigger_type: it.trigger_type,
      anchor_event: it.anchor_event ?? null,
      status: it.status,
      sort_order: i,
    }));
    const { error: itemsErr } = await supabase.from("activation_plan_items").insert(rows);
    if (itemsErr) return { error: itemsErr.message };
  }

  const loaded = await loadBoard(supabase, workspaceId, board.id);
  if (!loaded) return { error: "Failed to load seeded board" };
  return { board: loaded };
}

/**
 * Seed the default journey scenarios onto a plan: create the scenario rows,
 * insert journey touchpoints that don't exist yet (matched by title, into
 * their swimlane by name — skipped when the lane was renamed/deleted), and
 * tag items via scenario_ids by exact title match. Items the user added or
 * retitled simply stay untagged.
 */
async function seedScenarios(
  supabase: DB,
  workspaceId: string,
  board: ActivationBoard
): Promise<string | null> {
  const groupsByName = new Map(board.groups.map((g) => [g.name, g]));
  const items = [...board.items];
  const existingTitles = new Set(items.map((it) => it.title));

  for (const extra of EXTRA_ITEMS) {
    if (existingTitles.has(extra.title)) continue;
    const group = groupsByName.get(extra.groupName);
    if (!group) continue;
    const { data: item, error } = await supabase
      .from("activation_plan_items")
      .insert({
        workspace_id: workspaceId,
        plan_id: board.id,
        group_id: group.id,
        title: extra.title,
        description: extra.description,
        day_start: extra.day_start,
        day_end: extra.day_end,
        trigger_type: extra.trigger_type,
        anchor_event: extra.anchor_event ?? null,
        status: extra.status,
        sort_order: items.filter((it) => it.group_id === group.id).length,
      })
      .select()
      .single();
    if (error || !item) return error?.message ?? "Failed to seed scenario touchpoint";
    items.push(item);
  }

  const scenarioIdsByTitle = new Map<string, string[]>();
  for (let i = 0; i < SEED_SCENARIOS.length; i++) {
    const sc = SEED_SCENARIOS[i];
    const { data: scenario, error } = await supabase
      .from("activation_plan_scenarios")
      .insert({
        workspace_id: workspaceId,
        plan_id: board.id,
        name: sc.name,
        description: sc.description,
        color: sc.color,
        sort_order: i,
      })
      .select()
      .single();
    if (error || !scenario) return error?.message ?? "Failed to seed scenario";
    for (const title of sc.itemTitles) {
      const arr = scenarioIdsByTitle.get(title) ?? [];
      arr.push(scenario.id);
      scenarioIdsByTitle.set(title, arr);
    }
  }

  for (const item of items) {
    const ids = scenarioIdsByTitle.get(item.title);
    if (!ids || ids.length === 0) continue;
    const { error } = await supabase
      .from("activation_plan_items")
      .update({ scenario_ids: ids })
      .eq("id", item.id)
      .eq("workspace_id", workspaceId);
    if (error) return error.message;
  }

  return null;
}
