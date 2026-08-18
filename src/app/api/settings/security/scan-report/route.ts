// Machine endpoint for the scheduled GitHub Actions static scan
// (.github/workflows/security-scan.yml) to report its results into the Hacker
// Rating page. Secret-authed (Bearer CRON_SECRET/SYNC_SECRET) — NOT a
// user-session route — because CI has no Supabase session.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const syncSecret = process.env.SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = bearer || request.headers.get("x-sync-secret");
  if (!syncSecret && !cronSecret) return process.env.NODE_ENV !== "production";
  return (
    (Boolean(syncSecret) && provided === syncSecret) ||
    (Boolean(cronSecret) && provided === cronSecret)
  );
}

const Body = z.object({
  passed: z.boolean(),
  severity_counts: z.record(z.string(), z.number()).default({}),
  details: z
    .array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().optional() }))
    .default([]),
  duration_ms: z.number().int().nonnegative().optional(),
});

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { passed, severity_counts, details, duration_ms } = parsed.data;
  const supabase = createServiceClient();
  const { error } = await supabase.from("security_scans").insert({
    scan_type: "ci_static",
    passed,
    severity_counts,
    details,
    duration_ms: duration_ms ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "ok" });
}
