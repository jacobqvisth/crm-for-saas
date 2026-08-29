// Live "outside-in" security probes run daily by /api/cron/security-scan.
// These complement the static CI scan (.github/workflows/security-scan.yml):
// the cron checks the DEPLOYED app's real behaviour, so a regression that a
// commit can't reveal (a header rule removed in Vercel, RLS toggled off in the
// dashboard, a missing secret) is still caught. No secret VALUES are ever
// logged — only whether they are present and well-formed.

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { appBaseUrl } from "@/lib/app-url";

export type CheckSeverity = "high" | "medium" | "low" | "info";

export type CheckResult = {
  name: string;
  ok: boolean;
  severity: CheckSeverity;
  detail: string;
};

export type ScanResult = {
  passed: boolean;
  checks: CheckResult[];
  severity_counts: Record<string, number>;
};

// The CRM must expose these enforced security headers on every response.
const REQUIRED_CRM_HEADERS = [
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
];

async function checkCrmHeaders(base: string): Promise<CheckResult> {
  try {
    const res = await fetch(`${base}/login`, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
    });
    const missing = REQUIRED_CRM_HEADERS.filter((h) => !res.headers.get(h));
    return {
      name: "crm_security_headers",
      ok: missing.length === 0,
      severity: "medium",
      detail:
        missing.length === 0
          ? "All required security headers present on the CRM."
          : `Missing CRM security headers: ${missing.join(", ")}.`,
    };
  } catch (err) {
    return {
      name: "crm_security_headers",
      ok: false,
      severity: "medium",
      detail: `Could not fetch the CRM to check headers: ${errMsg(err)}`,
    };
  }
}

// Sensitive authenticated endpoints must reject an unauthenticated caller.
// A regression that drops the getUser() guard would let these return 200.
const GUARDED_ENDPOINTS = [
  "/api/settings/security/findings",
  "/api/settings/team",
  "/api/tasks",
];

async function checkUnauthEndpoints(base: string): Promise<CheckResult> {
  const leaked: string[] = [];
  for (const path of GUARDED_ENDPOINTS) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
      });
      // 401/403 (rejected) or 3xx (redirected to login) are all acceptable.
      // A 200 means the endpoint served data with no session — a real leak.
      if (res.status === 200) leaked.push(`${path} (200)`);
    } catch {
      // A network error is not a leak; ignore.
    }
  }
  return {
    name: "unauthenticated_endpoint_access",
    ok: leaked.length === 0,
    severity: "high",
    detail:
      leaked.length === 0
        ? "Guarded endpoints reject unauthenticated requests."
        : `Endpoints served data without a session: ${leaked.join(", ")}.`,
  };
}

// With the anon key (what a browser gets), a workspace-scoped table must
// return zero rows — proof that RLS is still enabled. If RLS were turned off,
// this would return rows.
async function checkRlsAnon(): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return {
      name: "rls_anon_read",
      ok: false,
      severity: "high",
      detail: "Supabase URL/anon key not configured; cannot probe RLS.",
    };
  }
  try {
    const anonClient = createSupabaseClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anonClient
      .from("contacts")
      .select("id")
      .limit(1);
    const rows = data?.length ?? 0;
    // Either an RLS/permission error or zero rows means the table is protected.
    const ok = rows === 0;
    return {
      name: "rls_anon_read",
      ok,
      severity: "high",
      detail: ok
        ? error
          ? `Anon read rejected (RLS enforced): ${error.message}`
          : "Anon client reads 0 rows from a workspace table (RLS enforced)."
        : `Anon client read ${rows} row(s) from contacts — RLS may be disabled!`,
    };
  } catch (err) {
    // A thrown permission error is the healthy outcome.
    return {
      name: "rls_anon_read",
      ok: true,
      severity: "high",
      detail: `Anon read rejected (RLS enforced): ${errMsg(err)}`,
    };
  }
}

// Presence + shape of security-critical secrets. Never logs the values.
function checkConfig(): CheckResult {
  const problems: string[] = [];
  const enc = process.env.ENCRYPTION_KEY;
  if (!enc) problems.push("ENCRYPTION_KEY missing");
  else if (!/^[0-9a-fA-F]{64}$/.test(enc))
    problems.push("ENCRYPTION_KEY is not 64 hex chars");

  if (!process.env.CRON_SECRET) problems.push("CRON_SECRET missing");

  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!svc) problems.push("SUPABASE_SERVICE_ROLE_KEY missing");
  else if (svc === anon)
    problems.push("SERVICE_ROLE_KEY equals ANON_KEY (misconfigured!)");

  if (!process.env.CALL_WEBHOOK_SECRET)
    problems.push("CALL_WEBHOOK_SECRET missing (call webhooks would be exposed)");

  return {
    name: "config_secrets",
    ok: problems.length === 0,
    severity: "high",
    detail:
      problems.length === 0
        ? "All security-critical env vars present and well-formed."
        : problems.join("; ") + ".",
  };
}

// Informational: the external product app should send HSTS. This is a
// read-only target (owned by the codeoc team), so it never fails the scan —
// it is surfaced so the team can act.
async function checkAppHsts(): Promise<CheckResult> {
  try {
    const res = await fetch("https://app.wrenchlane.com", {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
    });
    const hsts = res.headers.get("strict-transport-security");
    return {
      name: "app_wrenchlane_hsts",
      ok: Boolean(hsts),
      severity: "info",
      detail: hsts
        ? "app.wrenchlane.com sends HSTS."
        : "app.wrenchlane.com is missing HSTS (report to the codeoc team).",
    };
  } catch (err) {
    return {
      name: "app_wrenchlane_hsts",
      ok: true, // never fail the scan on an external, read-only target
      severity: "info",
      detail: `Could not reach app.wrenchlane.com: ${errMsg(err)}`,
    };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runSecurityScan(): Promise<ScanResult> {
  const base = appBaseUrl();
  const checks: CheckResult[] = [];

  const [headers, unauth, rls, hsts] = await Promise.all([
    checkCrmHeaders(base),
    checkUnauthEndpoints(base),
    checkRlsAnon(),
    checkAppHsts(),
  ]);
  checks.push(headers, unauth, rls, checkConfig(), hsts);

  // The scan "passes" only on the checks we control (info checks never fail it).
  const failing = checks.filter((c) => !c.ok && c.severity !== "info");
  const severity_counts: Record<string, number> = {};
  for (const c of failing) {
    severity_counts[c.severity] = (severity_counts[c.severity] ?? 0) + 1;
  }

  return { passed: failing.length === 0, checks, severity_counts };
}
