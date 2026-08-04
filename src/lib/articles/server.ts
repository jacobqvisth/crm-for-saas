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
 * Articles is a shared team resource, exactly like Forums.
 *
 * The content board holds no per-user secrets and Wrenchlane runs this CRM as a
 * single team, so every Articles API resolves to the one canonical company
 * workspace regardless of which login is in use. Without this, Jacob's two
 * logins would each see a different, half-empty library. RLS on the `articles`
 * table is opened to any authenticated user to match; see the migration.
 *
 * Same constant as SHARED_FORUMS_WORKSPACE_ID. It is duplicated rather than
 * imported so that Articles does not take a dependency on the forums module for
 * a single ID, and so either feature can move workspace without the other.
 */
export const SHARED_ARTICLES_WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";

export async function resolveArticlesWorkspace(): Promise<WorkspaceOk | WorkspaceErr> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { supabase, userId: user.id, workspaceId: SHARED_ARTICLES_WORKSPACE_ID };
}
