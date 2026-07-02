import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { SEED_GROUPS, SEED_BOARD_NAME } from "@/lib/roadmap/seed";
import type { RoadmapBoard } from "@/lib/roadmap/types";

// GET /api/roadmap            → { boards: Roadmap[], board: RoadmapBoard }
// GET /api/roadmap?id=<uuid>  → { boards, board } where board is the requested one
//
// On a workspace's first visit (no roadmaps), a default "WL Marketing" board is
// seeded from src/lib/roadmap/seed.ts so the page renders the example timeline.
export async function GET(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  let { data: boards } = await supabase
    .from("roadmaps")
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

  const board = await loadBoard(supabase, workspaceId, selected.id);
  if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

  return NextResponse.json({ boards, board });
}

const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

// POST /api/roadmap → create a new (empty) board
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = createBoardSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { count } = await supabase
    .from("roadmaps")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  const { data: board, error } = await supabase
    .from("roadmaps")
    .insert({
      workspace_id: workspaceId,
      name: parsed.data.name ?? "New roadmap",
      sort_order: count ?? 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ board: { ...board, groups: [], items: [] } }, { status: 201 });
}

type DB = NonNullable<Awaited<ReturnType<typeof resolveWorkspace>>["supabase"]>;

async function loadBoard(
  supabase: DB,
  workspaceId: string,
  roadmapId: string
): Promise<RoadmapBoard | null> {
  const { data: board } = await supabase
    .from("roadmaps")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", roadmapId)
    .single();
  if (!board) return null;

  const [{ data: groups }, { data: items }] = await Promise.all([
    supabase
      .from("roadmap_groups")
      .select("*")
      .eq("roadmap_id", roadmapId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("roadmap_items")
      .select("*")
      .eq("roadmap_id", roadmapId)
      .order("sort_order", { ascending: true })
      .order("start_date", { ascending: true }),
  ]);

  return { ...board, groups: groups ?? [], items: items ?? [] };
}

async function seedDefaultBoard(
  supabase: DB,
  workspaceId: string
): Promise<{ board: RoadmapBoard } | { error: string }> {
  const { data: board, error: boardErr } = await supabase
    .from("roadmaps")
    .insert({ workspace_id: workspaceId, name: SEED_BOARD_NAME, sort_order: 0 })
    .select()
    .single();
  if (boardErr || !board) return { error: boardErr?.message ?? "Failed to seed board" };

  for (let g = 0; g < SEED_GROUPS.length; g++) {
    const sg = SEED_GROUPS[g];
    const { data: group, error: groupErr } = await supabase
      .from("roadmap_groups")
      .insert({
        workspace_id: workspaceId,
        roadmap_id: board.id,
        name: sg.name,
        color: sg.color,
        sort_order: g,
      })
      .select()
      .single();
    if (groupErr || !group) return { error: groupErr?.message ?? "Failed to seed group" };

    const rows = sg.items.map((it, i) => ({
      workspace_id: workspaceId,
      roadmap_id: board.id,
      group_id: group.id,
      title: it.title,
      start_date: it.start_date,
      end_date: it.end_date,
      phase: sg.name,
      sort_order: i,
    }));
    const { error: itemsErr } = await supabase.from("roadmap_items").insert(rows);
    if (itemsErr) return { error: itemsErr.message };
  }

  const loaded = await loadBoard(supabase, workspaceId, board.id);
  if (!loaded) return { error: "Failed to load seeded board" };
  return { board: loaded };
}
