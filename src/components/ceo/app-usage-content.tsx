import { formatNumber } from "@/lib/ceo/format";
import {
  APP_USAGE_PLATFORMS,
  granularityColumnHeader,
  granularityNoun,
  type AppUsageData,
} from "@/lib/ceo/data/app-usage";
import type { CSSProperties } from "react";
import { InfoHint, type SourceInfo } from "./source-info";
import type {
  InternalTestUserRecord,
  InternalTestWorkshopRecord,
} from "@/lib/ceo/internal-test/loader";
import {
  DEFAULT_TIME_RANGE_KEY,
  type DashboardTimeRangeKey,
} from "@/lib/ceo/time-ranges";

type AppUsageContentProps = {
  usage: AppUsageData;
  internalTestUsers: InternalTestUserRecord[];
  internalTestWorkshops: InternalTestWorkshopRecord[];
};

function buildPlatformHref(
  rangeKey: DashboardTimeRangeKey,
  platformKey: string,
) {
  const params = new URLSearchParams();
  if (rangeKey !== DEFAULT_TIME_RANGE_KEY) {
    params.set("range", rangeKey);
  }
  if (platformKey !== "all") {
    params.set("platform", platformKey);
  }
  const query = params.toString();
  return query ? `/ceo/app-usage?${query}` : "/ceo/app-usage";
}

const PLATFORM_FILTERS_INFO: SourceInfo = {
  title: "Platform filter — what each tab counts",
  body:
    "Each tab applies a different GA4 dimensionFilter so the numbers below answer a different question. Diagnoses (the orange bar / 'Diagnoses made' column) come from the first-party dashboard_diagnostics table and never change between tabs.",
  sources: [
    "GA4 streams: Website and web app · WrenchLane - iOS · WrenchLane - Android",
  ],
  fields: [
    "All — hostName = app.wrenchlane.com OR streamName ∈ {WrenchLane - iOS, WrenchLane - Android}",
    "Web — hostName = app.wrenchlane.com",
    "iOS — streamName = WrenchLane - iOS",
    "Android — streamName = WrenchLane - Android",
  ],
  logic:
    "All sums product activity across web, iOS, and Android. Marketing-site visits on wrenchlane.com (which share the 'Website and web app' GA4 stream with the product app) are dropped by filtering that stream down to hostName = app.wrenchlane.com. iOS and Android each isolate their native Firebase stream.",
};

export function AppUsagePlatformTabs({
  rangeKey,
  active,
}: {
  rangeKey: DashboardTimeRangeKey;
  active: AppUsageData["platform"];
}) {
  return (
    <nav className="platform-tabs" aria-label="Filter by platform">
      {APP_USAGE_PLATFORMS.map((option) => (
        <a
          aria-current={option.key === active ? "page" : undefined}
          aria-label={`${option.label} — ${option.description}`}
          className={`platform-tab${option.key === active ? " active" : ""}`}
          href={buildPlatformHref(rangeKey, option.key)}
          key={option.key}
          title={option.description}
        >
          {option.label}
        </a>
      ))}
      <span className="platform-tabs-info">
        <InfoHint info={PLATFORM_FILTERS_INFO} />
      </span>
    </nav>
  );
}

const GA4_SOURCE_INFO: SourceInfo = {
  title: "GA4 app usage",
  body:
    "Reads Google Analytics 4 reporting data, filtered to the active platform and bucketed to match the selected range.",
  sources: ["GA4 property 479182799"],
  fields: [
    "dimension = dateHour | date | yearWeek | yearMonth (per range)",
    "activeUsers, sessions, screenPageViews, eventCount",
  ],
  refresh:
    "GA4 reports update as Analytics processes events from the product app. Recent buckets can move while GA4 finishes processing.",
};

const COLUMN_INFO: Record<string, SourceInfo> = {
  uniqueUsers: {
    title: "Unique users",
    body:
      "A user who had an engaged visit or generated activity in this bucket. Today this is mostly browser/device based because the product app is not yet reliably sending AWS user_id.",
    fields: ["GA4 activeUsers"],
  },
  sessions: {
    title: "Sessions",
    body:
      "A visit window started by GA4. One person can create multiple sessions in the same bucket if they come back later.",
    fields: ["GA4 sessions"],
  },
  pageViews: {
    title: "Page views",
    body:
      "App pages viewed in the active platform stream. Native iOS/Android Firebase streams typically don't emit page_view events, so the iOS and Android filters may show 0 here.",
    fields: ["GA4 screenPageViews"],
  },
  pagesPerSession: {
    title: "Pages per session",
    body:
      "Page views divided by sessions, computed per bucket. A rough indicator of session depth. Always 0 on platforms that don't emit page_view events.",
    fields: ["screenPageViews / sessions"],
  },
  diagnosesMade: {
    title: "Diagnoses made",
    body:
      "First-party diagnostic rows created in this bucket from the AWS/core-app export. Internal/test users and workshops are excluded immediately. Note: diagnostics aren't platform-attributed, so the platform filter doesn't change this number.",
    sources: ["AWS/S3 core app export", "dashboard_diagnostics"],
    fields: ["dashboard_diagnostics.created_at"],
  },
  events: {
    title: "Events",
    body:
      "All GA4 events counted for the active platform stream, including page views, screen views, and other automatically or manually tracked events.",
    fields: ["GA4 eventCount"],
  },
};

function AppUsageDiagram({ rows }: { rows: AppUsageData["rows"] }) {
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => [row.activeUsers, row.diagnosesMade]),
  );

  return (
    <div className="app-usage-diagram" aria-label="App usage diagram">
      <div className="diagram-legend">
        <span>
          <i className="legend-users" />
          Unique users
        </span>
        <span>
          <i className="legend-diagnoses" />
          Diagnoses made
        </span>
      </div>

      <div className="diagram-bars">
        {rows.map((row) => (
          <div className="diagram-week" key={row.bucket}>
            <div className="diagram-pair">
              <span
                className="diagram-bar users"
                style={
                  {
                    "--bar-height": `${Math.max(
                      3,
                      (row.activeUsers / maxValue) * 100,
                    )}%`,
                  } as CSSProperties
                }
              >
                <small>{formatNumber(row.activeUsers)}</small>
              </span>
              <span
                className="diagram-bar diagnoses"
                style={
                  {
                    "--bar-height": `${Math.max(
                      3,
                      (row.diagnosesMade / maxValue) * 100,
                    )}%`,
                  } as CSSProperties
                }
              >
                <small>{formatNumber(row.diagnosesMade)}</small>
              </span>
            </div>
            <span className="diagram-label">{row.bucketShortLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AppUsageContent({
  usage,
  internalTestUsers,
  internalTestWorkshops,
}: AppUsageContentProps) {
  const granularity = usage.granularity;
  const noun = granularityNoun(granularity);
  const columnHeader = granularityColumnHeader(granularity);

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h2>
              <span className="heading-with-info">
                Unique users by {noun}
                <InfoHint info={GA4_SOURCE_INFO} />
              </span>
            </h2>
          </div>
        </div>

        {usage.error ? (
          <div className="empty-state">
            <strong>GA4 usage could not load</strong>
            <p>{usage.error}</p>
          </div>
        ) : (
          <>
            <AppUsageDiagram rows={usage.rows} />
            <div className="table-wrap">
              <table className="data-table app-usage-table">
                <thead>
                  <tr>
                    <th>{columnHeader}</th>
                    <th>
                      <span className="table-heading-info">
                        Unique users
                        <InfoHint info={COLUMN_INFO.uniqueUsers} />
                      </span>
                    </th>
                    <th>
                      <span className="table-heading-info">
                        Sessions
                        <InfoHint info={COLUMN_INFO.sessions} />
                      </span>
                    </th>
                    <th>
                      <span className="table-heading-info">
                        Page views
                        <InfoHint info={COLUMN_INFO.pageViews} />
                      </span>
                    </th>
                    <th>
                      <span className="table-heading-info">
                        Pages / session
                        <InfoHint info={COLUMN_INFO.pagesPerSession} />
                      </span>
                    </th>
                    <th>
                      <span className="table-heading-info">
                        Diagnoses made
                        <InfoHint info={COLUMN_INFO.diagnosesMade} />
                      </span>
                    </th>
                    <th>
                      <span className="table-heading-info">
                        Events
                        <InfoHint info={COLUMN_INFO.events} />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const totals = usage.rows.reduce(
                      (acc, row) => ({
                        activeUsers: acc.activeUsers + row.activeUsers,
                        sessions: acc.sessions + row.sessions,
                        pageViews: acc.pageViews + row.pageViews,
                        diagnosesMade: acc.diagnosesMade + row.diagnosesMade,
                        events: acc.events + row.events,
                      }),
                      {
                        activeUsers: 0,
                        sessions: 0,
                        pageViews: 0,
                        diagnosesMade: 0,
                        events: 0,
                      },
                    );
                    const pagesPerSession =
                      totals.sessions > 0
                        ? totals.pageViews / totals.sessions
                        : 0;
                    return (
                      <tr className="usage-totals-row">
                        <td>
                          <span className="table-primary">
                            <strong>Total</strong>
                            <span>across all rows</span>
                          </span>
                        </td>
                        <td>
                          <strong>{formatNumber(totals.activeUsers)}</strong>
                        </td>
                        <td>
                          <strong>{formatNumber(totals.sessions)}</strong>
                        </td>
                        <td>
                          <strong>{formatNumber(totals.pageViews)}</strong>
                        </td>
                        <td>
                          <strong>{pagesPerSession.toFixed(1)}</strong>
                        </td>
                        <td>
                          <strong>{formatNumber(totals.diagnosesMade)}</strong>
                        </td>
                        <td>
                          <strong>{formatNumber(totals.events)}</strong>
                        </td>
                      </tr>
                    );
                  })()}
                  {usage.rows.map((row) => (
                    <tr key={row.bucket}>
                      <td>
                        <span className="table-primary">
                          <strong>{row.bucketLabel}</strong>
                          <span>{row.bucket}</span>
                        </span>
                      </td>
                      <td>{formatNumber(row.activeUsers)}</td>
                      <td>{formatNumber(row.sessions)}</td>
                      <td>{formatNumber(row.pageViews)}</td>
                      <td>{row.pagesPerSession.toFixed(1)}</td>
                      <td>{formatNumber(row.diagnosesMade)}</td>
                      <td>{formatNumber(row.events)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </article>

      <section className="panel exclusion-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Internal-test exclusions</p>
            <h2>What&apos;s filtered out of these numbers</h2>
          </div>
          <span className="badge">
            {internalTestWorkshops.length} workshops ·{" "}
            {internalTestUsers.length} users
          </span>
        </div>
        <p className="panel-description">
          <strong>Diagnoses made</strong> excludes internal/test users (manual
          list + anyone signed up with an <code>@wrenchlane.com</code> email,
          auto-flagged at every core_app sync) and every user inside an
          internal/test workshop. <strong>GA4 unique users, sessions, page
          views, pages/session, and events</strong> still include internal
          traffic — GA4 has no way to map its pseudonymous counters back to
          the internal-test list because the product app does not send a
          user_id (or an <code>is_internal_test</code> user_property) to
          GA4/Firebase. Once the app starts emitting either, we can add a
          GA4 <code>dimensionFilter</code> here. Manage the list at{" "}
          <a href="/ceo/settings">/ceo/settings</a>.
        </p>
        <details className="exclusion-details">
          <summary>Show excluded workshops and users</summary>
          <div className="exclusion-grid">
            <div className="exclusion-column">
              <h3>Workshops</h3>
              <ul className="exclusion-list">
                {internalTestWorkshops.map((workshop) => (
                  <li key={workshop.workshopId}>
                    <strong>{workshop.name ?? workshop.workshopId}</strong>
                    {workshop.internalTestNote ? (
                      <span className="exclusion-meta">
                        {workshop.internalTestNote}
                      </span>
                    ) : null}
                    <code>{workshop.workshopId}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div className="exclusion-column">
              <h3>Users</h3>
              <ul className="exclusion-list">
                {internalTestUsers
                  .filter((user) => user.isInternalTest)
                  .map((user) => (
                    <li key={user.internalUserId}>
                      <strong>
                        {user.internalTestNote ?? user.internalUserId}
                      </strong>
                      <code>{user.internalUserId}</code>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
