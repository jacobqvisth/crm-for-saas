import { compactNumber, formatNumber, formatPercent } from "@/lib/ceo/format";
import { formatStockholmTime } from "@/lib/ceo/data/sync-freshness";
import type {
  ProductAnalyticsData,
  ProductEventRow,
  ProductFunnelStep,
  ProductSegmentRow,
} from "@/lib/ceo/data/product-analytics";
import { InfoHint, type SourceInfo } from "./source-info";

const POSTHOG_SOURCE: SourceInfo = {
  title: "PostHog product analytics",
  body:
    "Queried live from PostHog Cloud EU (project 196292) at page load, cached 5 minutes. Every event is keyed on the Cognito sub (= contacts.wl_user_id) and grouped by workshop_id, so this is real in-app behaviour — not anonymous web traffic. Internal staff/admin accounts (person property privilege ∈ {admin, staff}) are excluded everywhere.",
  sources: ["PostHog events (codeoc frontend + backend Python SDK)"],
  fields: [
    "person.properties.plan / country / privilege",
    "$group_0 = workshop_id",
    "events: $pageview, $autocapture, vehicle_selected, diagnostic_*, upgrade_started, subscription_started, $exception …",
  ],
};

function Kpi({
  label,
  value,
  icon,
  hint,
  tone,
}: {
  label: string;
  value: string;
  icon: string;
  hint: string;
  tone: string;
}) {
  return (
    <article className={`kpi-card ${tone}`}>
      <div className="kpi-card-main">
        <p className="label-with-info">
          <span>{label}</span>
        </p>
        <strong>{value}</strong>
      </div>
      <span className="metric-icon">{icon}</span>
      <span className="kpi-card-hint">{hint}</span>
    </article>
  );
}

function FunnelChart({ steps }: { steps: ProductFunnelStep[] }) {
  const maxValue = Math.max(1, ...steps.map((s) => s.users));
  return (
    <div className="section-stack" style={{ gap: 12 }}>
      {steps.map((step) => (
        <div className="funnel-row" key={step.key}>
          <div className="funnel-label">
            <strong>{step.label}</strong>
            <span className="label-with-info">
              <span>{formatNumber(step.users)} users</span>
            </span>
          </div>
          <div className="funnel-track">
            <div
              className="funnel-bar"
              style={{ width: `${Math.max(4, (step.users / maxValue) * 100)}%` }}
            />
          </div>
          <span className="funnel-rate">
            {step.key === steps[0]?.key
              ? "—"
              : formatPercent(step.conversionFromPrevious)}
          </span>
        </div>
      ))}
    </div>
  );
}

function BarList({
  rows,
  emptyLabel,
}: {
  rows: Array<{ key: string; label: string; value: number; sub?: string }>;
  emptyLabel: string;
}) {
  const maxValue = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p>{emptyLabel}</p>
      </div>
    );
  }
  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div className="bar-row" key={row.key}>
          <div className="bar-row-copy">
            <strong>{row.label}</strong>
            <span className="table-secondary">
              {formatNumber(row.value)}
              {row.sub ? ` · ${row.sub}` : ""}
            </span>
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${Math.max(3, (row.value / maxValue) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SegmentTable({
  title,
  rows,
}: {
  title: string;
  rows: ProductSegmentRow[];
}) {
  return (
    <article className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          <p>No data in this range.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{title.replace("By ", "")}</th>
                <th>Users</th>
                <th>Events</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="table-primary">{row.key}</td>
                  <td>{formatNumber(row.users)}</td>
                  <td>{formatNumber(row.events)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function TopEventsTable({ rows }: { rows: ProductEventRow[] }) {
  return (
    <article className="panel">
      <div className="panel-heading">
        <h2>
          <span className="heading-with-info">
            Top events
            <InfoHint
              info={{
                title: "Top events",
                body:
                  "Most frequent events in the range, including autocapture ($autocapture) and explicit product events. Autocapture records clicks/inputs without instrumentation — feature usage we never had to wire up.",
                fields: ["event, count(), count(DISTINCT person_id)"],
              }}
            />
          </span>
        </h2>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Count</th>
              <th>Users</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="table-primary">{row.label}</td>
                <td>{formatNumber(row.count)}</td>
                <td>{formatNumber(row.users)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function ProductAnalyticsContent({
  data,
}: {
  data: ProductAnalyticsData;
}) {
  if (!data.available) {
    return (
      <div className="empty-state">
        <strong>Product analytics unavailable</strong>
        <p>{data.note}</p>
      </div>
    );
  }

  const { overview } = data;

  return (
    <div className="section-stack">
      {/* Overview */}
      <section className="kpi-grid">
        <Kpi
          tone="tone-growth"
          icon="AU"
          label="Active users"
          value={formatNumber(overview.activeUsers)}
          hint={data.rangeLabel}
        />
        <Kpi
          tone="tone-growth"
          icon="DAU"
          label="Avg daily active"
          value={formatNumber(overview.avgDau)}
          hint="mean per day in range"
        />
        <Kpi
          tone="tone-revenue"
          icon="ST"
          label="Stickiness"
          value={formatPercent(overview.stickiness)}
          hint="avg DAU ÷ active users"
        />
        <Kpi
          tone="tone-growth"
          icon="EV"
          label="Events"
          value={compactNumber(overview.events)}
          hint="all captured events"
        />
        <Kpi
          tone="tone-growth"
          icon="SE"
          label="Sessions"
          value={formatNumber(overview.sessions)}
          hint="distinct sessions"
        />
        <Kpi
          tone="tone-growth"
          icon="PV"
          label="Page views"
          value={formatNumber(overview.pageviews)}
          hint="$pageview events"
        />
      </section>

      {/* Funnels */}
      <div className="content-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <article className="panel">
          <div className="panel-heading">
            <h2>
              <span className="heading-with-info">
                Diagnostic activation funnel
                <InfoHint
                  info={{
                    title: "Diagnostic funnel",
                    body:
                      "Distinct users who reached each step in the range. This is the in-app journey we could never see before — core_app only stored completed diagnostics, never where users dropped off inside the flow. The right-side % is conversion from the previous step.",
                    fields: [
                      "uniqIf(person_id, event = 'vehicle_selected' … 'diagnostic_completed')",
                    ],
                  }}
                />
              </span>
            </h2>
          </div>
          <FunnelChart steps={data.diagnosticFunnel} />
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>
              <span className="heading-with-info">
                Monetization activity
                <InfoHint
                  info={{
                    title: "Monetization activity",
                    body:
                      "Distinct users who triggered each billing-related event. upgrade_started captures upgrade INTENT — Stripe only shows completed upgrades, never attempts.",
                    fields: [
                      "uniqIf(person_id, event = 'feature_paywall_hit' … 'subscription_started')",
                    ],
                  }}
                />
              </span>
            </h2>
          </div>
          <BarList
            emptyLabel="No monetization events in this range."
            rows={data.monetization.map((m) => ({
              key: m.key,
              label: m.label,
              value: m.users,
              sub: "users",
            }))}
          />
        </article>
      </div>

      {/* Daily activity */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <h2>Daily activity</h2>
        </div>
        <BarList
          emptyLabel="No activity in this range."
          rows={data.trend.map((p) => ({
            key: p.day,
            label: p.day,
            value: p.events,
            sub: `${formatNumber(p.users)} users · ${formatNumber(p.pageviews)} views`,
          }))}
        />
      </article>

      {/* Per-workshop engagement */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <h2>
            <span className="heading-with-info">
              Workshop engagement
              <InfoHint
                info={{
                  title: "Per-workshop engagement",
                  body:
                    "Account-level product activity via PostHog group analytics ($group_0 = workshop_id), joined to the workshop name from dashboard_workshops. Account behaviour was invisible before — this feeds churn-risk and the Field Routes lapsed pool.",
                  sources: ["PostHog group analytics", "dashboard_workshops"],
                }}
              />
            </span>
          </h2>
        </div>
        {data.workshops.length === 0 ? (
          <div className="empty-state">
            <p>No workshop-attributed activity in this range.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Workshop</th>
                  <th>Users</th>
                  <th>Events</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.workshops.map((row) => (
                  <tr key={row.workshopId}>
                    <td className="table-primary">
                      <span className="table-primary-name">
                        {row.name ?? "Unknown workshop"}
                      </span>
                      <span className="table-secondary">{row.workshopId}</span>
                    </td>
                    <td>{formatNumber(row.users)}</td>
                    <td>{formatNumber(row.events)}</td>
                    <td>
                      {row.lastSeen ? formatStockholmTime(row.lastSeen) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {/* Top events + errors */}
      <div className="content-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <TopEventsTable rows={data.topEvents} />

        <article className="panel">
          <div className="panel-heading">
            <h2>
              <span className="heading-with-info">
                Errors
                <InfoHint
                  info={{
                    title: "Errors ($exception)",
                    body:
                      "Client errors captured by PostHog (cross-linked to Sentry). Per-user error impact was never visible in the CRM — these are a churn-risk and support signal.",
                    fields: ["$exception_type, count(), affected users"],
                  }}
                />
              </span>
            </h2>
          </div>
          {data.errors.length === 0 ? (
            <div className="empty-state">
              <p>No errors captured in this range. 🎉</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Count</th>
                    <th>Users</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.errors.map((row) => (
                    <tr key={row.type}>
                      <td className="table-primary">{row.type}</td>
                      <td>{formatNumber(row.count)}</td>
                      <td>{formatNumber(row.users)}</td>
                      <td>
                        {row.lastSeen ? formatStockholmTime(row.lastSeen) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>

      {/* Segments */}
      <div className="content-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <SegmentTable title="By plan" rows={data.byPlan} />
        <SegmentTable title="By country" rows={data.byCountry} />
      </div>
    </div>
  );
}
