"use client";

import { formatNumber } from "@/lib/ceo/format";
import {
  COHORT_KEYS,
  USER_ID_WIRING_DATE,
  USD_TO_SEK,
  type CohortKey,
  type GoogleAdsUsersData,
} from "@/lib/ceo/google-ads-users-shared";
import { InfoHint, type SourceInfo } from "./source-info";

type GoogleAdsUsersContentProps = {
  data: GoogleAdsUsersData;
};

const ATTRIBUTION_INFO: SourceInfo = {
  title: "How users get attributed to Google Ads",
  body:
    "Both wrenchlane.com and app.wrenchlane.com run the same GA4 property, so the analytics cookie survives the marketing-to-app hop. GA4 stamps every identified user with the source of their FIRST visit; the hourly ga4_attribution sync joins that to app users via the crm_user_id custom dimension. A user counts as a Google Ads user when their first touch was an ad click (medium cpc, a Pmax campaign name, or GA4's Google Ads campaign dimension).",
  sources: ["dashboard_user_attribution (GA4 Data API)", "dashboard_users"],
  logic:
    `First-touch is reliable from ${USER_ID_WIRING_DATE} onward (when the user-ID wiring went live). Users who signed up before the first ad ran are kept in their own pre-ads cohort no matter what GA4 says, because a later ad click by an old user can masquerade as a first touch.`,
};

const BEHAVIOR_INFO: SourceInfo = {
  title: "Product behaviour by cohort",
  body:
    "Activation and diagnostics come from the full-history diagnostics table keyed per user. Chat = at least one diagnostic with a chat attached. Active last 30d uses last_seen_at from the app export. Churned = the app's own churned_at stamp.",
  sources: ["dashboard_diagnostics", "dashboard_users"],
  logic:
    "Feature counters (AI search, VRM, InfoPro, Motor) exist only from 2026-06-11 onward, which is fine for ads-era cohorts but understates pre-ads users' lifetime usage - compare pre-ads rows with that in mind.",
};

const PAYER_INFO: SourceInfo = {
  title: "Who counts as a payer",
  body:
    "Same rule as /funnel: a workshop with a paid plan or charge evidence, minus workshops still inside a never-charged trial. plan_key alone is not enough - it is stamped at checkout during the trial, before any money moves.",
  sources: ["dashboard_subscriptions.metadata (ever_paid / first_paid_at)", "dashboard_workshops.plan_key"],
  logic:
    "A workshop is ad-acquired when any of its users has Google Ads first-touch. Trial = any subscription with a trial_end. Active = subscription status active or past_due today.",
};

const MONEY_INFO: SourceInfo = {
  title: "Why money is modelled, not read from Stripe",
  body:
    "dashboard_subscriptions.mrr_amount_cents holds the amount in the Stripe price's default currency, not the customer's billing currency, so it cannot be summed as SEK. All money on this page is SEK list price per plan tier (One 179, Small 749, Large 1799 per month).",
  sources: ["SEK list prices (cac-ltv-shared)", "dashboard_metric_snapshots · google_ads.ad_spend (USD)"],
  logic:
    `Ad spend converts at a fixed ${USD_TO_SEK} SEK/USD, the same rate the CAC & LTV page uses for its server-rendered table. Revenue to date = months since first payment x tier list price - an estimate that ignores discounts, currency spreads and refunds. The full unit-economics model (data costs, AI costs, fees) lives on the CAC & LTV page.`,
};

function pctLabel(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function sek(value: number) {
  return `${formatNumber(Math.round(value))} kr`;
}

function days(value: number | null) {
  if (value === null) return "—";
  return value < 1 ? "<1 day" : `${value.toFixed(0)} days`;
}

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

const COHORT_SHORT: Record<CohortKey, string> = {
  google_ads: "Google Ads",
  ads_era_other: "Other (ads era)",
  pre_ads: "Pre-ads",
};

export function GoogleAdsUsersContent({ data }: GoogleAdsUsersContentProps) {
  if (data.error) {
    return (
      <article className="panel panel-wide">
        <p>Could not load Google Ads user data: {data.error}</p>
      </article>
    );
  }

  const { economics } = data;
  const adsBehavior = data.behavior.find((b) => b.key === "google_ads");
  const adsMonetization = data.monetization.find((m) => m.key === "google_ads");
  const trendMax = Math.max(
    ...data.monthlySignups.map((row) => row.googleAds + row.adsEraOther + row.preAds),
    1,
  );
  const totalAdsPayers = data.planMix.reduce((sum, row) => sum + row.adsPayers, 0);
  const totalOtherPayers = data.planMix.reduce((sum, row) => sum + row.otherPayers, 0);

  return (
    <div className="section-stack">
      {/* ---- KPI header ---------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Google Ads users</p>
            <h2 className="heading-with-info">
              <span>How much of the user base did ads actually bring in?</span>
              <InfoHint info={ATTRIBUTION_INFO} />
            </h2>
          </div>
        </div>
        <div className="summary-grid columns-4">
          <SummaryCard
            value={formatNumber(data.adsUsers)}
            label="Users from Google Ads"
            hint={`${pctLabel(data.adsShareOfAllPct)} of all ${formatNumber(data.totalUsers)} signups ever`}
          />
          <SummaryCard
            value={pctLabel(data.adsShareOfAdsEraPct)}
            label="Share of ads-era signups"
            hint={`${formatNumber(data.adsEraUsers)} signups since Pmax launch`}
          />
          <SummaryCard
            value={formatNumber(data.adsPayerWorkshops)}
            label="Paying workshops from ads"
            hint={
              adsMonetization
                ? `${pctLabel(adsMonetization.payerPct)} of ad-acquired workshops`
                : undefined
            }
            info={PAYER_INFO}
          />
          <SummaryCard
            value={pctLabel(data.attributionCoveragePct)}
            label="Attribution coverage (ads era)"
            hint="Share of ads-era signups GA4 could identify"
          />
        </div>
      </article>

      {/* ---- signups by month ---------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Acquisition mix</p>
            <h2>Signups by month and origin</h2>
            <p className="panel-description">
              Google Ads vs everything else. Coverage = share of that month&apos;s
              signups with a GA4 identity; months before June 2026 are partly
              blind, so their splits are floors, not truths.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Google Ads</th>
                <th>Other (ads era)</th>
                <th>Pre-ads</th>
                <th>Total</th>
                <th>Ads share</th>
                <th>Coverage</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.monthlySignups.map((row) => {
                const total = row.googleAds + row.adsEraOther + row.preAds;
                return (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{formatNumber(row.googleAds)}</td>
                    <td>{formatNumber(row.adsEraOther)}</td>
                    <td>{formatNumber(row.preAds)}</td>
                    <td>{formatNumber(total)}</td>
                    <td>{total > 0 ? pctLabel((row.googleAds / total) * 100, 0) : "—"}</td>
                    <td>{pctLabel(row.attributedPct, 0)}</td>
                    <td style={{ width: "30%" }}>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{ width: `${Math.max(2, (total / trendMax) * 100)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      {/* ---- behaviour ------------------------------------------------------ */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Product behaviour</p>
            <h2 className="heading-with-info">
              <span>What do ad-acquired users do, and skip, in the product?</span>
              <InfoHint info={BEHAVIOR_INFO} />
            </h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Users</th>
                <th>Activated</th>
                <th>Median time to 1st diagnostic</th>
                <th>Median diagnostics (activated)</th>
                <th>Used chat</th>
                <th>Active last 30d</th>
                <th>Churned</th>
              </tr>
            </thead>
            <tbody>
              {data.behavior.map((row) => (
                <tr key={row.key}>
                  <td>{COHORT_SHORT[row.key]}</td>
                  <td>{formatNumber(row.users)}</td>
                  <td>{pctLabel(row.activationPct)}</td>
                  <td>{days(row.medianDaysToFirstDiagnostic)}</td>
                  <td>
                    {row.medianDiagnosticsPerActivated !== null
                      ? formatNumber(row.medianDiagnosticsPerActivated)
                      : "—"}
                  </td>
                  <td>{pctLabel(row.usersWithChatPct)}</td>
                  <td>{pctLabel(row.activeLast30dPct)}</td>
                  <td>{pctLabel(row.churnedPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Feature adoption (share of cohort)</th>
                {COHORT_KEYS.map((key) => (
                  <th key={key}>{COHORT_SHORT[key]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.featureAdoption.map((row) => (
                <tr key={row.featureKey}>
                  <td>{row.label}</td>
                  {COHORT_KEYS.map((key) => (
                    <td key={key}>{pctLabel(row.pctByCohort[key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {/* ---- monetization --------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Monetization</p>
            <h2 className="heading-with-info">
              <span>How many convert to paying, how fast, and on which plans?</span>
              <InfoHint info={PAYER_INFO} />
            </h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Workshops</th>
                <th>Started trial</th>
                <th>Ever paid</th>
                <th>Trial to paid</th>
                <th>Active sub now</th>
                <th>Median signup to 1st payment</th>
                <th>Est. MRR</th>
                <th>Est. revenue to date</th>
              </tr>
            </thead>
            <tbody>
              {data.monetization.map((row) => (
                <tr key={row.key}>
                  <td>{COHORT_SHORT[row.key]}</td>
                  <td>{formatNumber(row.workshops)}</td>
                  <td>
                    {formatNumber(row.trialWorkshops)} ({pctLabel(row.trialPct)})
                  </td>
                  <td>
                    {formatNumber(row.payerWorkshops)} ({pctLabel(row.payerPct)})
                  </td>
                  <td>{pctLabel(row.trialToPaidPct)}</td>
                  <td>{formatNumber(row.activeSubWorkshops)}</td>
                  <td>{days(row.medianDaysToFirstPaid)}</td>
                  <td>{sek(row.estMrrSek)}</td>
                  <td>{sek(row.estRevenueToDateSek)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="summary-grid columns-3">
          {data.planMix.map((tier) => (
            <div className="summary-card" key={tier.tierKey}>
              <strong>
                {formatNumber(tier.adsPayers)} vs {formatNumber(tier.otherPayers)}
              </strong>
              <span>{tier.tierLabel} plan: ads payers vs all other payers</span>
              <small>
                {totalAdsPayers > 0 ? pctLabel((tier.adsPayers / totalAdsPayers) * 100, 0) : "0%"}{" "}
                of ads payers ·{" "}
                {totalOtherPayers > 0
                  ? pctLabel((tier.otherPayers / totalOtherPayers) * 100, 0)
                  : "0%"}{" "}
                of other payers
              </small>
            </div>
          ))}
        </div>
      </article>

      {/* ---- campaigns ------------------------------------------------------ */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Campaigns</p>
            <h2>Which campaigns the users came from</h2>
            <p className="panel-description">
              GA4 withholds the campaign name for a slice of Pmax traffic; those
              users are still confirmed ad clicks, just unlabeled.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Users</th>
                <th>Activated</th>
                <th>Paying workshops</th>
                <th>Signup to paid</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((row) => (
                <tr key={row.campaign}>
                  <td>{row.campaign}</td>
                  <td>{formatNumber(row.users)}</td>
                  <td>{formatNumber(row.activatedUsers)}</td>
                  <td>{formatNumber(row.payerWorkshops)}</td>
                  <td>{pctLabel(row.signupToPaidPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {/* ---- economics ------------------------------------------------------ */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Channel economics</p>
            <h2 className="heading-with-info">
              <span>What does an ads user cost, and what are they worth?</span>
              <InfoHint info={MONEY_INFO} />
            </h2>
          </div>
        </div>
        <div className="summary-grid columns-4">
          <SummaryCard
            value={sek(economics.spendSek)}
            label="Total ad spend"
            hint={`$${formatNumber(Math.round(economics.spendUsd))} since ${economics.spendSinceDate || "?"} · ${formatNumber(economics.adClicks)} clicks`}
          />
          <SummaryCard
            value={economics.costPerSignupSek !== null ? sek(economics.costPerSignupSek) : "—"}
            label="Spend per attributed signup"
            hint="Total spend ÷ users with ads first-touch"
          />
          <SummaryCard
            value={economics.cacPerPayerSek !== null ? sek(economics.cacPerPayerSek) : "—"}
            label="CAC per paying workshop"
            hint="Total spend ÷ ad-acquired payers"
          />
          <SummaryCard
            value={
              economics.arpaSekPerPayerMonth !== null
                ? `${sek(economics.arpaSekPerPayerMonth)}/mo`
                : "—"
            }
            label="ARPA of ads payers"
            hint="Plan-mix weighted SEK list price, active subs"
          />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Monthly churn scenario</th>
                <th>LTV per ads customer</th>
                <th>LTV : CAC</th>
                <th>CAC payback</th>
              </tr>
            </thead>
            <tbody>
              {economics.scenarios.map((row) => (
                <tr key={row.monthlyChurnPct}>
                  <td>{row.monthlyChurnPct}% / month</td>
                  <td>{sek(row.ltvSek)}</td>
                  <td>{row.ltvCacRatio !== null ? `${row.ltvCacRatio.toFixed(1)}x` : "—"}</td>
                  <td>
                    {row.paybackMonths !== null ? `${row.paybackMonths.toFixed(1)} months` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-description">
          LTV = ARPA x {economics.assumedGrossMarginPct}% assumed gross margin ÷
          churn. The measured cost model (per-vehicle data, AI, Stripe fees) is
          on the CAC &amp; LTV page; this table exists to sanity-check the ads
          channel specifically.
        </p>
      </article>

      {/* ---- countries ------------------------------------------------------ */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Geography</p>
            <h2>Where Google Ads users are</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Country</th>
                <th>Ads users</th>
                <th>Paying workshops</th>
              </tr>
            </thead>
            <tbody>
              {data.countries.map((row) => (
                <tr key={row.country}>
                  <td>{row.country}</td>
                  <td>{formatNumber(row.users)}</td>
                  <td>{formatNumber(row.payerWorkshops)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {adsBehavior ? (
          <p className="panel-description">
            Cohort size note: {formatNumber(adsBehavior.users)} users across{" "}
            {formatNumber(adsBehavior.workshops)} workshops. Percentages on small
            slices (single campaigns, small countries) move a lot per user - read
            them as direction, not precision.
          </p>
        ) : null}
      </article>
    </div>
  );
}
