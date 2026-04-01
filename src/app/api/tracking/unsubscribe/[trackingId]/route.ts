import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UNSUBSCRIBE_HTML = `<!DOCTYPE html>
<html>
  <head><title>Unsubscribed</title></head>
  <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f8fafc;">
    <div style="text-align: center; padding: 2rem;">
      <h1 style="color: #0f172a; font-size: 1.5rem;">You've been unsubscribed</h1>
      <p style="color: #64748b; margin-top: 0.5rem;">You will no longer receive emails from us.</p>
    </div>
  </body>
</html>`;

async function processUnsubscribe(trackingId: string) {
  const supabase = createAdminClient();

  // Look up email_queue by tracking_id
  const { data: queueItem } = await supabase
    .from("email_queue")
    .select("id, workspace_id, contact_id, to_email, enrollment_id")
    .eq("tracking_id", trackingId)
    .single();

  if (!queueItem) {
    return;
  }

  // Insert into unsubscribes (upsert to handle duplicates)
  await supabase
    .from("unsubscribes")
    .upsert(
      {
        workspace_id: queueItem.workspace_id,
        email: queueItem.to_email,
        reason: "recipient_unsubscribed",
      },
      { onConflict: "workspace_id,email" }
    );

  // Also insert into suppressions (primary suppression gate)
  const { data: existingSuppression } = await supabase
    .from("suppressions")
    .select("id")
    .eq("workspace_id", queueItem.workspace_id)
    .eq("email", queueItem.to_email)
    .eq("active", true)
    .maybeSingle();

  if (!existingSuppression) {
    await supabase.from("suppressions").insert({
      workspace_id: queueItem.workspace_id,
      email: queueItem.to_email,
      reason: "unsubscribed",
      source: "recipient clicked unsubscribe",
    });
  }

  // Insert email_event
  await supabase.from("email_events").insert({
    tracking_id: trackingId,
    email_queue_id: queueItem.id,
    event_type: "unsubscribe",
  });

  // Update contact status to 'unsubscribed'
  if (queueItem.contact_id) {
    await supabase
      .from("contacts")
      .update({ status: "unsubscribed" })
      .eq("id", queueItem.contact_id);

    // Create activity record
    await supabase.from("activities").insert({
      workspace_id: queueItem.workspace_id,
      type: "contact_unsubscribed",
      subject: "Contact unsubscribed",
      description: "Contact unsubscribed from emails",
      contact_id: queueItem.contact_id,
      metadata: {
        tracking_id: trackingId,
        email_queue_id: queueItem.id,
      },
    });
  }

  // Cancel ALL active sequence enrollments for this contact
  const { data: activeEnrollments } = await supabase
    .from("sequence_enrollments")
    .select("id")
    .eq("contact_id", queueItem.contact_id)
    .in("status", ["active", "paused"]);

  if (activeEnrollments && activeEnrollments.length > 0) {
    const enrollmentIds = activeEnrollments.map((e) => e.id);

    // Update enrollment statuses
    await supabase
      .from("sequence_enrollments")
      .update({
        status: "unsubscribed",
        completed_at: new Date().toISOString(),
      })
      .in("id", enrollmentIds);

    // Cancel all scheduled emails for these enrollments
    await supabase
      .from("email_queue")
      .update({ status: "cancelled" as const })
      .in("enrollment_id", enrollmentIds)
      .eq("status", "scheduled");
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;

  try {
    await processUnsubscribe(trackingId);
  } catch (err) {
    console.error("Unsubscribe error:", err);
  }

  return new NextResponse(UNSUBSCRIBE_HTML, {
    headers: { "Content-Type": "text/html" },
  });
}

// POST handler for one-click unsubscribe (RFC 8058)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;

  try {
    await processUnsubscribe(trackingId);
  } catch (err) {
    console.error("One-click unsubscribe error:", err);
  }

  return new NextResponse(null, { status: 200 });
}
