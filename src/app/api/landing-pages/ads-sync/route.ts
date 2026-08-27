import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createGoogleAdsAccess,
  hasGoogleAdsApiCredentials,
} from "@/lib/ceo/sync/google-ads-client";
import { SyncSkippedError } from "@/lib/ceo/sync/errors";
import { isSyncRequestAuthorized } from "@/lib/ceo/sync/auth";
import {
  applyCompetitorSync,
  planCompetitorSync,
  readAdGroups,
} from "@/lib/landing/ads-sync";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Reconcile Google Ads against the landing-page programme.
 *
 *   GET   returns the plan and changes nothing.
 *   POST  applies it, and only with an explicit confirmation string.
 *
 * The confirmation is not ceremony. This endpoint edits a live ad account that
 * is currently spending money, and the difference between "show me what you
 * would do" and "do it" should not be a single boolean that a mistyped fetch
 * could flip. A plan that was never applied costs nothing; a mutate that should
 * not have run costs real money and is tedious to unwind by hand.
 */

const bodySchema = z.object({
  apply: z.boolean().default(false),
  /** Must be the literal string below before anything is written. */
  confirm: z.string().optional(),
});

const CONFIRM_PHRASE = "retarget-competitor-ads";

function credentialsProblem() {
  return NextResponse.json(
    {
      configured: false,
      error:
        "Google Ads API is not configured. GOOGLE_ADS_CUSTOMER_ID is set but GOOGLE_ADS_DEVELOPER_TOKEN is missing, and the client requires both. Add the 22-character token from the manager account's API Center to the Vercel production environment.",
    },
    { status: 409 },
  );
}

export async function GET(request: NextRequest) {
  if (!isSyncRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasGoogleAdsApiCredentials()) return credentialsProblem();

  try {
    const access = await createGoogleAdsAccess();
    const observed = await readAdGroups(access);
    const plan = planCompetitorSync(observed);
    return NextResponse.json({ configured: true, dryRun: true, plan });
  } catch (err) {
    if (err instanceof SyncSkippedError) {
      return NextResponse.json(
        { configured: false, error: err.message },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSyncRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasGoogleAdsApiCredentials()) return credentialsProblem();

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const wantsApply = parsed.data.apply;
  if (wantsApply && parsed.data.confirm !== CONFIRM_PHRASE) {
    return NextResponse.json(
      {
        error: `Refusing to write to the ad account without confirm: "${CONFIRM_PHRASE}".`,
      },
      { status: 400 },
    );
  }

  try {
    const access = await createGoogleAdsAccess();
    const observed = await readAdGroups(access);
    const plan = planCompetitorSync(observed);
    const result = await applyCompetitorSync(access, plan, observed, {
      dryRun: !wantsApply,
    });
    return NextResponse.json({ configured: true, plan, result });
  } catch (err) {
    if (err instanceof SyncSkippedError) {
      return NextResponse.json(
        { configured: false, error: err.message },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
