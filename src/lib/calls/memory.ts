// No "server-only" marker: the formatter below is unit-tested. The module is
// only ever imported from server-side brief builders.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { voiceSafeInline } from "@/lib/call-agent/sanitize";

type Client = SupabaseClient<Database>;

// Cross-call memory for the voice agent, built from what the CRM already
// stores: every processed call (human, outbound AI, switchboard) leaves an AI
// summary on call_sessions. No separate memory store — the summaries ARE the
// memory; this module just selects and phrases them for a voice prompt.
//
// Kept deliberately compact: the text is injected into a live conversation's
// context, where a long dossier makes the model recite instead of converse.

export interface MemoryCall {
  started_at: string;
  direction: string | null;
  initiated_by: string | null;
  summary: string;
}

const MAX_SUMMARY_CHARS = 280;

/** Cut at a word boundary so the agent never sees a chopped mid-word token. */
function trimSummary(text: string, max = MAX_SUMMARY_CHARS): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max / 2 ? lastSpace : max).trimEnd()}...`;
}

function agePhrase(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "about a month ago" : `about ${months} months ago`;
}

function whoPhrase(call: MemoryCall): string {
  if (call.initiated_by === "agent") return "our AI assistant called them";
  if (call.initiated_by === "switchboard") return "they called our switchboard";
  return call.direction === "inbound" ? "they called us" : "our team called them";
}

/**
 * Phrase the calls as short spoken-context lines, newest first:
 *   "2 days ago, our AI assistant called them: <summary>"
 * Pure so it can be unit-tested without a database.
 */
export function formatCallMemory(calls: MemoryCall[], now: Date = new Date()): string {
  return calls
    .filter((c) => c.summary?.trim())
    .map(
      (c) =>
        `${agePhrase(c.started_at, now)}, ${whoPhrase(c)}: ${voiceSafeInline(
          trimSummary(c.summary),
        )}`,
    )
    .join(" | ");
}

/**
 * The last few summarized calls with this contact (falling back to anyone at
 * the same company, so a workshop's second mechanic still gets continuity).
 * Empty string when there is nothing to remember.
 */
export async function buildRecentCallMemory(
  supabase: Client,
  params: { contactId?: string | null; companyId?: string | null; limit?: number; now?: Date },
): Promise<string> {
  const limit = params.limit ?? 3;

  const fetchBy = async (column: "contact_id" | "company_id", value: string) => {
    const { data } = await supabase
      .from("call_sessions")
      .select("started_at, direction, initiated_by, summary")
      .eq(column, value)
      .not("summary", "is", null)
      .order("started_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as MemoryCall[];
  };

  let calls: MemoryCall[] = [];
  if (params.contactId) calls = await fetchBy("contact_id", params.contactId);
  if (!calls.length && params.companyId) calls = await fetchBy("company_id", params.companyId);
  return formatCallMemory(calls, params.now);
}
