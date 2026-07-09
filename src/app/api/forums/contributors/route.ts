import { NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/forums/server";
import { getContributorLeaderboard } from "@/lib/forums/contributors";

// GET /api/forums/contributors → { leaderboard }
// Per-member contribution totals across every posted forum item (Reddit-detected
// comments + Slack ✅ confirmations), most active first.
export async function GET() {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const leaderboard = await getContributorLeaderboard(supabase, workspaceId);
  return NextResponse.json({ leaderboard });
}
