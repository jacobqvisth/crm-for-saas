import type {
  AcquisitionCampaign,
  AcquisitionTrendPoint,
  DashboardData,
  KpiCard,
  LifecycleCampaign,
  OrganicTrendPoint,
  OperationsTrendPoint,
  PerformancePoint,
  ProductTrendPoint,
  RecentSyncRun,
  RevenueTrendPoint,
} from "@/lib/ceo/metrics/types";
import {
  compactNumber,
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/ceo/format";
import {
  InfoHint,
  type SourceInfo,
} from "./source-info";
import { SOURCE_INFO, sourceInfoFromLabel } from "./source-info-data";

export type DashboardSectionKey =
  | "usage"
  | "active-users"
  | "cta-clicks"
  | "conversions"
  | "dashboard"
  | "pilot-stats"
  | "new-users"
  | "acquisition"
  | "organic-search"
  | "product"
  | "workshops"
  | "diagnostics"
  | "operations"
  | "lifecycle"
  | "revenue"
  | "data-health"
  | "domain-health"
  | "reviews"
  | "settings";

type DashboardSectionConfig = {
  key: DashboardSectionKey;
  label: string;
  glyph: string;
  href: string;
  title: string;
  description: string;
};

export const DASHBOARD_SECTIONS: DashboardSectionConfig[] = [
  {
    key: "usage",
    label: "Usage",
    glyph: "US",
    href: "/ceo/app-usage",
    title: "Usage",
    description:
      "GA4 unique users, sessions, page views, and event volume — bucketed to match the selected range. Filter by platform: web, iOS, Android, or all.",
  },
  {
    key: "active-users",
    label: "Active Users",
    glyph: "AU",
    href: "/ceo/active-users",
    title: "Active Users",
    description:
      "Logged-in users on app.wrenchlane.com and what they did in the selected range (default: yesterday). Joins GA4 engagement (sessions, page views, events) with first-party diagnostics, keyed on crm_user_id = contacts.wl_user_id. Internal-test accounts excluded.",
  },
  {
    key: "new-users",
    label: "New Users",
    glyph: "NU",
    href: "/ceo/new-users",
    title: "New Users",
    description:
      "Top of the funnel. iOS / Android downloads, sign-ups, first diagnoses, and average days from sign-up to first diagnosis.",
  },
  {
    key: "cta-clicks",
    label: "CTA Clicks",
    glyph: "CT",
    href: "/ceo/cta-clicks",
    title: "CTA Clicks",
    description:
      "Live GA4 view of cta_click events. Filter by host (app / marketing / all), break down by section and button label.",
  },
  {
    key: "conversions",
    label: "Conversions",
    glyph: "CV",
    href: "/ceo/conversions",
    title: "Conversions",
    description:
      "Outreach → signup attribution. Per-sequence: sends, unique recipients, attributed signups, conversion rate, and median lag from send to signup. Driven by contacts.attributed_to_sequence_id, populated by the hourly discover-new cron.",
  },
  {
    key: "dashboard",
    label: "Overview - test",
    glyph: "OV",
    href: "/ceo/overview",
    title: "Command Center",
    description:
      "One place to read the company: growth, activation, revenue, operations, and trust in the numbers.",
  },
  {
    key: "pilot-stats",
    label: "Pilot Stats - test",
    glyph: "PS",
    href: "/ceo/pilot-stats",
    title: "Pilot Stats",
    description:
      "Mirror of the legacy Streamlit overview. Total users, workshops, diagnostics, AI cost, activity, and per-workshop volume.",
  },
  {
    key: "acquisition",
    label: "Acquisition - test",
    glyph: "AQ",
    href: "/ceo/acquisition",
    title: "Acquisition",
    description:
      "Paid demand, campaign efficiency, funnel handoff, and where traffic is producing real activation.",
  },
  {
    key: "organic-search",
    label: "Organic Search - test",
    glyph: "OS",
    href: "/ceo/organic-search",
    title: "Organic Search",
    description:
      "Search Console clicks, impressions, top queries, top pages, and how organic discovery is trending.",
  },
  {
    key: "product",
    label: "Product - test",
    glyph: "PD",
    href: "/ceo/product",
    title: "Product",
    description:
      "Usage, diagnostics throughput, platform mix, and workshop movement from signup into value.",
  },
  {
    key: "workshops",
    label: "Workshops - test",
    glyph: "WS",
    href: "/ceo/workshops",
    title: "Workshop Drilldown",
    description:
      "A deeper account-level view of workshops, members, billing state, activity, and diagnostics usage.",
  },
  {
    key: "diagnostics",
    label: "Diagnostics",
    glyph: "DG",
    href: "/ceo/diagnostics",
    title: "Diagnostics",
    description:
      "Per-diagnostic drilldown. Username, workshop, car, DTCs, symptoms, description, and the full ranked list of AI causes for every session in the selected window.",
  },
  {
    key: "operations",
    label: "Operations - test",
    glyph: "OP",
    href: "/ceo/operations",
    title: "Operations",
    description:
      "Diagnostics engine throughput, AI cost, Motor database usage, and efficiency of the product machinery.",
  },
  {
    key: "lifecycle",
    label: "Lifecycle - test",
    glyph: "LC",
    href: "/ceo/lifecycle",
    title: "Lifecycle",
    description:
      "Customer.io campaign performance, messaging quality, and retention-touch effectiveness.",
  },
  {
    key: "revenue",
    label: "Revenue - test",
    glyph: "RV",
    href: "/ceo/revenue",
    title: "Revenue",
    description:
      "Stripe-backed subscription health, plan mix, paid growth, and workshop billing posture.",
  },
  {
    key: "data-health",
    label: "Data Health - test",
    glyph: "DH",
    href: "/ceo/data-health",
    title: "Data Health",
    description:
      "Freshness, recent sync runs, canonical coverage, and how much confidence to place in every view.",
  },
  {
    key: "domain-health",
    label: "Domain Health",
    glyph: "DM",
    href: "/ceo/domain-health",
    title: "Domain Health",
    description:
      "Daily DNS auth, blocklist, and send-rate snapshot for wrenchlane.com. Alerts when bounce rate, unsubscribe rate, or send volume signals deliverability risk.",
  },
  {
    key: "reviews",
    label: "Reviews",
    glyph: "RV",
    href: "/ceo/reviews",
    title: "Reviews",
    description:
      "Wrenchlane's rating and review count across every SaaS review platform (Capterra, G2, Trustpilot, Google, and more), with a feed of individual reviews where a platform exposes them. Manual entry today; Google + Trustpilot API sync to follow.",
  },
  {
    key: "settings",
    label: "Playbook - test",
    glyph: "PB",
    href: "/ceo/settings",
    title: "Playbook",
    description:
      "Source priorities, dashboard operating rules, and how the CEO should read this system.",
  },
];

export function getDashboardSectionConfig(section: DashboardSectionKey) {
  return (
    DASHBOARD_SECTIONS.find((item) => item.key === section) ??
    DASHBOARD_SECTIONS[0]
  );
}

function safeRate(numerator: number, denominator: number) {
  if (!denominator || !Number.isFinite(denominator)) {
    return 0;
  }

  return (numerator / denominator) * 100;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Pending";
  }

  return new Date(value).toLocaleString();
}

function sumRows(rows: number[]) {
  return rows.reduce((sum, row) => sum + row, 0);
}

function valueFromPoint<
  TPoint extends { date: string },
  TKey extends keyof Omit<TPoint, "date"> & string,
>(point: TPoint, key: TKey) {
  return Number(point[key] ?? 0);
}

type TrendSeries<
  TPoint extends { date: string },
  TKey extends keyof Omit<TPoint, "date"> & string,
> = {
  key: TKey;
  label: string;
  color: string;
  fill?: string;
  dashed?: boolean;
};

function linePath<
  TPoint extends { date: string },
  TKey extends keyof Omit<TPoint, "date"> & string,
>(points: TPoint[], key: TKey, maxValue: number) {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
      const y = 100 - (valueFromPoint(point, key) / maxValue) * 78 - 8;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function chartLabels<TPoint extends { date: string }>(points: TPoint[]) {
  const step = Math.max(1, Math.ceil(points.length / 4));

  return new Set(
    points
      .map((_, index) => index)
      .filter(
        (index) =>
          index === 0 || index === points.length - 1 || index % step === 0,
      ),
  );
}

function KpiTile({
  card,
  index,
}: {
  card: KpiCard;
  index: number;
}) {
  const marks = ["MR", "WS", "AU", "DX", "CV", "CA", "OP", "LC"];

  return (
    <article className={`kpi-card tone-${card.tone}`}>
      <div className="kpi-card-main">
        <p className="label-with-info">
          <span>{card.label}</span>
          <InfoHint info={sourceInfoFromLabel(card.label)} />
        </p>
        <strong>{card.value}</strong>
      </div>
      <span className="metric-icon">{marks[index] ?? "WL"}</span>
      <span className="kpi-card-hint">{card.hint}</span>
    </article>
  );
}

function SectionKpiGrid({ cards }: { cards: KpiCard[] }) {
  return (
    <section className="kpi-grid">
      {cards.map((card, index) => (
        <KpiTile key={card.label} card={card} index={index} />
      ))}
    </section>
  );
}

function PanelHeader({
  eyebrow,
  title,
  badge,
  description,
  info,
}: {
  eyebrow: string;
  title: string;
  badge?: string;
  description?: string;
  info?: SourceInfo | string;
}) {
  return (
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="heading-with-info">
          <span>{title}</span>
          <InfoHint info={info ?? sourceInfoFromLabel(`${eyebrow} ${title}`)} />
        </h2>
        {description ? <p className="panel-description">{description}</p> : null}
      </div>
      {badge ? <span className="badge">{badge}</span> : null}
    </div>
  );
}

function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function TableHeading({ label, info }: { label: string; info?: SourceInfo | string }) {
  return (
    <span className="table-heading-info">
      <span>{label}</span>
      <InfoHint info={info ?? sourceInfoFromLabel(label)} />
    </span>
  );
}

function SummaryGrid({
  items,
  columns = 4,
}: {
  items: Array<{ label: string; value: string; hint?: string; info?: SourceInfo | string }>;
  columns?: 2 | 3 | 4 | 6;
}) {
  return (
    <div className={`summary-grid columns-${columns}`}>
      {items.map((item) => (
        <div className="summary-card" key={item.label}>
          <strong>{item.value}</strong>
          <span className="label-with-info">
            <span>{item.label}</span>
            <InfoHint info={item.info ?? sourceInfoFromLabel(item.label)} />
          </span>
          {item.hint ? <small>{item.hint}</small> : null}
        </div>
      ))}
    </div>
  );
}

function SourceDot({ status }: { status: string }) {
  return <span className={`source-dot source-${status}`} aria-hidden />;
}

function SourceHealthList({
  sources,
  compact = false,
}: {
  sources: DashboardData["sources"];
  compact?: boolean;
}) {
  return (
    <div className={`source-health-list${compact ? " compact" : ""}`}>
      {sources.map((source) => (
        <div className="source-health-row" key={source.sourceKey}>
          <div className="source-health-main">
            <SourceDot status={source.status} />
            <div>
              <strong>{source.label}</strong>
              <span className="source-health-copy">
                {source.lastSuccessAt
                  ? `${source.hoursSinceSuccess.toFixed(1)}h since last success`
                  : source.lastError ?? "Waiting for first successful sync"}
                <InfoHint
                  info={{
                    title: `${source.label} freshness`,
                    body: SOURCE_INFO.sync,
                    sources: [source.label, "dashboard_sync_runs"],
                    logic:
                      "Healthy means the source has a recent successful sync. Stale, failing, and pending lower confidence in metrics that depend on that source.",
                  }}
                />
              </span>
            </div>
          </div>
          <small>{source.status}</small>
        </div>
      ))}
    </div>
  );
}

function FunnelBars({ funnel }: { funnel: DashboardData["funnel"] }) {
  const maxValue = Math.max(...funnel.map((step) => step.value), 1);

  return (
    <div className="funnel-list">
      {funnel.map((step) => (
        <div className="funnel-row" key={step.key}>
          <div className="funnel-label">
            <strong>{step.label}</strong>
            <span className="label-with-info">
              <span>{formatNumber(step.value)}</span>
              <InfoHint
                info={{
                  title: `${step.label} funnel step`,
                  body: SOURCE_INFO.calculated,
                  sources: ["dashboard_funnel_snapshots", "GA4 / Firebase", "core app warehouse", "Stripe"],
                  logic:
                    "The bar value is the synced count for this funnel stage. The right-side percentage is conversion from the previous stage.",
                }}
              />
            </span>
          </div>
          <div className="funnel-track">
            <div
              className="funnel-bar"
              style={{
                width: `${Math.max(4, (step.value / maxValue) * 100)}%`,
              }}
            />
          </div>
          <span className="funnel-rate">
            {formatPercent(step.conversionFromPrevious)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TrendChart<
  TPoint extends { date: string },
  TKey extends keyof Omit<TPoint, "date"> & string,
>({
  points,
  series,
  title,
  subtitle,
  info,
}: {
  points: TPoint[];
  series: Array<TrendSeries<TPoint, TKey>>;
  title: string;
  subtitle?: string;
  info?: SourceInfo | string;
}) {
  const fallback =
    points.length > 0
      ? points
      : [Object.assign({ date: "No data" }, ...series.map((item) => ({ [item.key]: 0 })))] as TPoint[];
  const maxValue = Math.max(
    1,
    ...fallback.flatMap((point) =>
      series.map((item) => valueFromPoint(point, item.key)),
    ),
  );
  const labels = chartLabels(fallback);

  return (
    <div className="trend-chart-wrap">
      <div className="trend-chart-head">
        <div>
          <strong className="heading-with-info compact">
            <span>{title}</span>
            <InfoHint
              info={
                info ?? {
                  title: `${title} trend`,
                  body: SOURCE_INFO.normalized,
                  sources: series.map((item) => item.label),
                }
              }
            />
          </strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        <div className="chart-legend">
          {series.map((item) => (
            <span key={item.label}>
              <i style={{ background: item.color }} />
              {item.label}
              <InfoHint info={sourceInfoFromLabel(item.label)} />
            </span>
          ))}
        </div>
      </div>

      <div className="chart-wrap">
        <svg
          aria-label={title}
          className="line-chart"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <defs>
            {series
              .filter((item) => item.fill)
              .map((item) => (
                <linearGradient
                  id={`gradient-${title}-${item.key}`.replace(/[^a-zA-Z0-9-_]/g, "")}
                  key={item.key}
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={item.fill} stopOpacity="0.26" />
                  <stop offset="100%" stopColor={item.fill} stopOpacity="0" />
                </linearGradient>
              ))}
          </defs>
          {[18, 36, 54, 72, 90].map((line) => (
            <line
              className="chart-grid"
              key={line}
              x1="0"
              x2="100"
              y1={line}
              y2={line}
            />
          ))}
          {series.map((item) => {
            const path = linePath(fallback, item.key, maxValue);
            const gradientId = `gradient-${title}-${item.key}`.replace(
              /[^a-zA-Z0-9-_]/g,
              "",
            );

            return (
              <g key={item.key}>
                {item.fill ? (
                  <path
                    className="chart-area generic"
                    d={`${path} L 100 100 L 0 100 Z`}
                    fill={`url(#${gradientId})`}
                  />
                ) : null}
                <path
                  className={`chart-line generic${item.dashed ? " dashed" : ""}`}
                  d={path}
                  stroke={item.color}
                />
              </g>
            );
          })}
        </svg>
        <div className="chart-axis">
          {fallback.map((point, index) =>
            labels.has(index) ? (
              <span key={`${point.date}-${index}`}>{point.date}</span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

function BarList({
  items,
  emptyTitle = "No data yet",
  emptyBody = "This view will populate as more synced data lands in the warehouse.",
}: {
  items: Array<{
    label: string;
    value: number;
    valueLabel?: string;
    hint?: string;
  }>;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  return (
    <div className="bar-list">
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <div className="bar-row-copy">
            <strong className="label-with-info">
              <span>{item.label}</span>
              <InfoHint info={sourceInfoFromLabel(item.label)} />
            </strong>
            {item.hint ? <span>{item.hint}</span> : null}
          </div>
          <div className="bar-row-main">
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${Math.max(4, (item.value / maxValue) * 100)}%` }}
              />
            </div>
            <strong>{item.valueLabel ?? formatNumber(item.value)}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function SegmentBar({
  segments,
}: {
  segments: Array<{
    label: string;
    value: number;
    colorClass: string;
  }>;
}) {
  const total = sumRows(segments.map((segment) => segment.value));

  return (
    <div className="segment-meter">
      <div className="segment-track">
        {segments.map((segment) => (
          <span
            className={`segment-pill ${segment.colorClass}`}
            key={segment.label}
            style={{
              width: `${total ? Math.max(4, (segment.value / total) * 100) : 0}%`,
            }}
            title={`${segment.label}: ${formatNumber(segment.value)}`}
          />
        ))}
      </div>
      <div className="segment-caption">
        {segments.map((segment) => (
          <span key={segment.label}>
            <i className={segment.colorClass} />
            {segment.label}: <strong>{formatNumber(segment.value)}</strong>
            <InfoHint info={sourceInfoFromLabel(segment.label)} />
          </span>
        ))}
      </div>
    </div>
  );
}

function AcquisitionCampaignTable({
  campaigns,
}: {
  campaigns: AcquisitionCampaign[];
}) {
  if (campaigns.length === 0) {
    return (
      <EmptyState
        title="No campaign rows yet"
        body="As linked Google Ads campaign data lands in GA4, this table will show spend, clicks, conversions, and efficiency by campaign."
      />
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th><TableHeading label="Campaign" /></th>
            <th><TableHeading label="Spend" /></th>
            <th><TableHeading label="Clicks" /></th>
            <th><TableHeading label="Signups" info="Ad-attributed signups (GA4 sign_up event in sessions from this campaign) for the selected window." /></th>
            <th><TableHeading label="CTR" info="Click-through rate: ad clicks divided by ad impressions." /></th>
            <th><TableHeading label="CPC" info="Cost per click: ad spend divided by ad clicks." /></th>
            <th><TableHeading label="Signup rate" info="Signups divided by ad clicks." /></th>
          </tr>
        </thead>
        <tbody>
          {campaigns.slice(0, 8).map((campaign) => (
            <tr key={`${campaign.campaignId ?? campaign.campaign}-${campaign.reportingSource ?? "none"}`}>
              <td>
                <div className="table-primary">
                  <strong>{campaign.campaign}</strong>
                  <span>{campaign.reportingSource ?? "linked ads"}</span>
                </div>
              </td>
              <td>{formatCurrency(campaign.spend)}</td>
              <td>{formatNumber(campaign.clicks)}</td>
              <td>{formatNumber(campaign.conversions)}</td>
              <td>{formatPercent(campaign.ctr)}</td>
              <td>{campaign.cpc ? formatCurrency(campaign.cpc) : "Pending"}</td>
              <td>{formatPercent(campaign.conversionRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LifecycleCampaignTable({
  campaigns,
}: {
  campaigns: LifecycleCampaign[];
}) {
  if (campaigns.length === 0) {
    return (
      <EmptyState
        title="No active lifecycle campaigns in range"
        body="This table fills from Customer.io campaign metrics. It stays strict about messaging data being separate from product identity."
      />
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th><TableHeading label="Campaign" info={SOURCE_INFO.customerIo} /></th>
            <th><TableHeading label="Sent" /></th>
            <th><TableHeading label="Open" /></th>
            <th><TableHeading label="Click" /></th>
            <th><TableHeading label="Conv." info="Customer.io-attributed campaign conversions in the selected window." /></th>
            <th><TableHeading label="Bounce" /></th>
            <th><TableHeading label="Unsub." /></th>
          </tr>
        </thead>
        <tbody>
          {campaigns.slice(0, 8).map((campaign) => (
            <tr key={`${campaign.campaignId ?? campaign.campaign}-${campaign.campaignState ?? "unknown"}`}>
              <td>
                <div className="table-primary">
                  <strong>{campaign.campaign}</strong>
                  <span>
                    {(campaign.campaignState ?? "unknown").replace(/_/g, " ")}
                    {" · "}
                    {(campaign.campaignType ?? "unknown").replace(/_/g, " ")}
                  </span>
                </div>
              </td>
              <td>{formatNumber(campaign.sent)}</td>
              <td>{formatPercent(campaign.openRate)}</td>
              <td>{formatPercent(campaign.clickRate)}</td>
              <td>{formatPercent(campaign.conversionRate)}</td>
              <td>{formatPercent(campaign.bounceRate)}</td>
              <td>{formatPercent(campaign.unsubscribeRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentSyncRunsTable({
  runs,
}: {
  runs: RecentSyncRun[];
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th><TableHeading label="Source" info={SOURCE_INFO.sync} /></th>
            <th><TableHeading label="Status" info="Latest sync status for this source: success, failed, running, or skipped." /></th>
            <th><TableHeading label="Started" info="Timestamp when the sync run started." /></th>
            <th><TableHeading label="Rows" info="Rows read from the source and rows written into the dashboard warehouse." /></th>
            <th><TableHeading label="Notes" info="Sync error details when present, otherwise the run is considered healthy." /></th>
          </tr>
        </thead>
        <tbody>
          {runs.slice(0, 10).map((run) => (
            <tr key={`${run.sourceKey}-${run.startedAt}`}>
              <td>{run.label}</td>
              <td>
                <span className={`status-pill ${run.status}`}>{run.status}</span>
              </td>
              <td>{formatDateTime(run.startedAt)}</td>
              <td>
                {formatNumber(run.rowsRead)} / {formatNumber(run.rowsWritten)}
              </td>
              <td>{run.errorMessage ?? "Healthy"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverviewHero({ data }: { data: DashboardData }) {
  const healthySources = data.sources.filter(
    (source) => source.status === "healthy",
  ).length;
  const topCampaign = data.acquisitionCampaigns[0];
  const topLifecycle = data.lifecycleCampaigns[0];
  const aiCostInWindow =
    data.operations.diagnosticCost + data.operations.chatCost;

  return (
    <section className="panel hero-panel">
      <div className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">CEO Readout</p>
          <h2>Everything important, without leaving the dashboard.</h2>
          <p className="hero-text">
            This view blends canonical product data from AWS, billing truth from
            Stripe, acquisition from GA4-linked Google Ads, and messaging
            performance from Customer.io.
          </p>
          <div className="hero-pill-list">
            <span className="hero-pill">
              {formatCurrency(data.revenue.mrr)} MRR run rate
            </span>
            <span className="hero-pill">
              {formatNumber(data.workshopSnapshot.live)} live workshops
            </span>
            <span className="hero-pill">
              {healthySources}/{data.sources.length} sources healthy
            </span>
            <span className="hero-pill">
              {formatCurrency(aiCostInWindow)} AI cost in window
            </span>
          </div>
        </div>

        <div className="hero-notes">
          <strong>What stands out now</strong>
          <div className="insight-list compact">
            {data.insights.slice(0, 3).map((insight) => (
              <p key={insight}>{insight}</p>
            ))}
          </div>
        </div>
      </div>

      <div className="summary-grid columns-4">
        <div className="summary-card spotlight">
          <strong>{topCampaign ? topCampaign.campaign : "No paid campaign yet"}</strong>
          <span className="label-with-info">
            <span>Top paid campaign</span>
            <InfoHint info={sourceInfoFromLabel("Top paid campaign")} />
          </span>
          <small>
            {topCampaign
              ? `${formatCurrency(topCampaign.spend)} spend · ${formatNumber(topCampaign.conversions)} conversions`
              : "Waiting for campaign-level spend rows"}
          </small>
        </div>
        <div className="summary-card spotlight">
          <strong>
            {topLifecycle ? topLifecycle.campaign : "No lifecycle campaign yet"}
          </strong>
          <span className="label-with-info">
            <span>Top lifecycle campaign</span>
            <InfoHint info={sourceInfoFromLabel("Top lifecycle campaign")} />
          </span>
          <small>
            {topLifecycle
              ? `${formatPercent(topLifecycle.openRate)} open · ${formatPercent(topLifecycle.clickRate)} click`
              : "Waiting for active messaging volume"}
          </small>
        </div>
        <div className="summary-card spotlight">
          <strong>{formatPercent(data.product.activationRate)}</strong>
          <span className="label-with-info">
            <span>Activation rate</span>
            <InfoHint
              info={{
                title: "Activation logic",
                body: SOURCE_INFO.calculated,
                sources: ["core app warehouse", "dashboard_funnel_snapshots"],
                logic:
                  "Activation compares users or workshops that reached first value against signups in the selected window.",
              }}
            />
          </span>
          <small>
            {formatNumber(data.product.diagnosticsCompleted)} diagnostics completed
          </small>
        </div>
        <div className="summary-card spotlight">
          <strong>{formatCurrency(data.revenue.arr)}</strong>
          <span className="label-with-info">
            <span>ARR run rate</span>
            <InfoHint info={sourceInfoFromLabel("ARR run rate")} />
          </span>
          <small>
            {formatNumber(data.revenue.activeSubscriptions)} active subscriptions
          </small>
        </div>
      </div>
    </section>
  );
}

function OverviewSection({ data }: { data: DashboardData }) {
  const deliveryRate = safeRate(data.lifecycle.delivered, data.lifecycle.sent);
  const openRate = safeRate(data.lifecycle.humanOpened, data.lifecycle.delivered);

  return (
    <div className="section-stack">
      <OverviewHero data={data} />
      <SectionKpiGrid cards={data.executive} />

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Growth Engine"
            title="How attention turns into paid workshops"
            badge={`${formatPercent(data.funnel.at(-1)?.conversionFromPrevious ?? 0)} final step`}
            description="This is the handoff from acquisition to onboarding to paid. It is the single best place to see where growth is leaking."
          />
          <FunnelBars funnel={data.funnel} />
        </article>

        <article className="panel">
          <PanelHeader
            eyebrow="Data Pulse"
            title="Can we trust the numbers?"
            badge={`${data.sources.filter((source) => source.status === "healthy").length}/${data.sources.length} healthy`}
          />
          <SourceHealthList sources={data.sources} compact />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Momentum"
            title="Product and revenue trend"
            badge="Normalized daily shape"
            description="Different units share one chart here so the CEO can spot direction changes quickly."
          />
          <TrendChart<ProductTrendPoint, "activeUsers" | "diagnosticsStarted" | "diagnosticsCompleted">
            points={data.productTrend}
            series={[
              {
                key: "activeUsers",
                label: "Active users",
                color: "#465fff",
                fill: "#465fff",
              },
              {
                key: "diagnosticsStarted",
                label: "Diagnostics started",
                color: "#f79009",
                fill: "#f79009",
              },
              {
                key: "diagnosticsCompleted",
                label: "Diagnostics completed",
                color: "#12b76a",
              },
            ]}
            title="Usage and diagnostics"
            subtitle="Normalized to compare direction, not absolute unit size."
          />
        </article>

        <article className="panel">
          <PanelHeader
            eyebrow="Message Quality"
            title="Lifecycle reach"
            badge={`${formatPercent(openRate)} open rate`}
          />
          <SummaryGrid
            columns={2}
            items={[
              {
                label: "Sent",
                value: formatNumber(data.lifecycle.sent),
                hint: "Customer.io sends",
              },
              {
                label: "Delivered",
                value: formatPercent(deliveryRate),
                hint: "Delivery rate",
              },
              {
                label: "Opened",
                value: formatNumber(data.lifecycle.humanOpened),
                hint: "Human opens",
              },
              {
                label: "Converted",
                value: formatNumber(data.lifecycle.converted),
                hint: "Messaging-attributed conversions",
              },
            ]}
          />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Workshop Health"
            title="Current state of tracked workshops"
            badge={`${formatNumber(data.workshopSnapshot.live)} live`}
            description="Stripe is canonical for billing status. Unknown status means the workshop still needs stronger billing linkage."
          />
          <SegmentBar
            segments={[
              {
                label: "Active",
                value: data.workshopSnapshot.active,
                colorClass: "segment-active",
              },
              {
                label: "Trialing",
                value: data.workshopSnapshot.trialing,
                colorClass: "segment-trialing",
              },
              {
                label: "Paused",
                value: data.workshopSnapshot.paused,
                colorClass: "segment-paused",
              },
              {
                label: "At risk",
                value: data.workshopSnapshot.atRisk,
                colorClass: "segment-risk",
              },
              {
                label: "Inactive",
                value: data.workshopSnapshot.inactive,
                colorClass: "segment-inactive",
              },
              {
                label: "Unknown",
                value: data.workshopSnapshot.unknown,
                colorClass: "segment-unknown",
              },
            ]}
          />
          <SummaryGrid
            columns={4}
            items={[
              {
                label: "Tracked workshops",
                value: formatNumber(data.workshopSnapshot.total),
              },
              {
                label: "Stripe-linked",
                value: formatNumber(data.workshopSnapshot.stripeLinked),
              },
              {
                label: "Canonical countries",
                value: formatNumber(data.workshopSnapshot.withCountry),
              },
              {
                label: "Top plan rows",
                value: formatNumber(data.revenue.planMix.length),
              },
            ]}
          />
        </article>

        <article className="panel">
          <PanelHeader
            eyebrow="Footprint"
            title="Where workshops are based"
            badge={`${formatNumber(data.workshopSnapshot.topCountries.length)} markets`}
          />
          <BarList
            items={data.workshopSnapshot.topCountries.map((country) => ({
              label: country.country,
              value: country.workshops,
            }))}
            emptyTitle="No canonical country data yet"
            emptyBody="As canonical workshop country coverage improves, the geographic footprint will appear here."
          />
        </article>
      </section>
    </div>
  );
}

function AcquisitionSection({ data }: { data: DashboardData }) {
  const clickThroughRate = safeRate(
    data.marketing.clicks,
    data.marketing.impressions,
  );
  const conversionRate = safeRate(
    data.marketing.conversions,
    data.marketing.clicks,
  );
  const costPerConversion = data.marketing.conversions
    ? data.marketing.spend / data.marketing.conversions
    : 0;
  const cards: KpiCard[] = [
    {
      label: "Tracked spend",
      value: formatCurrency(data.marketing.spend),
      rawValue: data.marketing.spend,
      hint: "GA4-linked Ads spend in range",
      tone: "growth",
    },
    {
      label: "Ad clicks",
      value: compactNumber(data.marketing.clicks),
      rawValue: data.marketing.clicks,
      hint: `${formatPercent(clickThroughRate)} CTR`,
      tone: "growth",
    },
    {
      label: "Conversions",
      value: formatNumber(data.marketing.conversions),
      rawValue: data.marketing.conversions,
      hint: `${formatPercent(conversionRate)} click-to-signup`,
      tone: "growth",
    },
    {
      label: "CPC",
      value: formatCurrency(data.marketing.cpc),
      rawValue: data.marketing.cpc,
      hint: "Cost per ad click",
      tone: "neutral",
    },
    {
      label: "CAC",
      value: data.marketing.cac ? formatCurrency(data.marketing.cac) : "Pending",
      rawValue: data.marketing.cac,
      hint: "Spend divided by new paid workshops",
      tone: data.marketing.cac ? "neutral" : "warning",
    },
    {
      label: "Cost / signup",
      value: costPerConversion ? formatCurrency(costPerConversion) : "Pending",
      rawValue: costPerConversion,
      hint: "Spend divided by ad-attributed signups",
      tone: costPerConversion ? "neutral" : "warning",
    },
  ];

  return (
    <div className="section-stack">
      <SectionKpiGrid cards={cards} />

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Trend"
            title="Paid demand trend"
            badge="Normalized daily shape"
            description="Spend, clicks, and conversions are normalized together to reveal directional change across the selected window."
          />
          <TrendChart<AcquisitionTrendPoint, "spend" | "clicks" | "conversions">
            points={data.acquisitionTrend}
            series={[
              {
                key: "spend",
                label: "Spend",
                color: "#f79009",
                fill: "#f79009",
              },
              {
                key: "clicks",
                label: "Clicks",
                color: "#465fff",
              },
              {
                key: "conversions",
                label: "Conversions",
                color: "#12b76a",
                fill: "#12b76a",
              },
            ]}
            title="Paid acquisition trend"
            subtitle="Use the KPI cards for actual unit values."
          />
        </article>

        <article className="panel">
          <PanelHeader
            eyebrow="Paid Efficiency"
            title="How spend is turning into outcomes"
            badge={`${formatPercent(clickThroughRate)} CTR`}
          />
          <SummaryGrid
            columns={2}
            items={[
              {
                label: "Impressions",
                value: compactNumber(data.marketing.impressions),
              },
              {
                label: "Ad clicks",
                value: formatNumber(data.marketing.clicks),
              },
              {
                label: "CPC",
                value: formatCurrency(data.marketing.cpc),
              },
              {
                label: "Signup rate",
                value: formatPercent(conversionRate),
              },
              {
                label: "Cost / signup",
                value: costPerConversion
                  ? formatCurrency(costPerConversion)
                  : "Pending",
              },
              {
                label: "New paid workshops",
                value: formatNumber(data.revenue.newPaidWorkshops),
              },
            ]}
          />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Campaigns"
            title="Where paid performance is concentrated"
            badge={`${formatNumber(data.acquisitionCampaigns.length)} campaigns`}
          />
          <AcquisitionCampaignTable campaigns={data.acquisitionCampaigns} />
        </article>

        <article className="panel">
          <PanelHeader
            eyebrow="Handoff"
            title="Traffic into activation"
            badge={`${formatPercent(data.product.activationRate)} activation`}
          />
          <FunnelBars funnel={data.funnel} />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <PanelHeader
            eyebrow="Platform Outcome"
            title="Where acquired usage lands"
          />
          <BarList
            items={data.product.platformSplit.map((platform) => ({
              label: platform.platform,
              value: platform.users,
            }))}
          />
        </article>

        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Operator Notes"
            title="How to read this page"
          />
          <div className="insight-list">
            <p>
              A conversion here is one ad-attributed signup — a GA4 sign_up
              event in a session whose <code>sessionGoogleAdsCampaignId</code>
              is set. CAC (spend ÷ new paid workshops) measures the same
              funnel one step deeper, so CAC ÷ Cost per signup is your
              signup-to-paid efficiency.
            </p>
            <p>
              Campaign rows come from GA4-linked Google Ads reporting and only
              include sessions tied to a Google Ads campaign. Unattributed
              signups (organic / direct) are not counted here — those land in
              the funnel signup step instead.
            </p>
            <p>
              The most useful CEO pattern is comparing this page with Product:
              if paid signups are stable but activation falls, the issue is
              likely inside onboarding or diagnostics rather than demand.
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}

function OrganicSearchSection({ data }: { data: DashboardData }) {
  const cards: KpiCard[] = [
    {
      label: "Organic clicks",
      value: compactNumber(data.organic.clicks),
      rawValue: data.organic.clicks,
      hint: `${compactNumber(data.organic.impressions)} impressions`,
      tone: "growth",
    },
    {
      label: "CTR",
      value: formatPercent(data.organic.ctr),
      rawValue: data.organic.ctr,
      hint: "Clicks divided by impressions",
      tone: "neutral",
    },
    {
      label: "Avg. position",
      value: data.organic.position ? data.organic.position.toFixed(1) : "0.0",
      rawValue: data.organic.position,
      hint: "Weighted by impressions",
      tone: "neutral",
    },
    {
      label: "Top queries",
      value: formatNumber(data.organic.topQueries.length),
      rawValue: data.organic.topQueries.length,
      hint: "Tracked query rows in range",
      tone: "growth",
    },
    {
      label: "Top pages",
      value: formatNumber(data.organic.topPages.length),
      rawValue: data.organic.topPages.length,
      hint: "Tracked landing rows in range",
      tone: "growth",
    },
    {
      label: "Countries",
      value: formatNumber(data.organic.countries.length),
      rawValue: data.organic.countries.length,
      hint: "Organic footprint",
      tone: "neutral",
    },
  ];

  return (
    <div className="section-stack">
      <SectionKpiGrid cards={cards} />

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Trend"
            title="Organic discovery trend"
            badge="Search Console"
            description="Daily clicks, impressions, CTR, and average position from Search Console. This is the organic counterpart to paid acquisition."
          />
          <TrendChart<OrganicTrendPoint, "clicks" | "impressions" | "ctr" | "position">
            points={data.organicTrend}
            series={[
              {
                key: "clicks",
                label: "Clicks",
                color: "#465fff",
                fill: "#465fff",
              },
              {
                key: "impressions",
                label: "Impressions",
                color: "#38bdf8",
                fill: "#38bdf8",
              },
              {
                key: "ctr",
                label: "CTR",
                color: "#f79009",
              },
              {
                key: "position",
                label: "Position",
                color: "#725cff",
                dashed: true,
              },
            ]}
            title="Organic search trend"
            subtitle="Normalized so the CEO can compare movement across mixed search metrics."
          />
        </article>

        <article className="panel">
          <PanelHeader
            eyebrow="Readout"
            title="What organic search is doing"
          />
          <SummaryGrid
            columns={2}
            items={[
              {
                label: "Organic clicks",
                value: formatNumber(data.organic.clicks),
              },
              {
                label: "Impressions",
                value: compactNumber(data.organic.impressions),
              },
              {
                label: "CTR",
                value: formatPercent(data.organic.ctr),
              },
              {
                label: "Avg. position",
                value: data.organic.position
                  ? data.organic.position.toFixed(1)
                  : "0.0",
              },
            ]}
          />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <PanelHeader
            eyebrow="Top Queries"
            title="What people search for"
          />
          <BarList
            items={data.organic.topQueries.map((row) => ({
              label: row.label,
              value: row.clicks,
              valueLabel: formatNumber(row.clicks),
              hint: `${compactNumber(row.impressions)} impressions · ${formatPercent(
                row.ctr,
              )} CTR · pos ${row.position.toFixed(1)}`,
            }))}
            emptyTitle="No organic queries yet"
            emptyBody="Once Search Console data lands, this becomes the CEO view of demand language and brand pull."
          />
        </article>

        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Top Pages"
            title="Which pages capture organic demand"
          />
          <BarList
            items={data.organic.topPages.map((row) => ({
              label: row.label.replace(/^https?:\/\//, ""),
              value: row.clicks,
              valueLabel: formatNumber(row.clicks),
              hint: `${compactNumber(row.impressions)} impressions · ${formatPercent(
                row.ctr,
              )} CTR · pos ${row.position.toFixed(1)}`,
            }))}
            emptyTitle="No organic pages yet"
            emptyBody="Page-level search performance will show up here once Search Console syncs are writing rows."
          />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <PanelHeader eyebrow="Devices" title="Organic usage by device" />
          <BarList
            items={data.organic.devices.map((row) => ({
              label: row.label,
              value: row.clicks,
              valueLabel: formatNumber(row.clicks),
              hint: `${formatPercent(row.ctr)} CTR · pos ${row.position.toFixed(1)}`,
            }))}
          />
        </article>

        <article className="panel panel-wide">
          <PanelHeader eyebrow="Countries" title="Where organic demand comes from" />
          <BarList
            items={data.organic.countries.map((row) => ({
              label: row.label,
              value: row.clicks,
              valueLabel: formatNumber(row.clicks),
              hint: `${compactNumber(row.impressions)} impressions · ${formatPercent(
                row.ctr,
              )} CTR`,
            }))}
          />
        </article>
      </section>
    </div>
  );
}

function ProductSection({ data }: { data: DashboardData }) {
  const completionRate = safeRate(
    data.product.diagnosticsCompleted,
    data.product.diagnosticsStarted,
  );
  const cards: KpiCard[] = [
    {
      label: "Active users",
      value: compactNumber(data.product.activeUsers),
      rawValue: data.product.activeUsers,
      hint: `${formatNumber(data.product.newUsers)} new in range`,
      tone: "product",
    },
    {
      label: "Diagnostics started",
      value: formatNumber(data.product.diagnosticsStarted),
      rawValue: data.product.diagnosticsStarted,
      hint: "Core app warehouse preferred",
      tone: "product",
    },
    {
      label: "Diagnostics completed",
      value: formatNumber(data.product.diagnosticsCompleted),
      rawValue: data.product.diagnosticsCompleted,
      hint: `${formatPercent(completionRate)} completion`,
      tone: "product",
    },
    {
      label: "Activation rate",
      value: formatPercent(data.product.activationRate),
      rawValue: data.product.activationRate,
      hint: "Signup to activated workshop",
      tone: "growth",
    },
    {
      label: "Live workshops",
      value: formatNumber(data.workshopSnapshot.live),
      rawValue: data.workshopSnapshot.live,
      hint: "Active plus trialing",
      tone: "growth",
    },
    {
      label: "At-risk workshops",
      value: formatNumber(data.workshopSnapshot.atRisk),
      rawValue: data.workshopSnapshot.atRisk,
      hint: "Retention attention needed",
      tone: data.workshopSnapshot.atRisk ? "warning" : "neutral",
    },
  ];

  return (
    <div className="section-stack">
      <SectionKpiGrid cards={cards} />

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Trend"
            title="Usage and diagnostics volume"
            badge="Normalized daily shape"
            description="This combines app usage with first-party diagnostics volume to show whether activity and value creation are moving together."
          />
          <TrendChart<ProductTrendPoint, "activeUsers" | "newUsers" | "diagnosticsStarted" | "diagnosticsCompleted">
            points={data.productTrend}
            series={[
              {
                key: "activeUsers",
                label: "Active users",
                color: "#465fff",
                fill: "#465fff",
              },
              {
                key: "newUsers",
                label: "New users",
                color: "#38bdf8",
              },
              {
                key: "diagnosticsStarted",
                label: "Diagnostics started",
                color: "#f79009",
              },
              {
                key: "diagnosticsCompleted",
                label: "Diagnostics completed",
                color: "#12b76a",
                dashed: true,
              },
            ]}
            title="Product activity"
            subtitle="Normalized so mixed units can be compared cleanly."
          />
        </article>

        <article className="panel">
          <PanelHeader
            eyebrow="Platform Mix"
            title="Where product usage happens"
          />
          <BarList
            items={data.product.platformSplit.map((platform) => ({
              label: platform.platform,
              value: platform.users,
            }))}
          />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Workshop State"
            title="How the customer base is behaving"
            badge={`${formatNumber(data.workshopSnapshot.live)} live workshops`}
          />
          <SegmentBar
            segments={[
              {
                label: "Active",
                value: data.workshopSnapshot.active,
                colorClass: "segment-active",
              },
              {
                label: "Trialing",
                value: data.workshopSnapshot.trialing,
                colorClass: "segment-trialing",
              },
              {
                label: "Paused",
                value: data.workshopSnapshot.paused,
                colorClass: "segment-paused",
              },
              {
                label: "At risk",
                value: data.workshopSnapshot.atRisk,
                colorClass: "segment-risk",
              },
              {
                label: "Inactive",
                value: data.workshopSnapshot.inactive,
                colorClass: "segment-inactive",
              },
              {
                label: "Unknown",
                value: data.workshopSnapshot.unknown,
                colorClass: "segment-unknown",
              },
            ]}
          />
          <SummaryGrid
            columns={4}
            items={[
              {
                label: "Tracked users",
                value: formatNumber(data.operations.totalUsers),
              },
              {
                label: "Tracked workshops",
                value: formatNumber(data.operations.totalWorkshops),
              },
              {
                label: "Stripe-linked workshops",
                value: formatNumber(data.workshopSnapshot.stripeLinked),
              },
              {
                label: "Canonical countries",
                value: formatNumber(data.workshopSnapshot.withCountry),
              },
            ]}
          />
        </article>

        <article className="panel">
          <PanelHeader eyebrow="Value Flow" title="Product notes" />
          <div className="insight-list">
            <p>
              Diagnostics created and completed come from the core app export
              whenever possible. That makes this the most trustworthy view of
              product throughput.
            </p>
            <p>
              Active users still come from GA4, so a gap between active users
              and diagnostics can point to exploration without core product
              value.
            </p>
            <p>
              Unknown workshop status is a data-quality issue first. If that
              number falls, the CEO should trust revenue and retention views
              more aggressively.
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}

function OperationsSection({ data }: { data: DashboardData }) {
  const windowAiCost = data.operations.diagnosticCost + data.operations.chatCost;
  const cards: KpiCard[] = [
    {
      label: "Diagnostics created",
      value: formatNumber(data.operations.diagnosticsCreated),
      rawValue: data.operations.diagnosticsCreated,
      hint: "Core app diagnostics in range",
      tone: "product",
    },
    {
      label: "Diagnostics completed",
      value: formatNumber(data.operations.diagnosticsCompleted),
      rawValue: data.operations.diagnosticsCompleted,
      hint: `${formatPercent(data.operations.completionRate)} completion`,
      tone: "product",
    },
    {
      label: "AI cost in window",
      value: formatCurrency(windowAiCost),
      rawValue: windowAiCost,
      hint: "Diagnostics plus chat cost",
      tone: "warning",
    },
    {
      label: "Cost / diagnostic",
      value: data.operations.costPerDiagnostic
        ? formatCurrency(data.operations.costPerDiagnostic)
        : "Pending",
      rawValue: data.operations.costPerDiagnostic,
      hint: "Window cost divided by diagnostics",
      tone: "neutral",
    },
    {
      label: "Chat sessions",
      value: formatNumber(data.operations.chatSessions),
      rawValue: data.operations.chatSessions,
      hint: `${formatNumber(data.operations.chatMessages)} messages`,
      tone: "product",
    },
    {
      label: "Motor accesses",
      value: formatNumber(data.operations.motorAccesses),
      rawValue: data.operations.motorAccesses,
      hint: `${formatNumber(data.operations.motorUniqueVehicles)} unique vehicles`,
      tone: "growth",
    },
  ];
  const aiSnapshotTotal = Math.max(
    1,
    data.operations.aiDiagnosticsCostSnapshot +
      data.operations.aiChatCostSnapshot,
  );

  return (
    <div className="section-stack">
      <SectionKpiGrid cards={cards} />

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Diagnostics Engine"
            title="Throughput and chat workload"
            badge="Normalized daily shape"
            description="This shows how diagnostic creation, completion, chat load, and cost move together through the selected window."
          />
          <TrendChart<OperationsTrendPoint, "diagnosticsCreated" | "diagnosticsCompleted" | "chatSessions" | "diagnosticCost">
            points={data.operationsTrend}
            series={[
              {
                key: "diagnosticsCreated",
                label: "Diagnostics created",
                color: "#f79009",
                fill: "#f79009",
              },
              {
                key: "diagnosticsCompleted",
                label: "Diagnostics completed",
                color: "#12b76a",
                fill: "#12b76a",
              },
              {
                key: "chatSessions",
                label: "Chat sessions",
                color: "#465fff",
              },
              {
                key: "diagnosticCost",
                label: "Diagnostic cost",
                color: "#725cff",
                dashed: true,
              },
            ]}
            title="Operations trend"
            subtitle="Mixed units are normalized to show movement, not precise scale."
          />
        </article>

        <article className="panel">
          <PanelHeader
            eyebrow="AI Snapshot"
            title="What the AI layer costs"
            badge={`${formatPercent(data.operations.aiChatAdoptionRate)} chat adoption`}
          />
          <SegmentBar
            segments={[
              {
                label: "Diagnostics AI",
                value: data.operations.aiDiagnosticsCostSnapshot,
                colorClass: "segment-risk",
              },
              {
                label: "Chat AI",
                value: data.operations.aiChatCostSnapshot,
                colorClass: "segment-active",
              },
            ]}
          />
          <SummaryGrid
            columns={2}
            items={[
              {
                label: "AI total snapshot",
                value: formatCurrency(data.operations.aiTotalCostSnapshot),
                hint: "Latest warehouse snapshot",
              },
              {
                label: "Diagnostics AI",
                value: formatCurrency(data.operations.aiDiagnosticsCostSnapshot),
                hint: `${formatPercent(
                  safeRate(
                    data.operations.aiDiagnosticsCostSnapshot,
                    aiSnapshotTotal,
                  ),
                )} of AI total`,
              },
              {
                label: "Chat AI",
                value: formatCurrency(data.operations.aiChatCostSnapshot),
                hint: `${formatPercent(
                  safeRate(data.operations.aiChatCostSnapshot, aiSnapshotTotal),
                )} of AI total`,
              },
              {
                label: "Window chat cost",
                value: formatCurrency(data.operations.chatCost),
                hint: `${formatCurrency(
                  data.operations.costPerChatSession,
                )} per chat session`,
              },
            ]}
          />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Motor Usage"
            title="Which databases the product is leaning on"
            badge={`${formatNumber(data.motorUsage.length)} databases`}
          />
          <BarList
            items={data.motorUsage.map((row) => ({
              label: row.database,
              value: row.accesses,
              valueLabel: formatNumber(row.accesses),
              hint: `${formatNumber(row.uniqueUsers)} users · ${formatNumber(row.uniqueVehicles)} vehicles`,
            }))}
            emptyTitle="No Motor usage rows yet"
            emptyBody="As the core app export continues to land, this will show which Motor databases are carrying the most load."
          />
        </article>

        <article className="panel">
          <PanelHeader
            eyebrow="Efficiency"
            title="Operational ratios"
          />
          <SummaryGrid
            columns={2}
            items={[
              {
                label: "Cost / diagnostic",
                value: data.operations.costPerDiagnostic
                  ? formatCurrency(data.operations.costPerDiagnostic)
                  : "Pending",
              },
              {
                label: "Cost / chat",
                value: data.operations.costPerChatSession
                  ? formatCurrency(data.operations.costPerChatSession)
                  : "Pending",
              },
              {
                label: "Messages / chat",
                value: data.operations.messagesPerChatSession
                  ? data.operations.messagesPerChatSession.toFixed(1)
                  : "0.0",
              },
              {
                label: "Motor unique users",
                value: formatNumber(data.operations.motorUniqueUsers),
              },
            ]}
          />
        </article>
      </section>
    </div>
  );
}

function LifecycleSection({ data }: { data: DashboardData }) {
  const deliveryRate = safeRate(data.lifecycle.delivered, data.lifecycle.sent);
  const openRate = safeRate(data.lifecycle.humanOpened, data.lifecycle.delivered);
  const clickRate = safeRate(
    data.lifecycle.humanClicked,
    data.lifecycle.delivered,
  );
  const conversionRate = safeRate(
    data.lifecycle.converted,
    data.lifecycle.delivered,
  );
  const cards: KpiCard[] = [
    {
      label: "Messages sent",
      value: compactNumber(data.lifecycle.sent),
      rawValue: data.lifecycle.sent,
      hint: `${formatPercent(deliveryRate)} delivered`,
      tone: "growth",
    },
    {
      label: "Human opens",
      value: formatNumber(data.lifecycle.humanOpened),
      rawValue: data.lifecycle.humanOpened,
      hint: `${formatPercent(openRate)} open rate`,
      tone: "growth",
    },
    {
      label: "Human clicks",
      value: formatNumber(data.lifecycle.humanClicked),
      rawValue: data.lifecycle.humanClicked,
      hint: `${formatPercent(clickRate)} click rate`,
      tone: "growth",
    },
    {
      label: "Conversions",
      value: formatNumber(data.lifecycle.converted),
      rawValue: data.lifecycle.converted,
      hint: `${formatPercent(conversionRate)} conversion rate`,
      tone: "growth",
    },
    {
      label: "Bounced",
      value: formatNumber(data.lifecycle.bounced),
      rawValue: data.lifecycle.bounced,
      hint: "List quality pressure",
      tone: data.lifecycle.bounced ? "warning" : "neutral",
    },
    {
      label: "Unsubscribed",
      value: formatNumber(data.lifecycle.unsubscribed),
      rawValue: data.lifecycle.unsubscribed,
      hint: "Audience fatigue pressure",
      tone: data.lifecycle.unsubscribed ? "warning" : "neutral",
    },
  ];

  return (
    <div className="section-stack">
      <SectionKpiGrid cards={cards} />

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Trend"
            title="Lifecycle engagement over time"
            badge="Messaging activity only"
            description="Customer.io measures message performance. It does not define who is a real product user."
          />
          <TrendChart<PerformancePoint, "sent" | "opened" | "clicked" | "converted">
            points={data.performance}
            series={[
              {
                key: "sent",
                label: "Sent",
                color: "#465fff",
                fill: "#465fff",
              },
              {
                key: "opened",
                label: "Opened",
                color: "#12b76a",
                fill: "#12b76a",
              },
              {
                key: "clicked",
                label: "Clicked",
                color: "#f79009",
              },
              {
                key: "converted",
                label: "Converted",
                color: "#725cff",
                dashed: true,
              },
            ]}
            title="Lifecycle trend"
            subtitle="Shows messaging performance only, not user truth."
          />
        </article>

        <article className="panel">
          <PanelHeader eyebrow="List Health" title="Quality of reach" />
          <SummaryGrid
            columns={2}
            items={[
              {
                label: "Delivery rate",
                value: formatPercent(deliveryRate),
              },
              {
                label: "Open rate",
                value: formatPercent(openRate),
              },
              {
                label: "Click rate",
                value: formatPercent(clickRate),
              },
              {
                label: "Conversion rate",
                value: formatPercent(conversionRate),
              },
              {
                label: "Bounced",
                value: formatNumber(data.lifecycle.bounced),
              },
              {
                label: "Unsubscribed",
                value: formatNumber(data.lifecycle.unsubscribed),
              },
            ]}
          />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Campaign Leaderboard"
            title="What messaging is actually performing"
            badge={`${formatNumber(data.lifecycleCampaigns.length)} campaigns`}
          />
          <LifecycleCampaignTable campaigns={data.lifecycleCampaigns} />
        </article>

        <article className="panel">
          <PanelHeader eyebrow="Reading Rule" title="Important distinction" />
          <div className="insight-list">
            <p>
              Customer.io is enrichment and messaging telemetry only. It should
              never be treated as the primary source of user identity, workshop
              creation, or product-side lifecycle state.
            </p>
            <p>
              A strong lifecycle number with weak product conversion means the
              message got attention but the product still leaked value.
            </p>
            <p>
              This page is best paired with Product and Revenue to understand
              whether messaging is merely engaging or actually moving paid
              outcomes.
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}

function RevenueSection({ data }: { data: DashboardData }) {
  const cards: KpiCard[] = [
    {
      label: "MRR",
      value: formatCurrency(data.revenue.mrr),
      rawValue: data.revenue.mrr,
      hint: `${formatCurrency(data.revenue.arr)} ARR run rate`,
      tone: "revenue",
    },
    {
      label: "Active subscriptions",
      value: formatNumber(data.revenue.activeSubscriptions),
      rawValue: data.revenue.activeSubscriptions,
      hint: "Stripe canonical",
      tone: "growth",
    },
    {
      label: "Trials",
      value: formatNumber(data.revenue.trials),
      rawValue: data.revenue.trials,
      hint: "Potential future paid workshops",
      tone: "growth",
    },
    {
      label: "New paid workshops",
      value: formatNumber(data.revenue.newPaidWorkshops),
      rawValue: data.revenue.newPaidWorkshops,
      hint: "New paid movement in range",
      tone: "growth",
    },
    {
      label: "Churned",
      value: formatNumber(data.revenue.churnedSubscriptions),
      rawValue: data.revenue.churnedSubscriptions,
      hint: "Stripe churn events in range",
      tone: data.revenue.churnedSubscriptions ? "warning" : "neutral",
    },
    {
      label: "Live workshops",
      value: formatNumber(data.workshopSnapshot.live),
      rawValue: data.workshopSnapshot.live,
      hint: "Active + trialing workshops",
      tone: "growth",
    },
  ];

  return (
    <div className="section-stack">
      <SectionKpiGrid cards={cards} />

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Trend"
            title="Revenue and subscription trend"
            badge="Normalized daily shape"
            description="MRR, active subscriptions, and trials are shown together to help the CEO read momentum, not just the current snapshot."
          />
          <TrendChart<RevenueTrendPoint, "mrr" | "activeSubscriptions" | "trials" | "newPaidWorkshops">
            points={data.revenueTrend}
            series={[
              {
                key: "mrr",
                label: "MRR",
                color: "#465fff",
                fill: "#465fff",
              },
              {
                key: "activeSubscriptions",
                label: "Active subscriptions",
                color: "#12b76a",
                fill: "#12b76a",
              },
              {
                key: "trials",
                label: "Trials",
                color: "#38bdf8",
              },
              {
                key: "newPaidWorkshops",
                label: "New paid",
                color: "#725cff",
                dashed: true,
              },
            ]}
            title="Revenue trend"
            subtitle="Normalized so mixed units can be compared cleanly."
          />
        </article>

        <article className="panel">
          <PanelHeader
            eyebrow="Plan Mix"
            title="Where recurring revenue is concentrated"
            badge={`${formatNumber(data.revenue.planMix.length)} plan rows`}
          />
          <BarList
            items={data.revenue.planMix.map((plan) => ({
              label: plan.plan,
              value: plan.subscriptions,
            }))}
            emptyTitle="No plan mix rows yet"
            emptyBody="Stripe plan distribution will appear here once recurring subscription rows are synced."
          />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Billing Posture"
            title="Workshop billing state"
            badge={`${formatNumber(data.workshopSnapshot.stripeLinked)} Stripe-linked`}
          />
          <SegmentBar
            segments={[
              {
                label: "Active",
                value: data.workshopSnapshot.active,
                colorClass: "segment-active",
              },
              {
                label: "Trialing",
                value: data.workshopSnapshot.trialing,
                colorClass: "segment-trialing",
              },
              {
                label: "Paused",
                value: data.workshopSnapshot.paused,
                colorClass: "segment-paused",
              },
              {
                label: "At risk",
                value: data.workshopSnapshot.atRisk,
                colorClass: "segment-risk",
              },
              {
                label: "Inactive",
                value: data.workshopSnapshot.inactive,
                colorClass: "segment-inactive",
              },
              {
                label: "Unknown",
                value: data.workshopSnapshot.unknown,
                colorClass: "segment-unknown",
              },
            ]}
          />
          <SummaryGrid
            columns={4}
            items={[
              {
                label: "ARR run rate",
                value: formatCurrency(data.revenue.arr),
              },
              {
                label: "MRR",
                value: formatCurrency(data.revenue.mrr),
              },
              {
                label: "Active subscriptions",
                value: formatNumber(data.revenue.activeSubscriptions),
              },
              {
                label: "Trialing subscriptions",
                value: formatNumber(data.revenue.trials),
              },
            ]}
          />
        </article>

        <article className="panel">
          <PanelHeader eyebrow="Retention Lens" title="How to read risk" />
          <div className="insight-list">
            <p>
              Active and trialing workshops show immediate revenue base plus
              near-term expansion opportunity.
            </p>
            <p>
              Paused and at-risk workshops are the best early-warning group for
              churn prevention and product success outreach.
            </p>
            <p>
              Unknown status should be treated as missing linkage, not as
              healthy revenue.
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}

function DataHealthSection({ data }: { data: DashboardData }) {
  const healthySources = data.sources.filter(
    (source) => source.status === "healthy",
  ).length;
  const staleSources = data.sources.filter(
    (source) => source.status === "stale",
  ).length;
  const failingSources = data.sources.filter(
    (source) => source.status === "failing",
  ).length;
  const recentRowsRead = data.recentSyncRuns.reduce(
    (sum, run) => sum + run.rowsRead,
    0,
  );
  const recentRowsWritten = data.recentSyncRuns.reduce(
    (sum, run) => sum + run.rowsWritten,
    0,
  );

  const cards: KpiCard[] = [
    {
      label: "Healthy sources",
      value: formatNumber(healthySources),
      rawValue: healthySources,
      hint: `${formatNumber(data.sources.length)} configured`,
      tone: "growth",
    },
    {
      label: "Stale sources",
      value: formatNumber(staleSources),
      rawValue: staleSources,
      hint: "Needs fresher syncs",
      tone: staleSources ? "warning" : "neutral",
    },
    {
      label: "Failing sources",
      value: formatNumber(failingSources),
      rawValue: failingSources,
      hint: "Needs fix before trust",
      tone: failingSources ? "warning" : "neutral",
    },
    {
      label: "Recent rows read",
      value: compactNumber(recentRowsRead),
      rawValue: recentRowsRead,
      hint: "Across recent sync runs",
      tone: "neutral",
    },
    {
      label: "Recent rows written",
      value: compactNumber(recentRowsWritten),
      rawValue: recentRowsWritten,
      hint: "Warehouse writes",
      tone: "neutral",
    },
    {
      label: "Current window",
      value: data.windowLabel,
      rawValue: 0,
      hint: data.dateSpan,
      tone: "neutral",
    },
  ];

  return (
    <div className="section-stack">
      <SectionKpiGrid cards={cards} />

      <section className="content-grid">
        <article className="panel">
          <PanelHeader
            eyebrow="Freshness"
            title="Source-by-source health"
          />
          <SourceHealthList sources={data.sources} />
        </article>

        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Recent Activity"
            title="What the sync layer has been doing"
            badge={`${formatNumber(data.recentSyncRuns.length)} runs`}
          />
          <RecentSyncRunsTable runs={data.recentSyncRuns} />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <PanelHeader
            eyebrow="Coverage"
            title="Canonical data coverage"
          />
          <SummaryGrid
            columns={2}
            items={[
              {
                label: "Users with Customer.io ID",
                value: formatNumber(data.enrichmentCoverage.usersWithCustomerIoId),
              },
              {
                label: "Users with created_at",
                value: formatNumber(data.enrichmentCoverage.usersWithCreatedAt),
              },
              {
                label: "Users with Stripe customer",
                value: formatNumber(data.enrichmentCoverage.usersWithStripeCustomerId),
              },
              {
                label: "Users with status",
                value: formatNumber(
                  data.enrichmentCoverage.usersWithSubscriptionStatus,
                ),
              },
              {
                label: "Workshops with country",
                value: formatNumber(data.enrichmentCoverage.workshopsWithCountry),
              },
              {
                label: "Workshops with status",
                value: formatNumber(
                  data.enrichmentCoverage.workshopsWithSubscriptionStatus,
                ),
              },
              {
                label: "Workshops with Stripe customer",
                value: formatNumber(
                  data.enrichmentCoverage.workshopsWithStripeCustomerId,
                ),
              },
              {
                label: "Workshops with core_app Stripe customer",
                value: formatNumber(
                  data.enrichmentCoverage.workshopsWithCoreStripeCustomerId,
                ),
              },
              {
                label: "Workshops with language",
                value: formatNumber(data.enrichmentCoverage.workshopsWithLanguage),
              },
              {
                label: "Workshops tagged created_by_agent",
                value: formatNumber(
                  data.enrichmentCoverage.workshopsWithCreatedByAgent,
                ),
              },
              {
                label: "Users with display name",
                value: formatNumber(data.enrichmentCoverage.usersWithName),
              },
              {
                label: "Users with core_app Stripe customer",
                value: formatNumber(
                  data.enrichmentCoverage.usersWithCoreStripeCustomerId,
                ),
              },
              {
                label: "Subscription-status drift (core_app vs Stripe)",
                value: formatNumber(
                  data.enrichmentCoverage.workshopsWithSubscriptionStatusDrift,
                ),
              },
              {
                label: "Unknown workshop status",
                value: formatNumber(data.workshopSnapshot.unknown),
              },
            ]}
          />
        </article>

        <article className="panel panel-wide">
          <PanelHeader eyebrow="Trust Rules" title="How this dashboard is meant to be read" />
          <div className="insight-list">
            <p>
              AWS/S3 core app data is the canonical source for users,
              workshops, diagnostics, and product-side state.
            </p>
            <p>
              Stripe is canonical for billing and subscription state. Customer.io
              enriches and measures messaging only; it does not define real
              users.
            </p>
            <p>
              GA4 is the analytics source for app and web behavior plus linked
              Ads reporting. Any stale or failing source should lower confidence
              in the relevant page, not necessarily in the whole dashboard.
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}

function SettingsSection({ data }: { data: DashboardData }) {
  return (
    <div className="section-stack">
      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Source Priority"
            title="What wins when data conflicts"
            badge="Operating model"
          />
          <div className="bar-list playbook-list">
            {[
              {
                label: "Users, workshops, diagnostics",
                value: 100,
                valueLabel: "AWS core app",
                hint: "Canonical source of truth",
              },
              {
                label: "Billing and subscription state",
                value: 90,
                valueLabel: "Stripe",
                hint: "Canonical for paid status and revenue",
              },
              {
                label: "Usage and ads-linked analytics",
                value: 80,
                valueLabel: "GA4 / Firebase",
                hint: "Canonical analytics layer",
              },
              {
                label: "Messaging performance",
                value: 70,
                valueLabel: "Customer.io",
                hint: "Campaign telemetry and enrichment only",
              },
              {
                label: "App Store discovery",
                value: 60,
                valueLabel: "App Store Connect",
                hint: "Will strengthen as Apple report rows land",
              },
            ].map((item) => (
              <div className="bar-row" key={item.label}>
                <div className="bar-row-copy">
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </div>
                <div className="bar-row-main text-value">
                  <strong>{item.valueLabel}</strong>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <PanelHeader eyebrow="Current Window" title="How the filters behave" />
          <div className="insight-list">
            <p>
              The current page is filtered to <strong>{data.windowLabel}</strong>
              {" · "}
              {data.dateSpan}.
            </p>
            <p>
              Most charts show normalized trend shape where mixed units are
              plotted together. Use the KPI cards for exact values.
            </p>
            <p>
              All time ranges are UTC-based. Generated timestamp tells you when
              the page was assembled.
            </p>
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <PanelHeader
            eyebrow="Page Directory"
            title="What each page is for"
          />
          <div className="directory-grid">
            {DASHBOARD_SECTIONS.filter((section) => section.key !== "settings").map(
              (section) => (
                <a className="directory-card" href={section.href} key={section.key}>
                  <span>{section.glyph}</span>
                  <strong>{section.label}</strong>
                  <p>{section.description}</p>
                </a>
              ),
            )}
          </div>
        </article>

        <article className="panel">
          <PanelHeader eyebrow="CEO Workflow" title="Best way to use this dashboard" />
          <div className="insight-list">
            <p>
              Start on Overview for the weekly readout, then move into the one
              page that looks off rather than bouncing between external tools.
            </p>
            <p>
              Compare Acquisition with Product to spot conversion leakage, and
              compare Product with Revenue to separate adoption issues from
              billing issues.
            </p>
            <p>
              Check Data Health before making a hard decision off any number
              that looks surprising.
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}

export function DashboardSectionContent({
  data,
  section,
}: {
  data: DashboardData;
  section: DashboardSectionKey;
}) {
  switch (section) {
    case "acquisition":
      return <AcquisitionSection data={data} />;
    case "organic-search":
      return <OrganicSearchSection data={data} />;
    case "product":
      return <ProductSection data={data} />;
    case "operations":
      return <OperationsSection data={data} />;
    case "workshops":
      return <OverviewSection data={data} />;
    case "lifecycle":
      return <LifecycleSection data={data} />;
    case "revenue":
      return <RevenueSection data={data} />;
    case "data-health":
      return <DataHealthSection data={data} />;
    case "settings":
      return <SettingsSection data={data} />;
    case "dashboard":
    default:
      return <OverviewSection data={data} />;
  }
}
