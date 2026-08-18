import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertActivity } from "@/lib/activities/insert";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  // Validate the destination is a well-formed http(s) URL. Using the URL parser
  // (not a string prefix check) rejects javascript:, data:, and malformed input.
  let parsed: URL;
  try {
    if (!url) throw new Error("missing url");
    parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("bad protocol");
    }
  } catch {
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

    // Only a real, known tracking id gets a redirect. A bogus/expired id can no
    // longer turn this endpoint into a generic open redirect on our domain.
    if (!queueItem) {
      return new NextResponse("Link not found", { status: 404 });
    }

    {
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

      // Create activity record. Soft-fail: a failed activity insert must
      // not break the redirect — the user's browser is waiting for a 302.
      if (queueItem.contact_id) {
        try {
          await insertActivity(
            supabase,
            {
              workspace_id: queueItem.workspace_id,
              type: "link_clicked",
              subject: "Link clicked",
              body: `Contact clicked a link in a sequence email`,
              contact_id: queueItem.contact_id,
              metadata: {
                tracking_id: trackingId,
                email_queue_id: queueItem.id,
                link_url: url,
              },
            },
            { context: "tracking/click" },
          );
        } catch (err) {
          console.error("tracking/click activity insert failed", err);
        }
      }
    }
  } catch (err) {
    console.error("Click tracking error:", err);
  }

  return NextResponse.redirect(url, 302);
}
