import dns from "dns/promises";

export type DomainCheckStatus = "pass" | "warn" | "fail";

export type DomainCheckResult = {
  spf: { status: DomainCheckStatus; detail: string };
  dkim: { status: DomainCheckStatus; detail: string };
  dmarc: { status: DomainCheckStatus; detail: string };
  mx: { status: DomainCheckStatus; detail: string };
  checkedAt: string;
};

export function extractDomain(email: string): string {
  const parts = email.split("@");
  return parts[parts.length - 1].toLowerCase();
}

export async function checkDomain(domain: string): Promise<DomainCheckResult> {
  const [spf, dkim, dmarc, mx] = await Promise.all([
    checkSpf(domain),
    checkDkim(domain),
    checkDmarc(domain),
    checkMx(domain),
  ]);

  return { spf, dkim, dmarc, mx, checkedAt: new Date().toISOString() };
}

async function checkSpf(
  domain: string
): Promise<{ status: DomainCheckStatus; detail: string }> {
  try {
    const records = await dns.resolveTxt(domain);
    const spfRecord = records
      .flat()
      .find((r) => r.startsWith("v=spf1"));

    if (!spfRecord) {
      return { status: "fail", detail: "No SPF record found. Add a TXT record: v=spf1 include:_spf.google.com ~all" };
    }

    if (
      spfRecord.includes("include:_spf.google.com") ||
      spfRecord.includes("include:googlemail.com")
    ) {
      return { status: "pass", detail: `SPF configured for Google: ${spfRecord}` };
    }

    return {
      status: "warn",
      detail: `SPF record found but doesn't include Google: ${spfRecord}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "fail", detail: `SPF lookup failed: ${msg}` };
  }
}

async function checkDkim(
  domain: string
): Promise<{ status: DomainCheckStatus; detail: string }> {
  try {
    const records = await dns.resolveTxt(`google._domainkey.${domain}`);
    const dkimRecord = records.flat().join("");

    if (dkimRecord.startsWith("v=DKIM1")) {
      return { status: "pass", detail: "DKIM configured for Google Workspace." };
    }

    return { status: "warn", detail: `DKIM record found but unexpected format: ${dkimRecord.slice(0, 80)}` };
  } catch {
    return {
      status: "fail",
      detail:
        "DKIM not configured for Google Workspace. Enable it in Google Admin → Apps → Gmail → Authenticate email.",
    };
  }
}

async function checkDmarc(
  domain: string
): Promise<{ status: DomainCheckStatus; detail: string }> {
  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    const dmarcRecord = records.flat().find((r) => r.startsWith("v=DMARC1"));

    if (!dmarcRecord) {
      return {
        status: "fail",
        detail: "No DMARC record found. Add a TXT record at _dmarc." + domain,
      };
    }

    if (dmarcRecord.includes("p=quarantine") || dmarcRecord.includes("p=reject")) {
      return { status: "pass", detail: `DMARC policy enforced: ${dmarcRecord}` };
    }

    if (dmarcRecord.includes("p=none")) {
      return {
        status: "warn",
        detail:
          "DMARC exists but policy is 'none' — recommend upgrading to 'quarantine'.",
      };
    }

    return { status: "warn", detail: `DMARC found: ${dmarcRecord}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "fail", detail: `DMARC lookup failed: ${msg}` };
  }
}

async function checkMx(
  domain: string
): Promise<{ status: DomainCheckStatus; detail: string }> {
  try {
    const records = await dns.resolveMx(domain);

    if (!records || records.length === 0) {
      return { status: "fail", detail: "No MX records found." };
    }

    const hasGoogle = records.some(
      (r) =>
        r.exchange.includes("google.com") || r.exchange.includes("googlemail.com")
    );

    if (hasGoogle) {
      return {
        status: "pass",
        detail: `MX records point to Google: ${records.map((r) => r.exchange).join(", ")}`,
      };
    }

    return {
      status: "warn",
      detail: `MX records found but don't point to Google: ${records.map((r) => r.exchange).join(", ")}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "fail", detail: `MX lookup failed: ${msg}` };
  }
}
