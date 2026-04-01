import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface SequenceHealth {
  auth_issue: boolean;
  high_bounces: boolean;
  paused_count: number;
}

export async function GET() {
  const supabase = await createClient();

  // Verify user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all sequences for the user's workspaces
  const { data: sequences } = await supabase
    .from("sequences")
    .select("id, workspace_id");

  if (!sequences || sequences.length === 0) {
    return NextResponse.json({});
  }

  const result: Record<string, SequenceHealth> = {};
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const seq of sequences) {
    // Count paused/company_paused enrollments
    const { count: pausedCount } = await supabase
      .from("sequence_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", seq.id)
      .in("status", ["paused", "company_paused"]);

    // Check for auth issues: find active enrollments using a gmail_account that isn't active
    const { data: activeEnrollments } = await supabase
      .from("sequence_enrollments")
      .select("sender_account_id")
      .eq("sequence_id", seq.id)
      .eq("status", "active")
      .not("sender_account_id", "is", null);

    let authIssue = false;
    if (activeEnrollments && activeEnrollments.length > 0) {
      const senderIds = [
        ...new Set(
          activeEnrollments
            .map((e) => e.sender_account_id)
            .filter(Boolean) as string[]
        ),
      ];

      if (senderIds.length > 0) {
        const { data: accounts } = await supabase
          .from("gmail_accounts")
          .select("id, status")
          .in("id", senderIds);

        if (accounts) {
          authIssue = accounts.some((a) => a.status !== "active");
        }
      }
    }

    // Check high bounce rate (> 5%) in last 7 days
    let highBounces = false;
    const { data: enrollmentIds } = await supabase
      .from("sequence_enrollments")
      .select("id")
      .eq("sequence_id", seq.id);

    if (enrollmentIds && enrollmentIds.length > 0) {
      const ids = enrollmentIds.map((e) => e.id);

      const { data: recentSentEmails } = await supabase
        .from("email_queue")
        .select("tracking_id")
        .in("enrollment_id", ids)
        .eq("status", "sent")
        .gte("sent_at", sevenDaysAgo);

      if (recentSentEmails && recentSentEmails.length > 0) {
        const trackingIds = recentSentEmails.map((e) => e.tracking_id);
        const { count: bounceCount } = await supabase
          .from("email_events")
          .select("id", { count: "exact", head: true })
          .in("tracking_id", trackingIds)
          .eq("event_type", "bounce");

        const bounceRate = ((bounceCount || 0) / recentSentEmails.length) * 100;
        highBounces = bounceRate > 5;
      }
    }

    result[seq.id] = {
      auth_issue: authIssue,
      high_bounces: highBounces,
      paused_count: pausedCount || 0,
    };
  }

  return NextResponse.json(result);
}
