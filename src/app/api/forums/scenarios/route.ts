import { NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/forums/server";
import { getForumScenarios } from "@/lib/forums/scenarios";

// GET /api/forums/scenarios → { scenarios: ForumScenario[] }
// Real diagnostic scenarios (from dashboard_diagnostics) to seed posts from.
// Auth-gated like the rest of the page; the data itself is workspace-agnostic
// (it's the synced CEO analytics data, same as /dashboard/diagnostics).
export async function GET() {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;

  try {
    const scenarios = await getForumScenarios();
    return NextResponse.json({ scenarios });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load scenarios" },
      { status: 500 },
    );
  }
}
