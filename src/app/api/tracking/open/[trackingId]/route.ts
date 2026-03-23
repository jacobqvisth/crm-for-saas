import { NextResponse } from "next/server";

// 1x1 transparent pixel GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;

  // TODO: Record open event in email_events table
  // - Look up email_queue by tracking_id
  // - Insert email_event with event_type = 'open'
  // - Include user_agent and ip_address from request headers
  console.log(`Email opened: ${trackingId}`);

  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
