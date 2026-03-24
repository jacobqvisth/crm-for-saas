import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SequenceSettings } from "@/lib/database.types";

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  // Get all active enrollments
  const { data: enrollments, error } = await supabase
    .from("sequence_enrollments")
    .select("*, sequences(*)")
    .eq("status", "active");

  if (error || !enrollments || enrollments.length === 0) {
    return NextResponse.json({ checked: 0, repliesFound: 0 });
  }

  let checked = 0;
  let repliesFound = 0;

  for (const enrollment of enrollments) {
    checked++;

    // Check for reply events on emails sent in this enrollment
    const { data: sentEmails } = await supabase
      .from("email_queue")
      .select("id, tracking_id, contact_id")
      .eq("enrollment_id", enrollment.id)
      .eq("status", "sent");

    if (!sentEmails || sentEmails.length === 0) continue;

    const trackingIds = sentEmails.map((e) => e.tracking_id).filter(Boolean);
    if (trackingIds.length === 0) continue;

    // Check for reply events
    const { data: replyEvents } = await supabase
      .from("email_events")
      .select("id")
      .in("tracking_id", trackingIds)
      .eq("event_type", "reply")
      .limit(1);

    if (replyEvents && replyEvents.length > 0) {
      const sequence = enrollment.sequences as unknown as { settings: SequenceSettings };
      const settings = sequence?.settings;

      if (settings?.stop_on_reply) {
        // Update enrollment status to replied
        await supabase
          .from("sequence_enrollments")
          .update({
            status: "replied",
            completed_at: new Date().toISOString(),
          })
          .eq("id", enrollment.id);

        // Cancel all scheduled emails for this enrollment
        await supabase
          .from("email_queue")
          .update({ status: "cancelled" as const })
          .eq("enrollment_id", enrollment.id)
          .eq("status", "scheduled");

        // Create activity record
        const contactId = sentEmails[0]?.contact_id;
        if (contactId) {
          await supabase.from("activities").insert({
            workspace_id: enrollment.workspace_id,
            type: "email_received",
            subject: "Reply received",
            description: "Contact replied to sequence email",
            contact_id: contactId,
            metadata: {
              sequence_id: enrollment.sequence_id,
              enrollment_id: enrollment.id,
            },
          });

          // Update contact's last_contacted_at
          await supabase
            .from("contacts")
            .update({ last_contacted_at: new Date().toISOString() })
            .eq("id", contactId);
        }

        repliesFound++;
      }
    }
  }

  return NextResponse.json({ checked, repliesFound });
}
