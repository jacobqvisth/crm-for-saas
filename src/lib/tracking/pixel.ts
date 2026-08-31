/**
 * Injects a 1x1 transparent tracking pixel into an HTML email body.
 */
export function injectTrackingPixel(
  html: string,
  trackingId: string,
  appUrl: string
): string {
  const pixelUrl = `${appUrl}/api/tracking/open/${trackingId}`;
  // No `display:none`. A 1x1 image is already invisible, so the property adds
  // nothing for the reader while matching the "hidden image" heuristic that
  // content filters score against. Keeping the border reset avoids a stray
  // 1px outline in clients that draw one on images.
  const pixel = `<img src="${pixelUrl}" width="1" height="1" style="border:0;" alt="" />`;

  // Insert before closing </body> tag if present, otherwise append
  if (html.includes("</body>")) {
    return html.replace("</body>", `${pixel}</body>`);
  }

  return html + pixel;
}
