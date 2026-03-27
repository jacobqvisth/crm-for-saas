import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Reset daily_sends_count for all accounts and set next reset time to tomorrow midnight UTC
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  const { error, count } = await supabase
    .from("gmail_accounts")
    .update({
      daily_sends_count: 0,
      status: "active",
    })
    .in("status", ["active", "rate_limited"])
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: "Failed to reset daily sends", details: error.message },
      { status: 500 }
    );
  }

  // Re-activate rate_limited accounts since it's a new day
  return NextResponse.json({
    success: true,
    accountsReset: count ?? 0,
    nextResetAt: tomorrow.toISOString(),
  });
}

// Vercel Cron Jobs send GET requests — alias POST handler
export const GET = POST;
