import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/ceo/env";

export function isSyncRequestAuthorized(request: NextRequest): boolean {
  const syncSecret = getEnv("SYNC_SECRET");
  const cronSecret = getEnv("CRON_SECRET");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const explicitSecret = request.headers.get("x-sync-secret");
  const providedSecret = bearer || explicitSecret;

  if (!syncSecret && !cronSecret) {
    return process.env.NODE_ENV !== "production";
  }

  return (
    (Boolean(syncSecret) && providedSecret === syncSecret) ||
    (Boolean(cronSecret) && providedSecret === cronSecret)
  );
}
