import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveArticlesWorkspace } from "@/lib/articles/server";
import { isWebflowConfigured } from "@/lib/articles/webflow";
import { publishArticleRow } from "@/lib/articles/publish";

// Publishing also classifies the article and renders plus uploads a hero image,
// so it needs more headroom than a bare CMS write.
export const maxDuration = 120;

const bodySchema = z.object({
  id: z.string().uuid(),
  /**
   * stage  = create the CMS item but leave it off the public site
   * live   = create it and publish it to wrenchlane.com
   * resync = the item already exists: refresh its fields, image and taxonomy in
   *          place and republish. The only safe way to change something already
   *          published, since deleting a published item reserves its slug.
   */
  mode: z.enum(["stage", "live", "resync"]).default("stage"),
});

// GET /api/articles/publish -> { configured: boolean }
// Lets the UI grey the button out with a reason instead of failing on click.
export async function GET() {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  return NextResponse.json({ configured: isWebflowConfigured() });
}

// POST /api/articles/publish -> { url, itemId, live }
export async function POST(request: NextRequest) {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  if (!isWebflowConfigured()) {
    return NextResponse.json(
      { error: "Webflow is not configured. WEBFLOW_API_TOKEN and WEBFLOW_SITE_ID must be set." },
      { status: 501 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { id, mode } = parsed.data;

  const { data: row, error: readError } = await supabase
    .from("articles")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (readError || !row) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  // The whole publish pipeline lives in src/lib/articles/publish.ts so the
  // Autopilot cron runs exactly the same code path this button does.
  const result = await publishArticleRow({ supabase, workspaceId, row, mode });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...(result.extra ?? {}) }, { status: result.status });
  }

  return NextResponse.json({
    url: result.url,
    itemId: result.itemId,
    live: result.live,
    article: result.article,
    applied: result.applied,
  });
}
