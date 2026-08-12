import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { decrypt, encrypt } from "@/lib/encryption";
import { CALL_AGENT_DEFAULTS, type CallAgentSettings } from "./types";

type Client = SupabaseClient<Database>;
type SettingsRow = Tables<"call_agent_settings">;

/** Load (or lazily create) the workspace's call-agent settings row. */
export async function loadCallAgentRow(
  supabase: Client,
  workspaceId: string,
): Promise<SettingsRow> {
  const { data } = await supabase
    .from("call_agent_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (data) return data;

  const { data: inserted, error } = await supabase
    .from("call_agent_settings")
    .insert({ workspace_id: workspaceId, ...CALL_AGENT_DEFAULTS })
    .select("*")
    .single();
  if (error || !inserted) {
    throw new Error(`call_agent_settings insert failed: ${error?.message}`);
  }
  return inserted;
}

/** Client-safe view: the API key never leaves the server, only a boolean. */
export function toClientSettings(row: SettingsRow): CallAgentSettings {
  return {
    workspace_id: row.workspace_id,
    enabled: row.enabled,
    mode: row.mode as CallAgentSettings["mode"],
    provider: row.provider,
    has_api_key: Boolean(row.provider_api_key_encrypted),
    provider_agent_ids: (row.provider_agent_ids ?? {}) as Record<string, string>,
    provider_kb_doc_id: row.provider_kb_doc_id,
    persona_name: row.persona_name,
    voice_ids: (row.voice_ids ?? {}) as Record<string, string>,
    greeting_note: row.greeting_note,
    daily_cap: row.daily_cap,
    max_attempts_per_contact: row.max_attempts_per_contact,
    min_days_between_calls: row.min_days_between_calls,
    call_start_hour: row.call_start_hour,
    call_end_hour: row.call_end_hour,
    call_days: row.call_days,
    languages_enabled: row.languages_enabled,
    callback_owner_user_id: row.callback_owner_user_id,
    daily_call_count: row.daily_call_count,
    daily_call_date: row.daily_call_date,
  };
}

/** Decrypt the provider API key (env var wins so ops can override). */
export function providerApiKey(row: SettingsRow): string | null {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  if (!row.provider_api_key_encrypted) return null;
  try {
    return decrypt(row.provider_api_key_encrypted);
  } catch {
    return null;
  }
}

export function encryptProviderApiKey(plain: string): string {
  return encrypt(plain.trim());
}

/**
 * Webhook secret for our inbound provider webhooks. Generated once on first
 * use so the webhook URLs shown in the settings UI are stable.
 */
export async function ensureWebhookSecret(
  supabase: Client,
  row: SettingsRow,
): Promise<string> {
  if (row.webhook_secret) return row.webhook_secret;
  const secret = crypto.randomUUID().replace(/-/g, "");
  await supabase
    .from("call_agent_settings")
    .update({ webhook_secret: secret })
    .eq("workspace_id", row.workspace_id);
  return secret;
}

/**
 * Consume one unit of the daily call budget. Returns false when the cap is
 * reached (the caller should skip, not dial). Counter resets by date compare,
 * mirroring workspace_ai_settings.daily_email_gen_count.
 */
export async function consumeDailyBudget(
  supabase: Client,
  row: SettingsRow,
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const count = row.daily_call_date === today ? row.daily_call_count : 0;
  if (count >= row.daily_cap) return false;
  await supabase
    .from("call_agent_settings")
    .update({ daily_call_count: count + 1, daily_call_date: today })
    .eq("workspace_id", row.workspace_id);
  row.daily_call_count = count + 1;
  row.daily_call_date = today;
  return true;
}
