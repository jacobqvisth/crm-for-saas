"use client";

import { useMemo, useState } from "react";
import { formatNumber, formatPercent } from "@/lib/ceo/format";
import type { PayingCustomersData } from "@/lib/ceo/paying-customers/shared";
import {
  ADS_ERA_START,
  MATURITY_DAYS,
  PAYING_TABS,
  type PayingTab,
} from "@/lib/ceo/paying-customers/shared";
import { worstStage } from "@/lib/ceo/paying-customers/funnel";

type Props = { data: PayingCustomersData; initialTab: PayingTab };

function pctText(value: number, digits = 1): string {
  return formatPercent(value, digits);
}

function day(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

function sek(value: number): string {
  return `${formatNumber(Math.round(value))} kr`;
}

/**
 * Subscription amounts are stored in the minor unit of the subscription's OWN
 * currency, so they are never summed here. Three currencies are live on the
 * account and adding them would produce a number that is not money in any of
 * them; each row shows its own.
 */
function money(minor: number | null, currency: string | null): string {
  if (minor === null) return "—";
  const amount = formatNumber(Math.round(minor / 100));
  return currency ? `${amount} ${currency}` : amount;
}

const STAGE_LABELS = {
  activation: "trying the product",
  checkout: "entering a card",
  payment: "converting a trial to a payment",
} as const;

function Kpi({
  value,
  label,
  hint,
}: {
  value: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="summary-card">
      <strong>{value}</strong>
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

// ------------------------------------------------------------------ funnel

function FunnelTab({ data }: { data: PayingCustomersData }) {
  const ads = data.funnels.find((f) => f.channel === "google_ads");
  const direct = data.funnels.find((f) => f.channel === "direct");
  const worst = ads && direct ? worstStage(ads, direct) : null;

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              Signed up {ADS_ERA_START} or later, on or before {data.maturityCutoff}
            </p>
            <h3>Ad click to actual payment, by channel</h3>
          </div>
        </div>
        <p className="panel-description">
          Only workshops that signed up at least {MATURITY_DAYS} days ago are counted, so
          every channel has had the same chance to convert. Without that cut-off the
          comparison is rigged: ad traffic is much newer than direct traffic, and a raw
          side-by-side charges ads for cohorts that have not finished their trial yet.
          Workshops that have already paid are kept regardless of age, because dropping a
          real payment would understate the fastest-converting channel.
        </p>
        <div className="table-wrap">
          <table className="data-table best-ads-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th style={{ textAlign: "right" }}>Signed up</th>
                <th style={{ textAlign: "right" }}>Tried it</th>
                <th style={{ textAlign: "right" }}>Entered a card</th>
                <th style={{ textAlign: "right" }}>Actually paid</th>
                <th style={{ textAlign: "right" }}>Signup to paid</th>
                <th style={{ textAlign: "right" }}>Card to paid</th>
                <th style={{ textAlign: "right" }}>Median days</th>
              </tr>
            </thead>
            <tbody>
              {data.funnels.map((f) => (
                <tr key={f.channel}>
                  <td>
                    <span className="table-primary-name">{f.label}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>{formatNumber(f.workshops)}</td>
                  <td style={{ textAlign: "right" }}>
                    {formatNumber(f.activated)}
                    <small className="table-secondary">{pctText(f.activatedPct)}</small>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {formatNumber(f.checkouts)}
                    <small className="table-secondary">{pctText(f.checkoutPct)}</small>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <strong>{formatNumber(f.payers)}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>{pctText(f.paidPct, 2)}</td>
                  <td style={{ textAlign: "right" }}>{pctText(f.checkoutToPaidPct)}</td>
                  <td style={{ textAlign: "right" }}>
                    {f.medianDaysToPaid === null ? "—" : Math.round(f.medianDaysToPaid)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {ads && direct && worst ? (
          <div className="playbook-callout playbook-caution">
            <h4>Where ad traffic is lost</h4>
            <p>
              Google Ads brings {formatNumber(ads.workshops)} signups in this cohort and{" "}
              {formatNumber(ads.payers)} paying customers ({pctText(ads.paidPct, 2)}).
              Direct brings {formatNumber(direct.workshops)} and{" "}
              {formatNumber(direct.payers)} ({pctText(direct.paidPct, 2)}). The widest gap
              is at <strong>{STAGE_LABELS[worst.stage]}</strong>, where ad traffic runs at{" "}
              {worst.ratio.toFixed(2)}x the direct rate. Once an ad-acquired workshop has
              entered a card it converts at {pctText(ads.checkoutToPaidPct)} against{" "}
              {pctText(direct.checkoutToPaidPct)} for direct, so the problem is reaching
              that point, not closing from it.
            </p>
          </div>
        ) : null}
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">All time, ad-acquired only</p>
            <h3>By campaign</h3>
          </div>
        </div>
        <p className="panel-description">
          GA4 first-touch records the campaign and nothing finer, so this cannot go down
          to ad group, keyword or asset. In practice one campaign carries nearly all of
          it, which means campaign-level comparison has very little to separate.
        </p>
        <div className="table-wrap">
          <table className="data-table best-ads-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th style={{ textAlign: "right" }}>Signups</th>
                <th style={{ textAlign: "right" }}>Entered a card</th>
                <th style={{ textAlign: "right" }}>Paying</th>
                <th style={{ textAlign: "right" }}>Signup to paid</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.campaign}>
                  <td>
                    <span className="table-primary-name">{c.campaign}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>{formatNumber(c.workshops)}</td>
                  <td style={{ textAlign: "right" }}>{formatNumber(c.checkouts)}</td>
                  <td style={{ textAlign: "right" }}>
                    <strong>{formatNumber(c.payers)}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>{pctText(c.paidPct, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

// --------------------------------------------------------------- customers

function CustomersTab({ data }: { data: PayingCustomersData }) {
  const [onlyActive, setOnlyActive] = useState(false);
  const rows = useMemo(
    () => (onlyActive ? data.customers.filter((c) => c.status === "active") : data.customers),
    [data.customers, onlyActive],
  );

  return (
    <article className="panel panel-wide">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Ad-acquired, charged at least once</p>
          <h3>Who actually pays</h3>
        </div>
        <span className="meta-pill">{rows.length} shown</span>
      </div>
      <p className="panel-description">
        Every workshop whose first touch was a Google Ads click and whom Stripe has
        actually charged. Membership is decided by{" "}
        <code>metadata.ever_paid</code>, never by the plan on the account: the plan is
        stamped when a card is entered, while the trial is still running, so a
        plan-based list would include people who have never paid anything.
      </p>
      <div className="range-tabs" role="group" aria-label="Filter">
        <button
          type="button"
          className={onlyActive ? "range-tab" : "range-tab is-active"}
          onClick={() => setOnlyActive(false)}
        >
          Everyone ever charged ({data.customers.length})
        </button>
        <button
          type="button"
          className={onlyActive ? "range-tab is-active" : "range-tab"}
          onClick={() => setOnlyActive(true)}
        >
          Still active ({data.customers.filter((c) => c.status === "active").length})
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="empty-state">No ad-acquired workshop has been charged yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table best-ads-table">
            <thead>
              <tr>
                <th>Workshop</th>
                <th>Campaign</th>
                <th>Signed up</th>
                <th>Card entered</th>
                <th>First paid</th>
                <th style={{ textAlign: "right" }}>Days</th>
                <th>Plan</th>
                <th style={{ textAlign: "right" }}>Monthly</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.workshopId}>
                  <td>
                    <span className="table-primary-name">
                      {c.name ?? `${c.workshopId.slice(0, 8)}…`}
                    </span>
                    {c.country ? (
                      <small className="table-secondary">{c.country}</small>
                    ) : null}
                  </td>
                  <td className="best-ads-campaigns">{c.campaign ?? "—"}</td>
                  <td>{day(c.signedUpAt)}</td>
                  <td>{day(c.checkoutAt)}</td>
                  <td>{c.firstPaidAt ? day(c.firstPaidAt) : "date unknown"}</td>
                  <td style={{ textAlign: "right" }}>
                    {c.daysSignupToPaid === null ? "—" : c.daysSignupToPaid}
                  </td>
                  <td>{c.planKey ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    {money(c.mrrMinorUnits, c.currency)}
                  </td>
                  <td>
                    <span
                      className={
                        c.status === "active" ? "segment-active" : "segment-inactive"
                      }
                    >
                      {c.status ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

// ----------------------------------------------------------- reconciliation

function ReconciliationTab({ data }: { data: PayingCustomersData }) {
  const totals = data.reconciliation.reduce(
    (acc, r) => ({
      googlePurchases: acc.googlePurchases + r.googlePurchases,
      ourCheckouts: acc.ourCheckouts + r.ourAdCheckouts,
      ourPayments: acc.ourPayments + r.ourAdFirstPayments,
      googleValue: acc.googleValue + r.googlePurchaseValue,
    }),
    { googlePurchases: 0, ourCheckouts: 0, ourPayments: 0, googleValue: 0 },
  );

  const tracksCheckouts =
    totals.ourCheckouts > 0 &&
    Math.abs(totals.googlePurchases - totals.ourCheckouts) <
      Math.abs(totals.googlePurchases - totals.ourPayments);

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">The finding</p>
            <h3>What Google counts as a purchase is not a purchase</h3>
          </div>
        </div>
        <p className="panel-description">
          Google Ads had a conversion action called{" "}
          <code>WrenchLane (web) purchase</code> whose counts tracked the moment a card is
          entered, not the moment money moves. It has been renamed to{" "}
          <code>WrenchLane (web) checkout started (card entered)</code> so it stops being
          read as revenue, but the numbers below are unchanged — the rename fixed the
          label, not the underlying event, which is fired by the app. Compare the last two
          columns: the middle one is card entries and the right one is Stripe charges.
        </p>
        <div className="table-wrap">
          <table className="data-table best-ads-table">
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: "right" }}>Google &ldquo;sign_up&rdquo;</th>
                <th style={{ textAlign: "right" }}>Google &ldquo;purchase&rdquo;</th>
                <th style={{ textAlign: "right" }}>Google&apos;s claimed value</th>
                <th style={{ textAlign: "right" }}>Our card entries</th>
                <th style={{ textAlign: "right" }}>Our real first payments</th>
              </tr>
            </thead>
            <tbody>
              {data.reconciliation.map((r) => (
                <tr key={r.month}>
                  <td>
                    <span className="table-primary-name">{r.month}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>{r.googleSignups.toFixed(0)}</td>
                  <td style={{ textAlign: "right" }}>
                    <strong>{r.googlePurchases.toFixed(0)}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>{sek(r.googlePurchaseValue)}</td>
                  <td style={{ textAlign: "right" }}>
                    <strong>{formatNumber(r.ourAdCheckouts)}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {formatNumber(r.ourAdFirstPayments)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td />
                <td style={{ textAlign: "right" }}>
                  <strong>{totals.googlePurchases.toFixed(0)}</strong>
                </td>
                <td style={{ textAlign: "right" }}>{sek(totals.googleValue)}</td>
                <td style={{ textAlign: "right" }}>
                  <strong>{formatNumber(totals.ourCheckouts)}</strong>
                </td>
                <td style={{ textAlign: "right" }}>
                  {formatNumber(totals.ourPayments)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {tracksCheckouts ? (
          <div className="playbook-callout playbook-caution">
            <h4>Google is counting card entries, not payments</h4>
            <p>
              Across these months Google recorded{" "}
              {totals.googlePurchases.toFixed(0)} &ldquo;purchases&rdquo; against{" "}
              {formatNumber(totals.ourCheckouts)} card entries and only{" "}
              {formatNumber(totals.ourPayments)} real first payments. The{" "}
              {sek(totals.googleValue)} it reports as revenue is the list price of plans
              people selected, most of whom were never charged. Any cost-per-acquisition
              or ROAS figure read from the Google Ads UI is measuring trials.
            </p>
          </div>
        ) : null}
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Account configuration</p>
            <h3>What the bidding algorithm can actually see</h3>
          </div>
        </div>
        <p className="panel-description">
          A conversion action steers bidding only when Google both counts it in the
          Conversions column and treats it as a goal. Everything else is recorded and
          ignored.
        </p>
        <div className="table-wrap">
          <table className="data-table best-ads-table">
            <thead>
              <tr>
                <th>Conversion action</th>
                <th>Category</th>
                <th>Counting</th>
                <th style={{ textAlign: "right" }}>Last 30 days</th>
                <th style={{ textAlign: "right" }}>Value</th>
                <th>Drives bidding</th>
              </tr>
            </thead>
            <tbody>
              {data.conversionActions.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="table-primary-name">{a.name}</span>
                  </td>
                  <td className="muted">{a.category ?? "—"}</td>
                  <td className="muted">{a.countingType ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    {a.last30dConversions.toFixed(0)}
                  </td>
                  <td style={{ textAlign: "right" }}>{sek(a.last30dValue)}</td>
                  <td>
                    <span className={a.drivesBidding ? "lift-badge lift-strong" : "muted"}>
                      {a.drivesBidding ? "yes" : "no"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

// ------------------------------------------------------------------ method

function MethodTab({ data }: { data: PayingCustomersData }) {
  return (
    <article className="panel panel-wide">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Read this before quoting a number</p>
          <h2>How this is measured</h2>
        </div>
      </div>

      <h4>Three different things get called a conversion</h4>
      <ul className="tight-list">
        <li>
          <strong>Signed up</strong> — a free account exists. This is the only thing
          Google Ads currently bids toward.
        </li>
        <li>
          <strong>Entered a card</strong> — a Stripe customer exists and a trial started.
          This is what Google Ads reports as &ldquo;purchase&rdquo;.
        </li>
        <li>
          <strong>Paid</strong> — Stripe actually charged them at least once. Only this
          one is revenue, and it is the definition used everywhere on this page.
        </li>
      </ul>

      <h4>Why paid is not read from the plan</h4>
      <p className="panel-description">
        The plan on an account is written at checkout, while the trial is still running,
        so a plan-based count includes people who never paid. Paying membership here comes
        from <code>metadata.ever_paid</code> on the Stripe subscription, and the date from{" "}
        <code>metadata.first_paid_at</code>. A workshop that was charged but has no stored
        timestamp is still counted, and shown as &ldquo;date unknown&rdquo; rather than
        dropped.
      </p>

      <h4>Why the cohort is cut off at {data.maturityCutoff}</h4>
      <p className="panel-description">
        Ad traffic is much newer than direct traffic. Comparing them without a maturity
        window charges ads for signups that have not finished a trial yet. Every rate on
        the funnel tab counts only workshops that signed up on or before{" "}
        {data.maturityCutoff}, which is {MATURITY_DAYS} days ago, plus anyone who has
        already paid.
      </p>

      <h4>How a user is tied to an ad</h4>
      <p className="panel-description">
        GA4 first-touch attribution, joined per user through the Cognito id that both the
        marketing site and the app stamp into GA4. It records source, medium and campaign
        — and nothing finer. There is no ad group, no keyword, no asset and no{" "}
        <code>gclid</code> stored anywhere, so this page cannot say which ad or which
        landing page produced a customer, only which campaign.
      </p>

      <h4>What this page cannot do</h4>
      <ul className="tight-list">
        <li>
          <strong>Tell Google about the payments.</strong> Offline conversion import
          through the Google Ads API is closed to new integrations; Google now requires
          the Data Manager API, and the OAuth token this app holds does not carry the
          scope for it. Until that changes, payments stay in this dashboard and never
          reach the bidding algorithm.
        </li>
        <li>
          <strong>Attribute below the campaign.</strong> See above — the identifiers do
          not exist in our data.
        </li>
        <li>
          <strong>Prove causation.</strong> First-touch attribution assigns a customer to
          whatever brought them first. Someone who saw an ad, forgot, and returned by
          typing the address is recorded as direct.
        </li>
      </ul>

      <h4>Currency</h4>
      <p className="panel-description">
        Subscription amounts are stored in the minor unit of each subscription&apos;s own
        currency and three are live on this account, so per-customer amounts are shown
        with their currency and never summed. Ad spend is converted from the reported USD
        at a fixed {formatNumber(9.6)} SEK, the same constant the campaigns and CAC/LTV
        pages use, so the three never disagree.
      </p>
    </article>
  );
}

// ------------------------------------------------------------------- shell

export function PayingCustomersContent({ data, initialTab }: Props) {
  const [tab, setTab] = useState<PayingTab>(initialTab);

  if (!data.configured || data.emptyReason) {
    return (
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h2>Nothing to show yet</h2>
          </div>
        </div>
        <p className="panel-description">
          {data.emptyReason ?? "Data has not been synced yet."}
        </p>
      </article>
    );
  }

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Google Ads · acquisition to revenue</p>
            <h2>Paying customers</h2>
          </div>
        </div>
        <p className="panel-description">
          Of the people an ad brought in, which ones actually started paying — not signed
          up, and not entered a card. Those three numbers differ by an order of magnitude
          on this account, and only the last one is money.
        </p>
        <div className="summary-grid columns-4">
          <Kpi
            value={formatNumber(data.adPayersAllTime)}
            label="Ad-acquired paying customers"
            hint="Stripe has charged them at least once"
          />
          <Kpi
            value={formatNumber(data.adCheckoutsAllTime)}
            label="Ad-acquired card entries"
            hint="what Google reports as purchases"
          />
          <Kpi
            value={formatNumber(data.adSignupsAllTime)}
            label="Ad-acquired signups"
            hint="what Google currently bids toward"
          />
          <Kpi
            value={
              data.costPerAdPayerSek === null ? "—" : sek(data.costPerAdPayerSek)
            }
            label="Ad spend per paying customer"
            hint={`${sek(data.adSpendSek)} spent in total`}
          />
        </div>
      </article>

      <nav className="campaign-tabs" aria-label="Paying customers">
        {PAYING_TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={tab === entry.key ? "campaign-tab is-active" : "campaign-tab"}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "funnel" ? <FunnelTab data={data} /> : null}
      {tab === "customers" ? <CustomersTab data={data} /> : null}
      {tab === "reconciliation" ? <ReconciliationTab data={data} /> : null}
      {tab === "method" ? <MethodTab data={data} /> : null}
    </div>
  );
}
