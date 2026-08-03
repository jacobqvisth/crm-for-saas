import { NextResponse, type NextRequest } from "next/server";
import { SOURCE_KEYS } from "@/lib/ceo/sources";
import { isSyncRequestAuthorized } from "@/lib/ceo/sync/auth";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export const runtime = "nodejs";
// Runs every source in one request, so it needs at least as much headroom as
// the single-source route. See the note there on batched upserts.
export const maxDuration = 300;

async function runAll(request: NextRequest) {
  if (!isSyncRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = [];
  for (const sourceKey of SOURCE_KEYS) {
    results.push(await runSourceSync(sourceKey));
  }

  const failed = results.some((result) => result.status === "failed");

  return NextResponse.json(
    {
      status: failed ? "failed" : "ok",
      results,
    },
    { status: failed ? 500 : 200 },
  );
}

export async function POST(request: NextRequest) {
  return runAll(request);
}

export async function GET(request: NextRequest) {
  return runAll(request);
}
