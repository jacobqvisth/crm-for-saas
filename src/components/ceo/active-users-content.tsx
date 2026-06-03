import { formatNumber } from "@/lib/ceo/format";
import type { ActiveUsersData } from "@/lib/ceo/data/active-users";
import { InfoHint } from "./source-info";

type ActiveUsersContentProps = {
  data: ActiveUsersData;
};

const STOCKHOLM_DATETIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  dateStyle: "short",
  timeStyle: "short",
});

const STOCKHOLM_DATE = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  dateStyle: "short",
});

function formatLastActive(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return STOCKHOLM_DATETIME.format(date);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return STOCKHOLM_DATE.format(date);
}

// Engagement time comes from GA4 in seconds. Show compact: "—", "47s", "12m",
// "1h 03m".
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatMaybeNumber(value: number | null): string {
  return value == null ? "—" : formatNumber(value);
}

function userLabel(row: ActiveUsersData["rows"][number]): {
  primary: string;
  secondary: string;
} {
  if (row.name) {
    return { primary: row.name, secondary: row.email ?? row.crmUserId };
  }
  if (row.email) {
    return { primary: row.email, secondary: row.crmUserId };
  }
  // Unmatched app user (in GA4 / diagnostics but not yet a CRM contact).
  return {
    primary: `${row.crmUserId.slice(0, 8)}…`,
    secondary: "Not in CRM yet",
  };
}

const NUM = { textAlign: "right" as const };

export function ActiveUsersContent({ data }: ActiveUsersContentProps) {
  const { totals, rows } = data;

  return (
    <div className="section-stack">
      <section className="kpi-grid">
        <article className="kpi-card tone-growth">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Active users</span>
              <InfoHint
                info={{
                  title: "Active users",
                  body: "Distinct people who were identified (logged in) on app.wrenchlane.com OR ran a diagnostic in this range. Keyed on the Cognito sub (crm_user_id = contacts.wl_user_id). Internal-test accounts are excluded.",
                  sources: [
                    "GA4 customUser:crm_user_id (hostName = app.wrenchlane.com)",
                    "dashboard_diagnostics.internal_user_id",
                  ],
                }}
              />
            </p>
            <strong>{formatNumber(totals.activeUsers)}</strong>
          </div>
          <span className="metric-icon">AU</span>
          <span className="kpi-card-hint">{data.rangeSpan}</span>
        </article>

        <article className="kpi-card tone-product">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Sessions</span>
            </p>
            <strong>{formatNumber(totals.sessions)}</strong>
          </div>
          <span className="metric-icon">∑</span>
          <span className="kpi-card-hint">on app.wrenchlane.com</span>
        </article>

        <article className="kpi-card tone-neutral">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Events</span>
              <InfoHint
                info={{
                  title: "Events",
                  body: "Total GA4 events fired by identified users on the web app — page views, session starts, CTA clicks, user_identified, etc.",
                }}
              />
            </p>
            <strong>{formatNumber(totals.events)}</strong>
          </div>
          <span className="metric-icon">EV</span>
          <span className="kpi-card-hint">
            {formatNumber(totals.pageViews)} page views
          </span>
        </article>

        <article className="kpi-card tone-neutral">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Engaged time</span>
              <InfoHint
                info={{
                  title: "Engaged time",
                  body: "Total GA4 user-engagement duration across these users on the web app — time the app was in focus and active. Summed across the range.",
                }}
              />
            </p>
            <strong>{formatDuration(totals.engagedSeconds)}</strong>
          </div>
          <span className="metric-icon">⏱</span>
          <span className="kpi-card-hint">active in-app time</span>
        </article>

        <article className="kpi-card tone-revenue">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Diagnostics run</span>
              <InfoHint
                info={{
                  title: "Diagnostics run",
                  body: "First-party diagnostic records created in this range, from dashboard_diagnostics. This is real product activity, independent of GA4.",
                  sources: ["dashboard_diagnostics"],
                }}
              />
            </p>
            <strong>{formatNumber(totals.diagnostics)}</strong>
          </div>
          <span className="metric-icon">DG</span>
          <span className="kpi-card-hint">by these users</span>
        </article>
      </section>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Logged-in users · {data.rangeLabel}</p>
            <h2>Who was active and what they did</h2>
          </div>
          <span className="badge">{formatNumber(rows.length)} users</span>
        </div>
        <p className="panel-description">
          Each row is one identified app user. Engagement columns come from GA4
          (web app only); diagnostics and account fields come from the CRM /
          first-party data. Sorted by event volume. Scroll sideways to see all
          columns — the user column stays pinned.
        </p>

        {data.note ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {data.note}
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="empty-state">
            <strong>No active users in this range</strong>
            <p>
              No identified activity on app.wrenchlane.com and no diagnostics
              were recorded for {data.rangeSpan}. Note that crm_user_id only
              started populating on 2026-05-25.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table active-users-table">
              <thead>
                <tr>
                  <th className="col-user">User</th>
                  <th>Company</th>
                  <th>Plan</th>
                  <th>Subscription</th>
                  <th>Lifecycle</th>
                  <th>Role</th>
                  <th>CRM status</th>
                  <th>Location</th>
                  <th style={NUM}>Sessions</th>
                  <th style={NUM}>Page views</th>
                  <th style={NUM}>Events</th>
                  <th style={NUM}>Engaged</th>
                  <th style={NUM}>Diag. (range)</th>
                  <th style={NUM}>Diag. (lifetime)</th>
                  <th style={NUM}>Logins</th>
                  <th style={NUM}>Credits</th>
                  <th className="col-actions">Top actions</th>
                  <th>Signed up</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const label = userLabel(row);
                  return (
                    <tr key={row.crmUserId}>
                      <td className="col-user">
                        <span className="table-primary">
                          <strong>{label.primary}</strong>
                          <span>{label.secondary}</span>
                        </span>
                      </td>
                      <td>{row.company ?? "—"}</td>
                      <td>{row.plan ?? "—"}</td>
                      <td>{row.subscriptionStatus ?? "—"}</td>
                      <td>{row.lifecycleStage ?? "—"}</td>
                      <td>{row.appRole ?? "—"}</td>
                      <td>{row.leadStatus ?? "—"}</td>
                      <td>{row.location ?? "—"}</td>
                      <td style={NUM}>{formatNumber(row.sessions)}</td>
                      <td style={NUM}>{formatNumber(row.pageViews)}</td>
                      <td style={NUM}>{formatNumber(row.events)}</td>
                      <td style={NUM}>{formatDuration(row.engagedSeconds)}</td>
                      <td style={NUM}>{formatNumber(row.diagnostics)}</td>
                      <td style={NUM}>
                        {formatMaybeNumber(row.diagnosticsLifetime)}
                      </td>
                      <td style={NUM}>{formatMaybeNumber(row.loginCount)}</td>
                      <td style={NUM}>
                        {formatMaybeNumber(row.creditsRemaining)}
                      </td>
                      <td className="col-actions">
                        {row.topActions.length === 0
                          ? "—"
                          : row.topActions
                              .map(
                                (a) => `${a.event} ${formatNumber(a.count)}`,
                              )
                              .join(" · ")}
                      </td>
                      <td>{formatDate(row.signedUpAt)}</td>
                      <td>{formatLastActive(row.lastActiveAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}
