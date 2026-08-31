// The funnel arithmetic for /dashboard/paying-customers, kept pure so the
// definitions that matter can be pinned by tests rather than by a comment.
//
// Three definitions do all the work here, and each one is a trap that has
// already cost this project a wrong number somewhere:
//
//   PAID means Stripe charged them. Not `plan_key`, which is stamped at
//   checkout while the trial is still running — 42 of 126 "paid plan"
//   workshops had never been charged when that was last measured.
//
//   CHECKOUT means a Stripe customer exists, i.e. a card was entered and a
//   trial began. This is the thing Google Ads mislabels as "purchase".
//
//   MATURE means the workshop signed up long enough ago to have had a fair
//   chance to convert. Ad traffic is much newer than direct traffic, so any
//   rate computed without this systematically flatters whichever channel is
//   older.

import { MATURITY_DAYS } from "./shared";

const DAY_MS = 86_400_000;

export type WorkshopFacts = {
  workshopId: string;
  channel: string;
  signedUpAt: string | null;
  /** Stripe customer created — card entered, trial started. */
  checkoutAt: string | null;
  /** Stripe actually charged them. Null means never. */
  firstPaidAt: string | null;
  /** Ran at least one diagnostic. */
  activated: boolean;
};

export function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS;
}

/**
 * The date on or before which a signup has had its full fair chance.
 *
 * Exported because the page states it out loud: a rate whose cohort boundary is
 * invisible invites the reader to compare it with a number built on a different
 * boundary.
 */
export function maturityCutoff(now: Date, maturityDays = MATURITY_DAYS): string {
  return new Date(now.getTime() - maturityDays * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Keep only workshops that signed up in the ads era AND are past the maturity
 * window.
 *
 * A workshop that has ALREADY paid is kept regardless of maturity: excluding it
 * would drop a real conversion from the numerator while its channel keeps the
 * signups it came with everywhere else, which biases every rate downward for
 * whichever channel converts fastest.
 */
export function selectMatureCohort(
  workshops: WorkshopFacts[],
  adsEraStart: string,
  cutoff: string,
): WorkshopFacts[] {
  return workshops.filter((w) => {
    if (!w.signedUpAt) return false;
    const day = w.signedUpAt.slice(0, 10);
    if (day < adsEraStart) return false;
    return day <= cutoff || w.firstPaidAt !== null;
  });
}

export function buildChannelFunnel(
  workshops: WorkshopFacts[],
  channel: string,
  label: string,
) {
  const inChannel = workshops.filter((w) => w.channel === channel);
  const activated = inChannel.filter((w) => w.activated).length;
  const checkouts = inChannel.filter((w) => w.checkoutAt !== null).length;
  const payerRows = inChannel.filter((w) => w.firstPaidAt !== null);
  const payers = payerRows.length;

  const daysToPaid = payerRows
    .filter((w) => w.signedUpAt && w.firstPaidAt)
    .map((w) => daysBetween(w.signedUpAt as string, w.firstPaidAt as string))
    .filter((d) => Number.isFinite(d) && d >= 0);

  return {
    channel,
    label,
    workshops: inChannel.length,
    activated,
    activatedPct: pct(activated, inChannel.length),
    checkouts,
    checkoutPct: pct(checkouts, inChannel.length),
    payers,
    paidPct: pct(payers, inChannel.length),
    checkoutToPaidPct: pct(payers, checkouts),
    medianDaysToPaid: median(daysToPaid),
  };
}

/**
 * Where a channel loses people relative to a reference channel.
 *
 * Returns the stage with the largest proportional shortfall, which is the one
 * worth fixing. On this account it is checkout, not payment: ad traffic reaches
 * checkout at about a fifth the rate of direct traffic, but once there it
 * converts to paid at a broadly comparable rate.
 */
export function worstStage(
  subject: ReturnType<typeof buildChannelFunnel>,
  reference: ReturnType<typeof buildChannelFunnel>,
): { stage: "activation" | "checkout" | "payment"; ratio: number } | null {
  const stages = [
    { stage: "activation" as const, a: subject.activatedPct, b: reference.activatedPct },
    { stage: "checkout" as const, a: subject.checkoutPct, b: reference.checkoutPct },
    {
      stage: "payment" as const,
      a: subject.checkoutToPaidPct,
      b: reference.checkoutToPaidPct,
    },
  ].filter((s) => s.b > 0);

  if (stages.length === 0) return null;

  let worst = stages[0];
  for (const s of stages) {
    if (s.a / s.b < worst.a / worst.b) worst = s;
  }
  return { stage: worst.stage, ratio: worst.b > 0 ? worst.a / worst.b : 0 };
}
