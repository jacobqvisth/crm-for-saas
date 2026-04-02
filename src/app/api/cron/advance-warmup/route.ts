import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWarmupDailyLimit, WARMUP_DURATION_DAYS, WARMUP_MIN_SENDS_TO_GRADUATE, WARMUP_MAX_BOUNCE_RATE } from "@/lib/warmup/schedule";
import { checkDomain, extractDomain } from "@/lib/warmup/domain-check";
import { calculateHealthScore } from "@/lib/warmup/health-score";
import type { DomainCheckResult } from "@/lib/warmup/domain-check";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let warmedUp = 0;
  let graduated = 0;
  let reset = 0;
  let healthChecked = 0;

  // 1. Advance warmup for all ramp accounts
  const { data: rampAccounts, error: rampError } = await supabase
    .from("gmail_accounts")
    .select("*")
    .eq("warmup_enabled", true)
    .eq("warmup_stage", "ramp");

  if (!rampError && rampAccounts) {
    for (const account of rampAccounts) {
      try {
        // If account was paused by circuit breaker during warmup — reset it
        if (account.status === "paused") {
          await supabase
            .from("gmail_accounts")
            .update({ warmup_day: 0, max_daily_sends: 5 })
            .eq("id", account.id);
          reset++;
          continue;
        }

        const newDay = (account.warmup_day ?? 0) + 1;
        const newLimit = getWarmupDailyLimit(newDay);

        // Check graduation criteria
        let shouldGraduate = false;
        if (newDay >= WARMUP_DURATION_DAYS && account.status === "active") {
          // Check bounce rate last 7 days
          const { data: sentEmails } = await supabase
            .from("email_queue")
            .select("id, tracking_id")
            .eq("sender_account_id", account.id)
            .eq("status", "sent")
            .gte("sent_at", sevenDaysAgo.toISOString());

          const sentCount = sentEmails?.length ?? 0;
          let bounceRate = 0;

          if (sentCount > 0) {
            const trackingIds = (sentEmails ?? []).map((e) => e.tracking_id).filter(Boolean);
            const { count: bounceCount } = await supabase
              .from("email_events")
              .select("id", { count: "exact", head: true })
              .in("tracking_id", trackingIds)
              .eq("event_type", "bounce");
            bounceRate = (bounceCount ?? 0) / sentCount;
          }

          // Check total sent ever
          const { count: totalSent } = await supabase
            .from("email_queue")
            .select("id", { count: "exact", head: true })
            .eq("sender_account_id", account.id)
            .eq("status", "sent");

          if (
            bounceRate < WARMUP_MAX_BOUNCE_RATE &&
            (totalSent ?? 0) >= WARMUP_MIN_SENDS_TO_GRADUATE
          ) {
            shouldGraduate = true;
          }
        }

        if (shouldGraduate) {
          await supabase
            .from("gmail_accounts")
            .update({
              warmup_stage: "graduated",
              warmup_day: newDay,
              max_daily_sends: account.target_daily_sends ?? 50,
            })
            .eq("id", account.id);
          graduated++;
        } else {
          await supabase
            .from("gmail_accounts")
            .update({ warmup_day: newDay, max_daily_sends: newLimit })
            .eq("id", account.id);
          warmedUp++;
        }
      } catch (err) {
        console.error(`[advance-warmup] Failed for account ${account.id}:`, err);
      }
    }
  }

  // 2. Refresh domain health for accounts needing it (empty or older than 24h)
  const { data: allAccounts } = await supabase
    .from("gmail_accounts")
    .select("id, email_address, domain_health, status")
    .in("status", ["active", "setup_pending", "paused"]);

  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;

  for (const account of allAccounts ?? []) {
    try {
      const health = account.domain_health as DomainCheckResult | null;
      const needsCheck =
        !health ||
        !health.checkedAt ||
        now - new Date(health.checkedAt).getTime() > twentyFourHours;

      if (needsCheck) {
        const domain = extractDomain(account.email_address);
        const result = await checkDomain(domain);
        await supabase
          .from("gmail_accounts")
          .update({ domain_health: result as unknown as Record<string, unknown> })
          .eq("id", account.id);
        healthChecked++;
      }
    } catch (err) {
      console.error(`[advance-warmup] Domain check failed for ${account.id}:`, err);
    }
  }

  // 3. Recalculate health scores for all active accounts
  const { data: activeAccounts } = await supabase
    .from("gmail_accounts")
    .select("*")
    .eq("status", "active");

  for (const account of activeAccounts ?? []) {
    try {
      // Get 7-day bounce stats
      const { data: sent } = await supabase
        .from("email_queue")
        .select("tracking_id")
        .eq("sender_account_id", account.id)
        .eq("status", "sent")
        .gte("sent_at", sevenDaysAgo.toISOString());

      const sentCount = sent?.length ?? 0;
      let bounceCount = 0;

      if (sentCount > 0) {
        const trackingIds = (sent ?? []).map((e) => e.tracking_id).filter(Boolean);
        const { count } = await supabase
          .from("email_events")
          .select("id", { count: "exact", head: true })
          .in("tracking_id", trackingIds)
          .eq("event_type", "bounce");
        bounceCount = count ?? 0;
      }

      const breakdown = calculateHealthScore(account, { sent: sentCount, bounced: bounceCount });

      await supabase
        .from("gmail_accounts")
        .update({ health_score: breakdown.overall })
        .eq("id", account.id);
    } catch (err) {
      console.error(`[advance-warmup] Health score failed for ${account.id}:`, err);
    }
  }

  return NextResponse.json({ warmedUp, graduated, reset, healthChecked });
}

// Vercel Cron Jobs send GET requests
export const POST = GET;
