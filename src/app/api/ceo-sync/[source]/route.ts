import { NextResponse, type NextRequest } from "next/server";
import { isSourceKey } from "@/lib/ceo/sources";
import { isSyncRequestAuthorized } from "@/lib/ceo/sync/auth";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export const runtime = "nodejs";

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
