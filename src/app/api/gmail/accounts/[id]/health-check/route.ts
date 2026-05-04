import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveTxt, resolveMx, resolve4 } from "node:dns/promises";

export const runtime = "nodejs";
export const maxDuration = 60;

type CheckLevel = "good" | "warn" | "error" | "neutral";
interface CheckResult {
  level: CheckLevel;
  label: string;
  detail?: string | null;
  value?: string | null;
}

const DKIM_SELECTORS = ["google", "default", "selector1", "selector2", "k1", "mailo"];

async function checkSPF(domain: string): Promise<CheckResult> {
  try {
    const records = await resolveTxt(domain);
    const flat = records.map((r) => r.join(""));
    const spf = flat.find((t) => t.toLowerCase().startsWith("v=spf1"));
    if (!spf) {
      return {
        level: "error",
        label: "SPF",
        detail: "No SPF record on the sending domain. Most providers will mark these messages as spam.",
      };
    }
    const includesGoogle = /include:_spf\.google\.com/i.test(spf);
    const ending = spf.match(/\s+([~\-+?]all)\b/i)?.[1] ?? null;
    const detailParts = [];
    if (includesGoogle) detailParts.push("includes Google");
    if (ending === "-all") detailParts.push("strict (-all)");
    else if (ending === "~all") detailParts.push("soft-fail (~all)");
    return {
      level: "good",
      label: "SPF",
      detail: detailParts.length ? detailParts.join(" · ") : "record present",
      value: spf,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { level: "error", label: "SPF", detail: `DNS lookup failed: ${msg}` };
  }
}

async function checkDKIM(domain: string): Promise<CheckResult> {
  for (const selector of DKIM_SELECTORS) {
    try {
      const records = await resolveTxt(`${selector}._domainkey.${domain}`);
      const flat = records.map((r) => r.join(""));
      const dkim = flat.find((t) => /v=DKIM1/i.test(t) || /\bk=rsa\b/i.test(t));
      if (dkim) {
        return {
          level: "good",
          label: "DKIM",
          detail: `record present at selector "${selector}"`,
          value: `${selector}._domainkey.${domain}`,
        };
      }
    } catch {
      // continue to next selector
    }
  }
  return {
    level: "error",
    label: "DKIM",
    detail: `No DKIM record found at common selectors (${DKIM_SELECTORS.join(", ")}). Without DKIM, messages will be flagged or rejected.`,
  };
}

async function checkDMARC(domain: string): Promise<CheckResult> {
  try {
    const records = await resolveTxt(`_dmarc.${domain}`);
    const flat = records.map((r) => r.join(""));
    const dmarc = flat.find((t) => /v=DMARC1/i.test(t));
    if (!dmarc) {
      return {
        level: "error",
        label: "DMARC",
        detail: "No DMARC record. Add one at least with p=none to start monitoring.",
      };
    }
    const policy = (dmarc.match(/p=([a-z]+)/i)?.[1] ?? "none").toLowerCase();
    if (policy === "reject" || policy === "quarantine") {
      return { level: "good", label: "DMARC", detail: `enforced (p=${policy})`, value: dmarc };
    }
    return {
      level: "warn",
      label: "DMARC",
      detail: `present but p=${policy} — monitor only. Consider tightening to p=quarantine or p=reject once you've validated authentication.`,
      value: dmarc,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { level: "error", label: "DMARC", detail: `DNS lookup failed: ${msg}` };
  }
}

// Domain-based blocklists (DBLs) — query format is `<domain>.<list-host>`.
// We use domain DBLs rather than IP DNSBLs because Gmail/Workspace egress IPs
// rotate per send, so an IP check is meaningless for outbound from this app.
//
// Spamhaus DBL convention: an A record means LISTED. The first three octets
// usually classify the listing (127.0.1.X). 127.0.1.255 is reserved to mean
// "your DNS resolver has been blocked by Spamhaus" (over-quota or public
// resolver) — we surface that as "lookup unavailable" instead of "listed".
//
// SURBL/URIBL follow a similar convention. We treat any return code ending in
// .255 as "blocked, not listed" defensively.
const BLOCKLISTS: Array<{ name: string; host: string; about: string }> = [
  {
    name: "Spamhaus DBL",
    host: "dbl.spamhaus.org",
    about: "Spamhaus Domain Block List — abused/spammer-owned domains.",
  },
  {
    name: "SURBL",
    host: "multi.surbl.org",
    about: "SURBL multi list — domains seen in spam/phish messages.",
  },
  {
    name: "URIBL",
    host: "multi.uribl.com",
    about: "URIBL multi list — black, grey, and abuse-tracker categories.",
  },
];

async function checkBlocklist(
  domain: string,
  list: (typeof BLOCKLISTS)[number],
): Promise<CheckResult> {
  const query = `${domain}.${list.host}`;
  try {
    const records = await resolve4(query);
    // Special-case "your resolver is blocked / over quota" markers.
    if (records.some((ip) => ip.endsWith(".255"))) {
      return {
        level: "neutral",
        label: list.name,
        detail: "Lookup blocked (DNS resolver rate-limited or public-resolver rejected). Re-run from a different network if needed.",
      };
    }
    return {
      level: "error",
      label: list.name,
      detail: `LISTED (return: ${records.join(", ")}). ${list.about} Request delisting from the operator.`,
      value: query,
    };
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
      // NXDOMAIN / no record = not listed.
      return { level: "good", label: list.name, detail: "not listed" };
    }
    return {
      level: "neutral",
      label: list.name,
      detail: `Lookup unavailable: ${err.code ?? String(e)}`,
    };
  }
}

async function checkMX(domain: string): Promise<CheckResult> {
  try {
    const records = await resolveMx(domain);
    if (records.length === 0) {
      return { level: "warn", label: "MX", detail: "No MX records — domain can't receive replies." };
    }
    const usesGoogle = records.some((r) => /google(mail)?\.com/i.test(r.exchange));
    const exchanges = records.map((r) => r.exchange).join(", ");
    return {
      level: "good",
      label: "MX",
      detail: usesGoogle ? "points to Google" : "records present",
      value: exchanges,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { level: "warn", label: "MX", detail: `MX lookup failed: ${msg}` };
  }
}

interface InternalStats {
  bounce: CheckResult;
  reply: CheckResult;
  pause: CheckResult;
}

async function computeInternalStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  status: string,
  pauseReason: string | null
): Promise<InternalStats> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Pull all sent queue items for this account in the window
  const { data: sentItems } = await supabase
    .from("email_queue")
    .select("tracking_id")
    .eq("sender_account_id", accountId)
    .eq("status", "sent")
    .gte("sent_at", since);

  const trackingIds = (sentItems ?? []).map((q) => q.tracking_id).filter((x): x is string => !!x);
  const sent = trackingIds.length;

  if (sent === 0) {
    const neutral: CheckResult = { level: "neutral", label: "", detail: "No sends in last 30 days" };
    return {
      bounce: { ...neutral, label: "Bounce rate" },
      reply: { ...neutral, label: "Reply rate" },
      pause: pauseCheck(status, pauseReason),
    };
  }

  // Count reply + bounce events for those tracking IDs
  let bounced = 0;
  let replied = 0;
  for (let i = 0; i < trackingIds.length; i += 200) {
    const chunk = trackingIds.slice(i, i + 200);
    const { data: events } = await supabase
      .from("email_events")
      .select("tracking_id, event_type")
      .in("tracking_id", chunk)
      .in("event_type", ["bounce", "reply"]);

    const bouncedSet = new Set<string>();
    const repliedSet = new Set<string>();
    for (const ev of events ?? []) {
      if (ev.event_type === "bounce") bouncedSet.add(ev.tracking_id);
      else if (ev.event_type === "reply") repliedSet.add(ev.tracking_id);
    }
    bounced += bouncedSet.size;
    replied += repliedSet.size;
  }

  const bounceRate = (bounced / sent) * 100;
  const replyRate = (replied / sent) * 100;

  let bounceLevel: CheckLevel = "good";
  if (bounceRate >= 8) bounceLevel = "error";
  else if (bounceRate >= 3) bounceLevel = "warn";

  let replyLevel: CheckLevel = "good";
  if (replyRate < 0.5) replyLevel = "warn"; // very low engagement is a soft signal of poor inbox placement
  if (sent < 50) replyLevel = "neutral"; // not enough volume to judge

  return {
    bounce: {
      level: bounceLevel,
      label: "Bounce rate",
      detail: `${bounceRate.toFixed(1)}% (${bounced} of ${sent} in last 30d)`,
    },
    reply: {
      level: replyLevel,
      label: "Reply rate",
      detail: `${replyRate.toFixed(1)}% (${replied} of ${sent} in last 30d)`,
    },
    pause: pauseCheck(status, pauseReason),
  };
}

function pauseCheck(status: string, pauseReason: string | null): CheckResult {
  if (status === "active") {
    return { level: "good", label: "Account status", detail: "active, no circuit-breaker pause" };
  }
  if (status === "paused") {
    return {
      level: "error",
      label: "Account status",
      detail: pauseReason ?? "paused (no reason recorded)",
    };
  }
  if (status === "disconnected") {
    return { level: "error", label: "Account status", detail: "disconnected — reconnect to resume sending" };
  }
  return { level: "warn", label: "Account status", detail: status };
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: account } = await supabase
    .from("gmail_accounts")
    .select("id, workspace_id, email_address, status, pause_reason")
    .eq("id", id)
    .single();
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", account.workspace_id)
    .eq("user_id", user.id)
    .single();
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const domain = account.email_address.split("@")[1] ?? "";
  if (!domain) {
    return NextResponse.json({ error: "Could not parse domain from email address" }, { status: 400 });
  }

  const [spf, dkim, dmarc, mx, internal, ...blocklists] = await Promise.all([
    checkSPF(domain),
    checkDKIM(domain),
    checkDMARC(domain),
    checkMX(domain),
    computeInternalStats(supabase, account.id, account.status, account.pause_reason),
    ...BLOCKLISTS.map((b) => checkBlocklist(domain, b)),
  ]);

  const checks: CheckResult[] = [
    spf,
    dkim,
    dmarc,
    mx,
    internal.bounce,
    internal.reply,
    internal.pause,
    ...blocklists,
  ];
  const errors = checks.filter((c) => c.level === "error").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  const overall: CheckLevel = errors > 0 ? "error" : warns > 0 ? "warn" : "good";

  return NextResponse.json({
    domain,
    email: account.email_address,
    overall,
    summary:
      overall === "good"
        ? "Looks healthy."
        : overall === "warn"
          ? `${warns} warning${warns === 1 ? "" : "s"} to look at.`
          : `${errors} issue${errors === 1 ? "" : "s"} need attention.`,
    checks: {
      auth: [spf, dkim, dmarc, mx],
      stats: [internal.bounce, internal.reply, internal.pause],
      blocklists,
    },
  });
}
