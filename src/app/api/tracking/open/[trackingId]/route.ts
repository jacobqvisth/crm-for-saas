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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;

  try {
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

    const userAgent = request.headers.get("user-agent") || null;
    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null;

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
