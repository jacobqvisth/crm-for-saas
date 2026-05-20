import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertActivity } from "@/lib/activities/insert";

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

  // Every write below throws on .error so it propagates to the outer
  // try/catch in GET/POST, which logs to console.error. Two layered
  // compliance gates protect against re-enrollment after an unsubscribe:
  // (1) a `suppressions` row by (workspace_id, email) blocks the email
  // from any future sequence enroll; (2) `contacts.status = 'unsubscribed'`
  // blocks that specific contact row. Both used to be silent — if either
  // failed, "Unsubscribed" would still render but downstream sequences
  // could keep enrolling the contact. Now any failure surfaces in Vercel
  // logs with the offending email + tracking_id so on-call can act.
  const ctx = `tracking_id=${trackingId} email=${queueItem.to_email}`;

  // Insert into unsubscribes (upsert to handle duplicates)
  const { error: unsubError } = await supabase
    .from("unsubscribes")
    .upsert(
      {
        workspace_id: queueItem.workspace_id,
        email: queueItem.to_email,
        reason: "recipient_unsubscribed",
      },
      { onConflict: "workspace_id,email" }
    );
  if (unsubError) {
    throw new Error(`unsubscribes upsert (${ctx}): ${unsubError.message}`);
  }

  // Also insert into suppressions (primary suppression gate)
  const { data: existingSuppression } = await supabase
    .from("suppressions")
    .select("id")
    .eq("workspace_id", queueItem.workspace_id)
    .eq("email", queueItem.to_email)
    .eq("active", true)
    .maybeSingle();

  if (!existingSuppression) {
    const { error: suppressionError } = await supabase
      .from("suppressions")
      .insert({
        workspace_id: queueItem.workspace_id,
        email: queueItem.to_email,
        reason: "unsubscribed",
        source: "recipient clicked unsubscribe",
      });
    if (suppressionError) {
      throw new Error(
        `suppressions insert (${ctx}): ${suppressionError.message}`,
      );
    }
  }

  // Insert email_event
  const { error: eventError } = await supabase.from("email_events").insert({
    tracking_id: trackingId,
    email_queue_id: queueItem.id,
    event_type: "unsubscribe",
  });
  if (eventError) {
    throw new Error(`email_events insert (${ctx}): ${eventError.message}`);
  }

  // Update contact status to 'unsubscribed'
  if (queueItem.contact_id) {
    const { error: contactError } = await supabase
      .from("contacts")
      .update({ status: "unsubscribed" })
      .eq("id", queueItem.contact_id);
    if (contactError) {
      throw new Error(
        `contacts.status update (${ctx} contact=${queueItem.contact_id}): ${contactError.message}`,
      );
    }

    // Create activity record. Soft-fail: the unsubscribe page must return
    // 200 to the recipient regardless of whether the audit row was written.
    try {
      await insertActivity(
        supabase,
        {
          workspace_id: queueItem.workspace_id,
          type: "contact_unsubscribed",
          subject: "Contact unsubscribed",
          body: "Contact unsubscribed from emails",
          contact_id: queueItem.contact_id,
          metadata: {
            tracking_id: trackingId,
            email_queue_id: queueItem.id,
          },
        },
        { context: "tracking/unsubscribe" },
      );
    } catch (err) {
      console.error("tracking/unsubscribe activity insert failed", err);
    }
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
    const { error: enrollmentError } = await supabase
      .from("sequence_enrollments")
      .update({
        status: "unsubscribed",
        completed_at: new Date().toISOString(),
      })
      .in("id", enrollmentIds);
    if (enrollmentError) {
      throw new Error(
        `sequence_enrollments update (${ctx} count=${enrollmentIds.length}): ${enrollmentError.message}`,
      );
    }

    // Cancel all scheduled emails for these enrollments
    const { error: queueError } = await supabase
      .from("email_queue")
      .update({ status: "cancelled" as const })
      .in("enrollment_id", enrollmentIds)
      .eq("status", "scheduled");
    if (queueError) {
      throw new Error(
        `email_queue cancel (${ctx} count=${enrollmentIds.length}): ${queueError.message}`,
      );
    }
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
