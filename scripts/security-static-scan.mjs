#!/usr/bin/env node
// Static security scan for the scheduled GitHub Actions job
// (.github/workflows/security-scan.yml). Runs `npm audit` and a few source
// greps, then POSTs a summary to the CRM's scan-report endpoint so it shows up
// on the Hacker Rating page (/settings/security).
//
// Env:
//   SECURITY_SCAN_ENDPOINT  e.g. https://crm-for-saas.vercel.app/api/settings/security/scan-report
//   SECURITY_SCAN_SECRET    the CRON_SECRET/SYNC_SECRET value (Bearer)
// If either is unset the script just prints the JSON (useful locally).

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const checks = [];

// 1. npm audit (production deps).
try {
  let auditJson;
  try {
    auditJson = execSync("npm audit --omit=dev --json", { encoding: "utf8" });
  } catch (e) {
    // npm audit exits non-zero when vulns exist; stdout still holds the JSON.
    auditJson = e.stdout?.toString() || "{}";
  }
  const audit = JSON.parse(auditJson);
  const v = audit.metadata?.vulnerabilities || {};
  const high = (v.critical || 0) + (v.high || 0);
  checks.push({
    name: "npm_audit_prod",
    ok: high === 0,
    detail: `prod vulns — critical:${v.critical || 0} high:${v.high || 0} moderate:${v.moderate || 0} low:${v.low || 0}`,
    severity: high > 0 ? "high" : "info",
  });
} catch (err) {
  checks.push({ name: "npm_audit_prod", ok: false, detail: `audit failed: ${err.message}`, severity: "medium" });
}

const srcFiles = walk(join(ROOT, "src"));

// 2. dangerouslySetInnerHTML usage count (each site is a potential XSS sink).
let dsihCount = 0;
for (const f of srcFiles) {
  const c = readFileSync(f, "utf8");
  dsihCount += (c.match(/dangerouslySetInnerHTML/g) || []).length;
}
checks.push({
  name: "dangerously_set_inner_html",
  ok: dsihCount <= 6, // audit baseline; a rise means a new unsanitized-HTML sink
  detail: `${dsihCount} dangerouslySetInnerHTML site(s) (baseline 6). Verify any new one is sandboxed/sanitized.`,
  severity: dsihCount > 6 ? "medium" : "info",
});

// 3. Hardcoded secret patterns in source.
const SECRET_RE = /(sk_live_[0-9a-zA-Z]{6,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|service_role["'`\s:=]+eyJ)/;
const secretHits = [];
for (const f of srcFiles) {
  if (SECRET_RE.test(readFileSync(f, "utf8"))) secretHits.push(f.replace(ROOT + "/", ""));
}
checks.push({
  name: "hardcoded_secrets",
  ok: secretHits.length === 0,
  detail: secretHits.length === 0 ? "No hardcoded secret literals in src/." : `Possible secrets in: ${secretHits.join(", ")}`,
  severity: secretHits.length > 0 ? "high" : "info",
});

// 4. API routes with no visible auth reference (heuristic). Cron/tracking and
//    machine webhooks authenticate differently, so they are excluded.
const apiRoutes = srcFiles.filter((f) => /src\/app\/api\/.*route\.(ts|js)$/.test(f));
const AUTH_RE = /getUser|isAuthorized|isSyncRequestAuthorized|resolveWorkspace|resolveAccess|CALL_WEBHOOK_SECRET/;
const EXCLUDE_RE = /\/api\/(tracking|cron|e2e-login)\//;
const unauth = [];
for (const f of apiRoutes) {
  if (EXCLUDE_RE.test(f)) continue;
  const c = readFileSync(f, "utf8");
  const mutates = /export async function (GET|POST|PUT|PATCH|DELETE)/.test(c);
  if (mutates && !AUTH_RE.test(c)) unauth.push(f.replace(ROOT + "/", ""));
}
checks.push({
  name: "unauthenticated_api_routes",
  ok: unauth.length === 0,
  detail: unauth.length === 0 ? "All non-public API routes reference an auth guard." : `No auth guard found in: ${unauth.join(", ")}`,
  severity: unauth.length > 0 ? "high" : "info",
});

const failing = checks.filter((c) => !c.ok && c.severity !== "info");
const severity_counts = {};
for (const c of failing) severity_counts[c.severity] = (severity_counts[c.severity] || 0) + 1;
const payload = { passed: failing.length === 0, severity_counts, details: checks };

console.log(JSON.stringify(payload, null, 2));

const endpoint = process.env.SECURITY_SCAN_ENDPOINT;
const secret = process.env.SECURITY_SCAN_SECRET;
if (endpoint && secret) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`scan-report POST failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log("Reported to Hacker Rating page.");
} else {
  console.log("(SECURITY_SCAN_ENDPOINT/SECRET not set — not reporting.)");
}

// Never fail the CI job on findings alone — the report is the deliverable.
process.exit(0);
