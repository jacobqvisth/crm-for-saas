import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveArticlesWorkspace } from "@/lib/articles/server";
import {
  articleUrl,
  createArticleItem,
  isWebflowConfigured,
  publishArticleItems,
} from "@/lib/articles/webflow";
import type { ArticleSeo } from "@/lib/articles/types";

export const maxDuration = 60;

const bodySchema = z.object({
  id: z.string().uuid(),
  /**
   * stage = create the CMS item but leave it off the public site
   * live  = create it and publish it to wrenchlane.com
   */
  mode: z.enum(["stage", "live"]).default("stage"),
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

  // Only long-form goes to the website CMS. A LinkedIn post or an X thread is
  // not a web article and would render as an orphan page.
  if (row.format !== "blog_article") {
    return NextResponse.json(
      { error: "Only blog articles can go to the website. Generate this as a blog article first." },
      { status: 422 },
    );
  }

  // The Articles collection is localized. Writing Swedish copy would have to
  // target the secondary CMS locale; publishing it into the English tree would
  // put Swedish text on an /en/ URL.
  if (row.language !== "en") {
    return NextResponse.json(
      { error: `Only English articles can be published for now (this one is "${row.language}").` },
      { status: 422 },
    );
  }

  if (!row.body?.trim()) {
    return NextResponse.json({ error: "This article has no body" }, { status: 422 });
  }

  if (row.published_url) {
    return NextResponse.json(
      { error: "This article was already sent to the website.", url: row.published_url },
      { status: 409 },
    );
  }

  const seo = (row.seo ?? {}) as Partial<ArticleSeo>;
  const title = row.title?.trim() || seo.metaTitle?.trim() || "Untitled";

  const created = await createArticleItem({
    title,
    slug: seo.slug?.trim() || title,
    body: row.body,
    summary: seo.metaDescription ?? null,
    metaTitle: seo.metaTitle ?? null,
    metaDescription: seo.metaDescription ?? null,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.reason }, { status: 502 });
  }

  let live = false;
  if (mode === "live") {
    const published = await publishArticleItems([created.data.id]);
    if (!published.ok) {
      // The item exists in the CMS at this point, so say so rather than implying
      // nothing happened. Jacob can publish it from Webflow.
      return NextResponse.json(
        {
          error: `Created in Webflow but publishing failed: ${published.reason}`,
          itemId: created.data.id,
          staged: true,
        },
        { status: 502 },
      );
    }
    live = true;
  }

  const url = articleUrl(created.data.slug);

  // Reuse the existing Library fields. Only a live publish counts as published;
  // a staged item is recorded as approved so the Library shows it moved on
  // without claiming it is public.
  const { data: updated, error: updateError } = await supabase
    .from("articles")
    .update({
      status: live ? "published" : "approved",
      published_url: url,
      ...(live ? { published_at: new Date().toISOString() } : {}),
    })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json(
      { error: `Sent to Webflow but could not update the CRM row: ${updateError.message}`, url, live },
      { status: 500 },
    );
  }

  return NextResponse.json({ url, itemId: created.data.id, live, article: updated });
}
