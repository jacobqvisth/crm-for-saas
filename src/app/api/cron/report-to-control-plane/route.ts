import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { METRIC_KEYS, type Metrics } from "@/lib/control-plane/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tell the control plane how this tenant is doing, in aggregate.
//
// THE DIRECTION IS THE DESIGN. The control plane could have read these numbers
// out of this database, and that would have required it to hold a service-role
// key for every tenant: one credential that reads every customer's entire CRM.
// Reporting outward instead means the control plane holds no way in to anything,
// which is the property that makes it safe to have at all.
//
// Only counts leave here. The receiving end enforces a closed list
// (lib/control-plane/stats.ts) and rejects anything that is not a non-negative
// integer, so this cannot quietly grow into an export of customer data.
//
// Inert until the tenant is wired: with CONTROL_PLANE_URL or
// CONTROL_PLANE_TOKEN unset this reports "not configured" and does nothing,
// which is the normal state for a tenant running on compiled defaults.

const SEVEN_DAYS_AGO = () => new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

type Supa = ReturnType<typeof createServiceClient>;

/**
 * Each metric is gathered independently.
 *
 * One failing count must not cost the whole report: a renamed column on a
 * single table would otherwise turn every number dark at once, and the reason
 * this exists is to notice when a tenant goes quiet.
 */
async function collect(supabase: Supa): Promise<{ metrics: Metrics; failed: string[] }> {
  const metrics: Metrics = {};
  const failed: string[] = [];

  const count = async (
    key: (typeof METRIC_KEYS)[number],
    build: () => PromiseLike<{ count: number | null; error: unknown }>,
  ) => {
    try {
      const { count: n, error } = await build();
      if (error || n === null) {
        failed.push(key);
        return;
      }
      metrics[key] = n;
    } catch {
      failed.push(key);
    }
  };

  const head = { count: "exact" as const, head: true };

  await count("users", () => supabase.from("workspace_members").select("user_id", head));
  await count("contacts", () => supabase.from("contacts").select("id", head));
  await count("companies", () => supabase.from("companies").select("id", head));
  await count("active_sequences", () =>
    supabase.from("sequences").select("id", head).eq("status", "active"),
  );
  await count("mailboxes_connected", () =>
    supabase.from("mail_accounts").select("id", head).eq("status", "active"),
  );
  await count("emails_sent_7d", () =>
    supabase
      .from("email_queue")
      .select("id", head)
      .eq("status", "sent")
      .gte("sent_at", SEVEN_DAYS_AGO()),
  );
  // Excludes auto-replies, matching how reply rate is counted everywhere else.
  // An out-of-office is not a reply, and a gauge that says otherwise flatters.
  await count("replies_7d", () =>
    supabase
      .from("inbox_messages")
      .select("id", head)
      .gte("received_at", SEVEN_DAYS_AGO())
      .not("is_auto_reply", "is", true),
  );
  await count("calls_7d", () =>
    supabase.from("call_sessions").select("id", head).gte("started_at", SEVEN_DAYS_AGO()),
  );

  return { metrics, failed };
}

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.CONTROL_PLANE_URL;
  const token = process.env.CONTROL_PLANE_TOKEN;
  if (!url || !token) {
    // Not an error. A tenant that has never been wired to a control plane runs
    // on compiled defaults and has nothing to report to.
    return NextResponse.json({ ok: true, skipped: "control plane not configured" });
  }

  const supabase = createServiceClient();
  const { metrics, failed } = await collect(supabase);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/heartbeat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ metrics }),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, status: res.status, error: body?.error ?? "heartbeat rejected", failed },
        { status: 200 },
      );
    }
    // 200 even on a failed report: this is a cron, and a non-2xx makes Vercel
    // mark the schedule failed and page about a gauge nobody is waiting on.
    return NextResponse.json({ ok: true, reported: Object.keys(metrics).length, failed });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      failed,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Vercel Cron invokes with GET. POST is kept so the job can be triggered by
// hand the way the other crons in this project are.
export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}
