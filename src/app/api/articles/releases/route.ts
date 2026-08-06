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
  releaseSlug,
  type ParsedRelease,
} from "@/lib/articles/release-mail";
import {
  articleUrl,
  createArticleItem,
  isWebflowConfigured,
  listCategories,
  listTags,
  uploadAsset,
} from "@/lib/articles/webflow";
import { renderReleaseHero } from "@/lib/articles/og-image";

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
}

/**
 * Newest release mails first, one per version.
 *
 * The same broadcast reaches several seed addresses, so the raw list contains
 * near-duplicates. Keying on the version keeps the newest copy of each.
 */
async function findReleases(token: string, limit = MAX_MESSAGES): Promise<FoundMail[]> {
  const list = await gmail<{ messages?: { id: string }[] }>(
    token,
    `/messages?q=${encodeURIComponent(DEFAULT_QUERY)}&maxResults=${limit}`,
  );
  if (!list?.messages?.length) return [];

  const byVersion = new Map<string, FoundMail>();
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
    };

    // Gmail returns newest first, so the first copy of a version wins.
    const key = parsed.version ?? found.subject.toLowerCase();
    if (!byVersion.has(key)) byVersion.set(key, found);
  }

  return [...byVersion.values()];
}

export async function GET() {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const mailbox = await openMailbox();
  if (!mailbox.ok) {
    return NextResponse.json({ error: mailbox.reason, configured: isWebflowConfigured() }, { status: 502 });
  }

  const found = await findReleases(mailbox.token);

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

  const created = await createArticleItem({
    title: parsed.title,
    slug,
    body,
    bodyFormat: "html",
    summary: metaDescription,
    metaTitle,
    metaDescription,
    categoryIds,
    tagIds,
    image,
  });
  if (!created.ok) return NextResponse.json({ error: created.reason }, { status: 502 });

  const url = articleUrl(created.data.slug);

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
      categories: categoryIds.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean),
      tags: tagIds.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean),
    },
  });
}
