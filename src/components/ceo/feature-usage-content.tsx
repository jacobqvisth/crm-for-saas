"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { compactNumber, formatNumber } from "@/lib/ceo/format";
import {
  FEATURE_USAGE_FEATURES,
  type FeatureUsageData,
  type FeatureUsageFeatureKey,
  type FeatureUsageUserRow,
} from "@/lib/ceo/feature-usage-shared";
import { InfoHint, type SourceInfo } from "./source-info";

type FeatureUsageContentProps = {
  data: FeatureUsageData;
};

const LOGINS_INFO: SourceInfo = {
  title: "App logins",
  body:
    "Real login events from the codeoc app (dashboard_user_logins). The S3 export carries each user's last 30 login timestamps; the hourly core_app sync accumulates them, which backfills roughly 14 months of history.",
  sources: ["codeoc S3 export · user_stats.login_history", "dashboard_user_logins"],
  logic:
    "Logins are bucketed to Stockholm civil days. 'Login users' counts distinct users with at least one login in the bucket — an app-data DAU that works even where GA4 is blocked.",
};

const FEATURE_INFO: SourceInfo = {
  title: "Feature counters",
  body:
    "Per-user, per-day activity counts accumulated from the codeoc export's snapshot counters (diagnostics, chat, AI search, VRM lookups, InfoPro vehicles, Motor vehicles).",
  sources: ["codeoc S3 export · user_stats counters", "dashboard_feature_usage"],
  logic:
    "The export only ships each user's LAST active day per feature; the hourly sync upserts those snapshots into a real time series. Data exists from 2026-06-11 onward — earlier days are zero by construction, not because nobody used the app.",
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Stockholm",
  });
}

function FeatureUsageDiagram({ data }: { data: FeatureUsageData }) {
  const buckets = data.buckets;
  const maxValue = Math.max(
    1,
    ...buckets.flatMap((bucket) => [bucket.loginUsers, bucket.featureTotal]),
  );

  return (
    <div className="app-usage-diagram" aria-label="Feature usage diagram">
      <div className="diagram-legend">
        <span>
          <i className="legend-users" />
          Login users
        </span>
        <span>
          <i className="legend-diagnoses" />
          Feature events
        </span>
      </div>

      <div className="diagram-bars">
        {buckets.map((bucket) => (
          <div className="diagram-week" key={bucket.bucket}>
            <div className="diagram-pair">
              <span
                className="diagram-bar users"
                style={
                  {
                    "--bar-height": `${Math.max(
                      3,
                      (bucket.loginUsers / maxValue) * 100,
                    )}%`,
                  } as CSSProperties
                }
              >
                <small>{formatNumber(bucket.loginUsers)}</small>
              </span>
              <span
                className="diagram-bar diagnoses"
                style={
                  {
                    "--bar-height": `${Math.max(
                      3,
                      (bucket.featureTotal / maxValue) * 100,
                    )}%`,
                  } as CSSProperties
                }
              >
                <small>{formatNumber(bucket.featureTotal)}</small>
              </span>
            </div>
            <span className="diagram-label">{bucket.bucketShortLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type UserSortKey = "featureTotal" | "logins" | FeatureUsageFeatureKey;

function userSortValue(row: FeatureUsageUserRow, key: UserSortKey): number {
  if (key === "featureTotal") return row.featureTotal;
  if (key === "logins") return row.logins;
  return row.features[key];
}

const TOP_USERS_LIMIT = 50;

export function FeatureUsageContent({ data }: FeatureUsageContentProps) {
  const [sortKey, setSortKey] = useState<UserSortKey>("featureTotal");

  const sortedUsers = useMemo(
    () =>
      [...data.users]
        .sort(
          (a, b) =>
            userSortValue(b, sortKey) - userSortValue(a, sortKey) ||
            b.featureTotal - a.featureTotal,
        )
        .slice(0, TOP_USERS_LIMIT),
    [data.users, sortKey],
  );

  const sortButton = (key: UserSortKey, label: string) => (
    <button
      className={`toplist-sort${sortKey === key ? " is-active" : ""}`}
      onClick={() => setSortKey(key)}
      type="button"
    >
      {label}
      <span className="toplist-sort-caret">{sortKey === key ? "▼" : ""}</span>
    </button>
  );

  const topFeature = [...data.features].sort((a, b) => b.total - a.total)[0];

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Feature Usage</p>
            <h2 className="heading-with-info">
              <span>Activity per bucket — {data.rangeLabel}</span>
              <InfoHint info={LOGINS_INFO} />
            </h2>
            <p className="panel-description">{data.rangeSpan}</p>
          </div>
          <span className="badge">
            {formatNumber(data.totals.loginUsers)} login users
          </span>
        </div>

        <div className="summary-grid columns-4">
          <div className="summary-card">
            <strong>{formatNumber(data.totals.loginUsers)}</strong>
            <span className="label-with-info">
              <span>Users who logged in</span>
              <InfoHint info={LOGINS_INFO} />
            </span>
            <small>{formatNumber(data.totals.logins)} total logins</small>
          </div>
          <div className="summary-card">
            <strong>{formatNumber(data.totals.featureUsers)}</strong>
            <span className="label-with-info">
              <span>Users with feature activity</span>
              <InfoHint info={FEATURE_INFO} />
            </span>
            <small>
              {formatNumber(data.totals.featureEvents)} feature events
            </small>
          </div>
          <div className="summary-card">
            <strong>{topFeature ? topFeature.label : "—"}</strong>
            <span>Most-used feature</span>
            <small>
              {topFeature
                ? `${formatNumber(topFeature.total)} events · ${formatNumber(topFeature.users)} users`
                : "No feature activity in range"}
            </small>
          </div>
          <div className="summary-card">
            <strong>
              {formatNumber(
                data.features.filter((feature) => feature.total > 0).length,
              )}
              /{data.features.length}
            </strong>
            <span>Features in use</span>
            <small>Features with at least one event in range</small>
          </div>
        </div>

        <FeatureUsageDiagram data={data} />
        <p className="panel-description">{data.note}</p>
      </article>

      <section className="content-grid">
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Adoption</p>
              <h2 className="heading-with-info">
                <span>Usage by feature</span>
                <InfoHint info={FEATURE_INFO} />
              </h2>
            </div>
          </div>
          <div className="bar-list">
            {data.features.map((feature) => {
              const maxTotal = Math.max(
                1,
                ...data.features.map((item) => item.total),
              );
              return (
                <div className="bar-row" key={feature.key}>
                  <div className="bar-row-copy">
                    <strong>{feature.label}</strong>
                    <span>{feature.description}</span>
                  </div>
                  <div className="bar-row-main">
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${Math.max(4, (feature.total / maxTotal) * 100)}%`,
                        }}
                      />
                    </div>
                    <strong>
                      {formatNumber(feature.total)}
                      <small> · {formatNumber(feature.users)} users</small>
                    </strong>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Monthly Counters</p>
              <h2>InfoPro / Motor by month</h2>
              <p className="panel-description">
                The export also ships sparse per-month vehicle-lookup counters
                for the InfoPro and Motor databases.
              </p>
            </div>
          </div>
          {data.monthly.length === 0 ? (
            <div className="empty-state">
              <strong>No monthly counters in range</strong>
              <p>
                These counters are sparsely populated by the app today; rows
                appear as users open vehicles in InfoPro or Motor.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Feature</th>
                    <th>Lookups</th>
                    <th>Users</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.slice(0, 12).map((row) => (
                    <tr key={`${row.month}-${row.feature}`}>
                      <td>{row.month}</td>
                      <td>{row.label}</td>
                      <td>{formatNumber(row.total)}</td>
                      <td>{formatNumber(row.users)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Per Bucket</p>
            <h2>Logins and feature events over time</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{data.granularity === "day" ? "Date" : "Period"}</th>
                <th>Logins</th>
                <th>Login users</th>
                {FEATURE_USAGE_FEATURES.map((feature) => (
                  <th key={feature.key}>{feature.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data.buckets].reverse().map((bucket) => (
                <tr key={bucket.bucket}>
                  <td>{bucket.bucketLabel}</td>
                  <td>{formatNumber(bucket.logins)}</td>
                  <td>{formatNumber(bucket.loginUsers)}</td>
                  {FEATURE_USAGE_FEATURES.map((feature) => (
                    <td key={feature.key}>
                      {bucket.features[feature.key]
                        ? formatNumber(bucket.features[feature.key])
                        : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Drilldown</p>
            <h2>Top users in range</h2>
            <p className="panel-description">
              Click a column to re-sort. Showing top {TOP_USERS_LIMIT} of{" "}
              {formatNumber(data.users.length)} users with activity.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Workshop</th>
                <th>{sortButton("logins", "Logins")}</th>
                <th>Last login</th>
                {FEATURE_USAGE_FEATURES.map((feature) => (
                  <th key={feature.key}>
                    {sortButton(feature.key, feature.label)}
                  </th>
                ))}
                <th>{sortButton("featureTotal", "Total")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((row) => (
                <tr key={row.internalUserId}>
                  <td>
                    <div className="table-primary">
                      <strong>
                        {row.name ?? row.username ?? row.internalUserId}
                      </strong>
                      {row.username && row.name ? (
                        <span>{row.username}</span>
                      ) : row.role ? (
                        <span>{row.role}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {row.workshopId && row.company ? (
                      <a
                        href={`/dashboard/workshops?workshop=${encodeURIComponent(row.workshopId)}`}
                      >
                        {row.company}
                      </a>
                    ) : (
                      (row.company ?? "—")
                    )}
                  </td>
                  <td>{formatNumber(row.logins)}</td>
                  <td>{formatDateTime(row.lastLoginAt)}</td>
                  {FEATURE_USAGE_FEATURES.map((feature) => (
                    <td key={feature.key}>
                      {row.features[feature.key]
                        ? formatNumber(row.features[feature.key])
                        : "—"}
                    </td>
                  ))}
                  <td>
                    <strong>{compactNumber(row.featureTotal)}</strong>
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
