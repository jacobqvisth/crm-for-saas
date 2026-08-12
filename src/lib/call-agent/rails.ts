import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { isWithinSendWindow } from "@/lib/sequences/scheduler";
import type { SequenceSettings } from "@/lib/database.types";
import { resolveExcludedContactIds } from "@/lib/lists/exclusions";
import { isDialable, normalizePhone } from "@/lib/calls/phone";

type Client = SupabaseClient<Database>;
type SettingsRow = Tables<"call_agent_settings">;

/**
 * Every gate that must pass before the agent dials a contact. Ordered cheap →
 * expensive; the first failure wins and becomes the job's skip_reason. The
 * agent NEVER has an override path — unlike the human dial route, there is no
 * `override` flag here by design.
 */
export type RailResult = { ok: true } | { ok: false; reason: string };

const COUNTRY_TZ: Record<string, string> = {
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  DK: "Europe/Copenhagen",
  FI: "Europe/Helsinki",
  DE: "Europe/Berlin",
  NL: "Europe/Amsterdam",
  GB: "Europe/London",
  IE: "Europe/Dublin",
  PL: "Europe/Warsaw",
  RO: "Europe/Bucharest",
  BG: "Europe/Sofia",
  LT: "Europe/Vilnius",
  LV: "Europe/Riga",
  EE: "Europe/Tallinn",
  HR: "Europe/Zagreb",
  HU: "Europe/Budapest",
  CZ: "Europe/Prague",
  UA: "Europe/Kyiv",
  US: "America/New_York",
};

export function contactTimezone(countryCode: string | null | undefined): string {
  return COUNTRY_TZ[(countryCode ?? "").toUpperCase()] ?? "Europe/Stockholm";
}

/** Calling-hours gate, DST-aware via the sequences scheduler. */
export function withinCallingHours(
  settings: SettingsRow,
  countryCode: string | null | undefined,
  at: Date = new Date(),
): boolean {
  const window = {
    timezone: contactTimezone(countryCode),
    send_start_hour: settings.call_start_hour,
    send_end_hour: settings.call_end_hour,
    send_days: settings.call_days,
  } as SequenceSettings;
  return isWithinSendWindow(window, at);
}

export interface RailCheckInput {
  settings: SettingsRow;
  contact: {
    id: string;
    phone: string | null;
    country_code: string | null;
    company_id: string | null;
    email?: string | null;
  };
  campaignKey: string | null;
}

export async function checkRails(
  supabase: Client,
  input: RailCheckInput,
): Promise<RailResult> {
  const { settings, contact } = input;

  if (!settings.enabled) return { ok: false, reason: "agent disabled" };

  if (!contact.phone || !isDialable(contact.phone, contact.country_code)) {
    return { ok: false, reason: "no dialable phone" };
  }

  if (!withinCallingHours(settings, contact.country_code)) {
    return { ok: false, reason: "outside calling hours" };
  }

  // Hard company-level blocks (same gates as the human dial route, no override).
  if (contact.company_id) {
    const { data: company } = await supabase
      .from("companies")
      .select("do_not_contact, nix_blocked")
      .eq("id", contact.company_id)
      .maybeSingle();
    if (company?.do_not_contact) return { ok: false, reason: "company do_not_contact" };
    if (company?.nix_blocked) return { ok: false, reason: "company nix_blocked" };
  }

  // Managed exclusion sets. never_call is always on for calling; the agent
  // additionally excludes internal testers (a human may call a colleague to
  // test — the robot may not, except through the explicit test-call route).
  const excluded = await resolveExcludedContactIds(supabase, settings.workspace_id, {
    groups: ["never_call", "internal_testers"],
    lists: [],
  });
  if (excluded.has(contact.id)) return { ok: false, reason: "contact excluded (never_call / internal)" };

  // Unified suppressions (email-keyed today; a DNC there means "leave alone").
  if (contact.email) {
    const { data: sup } = await supabase
      .from("suppressions")
      .select("id")
      .eq("workspace_id", settings.workspace_id)
      .eq("email", contact.email.toLowerCase())
      .limit(1);
    if (sup && sup.length > 0) return { ok: false, reason: "suppressed" };
  }

  // Attempt + cool-down limits against prior agent jobs for this contact.
  const { data: prior } = await supabase
    .from("call_agent_jobs")
    .select("id, status, campaign_key, finished_at")
    .eq("contact_id", contact.id)
    .in("status", ["done", "failed"])
    .order("finished_at", { ascending: false })
    .limit(20);

  const priorJobs = prior ?? [];
  const sameCampaign = priorJobs.filter(
    (j) => (j.campaign_key ?? null) === (input.campaignKey ?? null),
  );
  if (sameCampaign.length >= settings.max_attempts_per_contact) {
    return { ok: false, reason: "max attempts reached" };
  }
  const lastDone = priorJobs.find((j) => j.status === "done" && j.finished_at);
  if (lastDone?.finished_at) {
    const days = (Date.now() - new Date(lastDone.finished_at).getTime()) / 86_400_000;
    if (days < settings.min_days_between_calls) {
      return { ok: false, reason: `called ${Math.floor(days)}d ago (cool-down)` };
    }
  }

  return { ok: true };
}

/** Normalized E.164 number for the dial, or null. */
export function dialablePhone(
  phone: string | null,
  countryCode: string | null,
): string | null {
  if (!phone) return null;
  return normalizePhone(phone, countryCode ?? undefined);
}
