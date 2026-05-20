import { WRENCHLANE_KNOWLEDGE } from "./wrenchlane-knowledge";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve the AI product knowledge for a workspace.
 *
 * The canonical content is editable from /settings/ai-knowledge and stored in
 * `workspace_ai_knowledge.content_md`. When a workspace has not customised it,
 * we fall back to the seed at src/lib/inbox/wrenchlane-knowledge.ts so the AI
 * always has *some* grounding to work from.
 *
 * Returns the markdown plus a flag indicating whether it came from the DB or
 * the seed — useful for the settings UI to show "currently using defaults".
 */
export async function loadWrenchlaneKnowledge(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{ contentMd: string; source: "db" | "seed"; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("workspace_ai_knowledge")
    .select("content_md, updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !data?.content_md) {
    return { contentMd: WRENCHLANE_KNOWLEDGE, source: "seed", updatedAt: null };
  }

  return { contentMd: data.content_md, source: "db", updatedAt: data.updated_at ?? null };
}

export const DEFAULT_KNOWLEDGE = WRENCHLANE_KNOWLEDGE;
