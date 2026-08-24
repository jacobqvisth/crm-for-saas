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
  type CampaignPerformance,
  type CampaignStatus,
  type CampaignsData,
  type CatalogCampaign,
} from "@/lib/ceo/campaigns-shared";
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
    "GA4 can tell you what a campaign spent. It cannot tell you what the campaign is for, who it was aimed at, or why it exists. That context is maintained by hand in campaigns-shared.ts and joined to the live numbers here. Anything found in the data but missing from the catalog is flagged rather than hidden.",
  sources: ["src/lib/ceo/campaigns-shared.ts · CAMPAIGN_CATALOG"],
  logic:
    "Status is maintained by hand. A campaign paused in the Google Ads UI will not change status here until the catalog is updated.",
};

const USERS_INFO: SourceInfo = {
  title: "Users per campaign",
  body:
    "Users whose GA4 first touch was this campaign, joined per user through crm_user_id. This is a lifetime figure: first touch is a property of the person, not of a reporting window, which is why it is only shown against all-time spend and never against the 30 or 90 day columns.",
  sources: ["dashboard_user_attribution · google_ads_campaign"],
  logic:
    "Attribution is only reliable from late May 2026 onward, when the GA4 user-ID wiring went live. Earlier signups are attributed at their first identified session, which can postdate the actual signup.",
};

const STATUS_ORDER: CampaignStatus[] = ["live", "paused", "planned", "retired"];

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

function CampaignCard({
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
        <div className="definition-item">
          <dt>Bidding</dt>
          <dd>
            {campaign.bidding}
            {campaign.dailyBudgetSek
              ? ` · ${sek(campaign.dailyBudgetSek)}/day`
              : ""}
          </dd>
        </div>
        <div className="definition-item">
          <dt>Where</dt>
          <dd>{campaign.geo}</dd>
        </div>
        <div className="definition-item">
          <dt>Why it exists</dt>
          <dd>{campaign.rationale}</dd>
        </div>
        {campaign.caveat ? (
          <div className="definition-item">
            <dt>Watch out</dt>
            <dd>{campaign.caveat}</dd>
          </div>
        ) : null}
      </dl>

      {perf ? (
        <div className="summary-grid columns-4">
          <SummaryCard value={sek(perf.spendSek)} label="Spend, all time" />
          <SummaryCard value={formatNumber(perf.clicks)} label="Clicks" />
          <SummaryCard
            value={perf.cpcSek === null ? "—" : sek(perf.cpcSek)}
            label="Cost per click"
          />
          <SummaryCard
            value={
              perf.attributedUsers === null
                ? "—"
                : formatNumber(perf.attributedUsers)
            }
            label="Users acquired"
            hint={
              perf.costPerUserSek === null
                ? undefined
                : `${sek(perf.costPerUserSek)} each`
            }
            info={USERS_INFO}
          />
        </div>
      ) : (
        <p className="panel-description">
          No performance data. GA4 only reports campaigns that have served an
          impression, so this is expected for anything paused or not yet built.
        </p>
      )}
    </article>
  );
}

export function CampaignsContent({ data }: CampaignsContentProps) {
  const { kpis, allTime, windows, trend, noDataCampaigns, attribution } = data;
  const [windowIndex, setWindowIndex] = useState(
    Math.max(windows.length - 1, 0),
  );
  const activeWindow = windows[windowIndex];

  const perfByName = new Map<string, CampaignPerformance>();
  for (const row of allTime) {
    perfByName.set(row.name.toLowerCase(), row);
    const entry = row.catalog;
    if (entry) perfByName.set(entry.name.toLowerCase(), row);
  }

  const uncatalogued = allTime.filter((row) => !row.catalog);
  const trendMax = Math.max(...trend.map((t) => t.totalSek), 1);

  return (
    <div className="section-stack">
      {/* ---- What this page is ------------------------------------------- */}
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
          set of plan-targeted Search campaigns, built so that each plan&apos;s
          audience lands on the page written for that plan rather than a generic
          one. This page holds both halves: what each campaign is designed to
          do, and what it actually did.
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
            Google Ads. The per-user product behaviour and payback for that
            cohort lives on the Google Ads Users page.
          </p>
        ) : null}
      </article>

      {/* ---- How the types differ ---------------------------------------- */}
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

      {/* ---- Performance table ------------------------------------------- */}
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
                          <span className="badge badge-warning">
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
            catalog: {uncatalogued.map((r) => r.name).join(", ")}. Add them to
            CAMPAIGN_CATALOG so this page can explain them.
          </p>
        ) : null}
      </article>

      {/* ---- Monthly trend ------------------------------------------------ */}
      {trend.length > 0 ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Over time</p>
              <h2>Monthly spend</h2>
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

      {/* ---- The catalog, grouped by status -------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">The portfolio</p>
            <h2 className="heading-with-info">
              <span>Every campaign in detail</span>
              <InfoHint info={CATALOG_INFO} />
            </h2>
          </div>
        </div>
      </article>

      {STATUS_ORDER.map((status) => {
        const group = CAMPAIGN_CATALOG.filter((c) => c.status === status);
        if (group.length === 0) return null;
        return (
          <section className="content-grid" key={status}>
            {group.map((campaign) => (
              <CampaignCard
                key={campaign.name}
                campaign={campaign}
                perf={perfByName.get(campaign.name.toLowerCase())}
              />
            ))}
          </section>
        );
      })}

      {/* ---- Caveats ------------------------------------------------------- */}
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
                    noDataCampaigns.length === 1 ? "campaign has" : "campaigns have"
                  } no data: ${noDataCampaigns.map((c) => c.name).join(", ")}.`
                : "Every catalogued campaign has data."}
            </dd>
          </div>
          <div className="definition-item">
            <dt>No conversions per campaign</dt>
            <dd>
              Spend, clicks and impressions come from GA4. Conversions and
              revenue per campaign would need the Google Ads API, which requires
              a developer token this account does not have. Until then, the
              closest available answer is the users-acquired column, which is
              first-touch attribution rather than a conversion count.
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
            <dt>Status is maintained by hand</dt>
            <dd>
              Pausing or enabling a campaign in the Google Ads UI does not
              change what this page says. The catalog has to be edited.
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
