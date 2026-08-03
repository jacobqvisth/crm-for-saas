import { NextResponse, type NextRequest } from "next/server";
import { isSourceKey } from "@/lib/ceo/sources";
import { isSyncRequestAuthorized } from "@/lib/ceo/sync/auth";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export const runtime = "nodejs";
// The writer batches each table's upsert into several statements to stay under
// PostgREST's 8s statement_timeout, which trades one long statement for more
// round-trips. Give the whole run explicit headroom rather than leaning on the
// platform default.
export const maxDuration = 300;

async function handle(
  request: NextRequest,
  context: { params: Promise<{ source: string }> },
) {
  if (!isSyncRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { source } = await context.params;
  if (!isSourceKey(source)) {
    return NextResponse.json({ error: "Unknown source" }, { status: 404 });
  }

  const result = await runSourceSync(source);
  const status = result.status === "failed" ? 500 : 200;

  return NextResponse.json(result, { status });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ source: string }> },
) {
  return handle(request, context);
}

// Vercel cron fires GET by default. Same auth + behavior as POST.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ source: string }> },
) {
  return handle(request, context);
}
