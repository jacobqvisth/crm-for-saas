// Turning a WrenchLane release email into a wrenchlane.com article.
//
// Every release goes out as a Customer.io broadcast ("Your diagnosis now
// continues into the repair and the invoice", release 3.7) and is then
// republished by hand as an article under Product Updates. 18 of them exist.
// This module does the reading and the reshaping; the API route does the I/O.
//
// WHY PARSE THE EMAIL RATHER THAN A CHANGELOG
// The email is the only place the release is written up in prose, with the
// screenshots already chosen and captioned. There is no changelog feed to read,
// and Customer.io's App API key is not available to this deployment.
//
// WHAT MAKES THIS TRACTABLE
// The broadcast is generated from one Customer.io template, so its markup is
// regular in a way arbitrary HTML email is not:
//   <h1>                                            the headline
//   <p>                                             the lead, straight after it
//   <p style="...font-weight:700...">               a section heading
//   <p style="...line-height:1.6...">               body copy
//   <img style="...max-width:540px...">             a screenshot
//   <img style="...max-width:200px...">             the logo (chrome)
// So headings are detected by weight and screenshots by width, and the footer is
// cut at the sign-off. If the template is ever redesigned this is the file that
// needs revisiting, which is why the rules live in named constants below.

import { stripLongDashes } from "@/lib/ai/no-long-dash";

/** Screenshots are 540px wide; the logo is 200 and social icons are 32. */
const CONTENT_IMAGE_MIN_WIDTH = 400;

/**
 * Everything from here down is email furniture, not article content. Matched
 * against a paragraph's plain text; the first hit ends the article body.
 */
const SIGN_OFF_PATTERNS = [
  /^(best|kind|warm)\s+regards\b/i,
  /^questions or feedback/i,
  /^(thanks|cheers)[\s,.!]*$/i,
  /^unsubscribe$/i,
  /^ai-driven car diagnostics$/i,
  /^www\.wrenchlane\.com$/i,
];

/** Greetings. Skipped in place rather than ending the body. */
const SALUTATION_PATTERNS = [/^(hi|hello|hey|hej)\b[\s,!.]*$/i, /^(hi|hello|hey|hej)\s+\S+[,!]?$/i];

/**
 * Trailing thank-yous. They read fine in a mail and wrong in an article, and
 * Jacob asked specifically that the article not sound like a forwarded email.
 */
const OUTRO_PATTERNS = [
  // Deliberately loose on the verb: releases have thanked readers for helping
  // "build" and for helping "make WrenchLane better", and chasing a new verb
  // one release at a time is how the last one slipped through.
  /thanks?\s+(you\s+)?for helping us/i,
  /shaped by your feedback/i,
  /from your feedback/i,
  /reply to this email/i,
];

/**
 * A heading whose section is the demo video rather than a screenshot.
 *
 * Matches "in action" rather than the full "see it in action", because the
 * product name and the release number get spliced into the middle of it:
 * 3.8 shipped with "See WrenchLane 3.8 in action". A miss here is silent.
 * Nothing errors, the poster frame is emitted as an ordinary image, and the
 * demo video simply never appears in the article. That is how 3.8 first went in.
 */
const VIDEO_HEADING = /\bin action\b|watch the|demo/i;

export interface ReleaseImage {
  url: string;
  alt: string;
}

export interface ReleaseSection {
  /** null for the opening section, which runs straight on from the lead. */
  heading: string | null;
  /** Inner HTML, with <strong>/<em> kept and everything else unwrapped. */
  paragraphs: string[];
  images: ReleaseImage[];
  /** Set when this section is the "See it in action" video block. */
  videoId?: string | null;
}

export interface ParsedRelease {
  /** "3.7", read from the Customer.io campaign tag. */
  version: string | null;
  title: string;
  lead: string | null;
  sections: ReleaseSection[];
  videoId: string | null;
}

/* --------------------------------------------------------------- helpers */

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** Plain text of a fragment, for pattern matching and headings. */
function toText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/**
 * Body copy, keeping only the emphasis the article needs.
 *
 * Links are unwrapped to their text rather than kept: every link in the mail
 * carries utm_* tracking parameters aimed at the campaign, which have no
 * business on a permanent article page.
 */
function toInlineHtml(html: string): string {
  const kept = html
    .replace(/<\s*(strong|b)\b[^>]*>/gi, "<strong>")
    .replace(/<\s*\/\s*(strong|b)\s*>/gi, "</strong>")
    .replace(/<\s*(em|i)\b[^>]*>/gi, "<em>")
    .replace(/<\s*\/\s*(em|i)\s*>/gi, "</em>")
    .replace(/<br\s*\/?>/gi, " ")
    // Drop every other tag, keeping inner text.
    .replace(/<(?!\/?(?:strong|em)\b)[^>]+>/gi, "");
  return decodeEntities(kept).replace(/\s+/g, " ").trim();
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : null;
}

/** Displayed width, from either the style or the width attribute. */
function imageWidth(tag: string): number | null {
  const style = attr(tag, "style") ?? "";
  const maxW = style.match(/max-width:\s*(\d+)px/i);
  if (maxW) return Number(maxW[1]);
  const w = attr(tag, "width");
  return w && /^\d+$/.test(w) ? Number(w) : null;
}

/**
 * Customer.io rewrites every link for click tracking, so the sent HTML contains
 * no real destinations at all:
 *   https://links.wrenchlane.com/e/c/<base64url of {"email_id":..,"href":".."}>
 * Both the campaign tag and the demo video live inside those payloads, so
 * anything that reads links has to decode them first. Found the hard way: the
 * video embed silently degraded to a poster screenshot until this existed.
 */
export function decodeTrackedLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/links\.[a-z0-9.-]+\/e\/[co]\/([A-Za-z0-9_-]{16,})/gi)) {
    try {
      const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64").toString("utf8");
      // The payload escapes & as &, which JSON.parse resolves for us.
      const href = (JSON.parse(json) as { href?: string }).href;
      if (href && !out.includes(href)) out.push(href);
    } catch {
      // A truncated or non-JSON payload is not worth failing the whole parse over.
    }
  }
  return out;
}

/** The email's HTML plus every destination hidden behind a tracked link. */
function searchable(html: string): string {
  return `${html}\n${decodeTrackedLinks(html).join("\n")}`;
}

export function extractYoutubeId(html: string): string | null {
  const hay = searchable(html);
  const m =
    hay.match(/youtube\.com\/watch\?v=([\w-]{6,})/i) ??
    hay.match(/youtube\.com\/embed\/([\w-]{6,})/i) ??
    hay.match(/youtu\.be\/([\w-]{6,})/i);
  return m ? m[1] : null;
}

/**
 * The release version, from the campaign tag Customer.io puts on every link
 * (utm_campaign=release_3_7). This is the most reliable marker that a given
 * email IS a release announcement, which is why detection keys on it.
 */
export function extractReleaseVersion(html: string): string | null {
  const m = searchable(html).match(/utm_campaign=release[_-]([0-9][0-9_.-]*)/i);
  if (m) return m[1].replace(/[_-]/g, ".").replace(/\.+$/, "");
  // Fall back to a version written into the copy, e.g. "WrenchLane 3.7".
  const t = html.match(/wrenchlane\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
  return t ? t[1] : null;
}

/** Is this email a release announcement at all? */
export function looksLikeRelease(html: string): boolean {
  return Boolean(extractReleaseVersion(html)) && /<h1[\s>]/i.test(html);
}

/* ---------------------------------------------------------------- parser */

type Block =
  | { kind: "h1"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "p"; html: string; text: string }
  | { kind: "img"; url: string; alt: string; width: number | null };

function blocks(html: string): Block[] {
  const out: Block[] = [];
  const re = /<h1\b[^>]*>([\s\S]*?)<\/h1>|<p\b([^>]*)>([\s\S]*?)<\/p>|<img\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) {
      const text = toText(m[1]);
      if (text) out.push({ kind: "h1", text });
      continue;
    }
    if (m[3] !== undefined) {
      const style = (attr(`<p ${m[2]}>`, "style") ?? "").toLowerCase();
      const text = toText(m[3]);
      if (!text) continue;
      // Bold and not body-sized: a section heading in this template.
      const bold = /font-weight:\s*(700|800|900|bold)/.test(style);
      out.push(bold ? { kind: "heading", text } : { kind: "p", html: m[3], text });
      continue;
    }
    if (m[4] !== undefined) {
      const tag = `<img ${m[4]}>`;
      const url = attr(tag, "src");
      if (!url) continue;
      out.push({ kind: "img", url, alt: decodeEntities(attr(tag, "alt") ?? "").trim(), width: imageWidth(tag) });
    }
  }
  return out;
}

/**
 * Parse a release email's HTML body into the shape an article needs.
 * Returns null when it does not look like a release at all.
 */
export function parseReleaseEmail(html: string): ParsedRelease | null {
  if (!looksLikeRelease(html)) return null;

  const all = blocks(html);
  const videoId = extractYoutubeId(html);

  const h1Index = all.findIndex((b) => b.kind === "h1");
  if (h1Index === -1) return null;
  const title = (all[h1Index] as { text: string }).text;

  // Cut the footer off before doing anything else.
  const rest = all.slice(h1Index + 1);
  const stopAt = rest.findIndex(
    (b) => (b.kind === "p" || b.kind === "heading") && SIGN_OFF_PATTERNS.some((re) => re.test(b.text)),
  );
  const body = stopAt === -1 ? rest : rest.slice(0, stopAt);

  let lead: string | null = null;
  const sections: ReleaseSection[] = [];
  let current: ReleaseSection = { heading: null, paragraphs: [], images: [] };

  for (const b of body) {
    if (b.kind === "heading") {
      if (current.heading || current.paragraphs.length || current.images.length) sections.push(current);
      current = { heading: b.text, paragraphs: [], images: [] };
      continue;
    }

    if (b.kind === "img") {
      // Chrome: logo, social icons, the tracking pixel (which has no width).
      if (b.width === null || b.width < CONTENT_IMAGE_MIN_WIDTH) continue;
      // The video block's image is a poster frame; the embed replaces it.
      if (videoId && current.heading && VIDEO_HEADING.test(current.heading)) {
        current.videoId = videoId;
        continue;
      }
      current.images.push({ url: b.url, alt: b.alt });
      continue;
    }

    // A stray second h1 is not body copy; the headline was taken above.
    if (b.kind !== "p") continue;
    if (SALUTATION_PATTERNS.some((re) => re.test(b.text))) continue;
    if (OUTRO_PATTERNS.some((re) => re.test(b.text))) continue;

    // The first ordinary paragraph after the headline is the standfirst.
    if (lead === null && !current.heading && current.paragraphs.length === 0) {
      lead = toInlineHtml(b.html);
      continue;
    }
    current.paragraphs.push(toInlineHtml(b.html));
  }
  if (current.heading || current.paragraphs.length || current.images.length) sections.push(current);

  return { version: extractReleaseVersion(html), title, lead, sections, videoId };
}

/* --------------------------------------------------------------- output */

const ZWNJ = "‌";
/** The spacer the hand-authored articles use between blocks. */
const SPACER = `<p>${ZWNJ}</p>`;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function imageFigure(url: string, alt: string): string {
  return (
    `<figure class="w-richtext-align-center w-richtext-figure-type-image">` +
    `<div><img alt="${esc(alt)}" src="${esc(url)}" loading="lazy"/></div></figure>`
  );
}

function videoFigure(videoId: string, title: string): string {
  return (
    `<figure style="padding-bottom:45%" class="w-richtext-align-center w-richtext-figure-type-video">` +
    `<div><iframe src="https://www.youtube.com/embed/${esc(videoId)}" title="${esc(title)}" ` +
    `scrolling="no" frameborder="0" allowfullscreen="true"></iframe></div></figure>`
  );
}

/**
 * The Webflow rich-text body, matching the structure of the release articles
 * already on the site: h1, lead, then h3 per feature with its screenshot, and
 * the demo video last under an h4.
 *
 * `hostedImages` maps the email's image URL to the Webflow CDN URL it was
 * uploaded to, so the article never hot-links Customer.io's asset host.
 */
export function buildReleaseBodyHtml(
  parsed: ParsedRelease,
  hostedImages: Map<string, string>,
): string {
  const parts: string[] = [`<h1>${esc(parsed.title)}</h1>`];
  if (parsed.lead) parts.push(`<p>${parsed.lead}</p>`);

  for (const section of parsed.sections) {
    const isVideo = Boolean(section.videoId);
    if (section.heading) {
      parts.push(SPACER);
      // h4 for the video block, h3 for features: what the site already does.
      const tag = isVideo ? "h4" : "h3";
      parts.push(`<${tag}><strong>${esc(section.heading)}</strong></${tag}>`);
    }
    for (const p of section.paragraphs) {
      parts.push(`<p>${p}</p>`);
    }
    for (const img of section.images) {
      const url = hostedImages.get(img.url) ?? img.url;
      parts.push(SPACER, imageFigure(url, img.alt));
    }
    if (section.videoId) {
      parts.push(SPACER, videoFigure(section.videoId, parsed.title));
    }
  }

  parts.push(SPACER);
  // The no-dash rule applies to everything we put in front of customers.
  return stripLongDashes(parts.join(""));
}

/** Every remote image the article will need, in order. */
export function releaseImageUrls(parsed: ParsedRelease): string[] {
  const urls: string[] = [];
  for (const s of parsed.sections) for (const i of s.images) if (!urls.includes(i.url)) urls.push(i.url);
  return urls;
}

/** A slug that reads like the ones already on the site. */
export function releaseSlug(parsed: ParsedRelease): string {
  const base = parsed.title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = parsed.version ? `-release-${parsed.version.replace(/\./g, "-")}` : "";
  return `${base}${suffix}`.slice(0, 200).replace(/-+$/, "");
}
