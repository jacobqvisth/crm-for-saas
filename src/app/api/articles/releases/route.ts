// Scan Gmail for release announcements, and turn one into a staged article.
//
// GET  /api/articles/releases          -> { mailbox, releases: [...] }
// POST /api/articles/releases { messageId } -> { url, itemId, article }
//
// WHY GMAIL AND NOT CUSTOMER.IO
// The release announcement is a Customer.io broadcast, but reading broadcasts
// needs an App API key this deployment does not have (only the CDP *write* key
// exists). The CRM already holds gmail.readonly OAuth for the team's mailboxes
// for mailbox-sync, and every release is seeded to a wrenchlane.com address, so
// the mail itself is the cheapest reliable source.
//
// The import stages the CMS item and stops. Going live is the existing
// PublishToSite "Publish it live" action, which promotes the already-created
// item rather than writing a second one.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveArticlesWorkspace } from "@/lib/articles/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getValidAccessToken } from "@/lib/gmail/token-refresh";
import { extractHtmlBody, getHeader, type GmailPayload } from "@/lib/gmail/messages";
import {
  buildReleaseBodyHtml,
  looksLikeRelease,
  parseReleaseEmail,
  releaseImageUrls,
  releaseLanguage,
  releaseSlug,
  type ParsedRelease,
} from "@/lib/articles/release-mail";
import {
  articleUrl,
  createArticleItem,
  createLocalizedArticleItem,
  getSiteLocales,
  isWebflowConfigured,
  listCategories,
  listTags,
  updateArticleItemLocale,
  uploadAsset,
} from "@/lib/articles/webflow";
import { renderReleaseHero } from "@/lib/articles/og-image";
import { translateReleaseToSwedish } from "@/lib/articles/translate";

// Importing fetches and re-uploads several screenshots and renders a hero.
export const maxDuration = 120;

/** Marks the articles rows this feature owns, and keeps them out of the Studio's way. */
const SOURCE_KIND = "release_mail";

/** Where release mail lands. Overridable so a different seed address can be used. */
const DEFAULT_MAILBOX = process.env.RELEASE_MAIL_MAILBOX || "jacob@wrenchlane.com";

/**
 * Deliberately broad. Precision comes from looksLikeRelease(), which keys on the
 * Customer.io release campaign tag, because subject lines vary release to
 * release ("Introducing Ask WrenchLane", "WrenchLane 3.2 fast search and PDF
 * export") and matching on them would miss some.
 */
const DEFAULT_QUERY = process.env.RELEASE_MAIL_QUERY || "from:wrenchlane.com newer_than:2y";

/** How many of the newest matching mails to open. Each one is a Gmail API call. */
const MAX_MESSAGES = 40;

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

interface ReleaseCandidate {
  messageId: string;
  subject: string;
  from: string;
  receivedAt: string | null;
  version: string | null;
  title: string;
  lead: string | null;
  sectionCount: number;
  imageCount: number;
  hasVideo: boolean;
  /** A Swedish send of the same release exists, so the SV variant is human copy. */
  hasSwedishMail: boolean;
  /** Set when this release is already in the Library. */
  articleId: string | null;
  publishedUrl: string | null;
  status: string | null;
}

/** The mailbox to read, and a token for it. */
async function openMailbox(): Promise<
  { ok: true; email: string; token: string } | { ok: false; reason: string }
> {
  const admin = createServiceClient();
  const { data: accounts, error } = await admin
    .from("gmail_accounts")
    .select("id, email_address")
    .eq("status", "active")
    .order("email_address");

  if (error) return { ok: false, reason: `Could not read the mailbox list: ${error.message}` };
  if (!accounts?.length) return { ok: false, reason: "No Gmail account is connected to the CRM." };

  const chosen = accounts.find((a) => a.email_address === DEFAULT_MAILBOX) ?? accounts[0];
  const token = await getValidAccessToken(chosen.id);
  if (!token.accessToken) {
    return { ok: false, reason: `${chosen.email_address}: ${token.error ?? "no access token"}` };
  }
  return { ok: true, email: chosen.email_address, token: token.accessToken };
}

async function gmail<T>(token: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface FoundMail {
  messageId: string;
  subject: string;
  from: string;
  receivedAt: string | null;
  html: string;
  parsed: ParsedRelease;
  language: "en" | "sv";
}

/**
 * A forward of the broadcast, not the broadcast.
 *
 * Colleagues forward the release mail to each other minutes after it goes out,
 * and Gmail returns the newest copy first, so the naive "newest wins" dedup
 * picks the forward and files the article against a forward's message id.
 * Covers the Swedish client prefix too.
 */
const FORWARD_SUBJECT = /^\s*(fwd?|vb|vidarebefordrat)\b\s*:/i;

/** The bare address out of a From header. */
function senderAddress(from: string): string | null {
  return from.match(/<([^>]+)>/)?.[1]?.trim() ?? (from.includes("@") ? from.trim() : null);
}

/**
 * Newest release mails first, one per version PER LANGUAGE.
 *
 * The same broadcast reaches several seed addresses, so the raw list contains
 * near-duplicates. Keying on the version keeps the newest copy of each.
 *
 * The language belongs in the key: Customer.io sends the English and Swedish
 * releases as two broadcasts carrying the same version, so keying on version
 * alone threw one of them away, and which one it threw away depended on send
 * order. The Swedish mail is the Swedish variant's source, so losing it meant
 * silently falling back to machine translation.
 */
async function findReleases(token: string, limit = MAX_MESSAGES): Promise<FoundMail[]> {
  const list = await gmail<{ messages?: { id: string }[] }>(
    token,
    `/messages?q=${encodeURIComponent(DEFAULT_QUERY)}&maxResults=${limit}`,
  );
  if (!list?.messages?.length) return [];

  const byKey = new Map<string, FoundMail>();
  for (const { id } of list.messages) {
    const msg = await gmail<{ payload: GmailPayload; internalDate?: string }>(
      token,
      `/messages/${id}?format=full`,
    );
    if (!msg?.payload) continue;

    const html = extractHtmlBody(msg.payload);
    if (!html || !looksLikeRelease(html)) continue;
    const parsed = parseReleaseEmail(html);
    if (!parsed) continue;

    const headers = msg.payload.headers ?? [];
    const found: FoundMail = {
      messageId: id,
      subject: getHeader(headers, "subject"),
      from: getHeader(headers, "from"),
      receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
      html,
      parsed,
      language: releaseLanguage(html),
    };

    // Gmail returns newest first, so the first copy of a version wins, except
    // that a direct send always beats a forward of the same broadcast.
    const key = `${found.language}:${parsed.version ?? found.subject.toLowerCase()}`;
    const held = byKey.get(key);
    if (!held) byKey.set(key, found);
    else if (FORWARD_SUBJECT.test(held.subject) && !FORWARD_SUBJECT.test(found.subject)) {
      byKey.set(key, found);
    }
  }

  return [...byKey.values()];
}

/**
 * The Swedish send of the same release, if there is one.
 *
 * Scoped to the same sender and a day either side of the English mail: the two
 * broadcasts go out minutes apart, where a subject search would depend on
 * wording that changes every release. Returns null rather than throwing, so a
 * miss falls back to translation instead of failing the import.
 */
async function findSwedishCounterpart(
  token: string,
  english: { from: string; receivedAt: string | null; version: string | null; messageId: string },
): Promise<ParsedRelease | null> {
  const sender = senderAddress(english.from);
  if (!sender || !english.receivedAt) return null;

  const at = Date.parse(english.receivedAt);
  if (Number.isNaN(at)) return null;
  const DAY = 24 * 60 * 60 * 1000;
  const q = `from:${sender} after:${Math.floor((at - DAY) / 1000)} before:${Math.floor((at + DAY) / 1000)}`;

  const list = await gmail<{ messages?: { id: string }[] }>(
    token,
    `/messages?q=${encodeURIComponent(q)}&maxResults=25`,
  );
  if (!list?.messages?.length) return null;

  for (const { id } of list.messages) {
    if (id === english.messageId) continue;
    const msg = await gmail<{ payload: GmailPayload }>(token, `/messages/${id}?format=full`);
    if (!msg?.payload) continue;
    const html = extractHtmlBody(msg.payload);
    if (!html || !looksLikeRelease(html)) continue;
    if (releaseLanguage(html) !== "sv") continue;
    const parsed = parseReleaseEmail(html);
    // Same release, not the previous one that happens to sit in the window.
    if (!parsed || parsed.version !== english.version) continue;
    return parsed;
  }
  return null;
}

export async function GET() {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const mailbox = await openMailbox();
  if (!mailbox.ok) {
    return NextResponse.json({ error: mailbox.reason, configured: isWebflowConfigured() }, { status: 502 });
  }

  const all = await findReleases(mailbox.token);
  // Only the English send is offered for import: it is the article's source,
  // and the Swedish one is consumed as its translation rather than listed as a
  // second article to publish.
  const found = all.filter((f) => f.language === "en");
  const swedishVersions = new Set(
    all.filter((f) => f.language === "sv").map((f) => f.parsed.version ?? ""),
  );

  // Which of these are already in the Library, so the UI can say so rather than
  // offering to import a duplicate.
  const { data: existing } = await supabase
    .from("articles")
    .select("id, source_ref, published_url, status")
    .eq("workspace_id", workspaceId)
    .eq("source_kind", SOURCE_KIND);
  const bySourceRef = new Map((existing ?? []).map((a) => [a.source_ref, a]));

  const releases: ReleaseCandidate[] = found.map((f) => {
    const already = bySourceRef.get(f.messageId);
    return {
      messageId: f.messageId,
      subject: f.subject,
      from: f.from,
      receivedAt: f.receivedAt,
      version: f.parsed.version,
      title: f.parsed.title,
      lead: f.parsed.lead,
      sectionCount: f.parsed.sections.length,
      imageCount: releaseImageUrls(f.parsed).length,
      hasVideo: Boolean(f.parsed.videoId),
      hasSwedishMail: swedishVersions.has(f.parsed.version ?? ""),
      articleId: already?.id ?? null,
      publishedUrl: already?.published_url ?? null,
      status: already?.status ?? null,
    };
  });

  return NextResponse.json({
    mailbox: mailbox.email,
    query: DEFAULT_QUERY,
    configured: isWebflowConfigured(),
    releases,
  });
}

const importSchema = z.object({ messageId: z.string().min(1) });

/** Fetch one of the email's screenshots and put it on the Webflow CDN. */
async function hostImage(url: string, name: string): Promise<{ fileId: string; url: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "image/png";
    const ext = contentType.includes("jpeg") ? "jpg" : "png";
    const up = await uploadAsset(`${name}.${ext}`, bytes, contentType);
    return up.ok ? up.data : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId, userId } = ws;

  if (!isWebflowConfigured()) {
    return NextResponse.json(
      { error: "Webflow is not configured. WEBFLOW_API_TOKEN and WEBFLOW_SITE_ID must be set." },
      { status: 501 },
    );
  }

  const parsedBody = importSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { messageId } = parsedBody.data;

  // Importing the same mail twice would collide on the Webflow slug, and a slug
  // is not recoverable once its item has been published.
  const { data: dupe } = await supabase
    .from("articles")
    .select("id, published_url")
    .eq("workspace_id", workspaceId)
    .eq("source_kind", SOURCE_KIND)
    .eq("source_ref", messageId)
    .maybeSingle();
  if (dupe) {
    return NextResponse.json(
      { error: "This release is already in the Library.", articleId: dupe.id, url: dupe.published_url },
      { status: 409 },
    );
  }

  const mailbox = await openMailbox();
  if (!mailbox.ok) return NextResponse.json({ error: mailbox.reason }, { status: 502 });

  const msg = await gmail<{ payload: GmailPayload; internalDate?: string }>(
    mailbox.token,
    `/messages/${messageId}?format=full`,
  );
  if (!msg?.payload) return NextResponse.json({ error: "Could not read that email" }, { status: 404 });

  const html = extractHtmlBody(msg.payload);
  const parsed = html ? parseReleaseEmail(html) : null;
  if (!parsed) {
    return NextResponse.json({ error: "That email does not look like a release announcement" }, { status: 422 });
  }

  const headers = msg.payload.headers ?? [];
  const subject = getHeader(headers, "subject");
  const slug = releaseSlug(parsed);

  // Re-host the screenshots. Linking to Customer.io's asset host from a
  // permanent page would leave the article at the mercy of an email CDN.
  const sourceUrls = releaseImageUrls(parsed);
  const hosted = new Map<string, string>();
  const failedImages: string[] = [];
  for (const [i, url] of sourceUrls.entries()) {
    const up = await hostImage(url, `${slug}-${i + 1}`);
    if (up) hosted.set(url, up.url);
    else failedImages.push(url);
  }

  // The hero is built from the first screenshot, letterboxed to the 3:2 the
  // site's image containers crop to. Cosmetic, so a failure is recorded and
  // carried rather than failing the import.
  let image: { fileId: string; url: string } | null = null;
  let imageNote: string | null = null;
  const heroSource = hosted.get(sourceUrls[0]) ?? sourceUrls[0];
  if (heroSource) {
    try {
      const png = await renderReleaseHero({
        title: parsed.title,
        imageUrl: heroSource,
        version: parsed.version,
      });
      const up = await uploadAsset(`${slug}-hero.png`, png, "image/png");
      if (up.ok) image = up.data;
      else imageNote = up.reason;
    } catch (err) {
      imageNote = err instanceof Error ? err.message : String(err);
    }
  }

  const body = buildReleaseBodyHtml(parsed, hosted);

  // Look the taxonomy up by name rather than hardcoding ids, so a renamed or
  // rebuilt term does not silently file releases under nothing.
  const [categories, tags] = await Promise.all([listCategories(), listTags()]);
  const categoryIds = categories.filter((c) => /product updates/i.test(c.name)).map((c) => c.id);
  const tagIds = tags.filter((t) => /^release[-\s]?notes$/i.test(t.name)).map((t) => t.id);

  const metaTitle = parsed.version
    ? `WrenchLane ${parsed.version}: ${parsed.title}`.slice(0, 60)
    : parsed.title.slice(0, 60);
  const metaDescription = (parsed.lead ?? parsed.title).replace(/<[^>]+>/g, "").slice(0, 200);

  const english = {
    title: parsed.title,
    slug,
    body,
    bodyFormat: "html" as const,
    summary: metaDescription,
    metaTitle,
    metaDescription,
    categoryIds,
    tagIds,
    image,
  };

  /**
   * Create across every enabled locale in one call.
   *
   * This has to happen at creation time. Webflow's docs are explicit that a
   * locale cannot be added to an existing item through the API, and the only
   * remedy is a manual step in the Designer, which is exactly the hole the
   * first hand-made 3.7 article fell into. Every locale starts as a copy of the
   * English; the Swedish one is translated over immediately below.
   */
  const locales = await getSiteLocales();
  const secondaryIds = Object.values(locales?.secondary ?? {});
  const created =
    locales && secondaryIds.length
      ? await createLocalizedArticleItem(english, [locales.primary, ...secondaryIds])
      : await createArticleItem(english);
  if (!created.ok) return NextResponse.json({ error: created.reason }, { status: 502 });

  const url = articleUrl(created.data.slug);

  // Translate the secondary locales. A failure here is not fatal: the article
  // is already correct in English, and the Swedish variant exists and can be
  // written by hand or by re-running. Silently publishing English text on a
  // Swedish URL would be worse than saying it did not translate.
  const translations: Record<string, string> = {};
  const translationErrors: string[] = [];
  let swedishSource: "mail" | "translated" | null = null;
  const swedishLocaleId = locales?.secondary?.sv;
  if (swedishLocaleId) {
    // Prefer the Swedish broadcast over translating the English one. It is the
    // copy the company actually shipped to Swedish customers, so it carries the
    // house terminology ("lätta nyttofordon", not the model's "lätta
    // lastbilar") and needs no review. Translation stays the fallback for
    // releases that went out in English only.
    const svMail = await findSwedishCounterpart(mailbox.token, {
      from: getHeader(headers, "from"),
      receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
      version: parsed.version,
      messageId,
    });

    // The two broadcasts have so far shared their screenshots, so the English
    // pass has normally hosted them already. Anything unique to the Swedish
    // mail still has to be re-hosted, or that image would be the one thing on
    // the page left pointing at an email CDN.
    if (svMail) {
      for (const [i, src] of releaseImageUrls(svMail).entries()) {
        if (hosted.has(src)) continue;
        const up = await hostImage(src, `${slug}-sv-${i + 1}`);
        if (up) hosted.set(src, up.url);
        else failedImages.push(src);
      }
    }

    const sv = svMail
      ? {
          title: svMail.title,
          slug: releaseSlug(svMail),
          summary: (svMail.lead ?? svMail.title).replace(/<[^>]+>/g, "").slice(0, 200),
          // Same hosted-image map as the English body, so both locales point at
          // the copies on the Webflow CDN rather than at the email CDN.
          bodyHtml: buildReleaseBodyHtml(svMail, hosted),
        }
      : await translateReleaseToSwedish({
          title: parsed.title,
          summary: metaDescription,
          bodyHtml: body,
        });
    if (sv) swedishSource = svMail ? "mail" : "translated";

    if (!sv) {
      translationErrors.push("sv");
    } else {
      const written = await updateArticleItemLocale(created.data.id, swedishLocaleId, {
        title: sv.title,
        slug: sv.slug,
        body: sv.bodyHtml,
        bodyFormat: "html",
        summary: sv.summary,
        // Swedish articles on this site deliberately carry no meta fields; the
        // template falls back to name and post-summary. Empty string, not null:
        // Webflow drops a null from a PATCH body, so the English meta copied in
        // at creation survived and the Swedish page shipped English metadata.
        metaTitle: "",
        metaDescription: "",
        categoryIds,
        tagIds,
        image,
      });
      if (written.ok) translations.sv = sv.slug;
      else translationErrors.push(`sv: ${written.reason}`);
    }
  }

  // "approved" not "published": the item is in Webflow but not on the public
  // site. PublishToSite reads exactly this state and offers "Publish it live".
  const { data: row, error: insertError } = await supabase
    .from("articles")
    .insert({
      workspace_id: workspaceId,
      source_kind: SOURCE_KIND,
      source_ref: messageId,
      source_snapshot: {
        subject,
        version: parsed.version,
        mailbox: mailbox.email,
        receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
        videoId: parsed.videoId,
        images: sourceUrls.length,
        translations,
        translationErrors,
        swedishSource,
      },
      format: "blog_article",
      language: "en",
      title: parsed.title,
      body,
      seo: { metaTitle, metaDescription, slug: created.data.slug },
      status: "approved",
      published_url: url,
      webflow_item_id: created.data.id,
      created_by: userId,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json(
      {
        error: `Staged in Webflow but the CRM row failed: ${insertError.message}`,
        url,
        itemId: created.data.id,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    url,
    itemId: created.data.id,
    article: row,
    applied: {
      images: hosted.size,
      failedImages,
      video: Boolean(parsed.videoId),
      hero: Boolean(image),
      imageNote,
      translations,
      translationErrors,
      // "mail" means the Swedish came from the Swedish broadcast and needs no
      // language review; "translated" means a model wrote it and it does.
      swedishSource,
      categories: categoryIds.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean),
      tags: tagIds.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean),
    },
  });
}
