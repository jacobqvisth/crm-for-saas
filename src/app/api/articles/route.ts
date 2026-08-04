import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveArticlesWorkspace } from "@/lib/articles/server";

// GET /api/articles?format=&status= -> { articles: [...] }
export async function GET(request: NextRequest) {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format");
  const status = searchParams.get("status");

  let query = supabase
    .from("articles")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (format) query = query.eq("format", format);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ articles: data ?? [] });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  // Body and title are editable because Jacob almost always tweaks a draft
  // before posting, and the edit should be what gets stored.
  title: z.string().nullable().optional(),
  body: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  status: z.enum(["draft", "approved", "published", "archived"]).optional(),
  published_url: z.string().url().nullable().optional(),
});

// PATCH /api/articles -> { article: <row> }
export async function PATCH(request: NextRequest) {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { id, ...patch } = parsed.data;

  const update: Record<string, unknown> = { ...patch };
  // Marking something published without a timestamp makes the library useless
  // for "what went out and when", so stamp it here rather than trusting callers.
  if (patch.status === "published") update.published_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("articles")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ article: data });
}

// DELETE /api/articles?id= -> { ok: true }
export async function DELETE(request: NextRequest) {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("articles")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
