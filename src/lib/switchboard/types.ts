// Shared (client-safe) types for the switchboard / telefonväxel. No server
// imports here — the settings page and the API routes both use these.

export interface SwitchboardTarget {
  id: string;
  user_id: string | null;
  label: string;
  aliases: string[];
  /** Resolved number that will actually ring (override, or the user's own). */
  phone: string | null;
  /** True when `phone` came from the user's profile rather than an override. */
  phone_from_profile: boolean;
  failover_target_id: string | null;
  enabled: boolean;
  sort_order: number;
}

export interface SwitchboardSettings {
  workspace_id: string;
  enabled: boolean;
  number: string | null;
  provider: string;
  /** True when a key is available (the key itself never leaves the server). */
  has_api_key: boolean;
  provider_agent_id: string | null;
  provider_phone_number_id: string | null;
  provider_kb_doc_id: string | null;
  persona_name: string;
  voice_id: string | null;
  greeting_note: string | null;
  languages_enabled: string[];
  answer_questions: boolean;
  take_messages: boolean;
  book_callbacks: boolean;
  open_hour: number;
  close_hour: number;
  open_days: number[];
  ring_seconds: number;
  voicemail_enabled: boolean;
  max_call_seconds: number;
}

export const SWITCHBOARD_DEFAULTS = {
  persona_name: "Mark",
  languages_enabled: ["sv", "en"],
  answer_questions: true,
  take_messages: true,
  book_callbacks: true,
  open_hour: 9,
  close_hour: 17,
  open_days: [1, 2, 3, 4, 5],
  ring_seconds: 25,
  voicemail_enabled: true,
  max_call_seconds: 600,
};

/**
 * "Henrik - Calm and composed" from the public shared library: a standard-accent
 * middle-aged Swedish male marked for conversational use. Chosen over the more
 * popular alternatives because the others are either narration voices or carry a
 * regional accent (Scanian / Gothenburg) that reads as local rather than
 * national on a company line.
 */
export const DEFAULT_SWITCHBOARD_VOICE = {
  sharedVoiceId: "SrEXuatZsaPiMUKtNYnc",
  publicOwnerId: "64cbc624eb5aab4e95a968e1f41d75402277cca6e549036ed17e56ea33bbbc9e",
  name: "Wrenchlane Reception (Henrik)",
};

/** Outcome labels for the calls table on the Phone System page. */
export const SWITCHBOARD_OUTCOME_LABEL: Record<string, string> = {
  handled_by_agent: "Handled by the receptionist",
  forwarded: "Put through to a human",
  no_answer: "Nobody answered",
  voicemail: "Voicemail left",
  message_taken: "Message taken",
  callback_booked: "Callback booked",
  abandoned: "Caller hung up",
  rejected: "Not answered (switchboard off)",
};

/**
 * Is `date` inside the switchboard's staffed hours? Outside them the
 * receptionist takes a message instead of ringing anyone.
 *
 * Hours are Stockholm-local to match the rest of the CRM's range handling.
 */
export function isWithinOfficeHours(
  date: Date,
  settings: Pick<SwitchboardSettings, "open_hour" | "close_hour" | "open_days">,
): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "";
  const isoByName: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const iso = isoByName[weekdayName];
  if (!iso || hour < 0) return false;

  if (!settings.open_days.includes(iso)) return false;
  return hour >= settings.open_hour && hour < settings.close_hour;
}

/**
 * Match what the caller asked for against the configured targets.
 *
 * Deliberately conservative: an exact label/alias match, then a whole-word
 * containment match. We never fuzzy-match, because putting a caller through to
 * the wrong person is worse than asking them to repeat the name.
 */
export function matchTarget<T extends { label: string; aliases: string[]; enabled: boolean }>(
  requested: string | null | undefined,
  targets: T[],
): T | null {
  const q = (requested ?? "").trim().toLowerCase();
  if (!q) return null;
  const live = targets.filter((t) => t.enabled);

  const names = (t: T) => [t.label, ...(t.aliases ?? [])].map((s) => s.toLowerCase().trim());

  const exact = live.find((t) => names(t).includes(q));
  if (exact) return exact;

  // Whole-word containment, e.g. caller said "can I speak to hans please".
  const words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const wordHit = live.find((t) => names(t).some((n) => n && words.includes(n)));
  if (wordHit) return wordHit;

  return null;
}
