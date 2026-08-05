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

export interface WebflowArticleInput {
  /** Headline. Webflow's required `name`. */
  title: string;
  slug: string;
  /** Markdown body; converted to HTML here. */
  body: string;
  summary: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
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
          "post-body": markdownToWebflowHtml(input.body),
          ...(input.summary ? { "post-summary": stripLongDashes(decodeStrayUnicodeEscapes(input.summary)) } : {}),
          ...(input.metaTitle ? { "meta-title": stripLongDashes(decodeStrayUnicodeEscapes(input.metaTitle)) } : {}),
          ...(input.metaDescription
            ? { "meta-description": stripLongDashes(decodeStrayUnicodeEscapes(input.metaDescription)) }
            : {}),
        },
      },
    },
  );

  if (!res.ok) return res;
  return { ok: true, data: { id: res.data.id, slug: res.data.fieldData?.slug ?? slug } };
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
