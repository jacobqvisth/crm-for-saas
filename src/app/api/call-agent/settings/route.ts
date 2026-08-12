import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMember } from "@/lib/call-agent/auth";
import {
  encryptProviderApiKey,
  ensureWebhookSecret,
  loadCallAgentRow,
  toClientSettings,
} from "@/lib/call-agent/settings";

export const dynamic = "force-dynamic";

/** GET /api/call-agent/settings — client-safe settings + webhook URLs. */
export async function GET() {
  const auth = await requireMember();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const row = await loadCallAgentRow(service, auth.workspaceId);
  const secret = await ensureWebhookSecret(service, row);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return NextResponse.json({
    settings: toClientSettings(row),
    caller_id: process.env.CRM_CALL_FROM_NUMBER ?? null,
    webhooks: {
      // Shown in the settings UI: the post-call webhook must be registered in
      // the ElevenLabs dashboard once (their API has no create-webhook route).
      post_call: `${appUrl}/api/call-agent/webhook?token=${secret}`,
      initiation: `${appUrl}/api/call-agent/initiation?token=${secret}`,
    },
  });
}

const PATCHABLE = new Set([
  "enabled",
  "mode",
  "persona_name",
  "voice_ids",
  "greeting_note",
  "daily_cap",
  "max_attempts_per_contact",
  "min_days_between_calls",
  "call_start_hour",
  "call_end_hour",
  "call_days",
  "languages_enabled",
  "callback_owner_user_id",
]);

/**
 * PATCH /api/call-agent/settings — update settings. `api_key` is special:
 * it arrives in plaintext once, is encrypted at rest, and never returned.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireMember();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const service = createServiceClient();
  const row = await loadCallAgentRow(service, auth.workspaceId);

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (PATCHABLE.has(key)) updates[key] = value;
  }
  if (typeof body.api_key === "string" && body.api_key.trim()) {
    updates.provider_api_key_encrypted = encryptProviderApiKey(body.api_key as string);
  }
  if (body.api_key === null) updates.provider_api_key_encrypted = null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await service
    .from("call_agent_settings")
    .update(updates)
    .eq("workspace_id", row.workspace_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const fresh = await loadCallAgentRow(service, auth.workspaceId);
  return NextResponse.json({ settings: toClientSettings(fresh) });
}
