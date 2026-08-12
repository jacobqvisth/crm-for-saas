// Shared (client-safe) types for the AI call agent. No server imports here —
// the settings page and API routes both use these.

export type CallAgentMode = "approve_each" | "autonomous";

export type CallAgentJobStatus =
  | "pending_approval"
  | "queued"
  | "processing"
  | "calling"
  | "done"
  | "failed"
  | "skipped"
  | "dismissed";

export interface CallAgentSettings {
  workspace_id: string;
  enabled: boolean;
  mode: CallAgentMode;
  provider: string;
  /** True when an API key is stored (the key itself never leaves the server). */
  has_api_key: boolean;
  provider_agent_ids: Record<string, string>;
  provider_kb_doc_id: string | null;
  persona_name: string;
  voice_ids: Record<string, string>;
  greeting_note: string | null;
  daily_cap: number;
  max_attempts_per_contact: number;
  min_days_between_calls: number;
  call_start_hour: number;
  call_end_hour: number;
  call_days: number[];
  languages_enabled: string[];
  callback_owner_user_id: string | null;
  daily_call_count: number;
  daily_call_date: string | null;
}

export const CALL_AGENT_DEFAULTS = {
  mode: "approve_each" as CallAgentMode,
  persona_name: "Elsa",
  daily_cap: 10,
  max_attempts_per_contact: 2,
  min_days_between_calls: 30,
  call_start_hour: 9,
  call_end_hour: 16,
  call_days: [1, 2, 3, 4, 5],
  languages_enabled: ["sv", "en"],
};

/** Which agent language a contact should get. */
export function pickAgentLanguage(
  contactLanguage: string | null | undefined,
  countryCode: string | null | undefined,
  enabled: string[],
): string {
  const lang = contactLanguage?.slice(0, 2).toLowerCase();
  if (lang && enabled.includes(lang)) return lang;
  const cc = (countryCode ?? "").toUpperCase();
  if (cc === "SE" && enabled.includes("sv")) return "sv";
  return enabled.includes("en") ? "en" : (enabled[0] ?? "en");
}
