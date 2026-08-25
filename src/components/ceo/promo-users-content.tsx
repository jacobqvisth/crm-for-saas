"use client";

import { formatNumber } from "@/lib/ceo/format";
import type {
  PromoUserRow,
  PromoUsersData,
} from "@/lib/ceo/promo-users-shared";
import { InfoHint, type SourceInfo } from "./source-info";

type PromoUsersContentProps = {
  data: PromoUsersData;
};

const GRANT_INFO: SourceInfo = {
  title: "What counts as a promo, and what a row is",
  body:
    "Every coupon or promotion code Stripe has ever applied to a customer. One row per (customer, coupon): a 90%-off coupon riding twelve monthly invoices is ONE grant, not twelve. The promotion code is an attribute rather than part of the key, because the same coupon is routinely applied both through a code and by hand in the Stripe dashboard, and keying on the code would split one customer into two half-grants.",
  sources: [
    "dashboard_promo_grants (hourly Stripe sync)",
    "Stripe subscriptions.discounts + invoices.total_discount_amounts",
  ],
  logic:
    "'Active now' means the discount is still attached to a live subscription. A grant seen only on invoices has expired or been removed; one seen only on a subscription has not been billed yet. Internal and partner comps are shown but flagged rather than dropped — a comp to a partner is a real category.",
};

const MONEY_INFO: SourceInfo = {
  title: "How the money is counted",
  body:
    "Discount totals come from the per-discount amount Stripe already attributes on each invoice, so they are exact rather than modelled. 'Paid alongside' is what the same customer still paid on those invoices.",
  sources: ["Stripe invoices.total_discount_amounts", "invoices.amount_paid"],
  logic:
    "SEK, USD and EUR are all in use and are never summed together — each currency is its own line. On an invoice carrying two coupons the paid amount is attributed to the first coupon only, because there is no non-arbitrary split; discount amounts stay exact either way.",
};

const ACTIVITY_INFO: SourceInfo = {
  title: "Where the outreach and product columns come from",
  body:
    "Outreach is the CRM side: calls placed through the calling pipeline, sequence emails actually sent, replies landed in the inbox, and logged activities. Product is the app side: diagnostics (the core action), diagnostic chats, feature events and logins.",
  sources: [
    "call_sessions · email_queue · inbox_messages · activities",
    "dashboard_diagnostics · dashboard_feature_usage · contacts",
  ],
  logic:
    "A promo grant is joined to a CRM contact by billing email first, then by Stripe customer id; the contact carries wl_user_id, which keys the app-side tables. Diagnostics are all-history, but feature counters only exist from 2026-06-11, so a long-standing user's feature total understates their lifetime usage.",
};

function SummaryCard({
  value,
  label,
  hint,
  info,
}: {
  value: string;
  label: string;
  hint?: string;
  info?: SourceInfo;
}) {
  return (
    <div className="summary-card">
      <strong>{value}</strong>
      <span className="label-with-info">
        <span>{label}</span>
        {info ? <InfoHint info={info} /> : null}
      </span>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function money(cents: number, currency: string | null) {
  const amount = formatNumber(Math.round(cents / 100));
  if (!currency || currency === "—") return amount;
  return currency === "SEK" ? `${amount} kr` : `${amount} ${currency}`;
}

function day(value: string | null) {
  if (!value) return "—";
  return value.slice(0, 10);
}

function pct(part: number, whole: number) {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function codeLabel(row: PromoUserRow) {
  return row.code ?? `(no code · ${row.couponId})`;
}

export function PromoUsersContent({ data }: PromoUsersContentProps) {
  if (data.error) {
    return (
      <article className="panel panel-wide">
        <p>Could not load promo users: {data.error}</p>
      </article>
    );
  }

  const { kpis } = data;
  const primaryMoney = data.money[0] ?? null;
  const engagementTotal = data.engagement.reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  );
  const outreachTotal = data.outreach.reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  );

  if (kpis.customers === 0) {
    return (
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Promo users</p>
            <h2>No promo grants synced yet</h2>
          </div>
        </div>
        <p className="panel-description">{data.note}</p>
      </article>
    );
  }

  return (
    <div className="section-stack">
      {/* ---- KPI header ------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Promo users</p>
            <h2 className="heading-with-info">
              <span>Who got a discount, and what did they do with it?</span>
              <InfoHint info={GRANT_INFO} />
            </h2>
          </div>
        </div>
        <div className="summary-grid columns-4">
          <SummaryCard
            value={formatNumber(kpis.customers)}
            label="Customers ever discounted"
            hint={`${formatNumber(kpis.externalCustomers)} external · ${formatNumber(kpis.internalCustomers)} internal or partner`}
            info={GRANT_INFO}
          />
          <SummaryCard
            value={formatNumber(kpis.activeNow)}
            label="Still discounted today"
            hint={`${formatNumber(kpis.distinctCodes)} distinct codes or coupons used`}
          />
          <SummaryCard
            value={
              primaryMoney
                ? money(primaryMoney.discountedCents, primaryMoney.currency)
                : "—"
            }
            label="Discount given up"
            hint={
              data.money.length > 1
                ? `plus ${data.money
                    .slice(1)
                    .map((row) => money(row.discountedCents, row.currency))
                    .join(" + ")}`
                : "single currency"
            }
            info={MONEY_INFO}
          />
          <SummaryCard
            value={formatNumber(kpis.everPaid)}
            label="Ever paid real money"
            hint={`${pct(kpis.everPaid, kpis.customers)} of discounted customers`}
          />
        </div>
        <div className="summary-grid columns-3">
          <SummaryCard
            value={formatNumber(kpis.neverDiagnosed)}
            label="Never ran a diagnosis"
            hint={`${pct(kpis.neverDiagnosed, kpis.customers)} of them never used the core feature`}
            info={ACTIVITY_INFO}
          />
          <SummaryCard
            value={formatNumber(kpis.everCalled)}
            label="Ever called"
            hint={`${formatNumber(kpis.customers - kpis.everCalled)} never got a call`}
          />
          <SummaryCard
            value={formatNumber(kpis.neverContacted)}
            label="Never contacted at all"
            hint="No call, no sequence email, no logged activity"
          />
        </div>
        <p className="panel-description">{data.note}</p>
      </article>

      {/* ---- money by currency ------------------------------------------ */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h2 className="heading-with-info">
              <span>What the discounts cost, per currency</span>
              <InfoHint info={MONEY_INFO} />
            </h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Currency</th>
                <th>Discount given up</th>
                <th>Paid alongside</th>
                <th>Discount share</th>
              </tr>
            </thead>
            <tbody>
              {data.money.map((row) => {
                const total = row.discountedCents + row.paidCents;
                return (
                  <tr key={row.currency}>
                    <td className="table-primary">{row.currency}</td>
                    <td>{money(row.discountedCents, row.currency)}</td>
                    <td>{money(row.paidCents, row.currency)}</td>
                    <td>{pct(row.discountedCents, total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      {/* ---- engagement ladder ------------------------------------------ */}
      <article className="content-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="heading-with-info">
                <span>Did the discount produce a user?</span>
                <InfoHint info={ACTIVITY_INFO} />
              </h2>
            </div>
          </div>
          <div className="bar-list">
            {data.engagement.map((bucket) => (
              <div className="bar-row" key={bucket.key}>
                <div className="bar-row-main">
                  <span className="bar-row-copy">{bucket.label}</span>
                  <span>
                    {formatNumber(bucket.count)} ·{" "}
                    {pct(bucket.count, engagementTotal)}
                  </span>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${engagementTotal === 0 ? 0 : (bucket.count / engagementTotal) * 100}%`,
                    }}
                  />
                </div>
                <small>{bucket.description}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Did anyone follow the discount up?</h2>
            </div>
          </div>
          <div className="bar-list">
            {data.outreach.map((bucket) => (
              <div className="bar-row" key={bucket.key}>
                <div className="bar-row-main">
                  <span className="bar-row-copy">{bucket.label}</span>
                  <span>
                    {formatNumber(bucket.count)} ·{" "}
                    {pct(bucket.count, outreachTotal)}
                  </span>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${outreachTotal === 0 ? 0 : (bucket.count / outreachTotal) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </article>

      {/* ---- per code rollup -------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h2>Per code and coupon</h2>
            <p className="panel-description">
              Codes that were never redeemed do not appear here — this table is
              built from grants that actually landed on a customer.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Terms</th>
                <th>Customers</th>
                <th>Active now</th>
                <th>Ever paid</th>
                <th>Diagnosed</th>
                <th>Diagnoses</th>
                <th>Discount given up</th>
                <th>First</th>
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {data.codes.map((row) => (
                <tr key={row.key}>
                  <td className="table-primary">
                    {row.code ?? `(no code · ${row.couponId})`}
                  </td>
                  <td>{row.terms}</td>
                  <td>{formatNumber(row.customers)}</td>
                  <td>{formatNumber(row.activeNow)}</td>
                  <td>{formatNumber(row.everPaid)}</td>
                  <td>
                    {formatNumber(row.withDiagnostics)} ·{" "}
                    {pct(row.withDiagnostics, row.customers)}
                  </td>
                  <td>{formatNumber(row.totalDiagnostics)}</td>
                  <td>
                    {row.discountByCurrency
                      .map((entry) => money(entry.cents, entry.currency))
                      .join(" + ")}
                  </td>
                  <td>{day(row.firstAppliedAt)}</td>
                  <td>{day(row.lastAppliedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {/* ---- the user table --------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h2 className="heading-with-info">
              <span>Every discounted user</span>
              <InfoHint info={ACTIVITY_INFO} />
            </h2>
            <p className="panel-description">
              Sorted with live discounts first, then by diagnoses, then by how
              much discount they were given. Calls show connected in brackets.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Workshop</th>
                <th>Code</th>
                <th>Terms</th>
                <th>State</th>
                <th>Discount</th>
                <th>Paid</th>
                <th>Calls</th>
                <th>Emails</th>
                <th>Replies</th>
                <th>Acts</th>
                <th>Diagnoses</th>
                <th>Chats</th>
                <th>Features</th>
                <th>Logins</th>
                <th>Active days</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((row) => (
                <tr key={row.grantId}>
                  <td className="table-primary">
                    {row.email ?? "(deleted Stripe customer)"}
                    {row.isInternal ? (
                      <>
                        {" "}
                        <span className="badge">internal</span>
                      </>
                    ) : null}
                  </td>
                  <td>{row.company ?? "—"}</td>
                  <td>{codeLabel(row)}</td>
                  <td>{row.terms}</td>
                  <td>
                    {row.activeNow
                      ? (row.subscriptionStatus ?? "active")
                      : "expired"}
                    {row.everPaid ? (
                      <>
                        {" "}
                        <span className="badge">paid</span>
                      </>
                    ) : null}
                  </td>
                  <td>{money(row.discountedCents, row.currency)}</td>
                  <td>{money(row.paidCents, row.currency)}</td>
                  <td>
                    {formatNumber(row.calls)}
                    {row.calls > 0 ? ` (${row.callsConnected})` : ""}
                  </td>
                  <td>{formatNumber(row.emailsSent)}</td>
                  <td>{formatNumber(row.replies)}</td>
                  <td>{formatNumber(row.activities)}</td>
                  <td>{formatNumber(row.diagnostics)}</td>
                  <td>{formatNumber(row.diagnosticChats)}</td>
                  <td>{formatNumber(row.featureEvents)}</td>
                  <td>{formatNumber(row.logins)}</td>
                  <td>{formatNumber(row.activeDays)}</td>
                  <td>{day(row.lastActiveAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.unresolvedGrants > 0 ? (
          <p className="panel-description">
            {formatNumber(data.unresolvedGrants)} grant
            {data.unresolvedGrants === 1 ? "" : "s"} could not be matched to a
            CRM contact or app user — usually a Stripe customer that has since
            been deleted, which keeps the redemption but drops the email. Their
            outreach and product columns read zero because there is nobody to
            look up, not because nothing happened.
          </p>
        ) : null}
      </article>
    </div>
  );
}
