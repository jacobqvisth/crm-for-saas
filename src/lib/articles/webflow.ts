// Publishing an article to wrenchlane.com.
//
// wrenchlane.com is a Webflow site (id in WEBFLOW_SITE_ID). Articles live in the
// "Articles" CMS collection and render at /en/article/<slug>. This module creates
// a CMS item from a stored draft and, optionally, publishes that item live.
//
// TWO SAFETY DECISIONS WORTH KNOWING
//
// 1. We publish ITEMS, never the SITE. The Webflow API also exposes a
//    publish-site call, which pushes every staged change on the site live,
//    including unrelated design work someone may have in progress in the
//    Designer. That would make this button capable of shipping things nobody
//    asked it to ship. publishItems() only ever calls the per-item endpoint.
//
// 2. Staged by default. createItem() creates the item without publishing it, so
//    the default path is reversible and invisible to the public. Going live is a
//    separate explicit call, which the UI gates behind a confirmation.
//
// Scope: English only for now. The collection is localized (items carry a
// cmsLocaleId) and writing a Swedish article means targeting the secondary
// locale, which is a separate job. The API route rejects non-English drafts
// rather than silently publishing Swedish copy into the English tree.

import { marked } from "marked";
import { stripLongDashes } from "@/lib/ai/no-long-dash";
import { decodeStrayUnicodeEscapes } from "./sanitize";

const API = "https://api.webflow.com/v2";
const ARTICLES_COLLECTION_ID = "695df5781f6fd2cc0d58cc14";

/** Where a published English article ends up. */
export function articleUrl(slug: string): string {
  return `https://wrenchlane.com/en/article/${slug}`;
}

/**
 * Both vars are required even though only the token goes on the wire.
 *
 * ARTICLES_COLLECTION_ID above is specific to the wrenchlane.com site, so a token
 * belonging to a different Webflow site would fail confusingly at the API.
 * Requiring WEBFLOW_SITE_ID, and checking it against the expected value, makes
 * "this deployment is wired to that site" an explicit, checkable statement and
 * catches a mismatch here instead of as a 404 from Webflow.
 */
const EXPECTED_SITE_ID = "6949978e26b3c3fc2873440d";

export function isWebflowConfigured(): boolean {
  return Boolean(
    process.env.WEBFLOW_API_TOKEN && process.env.WEBFLOW_SITE_ID === EXPECTED_SITE_ID,
  );
}

type WebflowResult<T> = { ok: true; data: T } | { ok: false; reason: string };

async function call<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<WebflowResult<T>> {
  const token = process.env.WEBFLOW_API_TOKEN;
  if (!token) return { ok: false, reason: "WEBFLOW_API_TOKEN is not set" };

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "accept-version": "2.0.0",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    return { ok: false, reason: `Could not reach Webflow: ${err instanceof Error ? err.message : String(err)}` };
  }

  const text = await res.text();
  if (!res.ok) {
    // Webflow returns a JSON body with message/details; surface it rather than a
    // bare status, since slug conflicts and validation errors are the common case.
    let detail = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text) as { message?: string; details?: unknown };
      if (parsed.message) {
        detail = parsed.message;
        if (parsed.details) detail += ` (${JSON.stringify(parsed.details).slice(0, 200)})`;
      }
    } catch {
      // keep the raw text
    }
    return { ok: false, reason: `Webflow ${res.status}: ${detail}` };
  }

  try {
    return { ok: true, data: (text ? JSON.parse(text) : {}) as T };
  } catch {
    return { ok: false, reason: "Webflow returned a response we could not parse" };
  }
}

/**
 * Markdown to the HTML Webflow's rich-text field expects.
 *
 * The existing live articles are plain HTML: h1/h3/h4, p, strong, figure for
 * media. Our blog drafts are Markdown, so convert at publish time and keep the
 * stored body canonical. `gfm` covers the tables the data-insight articles use.
 */
export function markdownToWebflowHtml(markdown: string): string {
  // decode first: rows generated before the generator-side fix still carry
  // literal \uXXXX sequences, and they must not reach the published page.
  const html = marked.parse(stripLongDashes(decodeStrayUnicodeEscapes(markdown)), {
    gfm: true,
    breaks: false,
    async: false,
  }) as string;
  return html.trim();
}

/**
 * Webflow slugs must be alphanumeric with hyphens. The model supplies one, but
 * it can arrive with stray punctuation or the wrong case, and a bad slug is a
 * 400 from the API rather than something we want to discover at publish time.
 */
export function normalizeSlug(raw: string, fallback: string): string {
  const base = (raw || fallback)
    .toLowerCase()
    .normalize("NFKD")
    // Strip diacritics so a Swedish-ish title still yields an ASCII slug.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200)
    .replace(/-+$/g, "");
  return base || "article";
}

/**
 * Sanitised rich-text HTML, straight through.
 *
 * Release articles are assembled as Webflow rich-text HTML already, because
 * their figure markup (w-richtext-figure-type-image / -video) has no Markdown
 * equivalent. Running that through the Markdown converter mangles it, so those
 * callers pass bodyFormat "html". The two sanitisers still apply: they are what
 * keep stray \uXXXX escapes and long dashes off the site.
 */
export function sanitizeWebflowHtml(html: string): string {
  return stripLongDashes(decodeStrayUnicodeEscapes(html)).trim();
}

export interface WebflowArticleInput {
  /** Headline. Webflow's required `name`. */
  title: string;
  slug: string;
  /** Markdown by default; already-built rich-text HTML when bodyFormat is "html". */
  body: string;
  /** Defaults to "markdown", which is what the generated drafts are. */
  bodyFormat?: "markdown" | "html";
  summary: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  /** Category and tag item ids, chosen at publish time. */
  categoryIds?: string[];
  tagIds?: string[];
  /** An already-uploaded asset, used for both the hero and the grid thumbnail. */
  image?: { fileId: string; url: string } | null;
}

export interface CreatedItem {
  id: string;
  slug: string;
}

/**
 * Create the CMS item. Staged, not live: it exists in the collection but is not
 * on the public site until publishItems() runs.
 */
export async function createArticleItem(
  input: WebflowArticleInput,
): Promise<WebflowResult<CreatedItem>> {
  const slug = normalizeSlug(input.slug, input.title);

  const res = await call<{ id: string; fieldData?: { slug?: string } }>(
    `/collections/${ARTICLES_COLLECTION_ID}/items`,
    {
      method: "POST",
      body: {
        isArchived: false,
        // Not a Webflow "Draft" (which would hide it even after publishing).
        // Staged-but-publishable is what we want.
        isDraft: false,
        fieldData: {
          name: stripLongDashes(decodeStrayUnicodeEscapes(input.title)).slice(0, 256),
          slug,
          "post-body":
            input.bodyFormat === "html"
              ? sanitizeWebflowHtml(input.body)
              : markdownToWebflowHtml(input.body),
          ...(input.summary ? { "post-summary": stripLongDashes(decodeStrayUnicodeEscapes(input.summary)) } : {}),
          ...(input.metaTitle ? { "meta-title": stripLongDashes(decodeStrayUnicodeEscapes(input.metaTitle)) } : {}),
          ...(input.metaDescription
            ? { "meta-description": stripLongDashes(decodeStrayUnicodeEscapes(input.metaDescription)) }
            : {}),
          ...(input.categoryIds?.length ? { category: input.categoryIds } : {}),
          ...(input.tagIds?.length ? { tags: input.tagIds } : {}),
          // One asset serves both fields, which is what the hand-authored
          // articles on the site already do.
          ...(input.image
            ? {
                "main-image": { fileId: input.image.fileId, url: input.image.url },
                "thumbnail-image": { fileId: input.image.fileId, url: input.image.url },
              }
            : {}),
        },
      },
    },
  );

  if (!res.ok) return res;
  return { ok: true, data: { id: res.data.id, slug: res.data.fieldData?.slug ?? slug } };
}

/* ------------------------------------------------- taxonomy (read-only) */

const CATEGORIES_COLLECTION_ID = "695f7988a6bf5c9a8afb9e03";
const TAGS_COLLECTION_ID = "695fd07354229bcbcb3ea650";

export interface TaxonomyTerm {
  id: string;
  name: string;
  /** Categories carry a description, which sharpens the model's choice a lot. */
  description?: string | null;
}

interface ItemsResponse {
  items: { id: string; fieldData?: { name?: string; description?: string | null } }[];
}

async function listTerms(collectionId: string, limit: number): Promise<TaxonomyTerm[]> {
  const res = await call<ItemsResponse>(`/collections/${collectionId}/items?limit=${limit}`, {
    method: "GET",
  });
  if (!res.ok) return [];
  return res.data.items
    .map((i) => ({
      id: i.id,
      name: i.fieldData?.name ?? "",
      description: i.fieldData?.description ?? null,
    }))
    .filter((t) => t.name);
}

/** The site's article categories, with descriptions. */
export function listCategories(): Promise<TaxonomyTerm[]> {
  return listTerms(CATEGORIES_COLLECTION_ID, 100);
}

/**
 * Which article items are actually live, keyed by item id.
 *
 * The CRM is not the only thing that can publish. A full site publish in the
 * Webflow Designer flushes every staged CMS item, and someone can publish a
 * single item by hand. When that happens the CRM's stored status silently goes
 * stale, which is how a live article ended up showing "In Webflow, not public".
 * So the Library reconciles against this rather than trusting what it wrote.
 *
 * Returns null on failure, so callers can tell "not published" apart from
 * "could not check".
 */
export async function getPublishedItemDates(): Promise<Map<string, string> | null> {
  const res = await call<{ items: { id: string; lastPublished?: string | null }[] }>(
    `/collections/${ARTICLES_COLLECTION_ID}/items?limit=100`,
    { method: "GET" },
  );
  if (!res.ok) return null;
  const map = new Map<string, string>();
  for (const item of res.data.items) {
    if (item.lastPublished) map.set(item.id, item.lastPublished);
  }
  return map;
}

/**
 * The site's tag vocabulary. Existing tags only, deliberately: inventing a tag
 * creates a thin taxonomy page with one article on it that nobody maintains.
 */
export function listTags(): Promise<TaxonomyTerm[]> {
  return listTerms(TAGS_COLLECTION_ID, 100);
}

/* --------------------------------------------------------- asset upload */

/**
 * Upload a generated image and return the reference an Image field expects.
 *
 * Webflow's asset flow is two hops: register the file, which returns a presigned
 * S3 POST, then send the bytes to S3 with the returned form fields. Only after
 * that does the asset exist, and the CMS field then takes { fileId, url }.
 */
export async function uploadAsset(
  fileName: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<WebflowResult<{ fileId: string; url: string }>> {
  const siteId = process.env.WEBFLOW_SITE_ID;
  if (!siteId) return { ok: false, reason: "WEBFLOW_SITE_ID is not set" };

  // Webflow wants an md5 of the payload up front, for dedupe and verification.
  const { createHash } = await import("node:crypto");
  const fileHash = createHash("md5").update(bytes).digest("hex");

  const reg = await call<{
    id: string;
    hostedUrl?: string;
    assetUrl?: string;
    uploadUrl: string;
    uploadDetails: Record<string, string>;
  }>(`/sites/${siteId}/assets`, { method: "POST", body: { fileName, fileHash } });
  if (!reg.ok) return reg;

  const form = new FormData();
  for (const [k, v] of Object.entries(reg.data.uploadDetails ?? {})) form.append(k, v);
  // The file part must be named "file" and must come last in a presigned S3 POST.
  // Copy into a plain ArrayBuffer: a Uint8Array can be backed by a
  // SharedArrayBuffer, which BlobPart does not accept.
  form.append("file", new Blob([bytes.slice().buffer as ArrayBuffer], { type: contentType }), fileName);

  let s3: Response;
  try {
    s3 = await fetch(reg.data.uploadUrl, { method: "POST", body: form });
  } catch (err) {
    return {
      ok: false,
      reason: `Asset upload failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!s3.ok) {
    const detail = (await s3.text()).slice(0, 200);
    return { ok: false, reason: `Asset upload rejected (${s3.status}): ${detail}` };
  }

  return {
    ok: true,
    data: { fileId: reg.data.id, url: reg.data.hostedUrl ?? reg.data.assetUrl ?? "" },
  };
}

/**
 * Update an existing item in place.
 *
 * This is the ONLY safe way to change something already published. Deleting a
 * published item removes it from the CMS but keeps its slug reserved and its page
 * live, so delete-and-recreate fails on the slug and orphans the live page. The
 * slug is deliberately not updatable here, because changing it breaks the URL.
 */
export async function updateArticleItem(
  itemId: string,
  input: Omit<WebflowArticleInput, "slug">,
): Promise<WebflowResult<{ id: string }>> {
  const res = await call<{ id: string }>(
    `/collections/${ARTICLES_COLLECTION_ID}/items/${itemId}`,
    {
      method: "PATCH",
      body: {
        isArchived: false,
        isDraft: false,
        fieldData: {
          name: stripLongDashes(decodeStrayUnicodeEscapes(input.title)).slice(0, 256),
          "post-body":
            input.bodyFormat === "html"
              ? sanitizeWebflowHtml(input.body)
              : markdownToWebflowHtml(input.body),
          ...(input.summary
            ? { "post-summary": stripLongDashes(decodeStrayUnicodeEscapes(input.summary)) }
            : {}),
          ...(input.metaTitle
            ? { "meta-title": stripLongDashes(decodeStrayUnicodeEscapes(input.metaTitle)) }
            : {}),
          ...(input.metaDescription
            ? {
                "meta-description": stripLongDashes(
                  decodeStrayUnicodeEscapes(input.metaDescription),
                ),
              }
            : {}),
          ...(input.categoryIds?.length ? { category: input.categoryIds } : {}),
          ...(input.tagIds?.length ? { tags: input.tagIds } : {}),
          ...(input.image
            ? {
                "main-image": { fileId: input.image.fileId, url: input.image.url },
                "thumbnail-image": { fileId: input.image.fileId, url: input.image.url },
              }
            : {}),
        },
      },
    },
  );
  if (!res.ok) return res;
  return { ok: true, data: { id: res.data.id ?? itemId } };
}

/**
 * Push specific items live. Deliberately the per-item endpoint: see the note at
 * the top of this file about never publishing the whole site.
 */
export async function publishArticleItems(
  itemIds: string[],
): Promise<WebflowResult<{ publishedItemIds?: string[] }>> {
  if (!itemIds.length) return { ok: false, reason: "No items to publish" };
  return call<{ publishedItemIds?: string[] }>(
    `/collections/${ARTICLES_COLLECTION_ID}/items/publish`,
    { method: "POST", body: { itemIds } },
  );
}
