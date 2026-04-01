import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contactId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch the contact (RLS ensures workspace membership)
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, email, workspace_id")
    .eq("id", contactId)
    .single();

  if (contactError || !contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  // Verify workspace membership explicitly
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", contact.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1. Add email to suppressions with reason='gdpr_erasure'
  const { data: existingSuppression } = await supabase
    .from("suppressions")
    .select("id")
    .eq("workspace_id", contact.workspace_id)
    .eq("email", contact.email)
    .eq("active", true)
    .maybeSingle();

  if (!existingSuppression) {
    await supabase.from("suppressions").insert({
      workspace_id: contact.workspace_id,
      email: contact.email,
      reason: "gdpr_erasure",
      source: "GDPR erasure request",
      created_by: user.id,
    });
  } else {
    // Update existing suppression reason to gdpr_erasure
    await supabase
      .from("suppressions")
      .update({ reason: "gdpr_erasure", source: "GDPR erasure request", created_by: user.id })
      .eq("id", existingSuppression.id);
  }

  // 2. Cancel all scheduled/pending emails for this contact
  await supabase
    .from("email_queue")
    .update({ status: "cancelled" })
    .eq("contact_id", contactId)
    .in("status", ["scheduled", "pending"]);

  // 3. Get email queue IDs for this contact (needed to delete email_events)
  const { data: queueIds } = await supabase
    .from("email_queue")
    .select("id")
    .eq("contact_id", contactId);

  const emailQueueIds = (queueIds || []).map((q) => q.id);

  // 4. Delete email_events tied to this contact's emails
  if (emailQueueIds.length > 0) {
    await supabase.from("email_events").delete().in("email_queue_id", emailQueueIds);
  }

  // 5. Delete inbox_messages for this contact
  await supabase.from("inbox_messages").delete().eq("contact_id", contactId);

  // 6. Delete email_queue records for this contact
  await supabase.from("email_queue").delete().eq("contact_id", contactId);

  // 7. Delete sequence_enrollments for this contact
  await supabase.from("sequence_enrollments").delete().eq("contact_id", contactId);

  // 8. Delete deal_contacts for this contact
  await supabase.from("deal_contacts").delete().eq("contact_id", contactId);

  // 9. Delete contact_list_members for this contact
  await supabase.from("contact_list_members").delete().eq("contact_id", contactId);

  // 10. Delete activities for this contact
  await supabase.from("activities").delete().eq("contact_id", contactId);

  // 11. Delete the contact itself
  await supabase.from("contacts").delete().eq("id", contactId);

  // 12. Log an anonymized system activity (not tied to the deleted contact)
  await supabase.from("activities").insert({
    workspace_id: contact.workspace_id,
    type: "system",
    subject: "GDPR erasure request processed",
    description:
      "A contact record was deleted and the email address was added to the suppression list.",
  });

  return NextResponse.json({ success: true });
}
