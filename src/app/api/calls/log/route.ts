import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CALL_OUTCOMES, type CallOutcome, logCall } from "@/lib/calls/log";

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
