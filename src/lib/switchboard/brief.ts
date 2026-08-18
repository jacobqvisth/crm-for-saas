import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { normalizePhone } from "@/lib/calls/phone";
import { isWithinOfficeHours, type SwitchboardTarget } from "./types";
import type { SwitchboardRow } from "./settings";

type Client = SupabaseClient<Database>;

export interface CallerMatch {
  contactId: string | null;
  companyId: string | null;
  displayName: string | null;
  companyName: string | null;
  historyLine: string;
}

/**
 * Identify an inbound caller from their number.
 *
 * Matched on the normalized phone against contacts, then the shared phone pool
 * (`phone_numbers`, which is keyed on company, so a workshop's switchboard
 * number still resolves to the right company even when no individual contact
 * carries it).
 */
export async function matchCaller(
  supabase: Client,
  workspaceId: string,
  callerNumber: string | null,
): Promise<CallerMatch> {
  const empty: CallerMatch = {
    contactId: null,
    companyId: null,
    displayName: null,
    companyName: null,
    historyLine: "No previous contact on record",
  };
  const phone = normalizePhone(callerNumber);
  if (!phone) return empty;

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, company_id")
    .eq("workspace_id", workspaceId)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();

  let companyId = contact?.company_id ?? null;
  let contactId = contact?.id ?? null;
  if (!companyId || !contactId) {
    // The shared pool stores the number as `number` and may carry a contact of
    // its own, so a workshop's main line still resolves even when no individual
    // contact record has that number on it.
    const { data: pooled } = await supabase
      .from("phone_numbers")
      .select("company_id, contact_id")
      .eq("workspace_id", workspaceId)
      .eq("number", phone)
      .limit(1)
      .maybeSingle();
    companyId = companyId ?? pooled?.company_id ?? null;
    contactId = contactId ?? pooled?.contact_id ?? null;
  }

  let companyName: string | null = null;
  if (companyId) {
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    companyName = company?.name ?? null;
  }

  if (!contactId && !companyId) return empty;

  // The contact may have come from the shared pool rather than the lookup above,
  // in which case we still want a name to greet them by.
  let named = contact;
  if (!named && contactId) {
    const { data } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, company_id")
      .eq("id", contactId)
      .maybeSingle();
    named = data ?? null;
  }

  const displayName =
    [named?.first_name, named?.last_name].filter(Boolean).join(" ").trim() || null;

  return {
    contactId,
    companyId,
    displayName,
    companyName,
    historyLine: await buildHistoryLine(supabase, contactId, companyId),
  };
}

/**
 * One short sentence of context for the receptionist. Deliberately terse: it is
 * spoken-word context, not a file to read out, and a long history line makes the
 * model recite instead of converse.
 */
async function buildHistoryLine(
  supabase: Client,
  contactId: string | null,
  companyId: string | null,
): Promise<string> {
  if (!contactId && !companyId) return "No previous contact on record";

  const parts: string[] = [];

  if (contactId) {
    const { data: lastCall } = await supabase
      .from("call_sessions")
      .select("created_at, direction")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastCall) {
      const days = Math.floor(
        (Date.now() - new Date(lastCall.created_at).getTime()) / 86_400_000,
      );
      const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
      parts.push(`last spoke ${when}`);
    }

    const { count } = await supabase
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contactId);
    if (count) parts.push(`${count} interactions on record`);
  }

  if (!parts.length) return "Known to us, but no interactions logged yet";
  return parts.join(", ");
}

/**
 * The dynamic variables the receptionist is given at the start of a call.
 *
 * `available_people` and `office_status` matter: without them the agent happily
 * offers to transfer to someone whose phone is not even configured, and promises
 * a transfer at 22:00 on a Sunday.
 */
export function buildSwitchboardVariables(params: {
  row: SwitchboardRow;
  caller: CallerMatch;
  targets: SwitchboardTarget[];
  now?: Date;
}): Record<string, string> {
  const now = params.now ?? new Date();
  const open = isWithinOfficeHours(now, params.row);
  const reachable = params.targets.filter((t) => t.enabled && t.phone);

  return {
    caller_name: params.caller.displayName ?? "there",
    caller_known: params.caller.contactId || params.caller.companyId ? "yes" : "no",
    caller_company: params.caller.companyName ?? "an unknown company",
    caller_history: params.caller.historyLine,
    available_people: open && reachable.length ? reachable.map((t) => t.label).join(", ") : "nobody",
    office_status: open ? "open" : "closed",
    company_name: "Wrenchlane",
  };
}
