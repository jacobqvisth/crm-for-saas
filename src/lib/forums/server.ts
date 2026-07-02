import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
 * Resolve the authenticated user + their workspace. Mirrors
 * src/lib/videos/server.ts — the same auth/membership guard used across the
 * workspace-scoped APIs.
 */
export async function resolveWorkspace(): Promise<WorkspaceOk | WorkspaceErr> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) {
    return { error: NextResponse.json({ error: "No workspace" }, { status: 403 }) };
  }

  return { supabase, userId: user.id, workspaceId: membership.workspace_id };
}
