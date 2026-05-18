// DNS auth lookups for a sending domain. We snapshot SPF, DKIM (google
// selector), DMARC, and MX every day so a silent record change becomes
// a same-day alert instead of a "why did our deliverability tank?" hunt
// three weeks later.

import { Resolver } from "node:dns/promises";

// Quad9 — has a real Spamhaus DQS relationship and doesn't return rate-
// limit placeholders for public-resolver queries. See dnsbl.ts for the
// full rationale. We use the same resolver here for consistency.
const RESOLVER_SERVERS = ["9.9.9.9", "149.112.112.112"];

function newResolver(): Resolver {
  const r = new Resolver();
  r.setServers(RESOLVER_SERVERS);
  return r;
}

export type DnsRecordCheck = {
  ok: boolean;
  value: string | null;
  // Only set when ok=false. Caller decides severity.
  note?: string;
};

export type DnsSnapshot = {
  spf: DnsRecordCheck;
  dkim: DnsRecordCheck & { selector: string };
  dmarc: DnsRecordCheck & { policy: string | null };
  mx: DnsRecordCheck;
};

// Selectors most likely to be in use given the Google + SES SPF mix on
// wrenchlane.com today. First hit wins. If you start sending through a
// new provider, append its selector here.
const DKIM_SELECTORS_TO_TRY = [
  "google",
  "selector1", // Microsoft 365
  "selector2",
  "k1", // Mailchimp / Mandrill / SES alt
  "k2",
  "s1", // SES
  "s2",
  "default",
  "dkim",
  "mail",
];

async function txtJoined(resolver: Resolver, name: string): Promise<string[]> {
  try {
    const records = await resolver.resolveTxt(name);
    return records.map((chunks) => chunks.join(""));
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === "ENOTFOUND" || code === "ENODATA";
}

async function checkSpf(resolver: Resolver, domain: string): Promise<DnsRecordCheck> {
  const txts = await txtJoined(resolver, domain);
  const spf = txts.find((t) => t.toLowerCase().startsWith("v=spf1"));
  if (!spf) {
    return { ok: false, value: null, note: "no v=spf1 TXT record at apex" };
  }
  return { ok: true, value: spf };
}

async function checkDmarc(
  resolver: Resolver,
  domain: string,
): Promise<DnsRecordCheck & { policy: string | null }> {
  const txts = await txtJoined(resolver, `_dmarc.${domain}`);
  const dmarc = txts.find((t) => t.toLowerCase().startsWith("v=dmarc1"));
  if (!dmarc) {
    return { ok: false, value: null, policy: null, note: "no _dmarc TXT record" };
  }
  const policyMatch = /p=([a-z]+)/i.exec(dmarc);
  const policy = policyMatch?.[1]?.toLowerCase() ?? null;
  // p=none is "monitor mode" — accepts everything. quarantine + reject are
  // enforcement. We don't downgrade to !ok on p=none because some deploys
  // intentionally start there; the alert layer can flag a regression
  // (e.g. reject → none).
  return { ok: true, value: dmarc, policy };
}

async function checkDkim(
  resolver: Resolver,
  domain: string,
): Promise<DnsRecordCheck & { selector: string }> {
  for (const sel of DKIM_SELECTORS_TO_TRY) {
    const txts = await txtJoined(resolver, `${sel}._domainkey.${domain}`);
    const dkim = txts.find((t) => t.toLowerCase().includes("v=dkim1"));
    if (dkim) return { ok: true, value: dkim, selector: sel };
  }
  return {
    ok: false,
    value: null,
    selector: "",
    note: `no DKIM record found at any of: ${DKIM_SELECTORS_TO_TRY.join(", ")}`,
  };
}

async function checkMx(resolver: Resolver, domain: string): Promise<DnsRecordCheck> {
  try {
    const mx = await resolver.resolveMx(domain);
    if (!mx.length) return { ok: false, value: null, note: "no MX records" };
    const sorted = [...mx].sort((a, b) => a.priority - b.priority);
    return {
      ok: true,
      value: sorted.map((m) => `${m.priority} ${m.exchange}`).join(", "),
    };
  } catch (err) {
    if (isNotFound(err)) return { ok: false, value: null, note: "no MX records" };
    throw err;
  }
}

export async function snapshotDns(domain: string): Promise<DnsSnapshot> {
  const resolver = newResolver();
  const [spf, dmarc, dkim, mx] = await Promise.all([
    checkSpf(resolver, domain),
    checkDmarc(resolver, domain),
    checkDkim(resolver, domain),
    checkMx(resolver, domain),
  ]);
  return { spf, dmarc, dkim, mx };
}
