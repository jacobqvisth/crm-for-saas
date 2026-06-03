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

// Per-column "where it comes from / how it's calculated" copy for the header
// info hints. Source-of-truth lives here so the table headers stay terse.
const COLUMN_INFO = {
  user: {
    title: "User",
    body: "The identified app user. Name + email come from the matching CRM contact (joined on contacts.wl_user_id = the Cognito sub). Users seen in GA4 / diagnostics but not yet in the CRM show a shortened crm_user_id and 'Not in CRM yet'.",
    sources: ["contacts.first_name / last_name / email / wl_user_id"],
  },
  company: {
    title: "Company",
    body: "The workshop this contact belongs to. From the company linked via contacts.company_id → companies.name.",
    sources: ["companies.name"],
  },
  plan: {
    title: "Plan",
    body: "The workshop's plan. Uses the company's plan; if the contact has no company, falls back to the per-user plan type.",
    sources: ["companies.plan", "contacts.user_plan_type"],
  },
  subscription: {
    title: "Subscription",
    body: "Billing/subscription state. Uses the contact's user_subscription_status; falls back to the company's customer_status when absent.",
    sources: ["contacts.user_subscription_status", "companies.customer_status"],
  },
  lifecycle: {
    title: "Lifecycle",
    body: "Sales/CS funnel stage of the workshop (lead, mql, sql, trial, paying, churned, reactivation).",
    sources: ["companies.lifecycle_stage"],
  },
  role: {
    title: "Role",
    body: "The user's role inside their workshop in the app — admin or mechanic.",
    sources: ["contacts.app_role"],
  },
  crmStatus: {
    title: "CRM status",
    body: "The contact's lead status in the CRM (new, contacted, engaged, qualified, customer, unqualified, churned). This is the sales-pipeline status, distinct from the billing Subscription column.",
    sources: ["contacts.lead_status"],
  },
  location: {
    title: "Location",
    body: "City and country stored on the CRM contact. May be empty for app users we haven't enriched. This is CRM-entered, not GA4 geo-IP.",
    sources: ["contacts.city", "contacts.country"],
  },
  sessions: {
    title: "Sessions",
    body: "GA4 sessions this user had on the web app in the selected range. A session is a period of activity; GA4 starts a new one after 30 min idle or at midnight.",
    sources: [
      "GA4 metric: sessions",
      "customUser:crm_user_id, hostName = app.wrenchlane.com",
    ],
  },
  pageViews: {
    title: "Page views",
    body: "GA4 screen/page views (screenPageViews) by this user on the web app in range. Counts repeat views.",
    sources: ["GA4 metric: screenPageViews", "hostName = app.wrenchlane.com"],
  },
  events: {
    title: "Events",
    body: "Total GA4 events fired by this user on the web app in range — every page_view, session_start, cta_click, scroll, user_identified, etc. counts as one event. The table is sorted by this.",
    sources: ["GA4 metric: eventCount", "hostName = app.wrenchlane.com"],
  },
  engaged: {
    title: "Engaged time",
    body: "GA4 user-engagement duration on the web app in range — cumulative time the app tab was focused and active for this user. Shown as s / m / h. Not wall-clock time on the page.",
    sources: ["GA4 metric: userEngagementDuration"],
  },
  diagRange: {
    title: "Diagnostics (range)",
    body: "Count of first-party diagnostic records this user created during the selected range. Keyed on dashboard_diagnostics.internal_user_id = the same Cognito sub. Independent of GA4.",
    sources: ["dashboard_diagnostics (created_at in range)"],
  },
  diagLifetime: {
    title: "Diagnostics (lifetime)",
    body: "All-time diagnostics total for this user, precomputed on the CRM contact — not limited to the selected range. '—' means the field isn't populated for this contact.",
    sources: ["contacts.diagnostics_total"],
  },
  logins: {
    title: "Logins",
    body: "Lifetime login count stored on the CRM contact (cumulative, not range-scoped). '—' if not tracked for this user.",
    sources: ["contacts.login_count"],
  },
  credits: {
    title: "Credits",
    body: "Diagnostic credits remaining on the user's account, as last synced to the CRM contact. '—' if not set.",
    sources: ["contacts.credits_remaining"],
  },
  topActions: {
    title: "Top actions",
    body: "This user's most frequent GA4 event types in range, each with its count, highest first (up to 5). Built from a per-user × eventName GA4 query on the web app. Shows what they actually did — e.g. cta_click, page_view, scroll_depth, form_submit.",
    sources: ["GA4: customUser:crm_user_id × eventName, metric eventCount"],
  },
  signedUp: {
    title: "Signed up",
    body: "When this contact record was created in the CRM — a proxy for account signup date. Shown in Stockholm time.",
    sources: ["contacts.created_at"],
  },
  lastActive: {
    title: "Last active",
    body: "Most recent activity timestamp recorded on the CRM contact, in Stockholm time. Synced from app activity; may lag the live GA4 numbers in the other columns.",
    sources: ["contacts.last_active_at"],
  },
};

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
                  <th className="col-user">
                    <span className="table-heading-info">
                      User
                      <InfoHint info={COLUMN_INFO.user} />
                    </span>
                  </th>
                  <th>
                    <span className="table-heading-info">
                      Company
                      <InfoHint info={COLUMN_INFO.company} />
                    </span>
                  </th>
                  <th>
                    <span className="table-heading-info">
                      Plan
                      <InfoHint info={COLUMN_INFO.plan} />
                    </span>
                  </th>
                  <th>
                    <span className="table-heading-info">
                      Subscription
                      <InfoHint info={COLUMN_INFO.subscription} />
                    </span>
                  </th>
                  <th>
                    <span className="table-heading-info">
                      Lifecycle
                      <InfoHint info={COLUMN_INFO.lifecycle} />
                    </span>
                  </th>
                  <th>
                    <span className="table-heading-info">
                      Role
                      <InfoHint info={COLUMN_INFO.role} />
                    </span>
                  </th>
                  <th>
                    <span className="table-heading-info">
                      CRM status
                      <InfoHint info={COLUMN_INFO.crmStatus} />
                    </span>
                  </th>
                  <th>
                    <span className="table-heading-info">
                      Location
                      <InfoHint info={COLUMN_INFO.location} />
                    </span>
                  </th>
                  <th style={NUM}>
                    <span className="table-heading-info">
                      Sessions
                      <InfoHint info={COLUMN_INFO.sessions} />
                    </span>
                  </th>
                  <th style={NUM}>
                    <span className="table-heading-info">
                      Page views
                      <InfoHint info={COLUMN_INFO.pageViews} />
                    </span>
                  </th>
                  <th style={NUM}>
                    <span className="table-heading-info">
                      Events
                      <InfoHint info={COLUMN_INFO.events} />
                    </span>
                  </th>
                  <th style={NUM}>
                    <span className="table-heading-info">
                      Engaged
                      <InfoHint info={COLUMN_INFO.engaged} />
                    </span>
                  </th>
                  <th style={NUM}>
                    <span className="table-heading-info">
                      Diag. (range)
                      <InfoHint info={COLUMN_INFO.diagRange} />
                    </span>
                  </th>
                  <th style={NUM}>
                    <span className="table-heading-info">
                      Diag. (lifetime)
                      <InfoHint info={COLUMN_INFO.diagLifetime} />
                    </span>
                  </th>
                  <th style={NUM}>
                    <span className="table-heading-info">
                      Logins
                      <InfoHint info={COLUMN_INFO.logins} />
                    </span>
                  </th>
                  <th style={NUM}>
                    <span className="table-heading-info">
                      Credits
                      <InfoHint info={COLUMN_INFO.credits} />
                    </span>
                  </th>
                  <th className="col-actions">
                    <span className="table-heading-info">
                      Top actions
                      <InfoHint info={COLUMN_INFO.topActions} />
                    </span>
                  </th>
                  <th>
                    <span className="table-heading-info">
                      Signed up
                      <InfoHint info={COLUMN_INFO.signedUp} />
                    </span>
                  </th>
                  <th>
                    <span className="table-heading-info">
                      Last active
                      <InfoHint info={COLUMN_INFO.lastActive} />
                    </span>
                  </th>
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
