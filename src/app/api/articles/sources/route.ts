import { NextResponse } from "next/server";
import { resolveArticlesWorkspace } from "@/lib/articles/server";
import { loadDiagnosticCandidates, loadStatSources } from "@/lib/articles/sources";
import { statStoryAvailability } from "@/lib/articles/stat-stories";

// Both the diagnostics list and the stat-story availability check read the full
// diagnostics history and, for stats, run two analysers over it. Cheap enough
// (~2.4k rows) but not instant, so give it room.
export const maxDuration = 60;

// GET /api/articles/sources -> { diagnostics: [...], statStories: [...] }
//
// One call powers the whole source picker. The stat stories come back with their
// sample size and an available flag, so the UI can grey out a story that does
// not have enough data behind it yet rather than letting Jacob publish an
// article built on four data points.
export async function GET() {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;

  try {
    const [diagnostics, statSources] = await Promise.all([
      loadDiagnosticCandidates(),
      loadStatSources(),
    ]);

    return NextResponse.json({
      diagnostics,
      statStories: statStoryAvailability(statSources),
      totals: {
        diagnostics: statSources.dtc?.totals.diagnostics ?? 0,
        withCodes: statSources.dtc?.totals.withCodes ?? 0,
        described: statSources.terms?.totals.described ?? 0,
        distinctCodes: statSources.dtc?.totals.distinctBaseCodes ?? 0,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load sources" },
      { status: 500 },
    );
  }
}
