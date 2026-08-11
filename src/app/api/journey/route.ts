import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/roadmap/server";
import type { JourneyBoard } from "@/lib/journey/types";

// GET /api/journey            → { boards, board } (board = first, with items)
// GET /api/journey?id=<uuid>  → { boards, board } where board is the requested one
//
// On a workspace's first visit (no boards), an empty "User Journey" board is
// created so the page always has somewhere to drop items.
export async function GET(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  let { data: boards } = await supabase
    .from("journey_boards")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!boards || boards.length === 0) {
    const { data: created, error } = await supabase
      .from("journey_boards")
      .insert({ workspace_id: workspaceId, name: "User Journey", sort_order: 0 })
      .select()
      .single();
    if (error || !created) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to create board" },
        { status: 500 }
      );
    }
    boards = [created];
  }

  const { searchParams } = new URL(request.url);
  const requestedId = searchParams.get("id");
  const selected = boards.find((b) => b.id === requestedId) ?? boards[0];

  const { data: items, error: itemsErr } = await supabase
    .from("journey_items")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("board_id", selected.id)
    .order("z", { ascending: true })
    .order("created_at", { ascending: true });
  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  const board: JourneyBoard = { ...selected, items: items ?? [] };
  return NextResponse.json({ boards, board });
}

const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

// POST /api/journey → create a new (empty) board
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = createBoardSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { count } = await supabase
    .from("journey_boards")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  const { data: board, error } = await supabase
    .from("journey_boards")
    .insert({
      workspace_id: workspaceId,
      name: parsed.data.name ?? "New board",
      sort_order: count ?? 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ board: { ...board, items: [] } }, { status: 201 });
}

const renameBoardSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

// PATCH /api/journey → rename a board
export async function PATCH(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = renameBoardSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { error } = await supabase
    .from("journey_boards")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/journey?id=<uuid> → delete a board (items cascade)
export async function DELETE(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("journey_boards")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
