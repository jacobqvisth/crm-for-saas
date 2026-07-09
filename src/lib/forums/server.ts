import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ForumCommentAssignment } from "./types";
import type { PersonaMember } from "./thread-analyze";

type DB = Awaited<ReturnType<typeof createClient>>;

interface WorkspaceOk {
  supabase: DB;
  userId: string;
  workspaceId: string;
  error?: undefined;
}
interface WorkspaceErr {
  error: NextResponse;
  supabase?: undefined;
}

/**
 * The Forums feature (distribution board, team comment drafts, Reddit roster,
 * answer posts) is a SHARED team resource, not per-tenant data — it holds no
 * per-user secrets. Wrenchlane runs this CRM as one team, so every forum API
 * resolves to this single shared workspace regardless of which account is
 * logged in. That way everyone with a CRM account (Jacob's two logins today,
 * Francis and others later) sees the exact same board.
 *
 * This is the canonical company workspace ("My Workspace") — the oldest one,
 * where all existing forum data already lives. RLS on the forum_* +
 * reddit_accounts tables is opened to any authenticated user to match; see
 * migration 20260709000000_forums_shared_across_users.sql.
 */
export const SHARED_FORUMS_WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";

/**
 * Resolve the authenticated user for a forum API. Unlike other workspace-scoped
 * features, forums are shared across the whole team, so every provisioned CRM
 * user resolves to SHARED_FORUMS_WORKSPACE_ID rather than their own workspace.
 */
export async function resolveWorkspace(): Promise<WorkspaceOk | WorkspaceErr> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  // Must be a provisioned CRM user (member of some workspace), but the forum
  // board they see is always the shared one — not their own workspace.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) {
    return { error: NextResponse.json({ error: "No workspace" }, { status: 403 }) };
  }

  return { supabase, userId: user.id, workspaceId: SHARED_FORUMS_WORKSPACE_ID };
}

/**
 * Fetch per-member comment assignments for a batch of forum items and group
 * them by source_id, so a GET can attach `assignments` to each rec/post.
 * Members are returned owner-label A→Z for stable rendering.
 */
export async function fetchAssignmentsBySource(
  supabase: DB,
  workspaceId: string,
  source: "distribution" | "post",
  ids: string[],
): Promise<Map<string, ForumCommentAssignment[]>> {
  const grouped = new Map<string, ForumCommentAssignment[]>();
  if (ids.length === 0) return grouped;

  const { data } = await supabase
    .from("forum_comment_assignments")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("source", source)
    .in("source_id", ids)
    .order("owner_label", { ascending: true });

  for (const row of (data ?? []) as unknown as ForumCommentAssignment[]) {
    const list = grouped.get(row.source_id) ?? [];
    list.push(row);
    grouped.set(row.source_id, list);
  }
  return grouped;
}

/**
 * Load the active roster with persona flags, one entry per team member, for the
 * thread analyzer. De-dupes by owner_label (a member may run several accounts)
 * — persona is OR'd across their accounts so any capability they hold counts.
 */
export async function loadPersonaRoster(
  supabase: DB,
  workspaceId: string,
): Promise<PersonaMember[]> {
  const { data } = await supabase
    .from("reddit_accounts")
    .select(
      "id, owner_label, turns_wrenches, uses_ai_tools, can_mention_wrenchlane, persona_note",
    )
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .order("owner_label", { ascending: true });

  const byLabel = new Map<string, PersonaMember>();
  for (const r of data ?? []) {
    const existing = byLabel.get(r.owner_label);
    if (existing) {
      existing.turns_wrenches ||= Boolean(r.turns_wrenches);
      existing.uses_ai_tools ||= Boolean(r.uses_ai_tools);
      existing.can_mention_wrenchlane ||= Boolean(r.can_mention_wrenchlane);
      if (!existing.persona_note && r.persona_note) existing.persona_note = r.persona_note;
      continue;
    }
    byLabel.set(r.owner_label, {
      owner_label: r.owner_label,
      account_id: r.id,
      turns_wrenches: Boolean(r.turns_wrenches),
      uses_ai_tools: Boolean(r.uses_ai_tools),
      can_mention_wrenchlane: Boolean(r.can_mention_wrenchlane),
      persona_note: r.persona_note ?? null,
    });
  }
  return [...byLabel.values()];
}
