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
import { InfoHint, type SourceInfo } from "./source-info";

type CampaignsContentProps = {
  data: CampaignsData;
};

const SPEND_INFO: SourceInfo = {
  title: "Where the spend numbers come from",
  body:
    "There is no Google Ads API connection on this account (no developer token). Every number here comes from GA4's linked-Google-Ads dimensions, synced hourly. That means two things: a campaign only appears once it has actually served an impression, so paused campaigns show nothing at all; and spend arrives in USD even though the ad account bills in SEK.",
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
    "This is a mirror of what is live in Google Ads, maintained by hand, not read back from the ad account. Reading real ad text would need a Google Ads API developer token this account does not have. If the copy is edited in Google Ads without updating the dashboard, this will drift.",
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
            <dt>No conversions per campaign</dt>
            <dd>
              Spend, clicks and impressions come from GA4. Conversions and
              revenue per campaign would need the Google Ads API, which requires
              a developer token this account does not have. The closest
              available answer is the users-acquired column, which is
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
      </nav>

      {active ? (
        <CampaignTab detail={active} />
      ) : (
        <OverviewTab data={data} onOpenCampaign={setTab} />
      )}
    </div>
  );
}
