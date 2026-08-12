import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Standard member gate for the call-agent API routes. */
export async function requireMember(): Promise<
  | { ok: true; workspaceId: string; userId: string }
  | { ok: false; status: number; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return { ok: false, status: 404, error: "No workspace found" };

  return { ok: true, workspaceId: membership.workspace_id, userId: user.id };
}
