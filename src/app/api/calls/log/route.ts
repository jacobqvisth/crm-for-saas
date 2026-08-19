import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CALL_OUTCOMES, type CallOutcome, logCall } from "@/lib/calls/log";
import { CALL_OUTCOME_LABEL, CONNECTED_BY_DEFAULT } from "@/lib/calls/decision";
import type { Json } from "@/lib/database.types";

const FeedbackItem = z.object({
  category: z.enum(["bug", "feature_request", "complaint", "praise", "other"]),
  severity: z.enum(["low", "medium", "high", "critical"]).nullish(),
  title: z.string().max(200).nullish(),
  body: z.string().min(1).max(2000),
});

const LogCallBody = z.object({
  contactId: z.string().uuid(),
  companyId: z.string().uuid().nullish(),
  listId: z.string().uuid().nullish(),
  outcome: z.enum(CALL_OUTCOMES as readonly [CallOutcome, ...CallOutcome[]]),
  connected: z.boolean().optional(),
  notes: z.string().max(2000).nullish(),
  durationSeconds: z.number().int().min(0).max(86400).nullish(),
  callbackAt: z.string().datetime().nullish(),
  occurredAt: z.string().datetime().optional(),
  enrollOverride: z.boolean().optional(),
  followUpRequiredOverride: z.boolean().optional(),
  feedback: z.array(FeedbackItem).max(20).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = LogCallBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  // Authorize against the contact's workspace.
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("id, workspace_id")
    .eq("id", parsed.data.contactId)
    .maybeSingle();
  if (contactErr) return NextResponse.json({ error: contactErr.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", contact.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await logCall({
      contactId: parsed.data.contactId,
      companyId: parsed.data.companyId,
      listId: parsed.data.listId,
      outcome: parsed.data.outcome,
      connected: parsed.data.connected,
      notes: parsed.data.notes,
      durationSeconds: parsed.data.durationSeconds,
      callbackAt: parsed.data.callbackAt,
      occurredAt: parsed.data.occurredAt,
      enrollOverride: parsed.data.enrollOverride,
      followUpRequiredOverride: parsed.data.followUpRequiredOverride,
      feedback: parsed.data.feedback,
      userId: user.id,
      supabase,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "logCall failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const CorrectOutcomeBody = z.object({
  activityId: z.string().uuid(),
  outcome: z.enum(CALL_OUTCOMES as readonly [CallOutcome, ...CallOutcome[]]),
});

// Correct the outcome on an already-logged call — the AI's suggestion is
// sometimes wrong. Only touches the activity row (outcome, subject, and the
// derived `connected` flag); it deliberately does NOT re-run logCall's side
// effects (lead-status transitions, suppressions, auto-enroll, tasks).
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = CorrectOutcomeBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { activityId, outcome } = parsed.data;

  // RLS scopes this read to the caller's workspaces.
  const { data: activity, error: readErr } = await supabase
    .from("activities")
    .select("id, type, subject, metadata, contact_id")
    .eq("id", activityId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!activity || activity.type !== "call") {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  const answered = CONNECTED_BY_DEFAULT[outcome];
  const previousMetadata =
    activity.metadata && typeof activity.metadata === "object" && !Array.isArray(activity.metadata)
      ? (activity.metadata as Record<string, Json>)
      : {};
  // Keep the "Call: <label> — <name>" subject shape in sync with the new outcome.
  const subject = activity.subject?.includes("—")
    ? `${activity.subject.split(":")[0]}: ${CALL_OUTCOME_LABEL[outcome]} —${activity.subject.split("—").slice(1).join("—")}`
    : activity.subject;

  const { error: updateErr } = await supabase
    .from("activities")
    .update({
      outcome,
      subject,
      metadata: {
        ...previousMetadata,
        outcome,
        connected: answered,
        outcome_corrected_by: user.id,
        outcome_corrected_at: new Date().toISOString(),
      },
    })
    .eq("id", activityId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    outcome,
    outcomeLabel: CALL_OUTCOME_LABEL[outcome],
    answered,
  });
}
