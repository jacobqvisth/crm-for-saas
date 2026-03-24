import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  // Validate URL
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return new NextResponse("Invalid link", { status: 400 });
  }

  try {
    const supabase = createAdminClient();

    // Look up email_queue by tracking_id
    const { data: queueItem } = await supabase
      .from("email_queue")
      .select("id, workspace_id, contact_id")
      .eq("tracking_id", trackingId)
      .single();

    if (queueItem) {
      const userAgent = request.headers.get("user-agent") || null;
      const ipAddress =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") ||
        null;

      // Insert click event
      await supabase.from("email_events").insert({
        tracking_id: trackingId,
        email_queue_id: queueItem.id,
        event_type: "click",
        link_url: url,
        user_agent: userAgent,
        ip_address: ipAddress,
      });

      // Create activity record
      if (queueItem.contact_id) {
        await supabase.from("activities").insert({
          workspace_id: queueItem.workspace_id,
          type: "link_clicked",
          subject: "Link clicked",
          description: `Contact clicked a link in a sequence email`,
          contact_id: queueItem.contact_id,
          metadata: {
            tracking_id: trackingId,
            email_queue_id: queueItem.id,
            link_url: url,
          },
        });
      }
    }
  } catch (err) {
    console.error("Click tracking error:", err);
  }

  return NextResponse.redirect(url, 302);
}
