// Daily Vercel cron (see vercel.json). Runs live "outside-in" security probes
// against the deployed app, records a security_scans row for the Hacker Rating
// page, auto-opens a finding for each failing probe (and auto-resolves it when
// the probe passes again), and Slack-alerts on any regression.
//
// Same SYNC_SECRET / CRON_SECRET Bearer auth as the rest of /api/cron/*.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runSecurityScan, type CheckResult } from "@/lib/security/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const syncSecret = process.env.SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const explicit = request.headers.get("x-sync-secret");
  const provided = bearer || explicit;
  if (!syncSecret && !cronSecret) {
    return process.env.NODE_ENV !== "production";
  }
  return (
    (Boolean(syncSecret) && provided === syncSecret) ||
    (Boolean(cronSecret) && provided === cronSecret)
  );
}

async function notifySlack(failing: CheckResult[]): Promise<void> {
  const webhook = process.env.SLACK_ALERT_WEBHOOK_URL;
  const lines = failing.map((c) => `• *${c.name}* (${c.severity}): ${c.detail}`);
  const text = `:rotating_light: *Security scan found ${failing.length} issue(s)*\n${lines.join("\n")}`;
  if (!webhook) {
    console.error("[security-scan]", text);
    return;
  }
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("[security-scan] Slack notify failed", err);
  }
}

async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createServiceClient();

  try {
    const { passed, checks, severity_counts } = await runSecurityScan();
    const durationMs = Date.now() - startedAt;

    // 1. Record the scan run.
    await supabase.from("security_scans").insert({
      scan_type: "live_probe",
      passed,
      severity_counts,
      details: checks,
      duration_ms: durationMs,
    });

    // 2. Auto-open a finding for each failing (non-info) probe, and
    //    auto-resolve a previously-opened scan finding once its probe passes.
    for (const c of checks) {
      const key = `SCAN-${c.name}`;
      if (!c.ok && c.severity !== "info") {
        await supabase
          .from("security_findings")
          .upsert(
            {
              finding_key: key,
              title: `Automated probe failed: ${c.name}`,
              category: c.name.includes("header")
                ? "headers"
                : c.name.includes("rls")
                  ? "rls"
                  : c.name.includes("endpoint")
                    ? "auth"
                    : "config",
              severity: c.severity,
              status: "open",
              affected_path: "daily security-scan cron",
              description: c.detail,
              remediation:
                "Investigate the failing probe; this row auto-resolves when the next scan passes.",
              source: "daily_scan",
            },
            { onConflict: "finding_key" },
          );
      } else {
        // Re-close a prior daily_scan finding that is now passing.
        await supabase
          .from("security_findings")
          .update({ status: "fixed", fixed_at: new Date().toISOString() })
          .eq("finding_key", key)
          .eq("source", "daily_scan")
          .eq("status", "open");
      }
    }

    // 3. Alert on any regression.
    const failing = checks.filter((c) => !c.ok && c.severity !== "info");
    if (failing.length > 0) await notifySlack(failing);

    return NextResponse.json({
      status: "ok",
      passed,
      failing: failing.length,
      severity_counts,
      duration_ms: durationMs,
      checks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("security_scans").insert({
      scan_type: "live_probe",
      passed: false,
      severity_counts: { high: 1 },
      details: [{ name: "scan_error", ok: false, detail: message }],
      duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
