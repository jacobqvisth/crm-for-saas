import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveArticlesWorkspace } from "@/lib/articles/server";
import {
  articleUrl,
  createArticleItem,
  isWebflowConfigured,
  listCategories,
  listTags,
  publishArticleItems,
  updateArticleItem,
  uploadAsset,
} from "@/lib/articles/webflow";
import { classifyArticle } from "@/lib/articles/classify";
import { pickBadge, renderArticleImage } from "@/lib/articles/og-image";
import type { ArticleSeo } from "@/lib/articles/types";

// Publishing now also classifies the article and renders plus uploads a hero
// image, so it needs more headroom than a bare CMS write.
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

  if (mode === "resync" && !row.webflow_item_id) {
    return NextResponse.json(
      { error: "This article is not on the site yet, so there is nothing to resync." },
      { status: 422 },
    );
  }

  // Already on the site and live: nothing to do, unless the caller explicitly
  // asked to resync it.
  if (mode !== "resync" && row.status === "published" && row.published_url) {
    return NextResponse.json(
      { error: "This article is already live on the website.", url: row.published_url },
      { status: 409 },
    );
  }

  // Already staged in Webflow. Going live must publish THAT item, not create a
  // second one, which would collide on the slug. This is why webflow_item_id
  // exists.
  if (mode !== "resync" && row.webflow_item_id && row.published_url) {
    if (mode === "stage") {
      return NextResponse.json(
        { error: "This article is already staged in Webflow.", url: row.published_url },
        { status: 409 },
      );
    }
    const published = await publishArticleItems([row.webflow_item_id]);
    if (!published.ok) {
      return NextResponse.json({ error: published.reason }, { status: 502 });
    }
    const { data: nowLive, error: liveErr } = await supabase
      .from("articles")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();
    if (liveErr) {
      return NextResponse.json(
        { error: `Published on the site but the CRM row did not update: ${liveErr.message}` },
        { status: 500 },
      );
    }
    return NextResponse.json({
      url: row.published_url,
      itemId: row.webflow_item_id,
      live: true,
      article: nowLive,
      applied: { promotedExisting: true },
    });
  }

  const seo = (row.seo ?? {}) as Partial<ArticleSeo>;
  const title = row.title?.trim() || seo.metaTitle?.trim() || "Untitled";
  const summary = seo.metaDescription ?? null;

  // Everything below is done at publish time, on purpose: it is wasted work for
  // the many drafts that never get published, and the taxonomy is read live from
  // Webflow so it cannot go stale in a prompt.
  const [categories, tags] = await Promise.all([listCategories(), listTags()]);
  const classified = await classifyArticle({
    title,
    summary,
    body: row.body,
    categories,
    tags,
  });

  // The hero image. A drawn card rather than a generated photo, because there is
  // no image-model credential on this project; see src/lib/articles/og-image.tsx.
  const snapshot = (row.source_snapshot ?? {}) as { dtcs?: string[]; carMake?: string | null; carModel?: string | null; carYear?: number | null };
  const kicker = categories.find((c) => c.id === classified.categoryIds[0])?.name ?? null;
  const vehicle = [snapshot.carYear, snapshot.carMake, snapshot.carModel].filter(Boolean).join(" ");
  const { badge } = pickBadge({ dtcs: snapshot.dtcs ?? null, title, summary });

  let image: { fileId: string; url: string } | null = null;
  let imageNote: string | null = null;
  try {
    const png = await renderArticleImage({
      title,
      badge,
      context: vehicle || null,
      kicker,
    });
    const upload = await uploadAsset(`${seo.slug?.trim() || "article"}-hero.png`, png, "image/png");
    if (upload.ok) image = upload.data;
    else imageNote = upload.reason;
  } catch (err) {
    // A missing image is cosmetic. Failing the publish over it would be worse,
    // so record why and carry on.
    imageNote = err instanceof Error ? err.message : String(err);
  }

  const fields = {
    title,
    body: row.body,
    summary,
    metaTitle: seo.metaTitle ?? null,
    metaDescription: seo.metaDescription ?? null,
    categoryIds: classified.categoryIds,
    tagIds: classified.tagIds,
    image,
  };

  // resync updates the existing item, everything else creates a new one. The
  // slug is never changed on a resync: it is the live URL.
  const written =
    mode === "resync"
      ? await updateArticleItem(row.webflow_item_id!, fields)
      : await createArticleItem({ ...fields, slug: seo.slug?.trim() || title });
  if (!written.ok) {
    return NextResponse.json({ error: written.reason }, { status: 502 });
  }
  const itemId = mode === "resync" ? row.webflow_item_id! : (written.data as { id: string }).id;

  let live = mode === "resync" && row.status === "published";
  if (mode === "live" || mode === "resync") {
    const published = await publishArticleItems([itemId]);
    if (!published.ok) {
      // The item exists in the CMS at this point, so say so rather than implying
      // nothing happened. Jacob can publish it from Webflow.
      return NextResponse.json(
        {
          error: `Written to Webflow but publishing failed: ${published.reason}`,
          itemId,
          staged: true,
        },
        { status: 502 },
      );
    }
    live = true;
  }

  const url =
    mode === "resync"
      ? row.published_url!
      : articleUrl((written.data as { slug?: string }).slug ?? seo.slug ?? "");

  // Reuse the existing Library fields. Only a live publish counts as published;
  // a staged item is recorded as approved so the Library shows it moved on
  // without claiming it is public.
  const { data: updated, error: updateError } = await supabase
    .from("articles")
    .update({
      status: live ? "published" : "approved",
      published_url: url,
      webflow_item_id: itemId,
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

  return NextResponse.json({
    url,
    itemId,
    live,
    article: updated,
    // Surfaced so the toast can say what actually got attached, rather than
    // implying an image and category that silently failed.
    applied: {
      categories: classified.categoryIds
        .map((id) => categories.find((c) => c.id === id)?.name)
        .filter(Boolean),
      tags: classified.tagIds.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean),
      image: Boolean(image),
      imageNote,
    },
  });
}
