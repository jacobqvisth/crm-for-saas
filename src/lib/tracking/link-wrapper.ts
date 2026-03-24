/**
 * Wraps all links in an HTML email body with click tracking URLs.
 * Excludes unsubscribe links and mailto: links.
 */
export function wrapLinks(
  html: string,
  trackingId: string,
  appUrl: string
): string {
  // Match <a href="..."> tags, capturing the URL
  const linkRegex = /<a\s([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi;

  return html.replace(linkRegex, (match, before: string, url: string, after: string) => {
    // Skip unsubscribe links
    if (
      url.includes("/api/tracking/unsubscribe/") ||
      url.includes("{{unsubscribe_link}}")
    ) {
      return match;
    }

    // Skip mailto: links
    if (url.startsWith("mailto:")) {
      return match;
    }

    // Skip non-http links (tel:, javascript:, #, etc.)
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return match;
    }

    const wrappedUrl = `${appUrl}/api/tracking/click/${trackingId}?url=${encodeURIComponent(url)}`;
    return `<a ${before}href="${wrappedUrl}"${after}>`;
  });
}
