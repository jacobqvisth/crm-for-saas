import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNextSendTime } from "@/lib/sequences/scheduler";
import { resolveVariables, ensureUnsubscribeLink } from "@/lib/sequences/variables";
import type { SequenceSettings } from "@/lib/database.types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { id: enrollmentId } = await params;

  // Verify user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const action = body?.action as "pause" | "resume" | undefined;
  if (action !== "pause" && action !== "resume") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // Load the enrollment and verify workspace access
  const { data: enrollment, error: enrollError } = await supabase
    .from("sequence_enrollments")
    .select("*, sequences(*)")
    .eq("id", enrollmentId)
    .single();

  if (enrollError || !enrollment) {
    return NextResponse.json({ error: "Enrollment not found" }, { status: 404 });
  }

  if (action === "pause") {
    if (enrollment.status !== "active") {
      return NextResponse.json({ error: "Enrollment is not active" }, { status: 400 });
    }

    await supabase
      .from("sequence_enrollments")
      .update({ status: "paused" })
      .eq("id", enrollmentId);

    await supabase
      .from("email_queue")
      .update({ status: "cancelled" as const })
      .eq("enrollment_id", enrollmentId)
      .eq("status", "scheduled");

    return NextResponse.json({ success: true, status: "paused" });
  }

  if (action === "resume") {
    if (enrollment.status !== "paused" && enrollment.status !== "company_paused") {
      return NextResponse.json({ error: "Enrollment is not paused" }, { status: 400 });
    }

    // Set back to active
    await supabase
      .from("sequence_enrollments")
      .update({ status: "active" })
      .eq("id", enrollmentId);

    // Re-schedule the next pending step
    const currentStep = enrollment.current_step ?? 0;
    const sequence = enrollment.sequences as unknown as {
      id: string;
      settings: SequenceSettings;
    };

    const { data: nextStep } = await supabase
      .from("sequence_steps")
      .select("*")
      .eq("sequence_id", enrollment.sequence_id)
      .eq("step_order", currentStep)
      .maybeSingle();

    if (nextStep && nextStep.type === "email" && sequence?.settings) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("*, companies(*)")
        .eq("id", enrollment.contact_id)
        .single();

      if (contact) {
        let subject = nextStep.subject_override || "";
        let bodyHtml = nextStep.body_override || "";

        if (nextStep.template_id) {
          const { data: template } = await supabase
            .from("email_templates")
            .select("*")
            .eq("id", nextStep.template_id)
            .single();
          if (template) {
            subject = nextStep.subject_override || template.subject;
            bodyHtml = nextStep.body_override || template.body_html;
          }
        }

        const company = (contact as Record<string, unknown>).companies as never;
        const trackingId = crypto.randomUUID();

        subject = resolveVariables(subject, contact, company, trackingId);
        bodyHtml = resolveVariables(bodyHtml, contact, company, trackingId);
        bodyHtml = ensureUnsubscribeLink(bodyHtml, trackingId);

        const scheduledFor = getNextSendTime(sequence.settings);

        await supabase.from("email_queue").insert({
          workspace_id: (enrollment as Record<string, unknown>).workspace_id as string ?? contact.workspace_id,
          enrollment_id: enrollmentId,
          step_id: nextStep.id,
          contact_id: enrollment.contact_id,
          sender_account_id: enrollment.sender_account_id!,
          to_email: contact.email,
          subject,
          body_html: bodyHtml,
          status: "scheduled" as const,
          scheduled_for: scheduledFor.toISOString(),
          tracking_id: trackingId,
        });
      }
    }

    return NextResponse.json({ success: true, status: "active" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
