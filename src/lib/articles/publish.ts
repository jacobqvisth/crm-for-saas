// Taking a stored article row and putting it on wrenchlane.com.
//
// This is the body of POST /api/articles/publish, lifted out so the Autopilot
// cron can reuse it. There must be exactly one implementation of "publish an
// article": the classify step, the hero render, the slug rules and the
// already-live guards are all things that go subtly wrong when duplicated, and
// a second copy would drift the moment either caller was touched.
//
// The route stays a thin wrapper that forwards `status` and `error` straight
// out, so the HTTP contract it had before this extraction is unchanged.

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyArticle } from "./classify";
import { pickBadge, renderArticleImage } from "./og-image";
import { checkVehicleClaims } from "./vehicle-guard";
import type { ArticleSeo } from "./types";
import {
  articleUrl,
  createArticleItem,
  listCategories,
  listTags,
  publishArticleItems,
  updateArticleItem,
  uploadAsset,
  type TaxonomyTerm,
} from "./webflow";

export type PublishMode = "stage" | "live" | "resync";

/** Just the columns publishing reads. Keeps this off the generated DB types. */
export interface PublishableArticleRow {
  id: string;
  format: string;
  language: string;
  title: string | null;
  body: string | null;
  seo: unknown;
  source_kind: string | null;
  source_snapshot: unknown;
  status: string | null;
  published_url: string | null;
  webflow_item_id: string | null;
}

export interface PublishOptions {
  // The generated Supabase types do not survive being passed around structurally,
  // and this module only ever touches the `articles` table by name.
  supabase: SupabaseClient<any, any, any>;
  workspaceId: string;
  row: PublishableArticleRow;
  mode: PublishMode;
  /**
   * Restrict the classifier to these category names. Autopilot uses it to keep
   * unattended articles out of categories that need a human (Product Updates,
   * Industry & Trends). Empty or absent means the whole taxonomy is fair game.
   */
  allowedCategories?: string[];
  /** Tag names always applied, on top of whatever the classifier chooses. */
  extraTagNames?: string[];
}

export interface PublishApplied {
  categories?: (string | undefined)[];
  tags?: (string | undefined)[];
  image?: boolean;
  imageNote?: string | null;
  promotedExisting?: boolean;
}

export type PublishResult =
  | {
      ok: true;
      url: string;
      itemId: string;
      live: boolean;
      article: unknown;
      applied: PublishApplied;
    }
  | {
      ok: false;
      status: number;
      error: string;
      /** Merged into the JSON body, so the route keeps returning `url`/`itemId`. */
      extra?: Record<string, unknown>;
    };

/** Case-insensitive name match against a taxonomy list. */
function idsByName(terms: TaxonomyTerm[], names: string[]): string[] {
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return [];
  return terms.filter((t) => wanted.has(t.name.trim().toLowerCase())).map((t) => t.id);
}

export async function publishArticleRow(opts: PublishOptions): Promise<PublishResult> {
  const { supabase, workspaceId, row, mode } = opts;

  // Only long-form goes to the website CMS. A LinkedIn post or an X thread is
  // not a web article and would render as an orphan page.
  if (row.format !== "blog_article") {
    return {
      ok: false,
      status: 422,
      error: "Only blog articles can go to the website. Generate this as a blog article first.",
    };
  }

  // The Articles collection is localized. Writing Swedish copy would have to
  // target the secondary CMS locale; publishing it into the English tree would
  // put Swedish text on an /en/ URL.
  if (row.language !== "en") {
    return {
      ok: false,
      status: 422,
      error: `Only English articles can be published for now (this one is "${row.language}").`,
    };
  }

  if (!row.body?.trim()) {
    return { ok: false, status: 422, error: "This article has no body" };
  }

  if (mode === "resync" && !row.webflow_item_id) {
    return {
      ok: false,
      status: 422,
      error: "This article is not on the site yet, so there is nothing to resync.",
    };
  }

  // Already on the site and live: nothing to do, unless the caller explicitly
  // asked to resync it.
  if (mode !== "resync" && row.status === "published" && row.published_url) {
    return {
      ok: false,
      status: 409,
      error: "This article is already live on the website.",
      extra: { url: row.published_url },
    };
  }

  // Already staged in Webflow. Going live must publish THAT item, not create a
  // second one, which would collide on the slug. This is why webflow_item_id
  // exists.
  if (mode !== "resync" && row.webflow_item_id && row.published_url) {
    if (mode === "stage") {
      return {
        ok: false,
        status: 409,
        error: "This article is already staged in Webflow.",
        extra: { url: row.published_url },
      };
    }
    const published = await publishArticleItems([row.webflow_item_id]);
    if (!published.ok) return { ok: false, status: 502, error: published.reason };

    const { data: nowLive, error: liveErr } = await supabase
      .from("articles")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();
    if (liveErr) {
      return {
        ok: false,
        status: 500,
        error: `Published on the site but the CRM row did not update: ${liveErr.message}`,
      };
    }
    return {
      ok: true,
      url: row.published_url,
      itemId: row.webflow_item_id,
      live: true,
      article: nowLive,
      applied: { promotedExisting: true },
    };
  }

  const seo = (row.seo ?? {}) as Partial<ArticleSeo>;
  const title = row.title?.trim() || seo.metaTitle?.trim() || "Untitled";
  const summary = seo.metaDescription ?? null;

  /**
   * Refuse to publish an invented vehicle.
   *
   * Checked here rather than at generation time so it guards every route to the
   * site, the Studio button and the Autopilot cron alike, and so a resync cannot
   * quietly push a bad body over a good one. The draft stays in the Library, so
   * this loses nothing but the publish. See vehicle-guard.ts for why a prompt
   * rule alone was not enough.
   */
  const vehicleCheck = checkVehicleClaims({
    sourceKind: row.source_kind,
    snapshot: (row.source_snapshot ?? null) as { carMake?: string | null; carModel?: string | null } | null,
    title: row.title,
    body: row.body,
  });
  if (!vehicleCheck.ok) {
    return {
      ok: false,
      status: 422,
      error: vehicleCheck.reason!,
      extra: { offences: vehicleCheck.offences },
    };
  }

  /**
   * Release articles are imported by /api/articles/releases, which already
   * assembled the body as Webflow rich-text HTML, filed it under Product
   * Updates and built a hero from a real screenshot. Re-running the generic
   * pipeline over one would run its HTML through the Markdown converter and
   * replace the screenshot hero with a drawn card, so this path leaves all
   * three alone. Reachable via the Re-sync button once a release is live.
   */
  const isRelease = row.source_kind === "release_mail";

  // Everything below is done at publish time, on purpose: it is wasted work for
  // the many drafts that never get published, and the taxonomy is read live from
  // Webflow so it cannot go stale in a prompt.
  const [categories, tags] = await Promise.all([listCategories(), listTags()]);

  // Autopilot narrows the classifier's choices. Falling back to the full list
  // when the filter matches nothing is deliberate: a typo in a settings field
  // should not silently publish every article with no category at all.
  const allowed = opts.allowedCategories?.length
    ? categories.filter((c) =>
        opts.allowedCategories!.some((n) => n.trim().toLowerCase() === c.name.trim().toLowerCase()),
      )
    : categories;
  const classifyAgainst = allowed.length ? allowed : categories;

  const classified = isRelease
    ? {
        categoryIds: categories.filter((c) => /product updates/i.test(c.name)).map((c) => c.id),
        tagIds: tags.filter((t) => /^release[-\s]?notes$/i.test(t.name)).map((t) => t.id),
      }
    : await classifyArticle({
        title,
        summary,
        body: row.body,
        categories: classifyAgainst,
        tags,
      });

  // Forced tags ride on top of the classifier's picks. This is what marks an
  // article as machine-published on the public site.
  const forcedTagIds = idsByName(tags, opts.extraTagNames ?? []);
  const tagIds = [...new Set([...classified.tagIds, ...forcedTagIds])];

  // The hero image. A drawn card rather than a generated photo, because there is
  // no image-model credential on this project; see src/lib/articles/og-image.tsx.
  const snapshot = (row.source_snapshot ?? {}) as {
    dtcs?: string[];
    carMake?: string | null;
    carModel?: string | null;
    carYear?: number | null;
  };
  const kicker = categories.find((c) => c.id === classified.categoryIds[0])?.name ?? null;
  const vehicle = [snapshot.carYear, snapshot.carMake, snapshot.carModel].filter(Boolean).join(" ");
  const { badge } = pickBadge({ dtcs: snapshot.dtcs ?? null, title, summary });

  let image: { fileId: string; url: string } | null = null;
  let imageNote: string | null = null;
  // A release already has a screenshot hero. Leaving image null means
  // updateArticleItem omits the field, so the existing one survives.
  if (!isRelease) {
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
  }

  const fields = {
    title,
    body: row.body,
    bodyFormat: (isRelease ? "html" : "markdown") as "html" | "markdown",
    summary,
    metaTitle: seo.metaTitle ?? null,
    metaDescription: seo.metaDescription ?? null,
    categoryIds: classified.categoryIds,
    tagIds,
    image,
  };

  // resync updates the existing item, everything else creates a new one. The
  // slug is never changed on a resync: it is the live URL.
  const written =
    mode === "resync"
      ? await updateArticleItem(row.webflow_item_id!, fields)
      : await createArticleItem({ ...fields, slug: seo.slug?.trim() || title });
  if (!written.ok) return { ok: false, status: 502, error: written.reason };

  const itemId = mode === "resync" ? row.webflow_item_id! : (written.data as { id: string }).id;

  let live = mode === "resync" && row.status === "published";
  if (mode === "live" || mode === "resync") {
    const published = await publishArticleItems([itemId]);
    if (!published.ok) {
      // The item exists in the CMS at this point, so say so rather than implying
      // nothing happened. Jacob can publish it from Webflow.
      return {
        ok: false,
        status: 502,
        error: `Written to Webflow but publishing failed: ${published.reason}`,
        extra: { itemId, staged: true },
      };
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
    .eq("id", row.id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (updateError) {
    return {
      ok: false,
      status: 500,
      error: `Sent to Webflow but could not update the CRM row: ${updateError.message}`,
      extra: { url, live },
    };
  }

  return {
    ok: true,
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
      tags: tagIds.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean),
      image: Boolean(image),
      imageNote,
    },
  };
}
