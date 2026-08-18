import "server-only";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { decrypt, encrypt } from "@/lib/encryption";
import { normalizePhone } from "@/lib/calls/phone";
import {
  SWITCHBOARD_DEFAULTS,
  type SwitchboardSettings,
  type SwitchboardTarget,
} from "./types";

type Client = SupabaseClient<Database>;
export type SwitchboardRow = Tables<"switchboard_settings">;
export type SwitchboardTargetRow = Tables<"switchboard_targets">;

/** Load (or lazily create) the workspace's switchboard settings row. */
export async function loadSwitchboardRow(
  supabase: Client,
  workspaceId: string,
): Promise<SwitchboardRow> {
  const { data } = await supabase
    .from("switchboard_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (data) return data;

  const { data: inserted, error } = await supabase
    .from("switchboard_settings")
    .insert({ workspace_id: workspaceId, ...SWITCHBOARD_DEFAULTS })
    .select("*")
    .single();
  if (error || !inserted) {
    throw new Error(`switchboard_settings insert failed: ${error?.message}`);
  }
  return inserted;
}

/**
 * Resolve the provider API key.
 *
 * Order: env (so ops can override without touching the DB) → this workspace's
 * own switchboard key → the workspace's call_agent key. The last step means the
 * switchboard works out of the box for a workspace that already provisioned the
 * outbound agent, instead of asking for the same key twice.
 */
export async function switchboardApiKey(
  supabase: Client,
  row: SwitchboardRow,
): Promise<string | null> {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;

  if (row.provider_api_key_encrypted) {
    try {
      return decrypt(row.provider_api_key_encrypted);
    } catch {
      /* fall through to the shared key */
    }
  }

  const { data } = await supabase
    .from("call_agent_settings")
    .select("provider_api_key_encrypted")
    .eq("workspace_id", row.workspace_id)
    .maybeSingle();
  if (data?.provider_api_key_encrypted) {
    try {
      return decrypt(data.provider_api_key_encrypted);
    } catch {
      return null;
    }
  }
  return null;
}

export function encryptProviderApiKey(plain: string): string {
  return encrypt(plain);
}

/** Shared secret our provider-facing webhooks (tools, initiation) check. */
export async function ensureWebhookSecret(
  supabase: Client,
  row: SwitchboardRow,
): Promise<string> {
  if (row.webhook_secret) return row.webhook_secret;
  const secret = crypto.randomUUID().replace(/-/g, "");
  await supabase
    .from("switchboard_settings")
    .update({ webhook_secret: secret })
    .eq("workspace_id", row.workspace_id);
  return secret;
}

/** Client-safe view: never leaks the API key itself. */
export function toClientSettings(row: SwitchboardRow, hasKey: boolean): SwitchboardSettings {
  return {
    workspace_id: row.workspace_id,
    enabled: row.enabled,
    number: row.number,
    provider: row.provider,
    has_api_key: hasKey,
    provider_agent_id: row.provider_agent_id,
    provider_phone_number_id: row.provider_phone_number_id,
    provider_kb_doc_id: row.provider_kb_doc_id,
    persona_name: row.persona_name,
    voice_id: row.voice_id,
    greeting_note: row.greeting_note,
    languages_enabled: row.languages_enabled,
    answer_questions: row.answer_questions,
    take_messages: row.take_messages,
    book_callbacks: row.book_callbacks,
    open_hour: row.open_hour,
    close_hour: row.close_hour,
    open_days: row.open_days,
    ring_seconds: row.ring_seconds,
    voicemail_enabled: row.voicemail_enabled,
    max_call_seconds: row.max_call_seconds,
  };
}

/**
 * Load the transfer targets with their phone numbers resolved.
 *
 * A target's number defaults to the user's own `user_profiles.call_agent_phone`
 * so a rep changes their phone in one place (Calling settings) and both their
 * own dialling and the switchboard follow. An explicit `phone` on the target
 * overrides that, for a shared line or someone without a CRM login.
 */
export async function loadTargets(
  supabase: Client,
  workspaceId: string,
): Promise<SwitchboardTarget[]> {
  const { data: rows } = await supabase
    .from("switchboard_targets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (!rows?.length) return [];

  const userIds = rows.map((r) => r.user_id).filter((v): v is string => Boolean(v));
  const phoneByUser = new Map<string, string | null>();
  const webrtcByUser = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, call_agent_phone, call_enabled, call_webrtc_number")
      .in("user_id", userIds);
    for (const p of profiles ?? []) {
      // A rep who switched calling off should not be rung by the switchboard.
      const off = p.call_enabled === false;
      phoneByUser.set(p.user_id, off ? null : p.call_agent_phone);
      webrtcByUser.set(p.user_id, off ? null : p.call_webrtc_number);
    }
  }

  return rows.map((r) => {
    const override = normalizePhone(r.phone);
    const fromProfile = r.user_id ? normalizePhone(phoneByUser.get(r.user_id) ?? null) : null;
    return {
      id: r.id,
      user_id: r.user_id,
      label: r.label,
      aliases: r.aliases ?? [],
      phone: override ?? fromProfile,
      phone_from_profile: !override && Boolean(fromProfile),
      // Only when the phone comes from their profile: an explicit override means
      // "ring this number", not "ring this person wherever they are".
      webrtc_number:
        !override && r.user_id ? normalizePhone(webrtcByUser.get(r.user_id) ?? null) : null,
      failover_target_id: r.failover_target_id,
      enabled: r.enabled,
      sort_order: r.sort_order,
    };
  });
}
