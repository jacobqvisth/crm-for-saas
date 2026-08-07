import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveArticlesWorkspace } from "@/lib/articles/server";
import { getPublishedItemDates, isWebflowConfigured } from "@/lib/articles/webflow";

type ArticleRow = {
  id: string;
  status: string;
  webflow_item_id: string | null;
  published_at: string | null;
};

/**
 * Correct any row whose stored status disagrees with Webflow.
 *
 * The CRM is not the only thing that publishes. A full site publish in the
 * Webflow Designer flushes every staged CMS item, so an article the CRM merely
 * staged can go live without the CRM ever hearing about it. That is exactly what
 * happened on 2026-08-05: an article live since 16:20 still showed as "In
 * Webflow, not public" because the row said "approved".
 *
 * Reconciling on read makes the Library truthful no matter who published, and
 * self-healing rather than needing a manual sync. One Webflow call, only when
 * there is actually a candidate row, and failures are ignored so the Library
 * still renders if Webflow is unreachable.
 */
async function reconcileWithWebflow(
  rows: ArticleRow[],
  supabase: Awaited<ReturnType<typeof resolveArticlesWorkspace>>["supabase"],
  workspaceId: string,
): Promise<void> {
  if (!supabase || !isWebflowConfigured()) return;
  const candidates = rows.filter((r) => r.webflow_item_id && r.status !== "published");
  if (!candidates.length) return;

  const live = await getPublishedItemDates();
  if (!live) return; // could not check; leave the stored status alone

  for (const row of candidates) {
    const publishedAt = live.get(row.webflow_item_id!);
    if (!publishedAt) continue;
    const { error } = await supabase
      .from("articles")
      .update({ status: "published", published_at: publishedAt })
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
    if (!error) {
      row.status = "published";
      row.published_at = publishedAt;
    }
  }
}

// GET /api/articles?format=&status= -> { articles: [...] }
export async function GET(request: NextRequest) {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format");

  // The status filter is applied AFTER reconciliation, otherwise a row that
  // Webflow says is live would be filtered out by its own stale status and never
  // get corrected.
  const status = searchParams.get("status");

  let query = supabase
    .from("articles")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (format) query = query.eq("format", format);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as ArticleRow[];
  await reconcileWithWebflow(rows, supabase, workspaceId);

  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  return NextResponse.json({ articles: filtered });
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
