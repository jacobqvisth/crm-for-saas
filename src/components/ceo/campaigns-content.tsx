"use client";

import { useState } from "react";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/ceo/format";
import {
  CAMPAIGN_CATALOG,
  CAMPAIGN_TYPE_EXPLAINERS,
  PURPOSE_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  USD_TO_SEK,
  isTabbed,
  type CampaignDetail,
  type CampaignPerformance,
  type CampaignStatus,
  type CampaignsData,
  type CatalogCampaign,
  type DailyPoint,
  type MonthlyPoint,
} from "@/lib/ceo/campaigns-shared";
import {
  WITHHELD_HEADLINES,
  creativeFor,
  keywordText,
  matchTypeOf,
} from "@/lib/ceo/campaigns-creative";
import {
  BROAD_THEN_NARROW,
  FUNNEL_MAP,
  FUNNEL_MECHANICS,
  IMPROVEMENT_PLAN,
  MORE_PAGES_ANSWER,
  MULTIPLE_PAGES_ANSWER,
  PLAN_FACTS,
  PMAX_BASELINE,
  PMAX_POWER_TABLE,
  PMAX_RECOMMENDATION,
  PMAX_SPLIT_VERDICT,
  TRACKING_ANSWER,
  WHY_TARGETING_IS_IMPRECISE,
  WHY_THIS_WORKS,
  type InfoPoint,
  type PlanPhaseState,
} from "@/lib/ceo/campaigns-info";
import { InfoHint, type SourceInfo } from "./source-info";

type CampaignsContentProps = {
  data: CampaignsData;
};

const SPEND_INFO: SourceInfo = {
  title: "Where the spend numbers come from",
  body:
    "Every number here comes from GA4's linked-Google-Ads dimensions, synced hourly, not from the Google Ads API. That means two things: a campaign only appears once it has actually served an impression, so paused campaigns show nothing at all; and spend arrives in USD even though the ad account bills in SEK. The API route now exists and is wired, and GOOGLE_ADS_CUSTOMER_ID is set, but GOOGLE_ADS_DEVELOPER_TOKEN is not present in any environment yet. Once it is, spend can come from the account itself and these two caveats go away.",
  sources: [
    "dashboard_metric_snapshots · source_key = google_ads",
    "GA4 Data API · sessionGoogleAdsCampaignName × advertiserAdCost",
  ],
  logic: `All money on this page is SEK, converted from GA4's USD at a fixed ${USD_TO_SEK} SEK/USD, the same rate the CAC/LTV and Google Ads Users pages use so the three never disagree.`,
};

const CATALOG_INFO: SourceInfo = {
  title: "Why there is a hand-written catalog",
  body:
    "GA4 can tell you what a campaign spent. It cannot tell you what the campaign is for, who it was aimed at, or why it exists. That context is maintained by hand and joined to the live numbers here. Anything found in the data but missing from the catalog is flagged rather than hidden.",
  sources: ["src/lib/ceo/campaigns-shared.ts · CAMPAIGN_CATALOG"],
  logic:
    "Status is maintained by hand. A campaign paused in the Google Ads UI will not change status here until the catalog is updated.",
};

const USERS_INFO: SourceInfo = {
  title: "Users per campaign",
  body:
    "Users whose GA4 first touch was this campaign, joined per user through crm_user_id. The lifetime total sits against all-time spend only. The monthly split places each user in the month they signed up, from dashboard_users.signed_up_at, because the attribution table itself stores no signup date.",
  sources: [
    "dashboard_user_attribution · google_ads_campaign",
    "dashboard_users · signed_up_at",
  ],
  logic:
    "Attribution is only reliable from late May 2026 onward, when the GA4 user-ID wiring went live. Earlier signups are attributed at their first identified session, which can postdate the actual signup.",
};

const CREATIVE_INFO: SourceInfo = {
  title: "Ad copy and keywords",
  body:
    "This is a mirror of what is live in Google Ads, maintained by hand, not read back from the ad account. Reading real ad text needs the Google Ads API, which is wired but still missing its developer token in the environment. Until that lands, editing copy in Google Ads without updating the dashboard makes this drift silently.",
  sources: ["src/lib/ceo/campaigns-creative.ts"],
  logic:
    "Last reconciled 2026-08-24 against the scripts that created and expanded these ads.",
};

const STATUS_ORDER: CampaignStatus[] = ["live", "paused", "planned"];

function statusTone(status: CampaignStatus) {
  switch (status) {
    case "live":
      return "badge badge-live";
    case "paused":
      return "badge badge-paused";
    case "planned":
      return "badge badge-planned";
    case "retired":
      return "badge badge-retired";
    default:
      return "badge";
  }
}

function sek(value: number) {
  return formatCurrency(value, "SEK");
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

/* ------------------------------------------------------------------ charts */

/**
 * Daily spend and clicks on one set of axes. Two different units, so each is
 * scaled to its own maximum and the legend says so. The point is shape and
 * coincidence in time, not absolute comparison between the two lines.
 */
function DailyChart({ points }: { points: DailyPoint[] }) {
  if (points.length < 2) return null;

  const width = 720;
  const height = 160;
  const padY = 8;
  const maxSpend = Math.max(...points.map((p) => p.spendSek), 1);
  const maxClicks = Math.max(...points.map((p) => p.clicks), 1);
  const step = width / (points.length - 1);

  const pathFor = (pick: (p: DailyPoint) => number, max: number) =>
    points
      .map((p, i) => {
        const x = i * step;
        const y = padY + (height - padY * 2) * (1 - pick(p) / max);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const spendPath = pathFor((p) => p.spendSek, maxSpend);
  const clicksPath = pathFor((p) => p.clicks, maxClicks);

  return (
    <div className="campaign-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Daily spend and clicks from ${points[0].date} to ${points[points.length - 1].date}`}
      >
        <path
          d={`${spendPath} L${width},${height} L0,${height} Z`}
          className="campaign-chart-fill"
        />
        <path d={spendPath} className="campaign-chart-line-spend" />
        <path d={clicksPath} className="campaign-chart-line-clicks" />
      </svg>
      <div className="campaign-chart-legend">
        <span>
          <i className="swatch swatch-spend" /> Spend, peak {sek(maxSpend)}/day
        </span>
        <span>
          <i className="swatch swatch-clicks" /> Clicks, peak{" "}
          {formatNumber(maxClicks)}/day
        </span>
        <span className="campaign-chart-range">
          {points[0].date} to {points[points.length - 1].date} · each line
          scaled to its own peak
        </span>
      </div>
    </div>
  );
}

/** Monthly spend bars with the users acquired that month alongside. */
function MonthlyBars({ points }: { points: MonthlyPoint[] }) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.spendSek), 1);
  return (
    <div className="bar-list">
      {points.map((p) => (
        <div className="bar-row" key={p.month}>
          <div className="bar-row-copy">
            <strong>{p.month}</strong>
            <span>
              {formatNumber(p.clicks)} clicks ·{" "}
              {formatNumber(p.impressions)} impressions
              {p.users > 0 ? ` · ${formatNumber(p.users)} users` : ""}
            </span>
          </div>
          <div className="bar-row-main">
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${Math.max(3, (p.spendSek / max) * 100)}%` }}
              />
            </div>
            <strong>{sek(p.spendSek)}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- per-campaign tab */

function CampaignTab({ detail }: { detail: CampaignDetail }) {
  const {
    catalog,
    performance,
    daily,
    monthly,
    spendSharePct,
    statusDiscrepancy,
    lowDeliveryWarning,
  } = detail;
  const adGroups = creativeFor(catalog.name);
  const totalKeywords = adGroups.reduce((s, g) => s + g.keywords.length, 0);

  return (
    <div className="section-stack">
      {/* ---- identity ---------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              {TYPE_LABELS[catalog.type]} · {PURPOSE_LABELS[catalog.purpose]}
            </p>
            <h2>{catalog.name}</h2>
          </div>
          <span className={statusTone(catalog.status)}>
            {STATUS_LABELS[catalog.status]}
          </span>
        </div>
        <p className="panel-description">{catalog.rationale}</p>
        {catalog.caveat ? (
          <p className="panel-description">
            <strong>Watch out. </strong>
            {catalog.caveat}
          </p>
        ) : null}
      </article>

      {statusDiscrepancy ? (
        <article className="panel panel-wide campaign-alert">
          <h3>Status is out of date</h3>
          <p>{statusDiscrepancy}</p>
        </article>
      ) : null}

      {lowDeliveryWarning ? (
        <article className="panel panel-wide campaign-alert">
          <h3>Live, but winning no auctions</h3>
          <p>{lowDeliveryWarning}</p>
        </article>
      ) : null}

      {/* ---- performance -------------------------------------------------- */}
      {performance ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Measured</p>
              <h3 className="heading-with-info">
                <span>Performance, all time</span>
                <InfoHint info={SPEND_INFO} />
              </h3>
            </div>
          </div>
          <div className="summary-grid columns-4">
            <SummaryCard
              value={sek(performance.spendSek)}
              label="Spend"
              hint={
                spendSharePct === null
                  ? undefined
                  : `${formatPercent(spendSharePct)} of all ad spend`
              }
            />
            <SummaryCard
              value={formatNumber(performance.clicks)}
              label="Clicks"
              hint={`${formatNumber(performance.impressions)} impressions`}
            />
            <SummaryCard
              value={
                performance.cpcSek === null ? "—" : sek(performance.cpcSek)
              }
              label="Cost per click"
              hint={
                performance.ctrPct === null
                  ? undefined
                  : `${formatPercent(performance.ctrPct, 2)} CTR`
              }
            />
            <SummaryCard
              value={
                performance.attributedUsers === null
                  ? "—"
                  : formatNumber(performance.attributedUsers)
              }
              label="Users acquired"
              hint={
                performance.costPerUserSek === null
                  ? undefined
                  : `${sek(performance.costPerUserSek)} each`
              }
              info={USERS_INFO}
            />
          </div>
          {performance.firstDay && performance.lastDay ? (
            <p className="panel-description">
              Serving from {performance.firstDay} to {performance.lastDay}.
            </p>
          ) : null}
        </article>
      ) : (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">No data yet</p>
              <h3>This campaign has never served an impression</h3>
            </div>
          </div>
          <p className="panel-description">
            {catalog.status === "planned"
              ? "It has not been built in Google Ads yet, so there is nothing to measure."
              : "It is built but paused, and GA4 only reports campaigns that actually served. Everything below is its configuration, which is real and checkable."}
          </p>
        </article>
      )}

      {/* ---- charts -------------------------------------------------------- */}
      {daily.length >= 2 ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Day by day</p>
              <h3>Spend and clicks</h3>
            </div>
          </div>
          <DailyChart points={daily} />
        </article>
      ) : null}

      {monthly.length > 0 ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Month by month</p>
              <h3 className="heading-with-info">
                <span>Spend, and the users it brought in</span>
                <InfoHint info={USERS_INFO} />
              </h3>
            </div>
          </div>
          <MonthlyBars points={monthly} />
          <p className="panel-description">
            Users are placed in the month they signed up. The current month is
            partial.
          </p>
        </article>
      ) : null}

      {/* ---- configuration -------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">How it is set up</p>
            <h3 className="heading-with-info">
              <span>Configuration</span>
              <InfoHint info={CATALOG_INFO} />
            </h3>
          </div>
        </div>
        <dl className="definition-list">
          <div className="definition-item">
            <dt>Who it targets</dt>
            <dd>{catalog.audience}</dd>
          </div>
          <div className="definition-item">
            <dt>Lands on</dt>
            <dd>{catalog.landingPage ?? "Not set"}</dd>
          </div>
          <div className="definition-item">
            <dt>Bidding</dt>
            <dd>{catalog.bidding}</dd>
          </div>
          <div className="definition-item">
            <dt>Daily budget</dt>
            <dd>
              {catalog.dailyBudgetSek
                ? `${sek(catalog.dailyBudgetSek)} per day`
                : "Not fixed in the catalog"}
            </dd>
          </div>
          <div className="definition-item">
            <dt>Where and language</dt>
            <dd>{catalog.geo}</dd>
          </div>
          {adGroups.length > 0 ? (
            <div className="definition-item">
              <dt>Structure</dt>
              <dd>
                {adGroups.length} ad{" "}
                {adGroups.length === 1 ? "group" : "groups"} ·{" "}
                {totalKeywords} keywords
              </dd>
            </div>
          ) : null}
        </dl>
      </article>

      {/* ---- creative -------------------------------------------------------- */}
      {adGroups.map((group) => (
        <article className="panel panel-wide" key={group.name}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Ad group</p>
              <h3 className="heading-with-info">
                <span>{group.name}</span>
                <InfoHint info={CREATIVE_INFO} />
              </h3>
            </div>
            <span className="badge">
              {group.headlines.length} headlines ·{" "}
              {group.descriptions.length} descriptions
            </span>
          </div>

          <h4 className="subheading">Keywords</h4>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Match type</th>
                </tr>
              </thead>
              <tbody>
                {group.keywords.map((kw) => (
                  <tr key={kw}>
                    <td>{keywordText(kw)}</td>
                    <td>
                      <span className="badge">{matchTypeOf(kw)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="subheading">Headlines</h4>
          <ul className="chip-list">
            {group.headlines.map((h) => (
              <li key={h}>
                {h} <small>{h.length}/30</small>
              </li>
            ))}
          </ul>

          <h4 className="subheading">Descriptions</h4>
          <ul className="tight-list">
            {group.descriptions.map((d) => (
              <li key={d}>
                {d} <small>({d.length}/90)</small>
              </li>
            ))}
          </ul>
        </article>
      ))}

      {adGroups.length > 0 && catalog.name.startsWith("WL Plan") ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Held back</p>
              <h3>Headlines deliberately not used</h3>
            </div>
          </div>
          <p className="panel-description">
            These run in Performance Max but were not carried into the Search
            campaigns. The first two are numeric performance claims held pending
            sign-off; the third pushes the free plan, which is the wrong call to
            action on a page selling a paid one.
          </p>
          <ul className="chip-list chip-list-muted">
            {WITHHELD_HEADLINES.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </article>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- info tab */

/**
 * "Built" and "Ready to run" read as done, everything blocked reads as stalled,
 * and the rest is still ahead of us. Three tones rather than five, because the
 * badge is a glance and the detail is in the phase body.
 */
function planStateTone(state: PlanPhaseState) {
  if (state === "Built") return "badge badge-live";
  if (state === "Blocked externally") return "badge badge-paused";
  return "badge badge-planned";
}

function PointList({ points }: { points: InfoPoint[] }) {
  return (
    <dl className="definition-list">
      {points.map((p) => (
        <div className="definition-item" key={p.heading}>
          <dt>{p.heading}</dt>
          <dd>{p.body}</dd>
        </div>
      ))}
    </dl>
  );
}

function InfoTab() {
  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Start here</p>
            <h2>How the plans work, and what advertising can and cannot do about them</h2>
          </div>
        </div>
        <p className="panel-description">
          Four plans, four landing pages, and a set of campaigns built to send
          each audience to the page written for it. That structure is sound, but
          it promises more precision than the Google auction can actually
          deliver, and it is worth understanding exactly where the limit sits
          before spending more against it.
        </p>
      </article>

      {/* ---- the plans ---------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">The product</p>
            <h3>The four plans</h3>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table campaign-type-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Price</th>
                <th>Built for</th>
                <th>Page</th>
                <th>How reachable it is with ads</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_FACTS.map((p) => (
                <tr key={p.plan}>
                  <td>
                    <strong>{p.plan}</strong>
                  </td>
                  <td>{p.price}</td>
                  <td>{p.builtFor}</td>
                  <td>
                    <small>{p.landingPage}</small>
                  </td>
                  <td>{p.reachability}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">The mechanic that shapes everything</p>
            <h3>Nobody buys a plan from an ad</h3>
          </div>
        </div>
        <PointList points={FUNNEL_MECHANICS} />
      </article>

      {/* ---- why it works -------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">The case for the current setup</p>
            <h3>Why this structure is a good one</h3>
          </div>
        </div>
        <PointList points={WHY_THIS_WORKS} />
      </article>

      {/* ---- the limits ----------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">The honest part</p>
            <h3>Why we cannot precisely reach One, Small or Large buyers</h3>
          </div>
        </div>
        <p className="panel-description">
          This is not a configuration problem that better targeting settings
          would fix. It is structural, and six separate things cause it.
        </p>
        <PointList points={WHY_TARGETING_IS_IMPRECISE} />
      </article>

      {/* ---- broad then narrow ----------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Strategy</p>
            <h3>Why going broad first, then narrowing, usually wins</h3>
          </div>
        </div>
        <PointList points={BROAD_THEN_NARROW} />
      </article>

      {/* ---- funnel map -------------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Coverage</p>
            <h3>The funnel, and which stages we actually cover</h3>
          </div>
        </div>
        <p className="panel-description">
          Campaigns are organised by plan today. Organising by what the person
          is trying to do is a better fit, because that is what they type into
          the search box.
        </p>
        <div className="table-wrap">
          <table className="data-table campaign-type-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Where their head is</th>
                <th>Campaign type</th>
                <th>Page it should land on</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {FUNNEL_MAP.map((row) => (
                <tr key={row.stage}>
                  <td>
                    <strong>{row.stage}</strong>
                  </td>
                  <td>{row.question}</td>
                  <td>{row.campaignType}</td>
                  <td>{row.page}</td>
                  <td>
                    <span
                      className={
                        row.status === "Running"
                          ? "badge badge-live"
                          : row.status === "Not built"
                            ? "badge badge-planned"
                            : "badge badge-paused"
                      }
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {/* ---- pmax per plan? ------------------------------------------------------ */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">A question that keeps coming up</p>
            <h3>
              Should we run a Performance Max campaign per plan, each on its own
              landing page, so we can compare them?
            </h3>
          </div>
        </div>
        <p className="panel-description">
          Short answer: pointing different audiences at different pages is a
          good idea, but separate campaigns are the wrong mechanism for it, and
          separate campaigns cannot answer the comparison question at all.
        </p>
        <PointList points={PMAX_SPLIT_VERDICT} />
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">How much traffic a real test needs</p>
            <h3>What this account can actually measure</h3>
          </div>
        </div>
        <p className="panel-description">
          Performance Max has delivered{" "}
          {formatNumber(PMAX_BASELINE.clicks)} clicks and{" "}
          {formatNumber(PMAX_BASELINE.signups)} signups, a{" "}
          {PMAX_BASELINE.signupRatePct}% click-to-signup rate, at roughly{" "}
          {PMAX_BASELINE.clicksPerDay} clicks a day. At that rate, here is how
          long it takes to tell a real difference from noise, at 80% power and
          95% confidence.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Difference you want to detect</th>
                <th>Clicks needed per variant</th>
                <th>2 variants</th>
                <th>4 variants</th>
              </tr>
            </thead>
            <tbody>
              {PMAX_POWER_TABLE.map((row) => (
                <tr key={row.effect}>
                  <td>{row.effect}</td>
                  <td>{row.clicksPerVariant}</td>
                  <td>{row.twoVariants}</td>
                  <td>{row.fourVariants}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-description">
          The four-variant column assumes the whole Performance Max budget is
          pointed at the test and still ignores the stricter threshold four
          simultaneous comparisons require. Treat it as a floor, not an
          estimate.
        </p>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Recommendation</p>
            <h3>What to do instead</h3>
          </div>
        </div>
        <PointList points={PMAX_RECOMMENDATION} />
      </article>

      {/* ---- the three follow-on questions -------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Follow-on question</p>
            <h3>Should we build more landing pages?</h3>
          </div>
        </div>
        <PointList points={MORE_PAGES_ANSWER} />
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Follow-on question</p>
            <h3>Can one Performance Max campaign use several landing pages?</h3>
          </div>
        </div>
        <PointList points={MULTIPLE_PAGES_ANSWER} />
      </article>

      <article className="panel panel-wide campaign-alert">
        <h3>Can we track which page delivers best? Not today</h3>
        <p>
          This is the question worth acting on. Three separate layers each
          block it, and the fix for all three is the same two columns.
        </p>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Follow-on question</p>
            <h3>Why we cannot currently tell which page delivered a signup</h3>
          </div>
        </div>
        <PointList points={TRACKING_ANSWER} />
      </article>

      {/* ---- the plan ------------------------------------------------------------ */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">What to build next</p>
            <h2>The improvement plan</h2>
          </div>
        </div>
        <p className="panel-description">
          Ordered so each phase unblocks the next. Phase 0 is not optional:
          nothing else changes anything while the live campaigns cannot win an
          auction. Each phase now carries where it actually stands, so the plan
          stops reading as untouched once work has landed against it.
        </p>
        <p className="panel-description">
          Phase 3, the fault-code pages, has grown large enough to need its own
          page. It is designed, sized against real diagnostic demand and queued
          on{" "}
          <a href="/dashboard/landing-pages">
            <strong>Landing Pages</strong>
          </a>
          , together with the map of which ad surface is allowed to point at
          which page and the one decision still open about where the pages get
          built.
        </p>
      </article>

      {IMPROVEMENT_PLAN.map((phase) => (
        <article className="panel panel-wide" key={phase.phase}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{phase.phase}</p>
              <h3>{phase.title}</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={planStateTone(phase.state)}>{phase.state}</span>
              <span className="badge">{phase.effort} effort</span>
            </div>
          </div>
          <p className="panel-description">{phase.why}</p>
          {phase.progress ? (
            <p className="panel-description">
              <strong>Where it stands. </strong>
              {phase.progress}
            </p>
          ) : null}
          {phase.blocked ? (
            <p className="panel-description">
              <strong>Constraint. </strong>
              {phase.blocked}
            </p>
          ) : null}
          <ul className="tight-list">
            {phase.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- overview */

function OverviewTab({
  data,
  onOpenCampaign,
}: {
  data: CampaignsData;
  onOpenCampaign: (name: string) => void;
}) {
  const { kpis, allTime, windows, trend, noDataCampaigns, attribution } = data;
  const alerts = data.details.filter(
    (d) => d.statusDiscrepancy || d.lowDeliveryWarning,
  );
  const [windowIndex, setWindowIndex] = useState(
    Math.max(windows.length - 1, 0),
  );
  const activeWindow = windows[windowIndex];

  const perfByName = new Map<string, CampaignPerformance>();
  for (const row of allTime) {
    perfByName.set(row.name.toLowerCase(), row);
    if (row.catalog) perfByName.set(row.catalog.name.toLowerCase(), row);
  }

  const uncatalogued = allTime.filter((row) => !row.catalog);
  const trendMax = Math.max(...trend.map((t) => t.totalSek), 1);

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Paid acquisition</p>
            <h2 className="heading-with-info">
              <span>Every Google Ads campaign, what it does, and what it costs</span>
              <InfoHint info={SPEND_INFO} />
            </h2>
          </div>
        </div>
        <p className="panel-description">
          Two live campaigns carry almost all paid volume. Alongside them sits a
          set of plan-targeted Search campaigns, built so each plan&apos;s
          audience lands on the page written for that plan rather than a generic
          one. Use the tabs above for a single campaign in full detail.
        </p>
        <div className="summary-grid columns-4">
          <SummaryCard
            value={sek(kpis.totalSpendSek)}
            label="Total spend, all time"
            hint={
              kpis.firstDay && kpis.lastDay
                ? `${kpis.firstDay} to ${kpis.lastDay}`
                : undefined
            }
            info={SPEND_INFO}
          />
          <SummaryCard
            value={formatNumber(kpis.totalClicks)}
            label="Clicks"
            hint={`${formatNumber(kpis.totalImpressions)} impressions`}
          />
          <SummaryCard
            value={kpis.blendedCpcSek === null ? "—" : sek(kpis.blendedCpcSek)}
            label="Blended cost per click"
            hint={
              kpis.blendedCtrPct === null
                ? undefined
                : `${formatPercent(kpis.blendedCtrPct, 2)} CTR`
            }
          />
          <SummaryCard
            value={`${kpis.liveCampaigns} live`}
            label="Campaigns in the catalog"
            hint={`${kpis.pausedOrPlanned} paused or not yet built`}
          />
        </div>
        {attribution ? (
          <p className="panel-description">
            Of {formatNumber(attribution.totalAttributedUsers)} users with GA4
            first-touch attribution,{" "}
            <strong>{formatNumber(attribution.googleAdsUsers)}</strong> (
            {formatPercent(attribution.googleAdsSharePct)}) arrived through
            Google Ads.
          </p>
        ) : null}
      </article>

      {alerts.length > 0 ? (
        <article className="panel panel-wide campaign-alert">
          <h3>
            {alerts.length} campaign{alerts.length === 1 ? "" : "s"} need
            attention
          </h3>
          <ul className="tight-list">
            {alerts.map((d) => (
              <li key={d.catalog.name}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onOpenCampaign(d.catalog.name)}
                >
                  {d.catalog.name}
                </button>
                {": "}
                {d.statusDiscrepancy ?? d.lowDeliveryWarning}
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Read this first</p>
            <h2>The three campaign types do genuinely different jobs</h2>
          </div>
        </div>
        <p className="panel-description">
          Comparing a Performance Max campaign to a Search campaign on cost per
          click is misleading. They buy different inventory, from people at
          different stages, with a different amount of control on our side.
        </p>
        <div className="table-wrap">
          <table className="data-table campaign-type-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>We control</th>
                <th>Google controls</th>
                <th>Where it shows</th>
                <th>Creative</th>
                <th>Best for</th>
                <th>Watch out</th>
              </tr>
            </thead>
            <tbody>
              {CAMPAIGN_TYPE_EXPLAINERS.map((row) => (
                <tr key={row.type}>
                  <td>
                    <strong>{row.label}</strong>
                  </td>
                  <td>
                    <ul className="tight-list">
                      {row.youControl.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    <ul className="tight-list">
                      {row.googleControls.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </td>
                  <td>{row.inventory}</td>
                  <td>{row.creative}</td>
                  <td>{row.bestFor}</td>
                  <td>{row.watchOut}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Measured</p>
            <h2 className="heading-with-info">
              <span>What each campaign actually did</span>
              <InfoHint info={SPEND_INFO} />
            </h2>
          </div>
          <div className="dashboard-range-bar">
            {windows.map((w, index) => (
              <button
                key={w.label}
                type="button"
                className={
                  index === windowIndex ? "button button-primary" : "button"
                }
                onClick={() => setWindowIndex(index)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {activeWindow && activeWindow.rows.length > 0 ? (
          <>
            <p className="panel-description">
              {activeWindow.label} · {sek(activeWindow.totalSpendSek)} across{" "}
              {activeWindow.rows.length}{" "}
              {activeWindow.rows.length === 1 ? "campaign" : "campaigns"}.
              Retired campaigns stay in this table because removing them would
              misstate spend history, but they have no tab of their own.
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Spend</th>
                    <th>Clicks</th>
                    <th>Impressions</th>
                    <th>CPC</th>
                    <th>CTR</th>
                    {activeWindow.days === null ? (
                      <th>
                        <span className="label-with-info">
                          <span>Users</span>
                          <InfoHint info={USERS_INFO} />
                        </span>
                      </th>
                    ) : null}
                    {activeWindow.days === null ? <th>Cost / user</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {activeWindow.rows.map((row) => (
                    <tr key={row.name}>
                      <td>
                        <strong>{row.name}</strong>
                        {row.catalog?.landingPage ? (
                          <>
                            <br />
                            <small>{row.catalog.landingPage}</small>
                          </>
                        ) : null}
                      </td>
                      <td>
                        {row.catalog ? TYPE_LABELS[row.catalog.type] : "Unknown"}
                      </td>
                      <td>
                        {row.catalog ? (
                          <span className={statusTone(row.catalog.status)}>
                            {STATUS_LABELS[row.catalog.status]}
                          </span>
                        ) : (
                          <span className="badge badge-paused">
                            Not in catalog
                          </span>
                        )}
                      </td>
                      <td>{sek(row.spendSek)}</td>
                      <td>{formatNumber(row.clicks)}</td>
                      <td>{formatNumber(row.impressions)}</td>
                      <td>{row.cpcSek === null ? "—" : sek(row.cpcSek)}</td>
                      <td>
                        {row.ctrPct === null
                          ? "—"
                          : formatPercent(row.ctrPct, 2)}
                      </td>
                      {activeWindow.days === null ? (
                        <td>
                          {row.attributedUsers === null
                            ? "—"
                            : formatNumber(row.attributedUsers)}
                        </td>
                      ) : null}
                      {activeWindow.days === null ? (
                        <td>
                          {row.costPerUserSek === null
                            ? "—"
                            : sek(row.costPerUserSek)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="panel-description">No spend recorded in this window.</p>
        )}

        {uncatalogued.length > 0 ? (
          <p className="panel-description">
            {uncatalogued.length} campaign
            {uncatalogued.length === 1 ? "" : "s"} in the data{" "}
            {uncatalogued.length === 1 ? "is" : "are"} not described in the
            catalog: {uncatalogued.map((r) => r.name).join(", ")}.
          </p>
        ) : null}
      </article>

      {trend.length > 0 ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Over time</p>
              <h2>Monthly spend, all campaigns</h2>
            </div>
          </div>
          <div className="bar-list">
            {trend.map((point) => {
              const top = Object.entries(point.byCampaign).sort(
                (a, b) => b[1] - a[1],
              );
              return (
                <div className="bar-row" key={point.month}>
                  <div className="bar-row-copy">
                    <strong>{point.month}</strong>
                    <span>
                      {top
                        .slice(0, 3)
                        .map(([name, value]) => `${name} ${sek(value)}`)
                        .join(" · ")}
                    </span>
                  </div>
                  <div className="bar-row-main">
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${Math.max(3, (point.totalSek / trendMax) * 100)}%`,
                        }}
                      />
                    </div>
                    <strong>{sek(point.totalSek)}</strong>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="panel-description">
            The current month is partial. Spend is converted from GA4&apos;s USD
            at {USD_TO_SEK} SEK/USD.
          </p>
        </article>
      ) : null}

      {STATUS_ORDER.map((status) => {
        const group = CAMPAIGN_CATALOG.filter(
          (c) => c.status === status && isTabbed(c),
        );
        if (group.length === 0) return null;
        return (
          <section className="content-grid" key={status}>
            {group.map((campaign) => (
              <OverviewCard
                key={campaign.name}
                campaign={campaign}
                perf={perfByName.get(campaign.name.toLowerCase())}
              />
            ))}
          </section>
        );
      })}

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Known limits</p>
            <h2>What this page cannot tell you, and why</h2>
          </div>
        </div>
        <dl className="definition-list">
          <div className="definition-item">
            <dt>Paused campaigns look empty</dt>
            <dd>
              GA4 only reports campaigns that served an impression. A campaign
              can be fully built and correctly configured and still show nothing
              here.{" "}
              {noDataCampaigns.length > 0
                ? `Currently ${noDataCampaigns.length} catalogued ${
                    noDataCampaigns.length === 1
                      ? "campaign has"
                      : "campaigns have"
                  } no data: ${noDataCampaigns.map((c) => c.name).join(", ")}.`
                : "Every catalogued campaign has data."}
            </dd>
          </div>
          <div className="definition-item">
            <dt>No conversions per campaign, for one more reason</dt>
            <dd>
              Spend, clicks and impressions come from GA4. Conversions and
              revenue per campaign need the Google Ads API. That client is now
              built and <code>GOOGLE_ADS_CUSTOMER_ID</code> is set, but{" "}
              <code>GOOGLE_ADS_DEVELOPER_TOKEN</code> is not present in any
              environment, and both are required. Until it is added, the closest
              available answer stays the users-acquired column, which is
              first-touch attribution rather than a conversion count.
            </dd>
          </div>
          <div className="definition-item">
            <dt>Ad copy is mirrored, not read back</dt>
            <dd>
              The headlines, descriptions and keywords on each campaign tab are
              maintained by hand from the scripts that created them. If someone
              edits an ad in Google Ads without updating the dashboard, this
              page will be out of date and will not know it.
            </dd>
          </div>
          <div className="definition-item">
            <dt>Currency is converted, not native</dt>
            <dd>
              The ad account bills in SEK. GA4 hands us USD. Everything here is
              converted at a fixed {USD_TO_SEK} SEK/USD rather than the daily
              rate, so totals will not reconcile to the invoice to the krona.
            </dd>
          </div>
          <div className="definition-item">
            <dt>Search will look expensive next to Performance Max</dt>
            <dd>
              That is real, not a reporting artefact. Search buys high-intent
              clicks at auction; PMax buys mixed inventory including very cheap
              display and video impressions. Judge them on cost per acquired
              user, not cost per click.
            </dd>
          </div>
        </dl>
      </article>
    </div>
  );
}

function OverviewCard({
  campaign,
  perf,
}: {
  campaign: CatalogCampaign;
  perf: CampaignPerformance | undefined;
}) {
  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            {TYPE_LABELS[campaign.type]} · {PURPOSE_LABELS[campaign.purpose]}
          </p>
          <h3>{campaign.name}</h3>
        </div>
        <span className={statusTone(campaign.status)}>
          {STATUS_LABELS[campaign.status]}
        </span>
      </div>
      <dl className="definition-list">
        <div className="definition-item">
          <dt>Who it targets</dt>
          <dd>{campaign.audience}</dd>
        </div>
        <div className="definition-item">
          <dt>Lands on</dt>
          <dd>{campaign.landingPage ?? "Not set"}</dd>
        </div>
      </dl>
      {perf ? (
        <div className="summary-grid columns-3">
          <SummaryCard value={sek(perf.spendSek)} label="Spend" />
          <SummaryCard value={formatNumber(perf.clicks)} label="Clicks" />
          <SummaryCard
            value={perf.cpcSek === null ? "—" : sek(perf.cpcSek)}
            label="CPC"
          />
        </div>
      ) : (
        <p className="panel-description">
          No performance data yet. Open its tab for the full configuration.
        </p>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------- shell */

export function CampaignsContent({ data }: CampaignsContentProps) {
  const [tab, setTab] = useState("overview");
  const details = data.details;
  const active = details.find((d) => d.catalog.name === tab);

  return (
    <div className="section-stack">
      <nav className="campaign-tabs" aria-label="Campaigns">
        <button
          type="button"
          className={tab === "overview" ? "campaign-tab is-active" : "campaign-tab"}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        {details.map((d) => (
          <button
            key={d.catalog.name}
            type="button"
            className={
              tab === d.catalog.name ? "campaign-tab is-active" : "campaign-tab"
            }
            onClick={() => setTab(d.catalog.name)}
          >
            {d.catalog.name.replace(/^WL Plan \| /, "")}
            <span className={statusTone(d.catalog.status)}>
              {STATUS_LABELS[d.catalog.status]}
            </span>
          </button>
        ))}
        <button
          type="button"
          className={tab === "info" ? "campaign-tab is-active" : "campaign-tab"}
          onClick={() => setTab("info")}
        >
          Info
        </button>
      </nav>

      {tab === "info" ? (
        <InfoTab />
      ) : active ? (
        <CampaignTab detail={active} />
      ) : (
        <OverviewTab data={data} onOpenCampaign={setTab} />
      )}
    </div>
  );
}
