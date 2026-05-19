import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { translateOutboundReply } from "@/lib/inbox/translate-outbound";

/**
 * Pre-flight translation preview for the inbox reply composer.
 *
 * Composer calls this on textarea blur to render a side-by-side preview of
 * what the recipient will actually receive. The reply endpoint translates
 * again at send time (preview cache isn't trusted for actual delivery), but
 * cache-hits during preview keep latency low.
 *
 * Body: { body_en }
 * Returns: { translated, target_language, model }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let payload: { body_en?: unknown } = {};
  try {
    payload = (await request.json()) as { body_en?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof payload.body_en !== "string" || !payload.body_en.trim()) {
    return NextResponse.json({ error: "body_en is required" }, { status: 400 });
  }

  const { data: msg } = await supabase
    .from("inbox_messages")
    .select("workspace_id, detected_language")
    .eq("id", id)
    .maybeSingle();
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Workspace gate.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", msg.workspace_id)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const targetLanguage = msg.detected_language ?? "en";

  const result = await translateOutboundReply({
    bodyEn: payload.body_en,
    targetLanguage,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  return NextResponse.json({
    translated: result.translated,
    target_language: result.targetLanguage,
    model: result.model,
  });
}
