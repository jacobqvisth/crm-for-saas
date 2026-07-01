import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { translateOutboundEmail } from "@/lib/inbox/translate-outbound";

/**
 * Translate a composed outreach email (subject + HTML body) to a target
 * language for the contact compose modal's side-by-side preview.
 *
 * Body: { workspaceId, subject, bodyHtml, targetLanguage }
 * Returns: { subject, bodyHtml, target_language, model }
 *
 * The send path (/api/contacts/[id]/send-email) translates again at send time
 * with the same lib — this endpoint only powers the preview panel, so a stale
 * preview never determines what actually ships.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: {
    workspaceId?: unknown;
    subject?: unknown;
    bodyHtml?: unknown;
    targetLanguage?: unknown;
  } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const workspaceId =
    typeof payload.workspaceId === "string" ? payload.workspaceId : "";
  const subject = typeof payload.subject === "string" ? payload.subject : "";
  const bodyHtml = typeof payload.bodyHtml === "string" ? payload.bodyHtml : "";
  const targetLanguage =
    typeof payload.targetLanguage === "string" ? payload.targetLanguage : "";

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (!targetLanguage) {
    return NextResponse.json({ error: "targetLanguage is required" }, { status: 400 });
  }
  if (!subject.trim() && !bodyHtml.trim()) {
    return NextResponse.json({ error: "Nothing to translate" }, { status: 400 });
  }

  // Workspace gate.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await translateOutboundEmail({ subject, bodyHtml, targetLanguage });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  return NextResponse.json({
    subject: result.subject,
    bodyHtml: result.bodyHtml,
    target_language: result.targetLanguage,
    model: result.model,
  });
}
