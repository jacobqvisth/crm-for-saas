// Shared types for the /dashboard/promo-users page. Kept free of server
// imports so the client content component can import them (same split as
// free-users-shared.ts / valdemar-shared.ts).

/** Structurally matches ceo/source-info-data's SourceInfo so InfoHint takes it. */
export type PromoInfo = {
  title: string;
  body: string;
  sources?: string[];
  logic?: string;
};

/**
 * What a promo user did after getting the discount. Deliberately split into
 * OUTREACH (what we did to them, from the CRM) and PRODUCT (what they did in
 * the app, from the warehouse) — the whole question this page answers is
 * whether the two line up.
 */
export type PromoUserRow = {
  grantId: string;
  email: string | null;
  /** Workshop name from the app, falling back to the CRM company name. */
  company: string | null;
  country: string | null;
  /** Human code (WRENCHLANE90) when one was used, else null for a hand-applied coupon. */
  code: string | null;
  couponId: string;
  /** "90% off, 14 mo" style label built from the coupon terms. */
  terms: string;
  discountLabel: string;
  source: "subscription" | "invoice" | "both";
  activeNow: boolean;
  subscriptionStatus: string | null;
  currency: string | null;
  discountedCents: number;
  paidCents: number;
  invoiceCount: number;
  firstAppliedAt: string | null;
  lastAppliedAt: string | null;
  everPaid: boolean;
  isInternal: boolean;

  // Outreach (CRM)
  contactId: string | null;
  calls: number;
  callsConnected: number;
  emailsSent: number;
  replies: number;
  activities: number;
  lastContactedAt: string | null;

  // Product (warehouse)
  internalUserId: string | null;
  diagnostics: number;
  diagnosticChats: number;
  featureEvents: number;
  logins: number;
  activeDays: number;
  lastActiveAt: string | null;
  signedUpAt: string | null;
};

/** One row of the "which code did what" rollup. */
export type PromoCodeRow = {
  key: string;
  code: string | null;
  couponId: string;
  terms: string;
  customers: number;
  activeNow: number;
  everPaid: number;
  withDiagnostics: number;
  totalDiagnostics: number;
  /** Discount given up, per currency — never summed across currencies. */
  discountByCurrency: Array<{ currency: string; cents: number }>;
  firstAppliedAt: string | null;
  lastAppliedAt: string | null;
};

/**
 * Engagement ladder. Mutually exclusive and ordered worst → best, so the
 * buckets sum to the promo population and the drop-off is readable.
 */
export type PromoEngagementBucket = {
  key: "never_logged_in" | "logged_in_no_diagnosis" | "one_diagnosis" | "repeat";
  label: string;
  description: string;
  count: number;
  emails: string[];
};

/** Outreach coverage: did anyone actually follow the discount up? */
export type PromoOutreachBucket = {
  key: "called_and_emailed" | "emailed_only" | "called_only" | "neither";
  label: string;
  count: number;
  emails: string[];
};

export type PromoMoneyTotal = {
  currency: string;
  discountedCents: number;
  paidCents: number;
};

export type PromoUsersKpis = {
  customers: number;
  externalCustomers: number;
  internalCustomers: number;
  activeNow: number;
  everPaid: number;
  neverDiagnosed: number;
  neverContacted: number;
  everCalled: number;
  distinctCodes: number;
};

export type PromoUsersData = {
  kpis: PromoUsersKpis;
  money: PromoMoneyTotal[];
  users: PromoUserRow[];
  codes: PromoCodeRow[];
  engagement: PromoEngagementBucket[];
  outreach: PromoOutreachBucket[];
  /** Grants whose Stripe customer no longer resolves to anyone we know. */
  unresolvedGrants: number;
  note: string;
  error: string | null;
};

/**
 * Build the "90% off, 14 mo" label. Exported so the loader and any test agree
 * on one phrasing instead of formatting coupon terms in two places.
 */
export function couponTerms(
  percentOff: number | null,
  amountOffCents: number | null,
  currency: string | null,
  duration: string | null,
  durationInMonths: number | null,
): string {
  const size =
    percentOff !== null
      ? `${Number(percentOff)}% off`
      : amountOffCents !== null
        ? `${Math.round(amountOffCents / 100)} ${(currency ?? "").toUpperCase()} off`
        : "discount";

  const span =
    duration === "forever"
      ? "forever"
      : duration === "once"
        ? "once"
        : durationInMonths
          ? `${durationInMonths} mo`
          : (duration ?? "");

  return span ? `${size}, ${span}` : size;
}
