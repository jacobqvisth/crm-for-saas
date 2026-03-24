/**
 * Injects a 1x1 transparent tracking pixel into an HTML email body.
 */
export function injectTrackingPixel(
  html: string,
  trackingId: string,
  appUrl: string
): string {
  const pixelUrl = `${appUrl}/api/tracking/open/${trackingId}`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0;" alt="" />`;

  // Insert before closing </body> tag if present, otherwise append
  if (html.includes("</body>")) {
    return html.replace("</body>", `${pixel}</body>`);
  }

  return html + pixel;
}
