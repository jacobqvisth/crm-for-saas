import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 1x1 transparent pixel GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

const PIXEL_HEADERS = {
  "Content-Type": "image/gif",
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

/**
 * Detect bot/scanner requests that should NOT count as real opens.
 *
 * Google Gmail scans every incoming email image within seconds of delivery.
 * Other mail clients (Outlook SafeLinks, Apple Mail Privacy) also pre-fetch.
 * We filter these out so stats reflect actual human opens.
 */
function isBotRequest(userAgent: string | null, ipAddress: string | null): boolean {
  // No user agent = likely a bot/scanner
  if (!userAgent) return true;

  const ua = userAgent.toLowerCase();

  // Known bot/scanner UA substrings
  const botPatterns = [
    "googleimageproxy",
    "googlebot",
    "bingbot",
    "yahoo! slurp",
    "duckduckbot",
    "bot/",
    "crawler",
    "spider",
    "slurp",
    "feedfetcher",
    "mediapartners-google",
    "facebookexternalhit",
    "linkedinbot",
    "twitterbot",
    "outbrain",
    "preview",
    "safebrowsing",
    "mail.ru",
    "msnbot",
  ];
  if (botPatterns.some((p) => ua.includes(p))) return true;

  // Google image proxy uses very old fake UAs like "Edge/12.246"
  // Edge 12 is from 2015 — no real user has this anymore
  if (/edge\/1[0-3]\./.test(ua)) return true;

  // Check Google IP ranges (most common false-positive source)
  // Covers: 66.102.x.x, 66.249.x.x, 72.14.x.x, 74.125.x.x, 209.85.x.x
  if (ipAddress) {
    const googlePrefixes = ["66.102.", "66.249.", "72.14.", "74.125.", "209.85.", "108.177.", "173.194.", "172.217.", "216.58.", "216.239."];
    if (googlePrefixes.some((prefix) => ipAddress.startsWith(prefix))) return true;
  }

  return false;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;

  try {
    const userAgent = request.headers.get("user-agent") || null;
    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null;

    // Skip bots/scanners entirely — return pixel without recording
    if (isBotRequest(userAgent, ipAddress)) {
      return new NextResponse(PIXEL, { headers: PIXEL_HEADERS });
    }

    const supabase = createAdminClient();

    // Look up email_queue by tracking_id
    const { data: queueItem } = await supabase
      .from("email_queue")
      .select("id, workspace_id, contact_id")
      .eq("tracking_id", trackingId)
      .single();

    if (!queueItem) {
      return new NextResponse(PIXEL, { headers: PIXEL_HEADERS });
    }

    // Deduplicate: only log the first open per tracking_id per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentOpen } = await supabase
      .from("email_events")
      .select("id")
      .eq("tracking_id", trackingId)
      .eq("event_type", "open")
      .gte("created_at", oneHourAgo)
      .limit(1);

    if (recentOpen && recentOpen.length > 0) {
      return new NextResponse(PIXEL, { headers: PIXEL_HEADERS });
    }

    // Check if this is the first open ever for this tracking_id (for activity record)
    const { data: anyPriorOpen } = await supabase
      .from("email_events")
      .select("id")
      .eq("tracking_id", trackingId)
      .eq("event_type", "open")
      .limit(1);

    const isFirstOpen = !anyPriorOpen || anyPriorOpen.length === 0;

    // Insert open event
    await supabase.from("email_events").insert({
      tracking_id: trackingId,
      email_queue_id: queueItem.id,
      event_type: "open",
      user_agent: userAgent,
      ip_address: ipAddress,
    });

    // Create activity record only for first open
    if (isFirstOpen && queueItem.contact_id) {
      await supabase.from("activities").insert({
        workspace_id: queueItem.workspace_id,
        type: "email_opened",
        subject: "Email opened",
        description: "Contact opened a sequence email",
        contact_id: queueItem.contact_id,
        metadata: {
          tracking_id: trackingId,
          email_queue_id: queueItem.id,
        },
      });
    }
  } catch (err) {
    console.error("Open tracking error:", err);
  }

  return new NextResponse(PIXEL, { headers: PIXEL_HEADERS });
}
