import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { resolveListContactIds, type ResolvableList } from "@/lib/lists/filter-query";
import { loadInternalTestSets } from "@/lib/ceo/internal-test/loader";
import { INTERNAL_TEST_EMAIL_DOMAINS } from "@/lib/ceo/internal-test/auto-flag";
import {
  hasAnyExclusion,
  type ListExclusions,
} from "@/lib/lists/exclusion-types";

// Re-export the client-safe types/helpers so server callers have one import.
export {
  EXCLUSION_GROUPS,
  EMPTY_EXCLUSIONS,
  parseListExclusions,
  hasAnyExclusion,
  mergeExclusions,
  serializeListExclusions,
} from "@/lib/lists/exclusion-types";
export type { ExclusionGroupKey, ListExclusions } from "@/lib/lists/exclusion-types";

// -----------------------------------------------------------------------------
// Per-list exclusion sets.
//
// A contact list (calling OR email) can subtract contacts belonging to one or
// more "exclusion sources" at resolution time. Two built-in groups plus an
// arbitrary set of other lists to subtract:
//
//   never_call        -> the managed call_exclusions list (domains/emails/companies).
//                        ALSO applied always-on to every calling surface.
//   internal_testers  -> the internal-test users/workshops that stats already
//                        exclude, mapped onto CRM contacts via wl_user_id +
//                        internal email domains. Kept SEPARATE from never_call:
//                        stats only ever use this set, never the never_call one.
//   lists[]           -> subtract the members of these other lists (e.g. a
//                        "Hans – private deals" list).
//
// This module is server-only: internal_testers needs a service-role client to
// read the global dashboard_* tables, so it must never reach the browser bundle.
// Client code that needs an exclusion-aware resolution calls
// GET /api/lists/[id]/resolve instead.
// -----------------------------------------------------------------------------

type Client = SupabaseClient<Database>;

// Keep .in() lists short — PostgREST encodes them in the URL and long lists
// 414 / silently truncate. Chunk every value-based fetch.
const IN_CHUNK = 100;

/** The always-on exclusions applied to every calling surface. */
export const ALWAYS_ON_CALLING: ListExclusions = { groups: ["never_call"], lists: [] };

/**
 * The managed never-call sets for a workspace, as raw domain/email/company
 * values. Small (typically a handful of rows) so they can be pushed onto a
 * query as negative filters — see {@link applyNeverCallNegativeFilters}.
 */
export type NeverCallSets = { domains: string[]; emails: string[]; companies: string[] };

export async function loadNeverCallSets(
  supabase: Client,
  workspaceId: string,
): Promise<NeverCallSets> {
  const { data } = await supabase
    .from("call_exclusions")
    .select("kind, value")
    .eq("workspace_id", workspaceId);
  const domains: string[] = [];
  const emails: string[] = [];
  const companies: string[] = [];
  for (const e of data ?? []) {
    if (e.kind === "domain") domains.push(e.value.toLowerCase());
    else if (e.kind === "email") emails.push(e.value.toLowerCase());
    else if (e.kind === "company") companies.push(e.value);
  }
  return { domains, emails, companies };
}

/**
 * Layer never-call as negative WHERE clauses onto a `contacts` query builder.
 * Used for count-only queries (playbook counts) where materialising ids would
 * be wasteful. `query` must already be scoped to the workspace.
 */
export function applyNeverCallNegativeFilters<Q>(query: Q, sets: NeverCallSets): Q {
  let q: any = query;
  if (sets.companies.length > 0) {
    q = q.not("company_id", "in", `(${sets.companies.join(",")})`);
  }
  if (sets.emails.length > 0) {
    // Emails are stored as-is; match case-insensitively via the same %@domain
    // trick would over-match, so compare the literal set with a NOT IN.
    q = q.not("email", "in", `(${sets.emails.map((e) => `"${e}"`).join(",")})`);
  }
  for (const domain of sets.domains) {
    q = q.not("email", "ilike", `%@${domain}`);
  }
  return q as Q;
}

/** Collect workspace contact ids whose email ends in @domain (case-insensitive). */
async function idsByDomain(supabase: Client, workspaceId: string, domain: string): Promise<string[]> {
  const out: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("email", `%@${domain}`)
      .range(offset, offset + PAGE - 1);
    const page = data ?? [];
    for (const r of page) out.push(r.id);
    if (page.length < PAGE) break;
  }
  return out;
}

async function idsByColumnIn(
  supabase: Client,
  workspaceId: string,
  column: "email" | "company_id" | "wl_user_id",
  values: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const { data } = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in(column, values.slice(i, i + IN_CHUNK));
    for (const r of data ?? []) out.push(r.id);
  }
  return out;
}

/**
 * Resolve the full set of contact ids to DROP for the given exclusion spec,
 * scoped to one workspace. Empty spec -> empty set. Best-effort: a source that
 * can't be read (e.g. no service key for internal_testers) contributes nothing
 * rather than throwing.
 */
export async function resolveExcludedContactIds(
  supabase: Client,
  workspaceId: string,
  exclusions: ListExclusions,
  opts?: { excludeSelfListId?: string },
): Promise<Set<string>> {
  const excluded = new Set<string>();
  if (!hasAnyExclusion(exclusions)) return excluded;

  // --- never_call: managed call_exclusions -----------------------------------
  if (exclusions.groups.includes("never_call")) {
    const sets = await loadNeverCallSets(supabase, workspaceId);
    if (sets.companies.length > 0) {
      for (const id of await idsByColumnIn(supabase, workspaceId, "company_id", sets.companies)) {
        excluded.add(id);
      }
    }
    if (sets.emails.length > 0) {
      for (const id of await idsByColumnIn(supabase, workspaceId, "email", sets.emails)) {
        excluded.add(id);
      }
    }
    for (const domain of sets.domains) {
      for (const id of await idsByDomain(supabase, workspaceId, domain)) excluded.add(id);
    }
  }

  // --- internal_testers: internal-test users + internal email domains --------
  if (exclusions.groups.includes("internal_testers")) {
    try {
      const sets = await loadInternalTestSets();
      // App users flagged internal (minus per-user exemptions), matched onto
      // CRM contacts via contacts.wl_user_id == dashboard_users.internal_user_id.
      const internalUserIds = [...sets.userIds].filter((id) => !sets.exemptUserIds.has(id));
      if (internalUserIds.length > 0) {
        for (const id of await idsByColumnIn(supabase, workspaceId, "wl_user_id", internalUserIds)) {
          excluded.add(id);
        }
      }
      // Internal email domains catch contacts that have no linked app user.
      for (const domain of INTERNAL_TEST_EMAIL_DOMAINS) {
        for (const id of await idsByDomain(supabase, workspaceId, domain)) excluded.add(id);
      }
      // Explicit email patterns from dashboard_internal_test_patterns.
      const patternEmails = [...sets.emails];
      if (patternEmails.length > 0) {
        for (const id of await idsByColumnIn(supabase, workspaceId, "email", patternEmails)) {
          excluded.add(id);
        }
      }
    } catch {
      // No service access / dashboard tables unavailable — skip this source.
    }
  }

  // --- other lists: subtract their members -----------------------------------
  for (const listId of exclusions.lists) {
    if (opts?.excludeSelfListId && listId === opts.excludeSelfListId) continue;
    const { data: l } = await supabase
      .from("contact_lists")
      .select("id, workspace_id, is_dynamic, filters")
      .eq("id", listId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!l) continue;
    try {
      for (const id of await resolveListContactIds(supabase, l as ResolvableList)) {
        excluded.add(id);
      }
    } catch {
      // A broken referenced list contributes nothing rather than failing the
      // whole resolution.
    }
  }

  return excluded;
}
