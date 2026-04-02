import type { Tables } from "@/lib/database.types";
import type { DomainCheckResult } from "./domain-check";

type GmailAccount = Tables<"gmail_accounts">;

export type HealthScoreBreakdown = {
  bounceRate: { score: number; weight: number; detail: string };
  domainAuth: { score: number; weight: number; detail: string };
  warmupProgress: { score: number; weight: number; detail: string };
  accountAge: { score: number; weight: number; detail: string };
  overall: number;
};

export type BounceStats = {
  sent: number;
  bounced: number;
};

export function calculateHealthScore(
  account: GmailAccount,
  bounceStats: BounceStats
): HealthScoreBreakdown {
  // 1. Bounce rate (35%)
  const bounceRateScore = calcBounceRateScore(bounceStats);

  // 2. Domain auth (25%)
  const domainAuthScore = calcDomainAuthScore(account.domain_health as DomainCheckResult | null);

  // 3. Warmup progress (20%)
  const warmupProgressScore = calcWarmupProgressScore(
    account.warmup_stage ?? "ramp",
    account.warmup_day ?? 0
  );

  // 4. Account age (20%)
  const accountAgeScore = calcAccountAgeScore(account.created_at);

  const overall = Math.round(
    bounceRateScore.score * bounceRateScore.weight +
    domainAuthScore.score * domainAuthScore.weight +
    warmupProgressScore.score * warmupProgressScore.weight +
    accountAgeScore.score * accountAgeScore.weight
  );

  return {
    bounceRate: bounceRateScore,
    domainAuth: domainAuthScore,
    warmupProgress: warmupProgressScore,
    accountAge: accountAgeScore,
    overall: Math.min(100, Math.max(0, overall)),
  };
}

function calcBounceRateScore(stats: BounceStats): { score: number; weight: number; detail: string } {
  const weight = 0.35;

  if (stats.sent === 0) {
    return { score: 80, weight, detail: "No emails sent in last 7 days." };
  }

  const rate = stats.bounced / stats.sent;
  const pct = (rate * 100).toFixed(1);

  if (rate < 0.02) {
    return { score: 100, weight, detail: `Bounce rate: ${pct}% (excellent)` };
  } else if (rate < 0.05) {
    return { score: 70, weight, detail: `Bounce rate: ${pct}% (moderate)` };
  } else if (rate < 0.08) {
    return { score: 40, weight, detail: `Bounce rate: ${pct}% (high — review list quality)` };
  } else {
    return { score: 0, weight, detail: `Bounce rate: ${pct}% (critical — account may be paused)` };
  }
}

function calcDomainAuthScore(
  domainHealth: DomainCheckResult | null
): { score: number; weight: number; detail: string } {
  const weight = 0.25;

  if (!domainHealth || !domainHealth.checkedAt) {
    return { score: 50, weight, detail: "Domain authentication not checked yet." };
  }

  const checks = [domainHealth.spf, domainHealth.dkim, domainHealth.dmarc, domainHealth.mx];
  const hasAnyFail = checks.some((c) => c?.status === "fail");
  const hasAnyWarn = checks.some((c) => c?.status === "warn");

  if (!hasAnyFail && !hasAnyWarn) {
    return { score: 100, weight, detail: "All domain authentication checks passed." };
  } else if (!hasAnyFail) {
    return { score: 80, weight, detail: "Domain auth has warnings — check DMARC/SPF configuration." };
  } else {
    return { score: 30, weight, detail: "Domain auth has failures — SPF, DKIM or MX not configured for Google." };
  }
}

function calcWarmupProgressScore(
  stage: string,
  warmupDay: number
): { score: number; weight: number; detail: string } {
  const weight = 0.20;

  if (stage === "graduated") {
    return { score: 100, weight, detail: "Warmup complete — account is fully ramped." };
  } else if (stage === "manual") {
    return { score: 80, weight, detail: "Manual sending mode — warmup skipped." };
  } else if (stage === "ramp") {
    if (warmupDay > 0) {
      return { score: 70, weight, detail: `Warming up — day ${warmupDay}/21.` };
    } else {
      return { score: 30, weight, detail: "Warmup not started yet." };
    }
  }

  return { score: 50, weight, detail: "Unknown warmup state." };
}

function calcAccountAgeScore(createdAt: string): { score: number; weight: number; detail: string } {
  const weight = 0.20;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays > 90) {
    return { score: 100, weight, detail: `Account connected ${Math.round(ageDays)} days ago.` };
  } else if (ageDays > 30) {
    return { score: 70, weight, detail: `Account connected ${Math.round(ageDays)} days ago.` };
  } else {
    return { score: 50, weight, detail: `Account connected ${Math.round(ageDays)} days ago (new account).` };
  }
}
