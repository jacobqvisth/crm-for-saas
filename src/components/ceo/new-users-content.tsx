import type { CSSProperties } from "react";
import { granularityColumnHeader, granularityNoun } from "@/lib/ceo/data/app-usage";
import type { NewUsersData } from "@/lib/ceo/data/new-users";
import { formatNumber } from "@/lib/ceo/format";
import { InfoHint, type SourceInfo } from "./source-info";

type NewUsersContentProps = {
  data: NewUsersData;
};

const COLUMN_INFO: Record<string, SourceInfo> = {
  iosDownloads: {
    title: "iOS downloads",
    body:
      "Daily installs of the WrenchLane iOS app from Apple's Platform App Installs report (sum across territories, install types, and source types). Apple's modern analytics no longer exposes a separate App Store Downloads report for this app — installs is the canonical equivalent and counts first-time downloads, redownloads on new devices, and auto-downloads.",
    fields: [
      "app_store_installations (App Store Connect, Platform App Installs)",
    ],
  },
  androidDownloads: {
    title: "Android downloads",
    body:
      "Daily count of first opens of the WrenchLane Android app, sourced from GA4's eventCount filtered to (streamName = WrenchLane - Android, eventName = first_open). This is a close proxy for Play Store installs (server-side install counts that haven't yet launched the app are excluded). The Play Console API is not used.",
    fields: [
      "eventCount where eventName = first_open (GA4 / Firebase, streamName = WrenchLane - Android)",
    ],
  },
  webFirstVisits: {
    title: "Web first visits",
    body:
      "Daily count of anonymous first-time visits on app.wrenchlane.com, sourced from GA4's eventCount filtered to (streamName = Website and web app, hostName = app.wrenchlane.com, eventName = first_visit). Symmetric to iOS / Android downloads: top-of-funnel discovery, NOT sign-ups. Most visitors land on the login page and leave without creating an account, so this number is normally larger than Sign-ups — the gap is the bounce. The streamName filter excludes Capacitor in-app webviews on iOS / Android even when they hit app.wrenchlane.com; the hostName filter excludes the marketing site (wrenchlane.com). Caveat: GA4 keys first_visit by browser cookie, so cookie-clearing or device-switching inflates this slightly.",
    fields: [
      "eventCount where streamName = Website and web app, hostName = app.wrenchlane.com, eventName = first_visit (GA4)",
    ],
  },
  signUps: {
    title: "New sign-ups",
    body:
      "Users bucketed by dashboard_users.signed_up_at — a canonical timestamp populated by the core_app sync writer using an explicit fallback chain: (1) user_created_at from the S3 user_stats export; (2) legacy created_at on the same row; (3) the user's workshop_created_at (catches owners whose user-level timestamp lands NULL but whose workshop did get a creation timestamp); (4) Customer.io profile created_at; (5) Stripe customer created. Whichever fires is stamped on metadata.signed_up_at_source. A daily 08:00 UTC health check alerts if any user lands without ANY signal in the last 24h.",
    fields: [
      "dashboard_users.signed_up_at (canonical, single read)",
      "metadata.signed_up_at_source = core_app_user | core_app_workshop | customer_io | stripe",
    ],
  },
  activated: {
    title: "Activated",
    body:
      "Of the users who signed up in this bucket, how many have ever made a first diagnosis. Cohort metric — recent buckets will keep growing as users activate over time.",
    fields: [
      "Users with signup date in bucket AND MIN(dashboard_diagnostics.created_at) is not null",
    ],
  },
  avgDaysToActivate: {
    title: "Avg days to activate",
    body:
      "For activated users in this signup-month cohort, the average days between their signup and their first diagnosis. Recent cohorts skew low because slow activators haven't shown up yet.",
    fields: [
      "(first_diagnosis.created_at - signup_at) / 86400, averaged across activated users in the cohort",
    ],
  },
};

function formatAvgDays(value: number | null): string {
  if (value === null) return "—";
  if (value < 1) {
    const hours = Math.round(value * 24);
    return `${hours}h`;
  }
  return `${value.toFixed(1)}d`;
}

function NewUsersDiagram({ rows }: { rows: NewUsersData["rows"] }) {
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => [row.signUps, row.activated]),
  );

  return (
    <div className="app-usage-diagram" aria-label="New users diagram">
      <div className="diagram-legend">
        <span>
          <i className="legend-users" />
          Sign-ups
        </span>
        <span>
          <i className="legend-diagnoses" />
          Activated
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
                    "--bar-height": `${Math.max(3, (row.signUps / maxValue) * 100)}%`,
                  } as CSSProperties
                }
              >
                <small>{formatNumber(row.signUps)}</small>
              </span>
              <span
                className="diagram-bar diagnoses"
                style={
                  {
                    "--bar-height": `${Math.max(
                      3,
                      (row.activated / maxValue) * 100,
                    )}%`,
                  } as CSSProperties
                }
              >
                <small>{formatNumber(row.activated)}</small>
              </span>
            </div>
            <span className="diagram-label">{row.bucketShortLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NewUsersContent({ data }: NewUsersContentProps) {
  const noun = granularityNoun(data.granularity);
  const columnHeader = granularityColumnHeader(data.granularity);

  if (data.error) {
    return (
      <article className="panel panel-wide">
        <div className="empty-state">
          <strong>New users data could not load</strong>
          <p>{data.error}</p>
        </div>
      </article>
    );
  }

  if (data.rows.length === 0) {
    return (
      <article className="panel panel-wide">
        <div className="empty-state">
          <strong>No data in this range</strong>
          <p>No sign-ups, first diagnoses, or downloads recorded for the selected range.</p>
        </div>
      </article>
    );
  }

  const totals = data.rows.reduce(
    (acc, row) => ({
      iosDownloads: acc.iosDownloads + row.iosDownloads,
      androidDownloads:
        row.androidDownloads !== null
          ? (acc.androidDownloads ?? 0) + row.androidDownloads
          : acc.androidDownloads,
      webFirstVisits:
        row.webFirstVisits !== null
          ? (acc.webFirstVisits ?? 0) + row.webFirstVisits
          : acc.webFirstVisits,
      signUps: acc.signUps + row.signUps,
      activated: acc.activated + row.activated,
      daysSum:
        acc.daysSum +
        (row.avgDaysToActivate !== null
          ? row.avgDaysToActivate * row.activated
          : 0),
      daysCount:
        acc.daysCount +
        (row.avgDaysToActivate !== null ? row.activated : 0),
    }),
    {
      iosDownloads: 0,
      androidDownloads: null as number | null,
      webFirstVisits: null as number | null,
      signUps: 0,
      activated: 0,
      daysSum: 0,
      daysCount: 0,
    },
  );
  const totalAvgDays =
    totals.daysCount > 0 ? totals.daysSum / totals.daysCount : null;

  const coveragePct =
    data.signUpCoverage.totalUsers > 0
      ? Math.round(
          ((data.signUpCoverage.totalUsers - data.signUpCoverage.missing) /
            data.signUpCoverage.totalUsers) *
            100,
        )
      : 0;

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h2>
              <span className="heading-with-info">
                Sign-ups and activation by {noun}
                <InfoHint
                  info={{
                    title: "New users overview",
                    body:
                      "Funnel from app discovery to first activation, bucketed by signup month (cohort view). Activated and avg days to activate are computed for the cohort that signed up in each row, not for diagnoses that happened in the row.",
                    fields: [
                      "iOS downloads (App Store Connect, Platform App Installs)",
                      "Android downloads (GA4 first_open events, Android stream)",
                      "Sign-ups (fallback chain — see column tooltip)",
                      "Activated: cohort members with any first diagnosis",
                      "Avg days to activate: signup to first diagnosis, averaged across activated cohort members",
                    ],
                  }}
                />
              </span>
            </h2>
            <p className="panel-description" style={{ marginTop: 4 }}>
              Sign-up date coverage: {coveragePct}% of users (
              {data.signUpCoverage.fromCoreAppUser} from core_app,{" "}
              {data.signUpCoverage.fromCoreAppWorkshop} from workshop fallback,{" "}
              {data.signUpCoverage.fromCustomerIo} from Customer.io,{" "}
              {data.signUpCoverage.fromStripe} from Stripe;{" "}
              {data.signUpCoverage.missing} users have no sign-up date and
              don&apos;t appear in the Sign-ups column).
            </p>
          </div>
        </div>

        <NewUsersDiagram rows={data.rows} />

        <div className="table-wrap">
          <table className="data-table app-usage-table">
            <thead>
              <tr>
                <th>{columnHeader}</th>
                <th>
                  <span className="table-heading-info">
                    iOS downloads
                    <InfoHint info={COLUMN_INFO.iosDownloads} />
                  </span>
                </th>
                <th>
                  <span className="table-heading-info">
                    Android downloads
                    <InfoHint info={COLUMN_INFO.androidDownloads} />
                  </span>
                </th>
                <th>
                  <span className="table-heading-info">
                    Web first visits
                    <InfoHint info={COLUMN_INFO.webFirstVisits} />
                  </span>
                </th>
                <th>
                  <span className="table-heading-info">
                    Sign-ups
                    <InfoHint info={COLUMN_INFO.signUps} />
                  </span>
                </th>
                <th>
                  <span className="table-heading-info">
                    Activated
                    <InfoHint info={COLUMN_INFO.activated} />
                  </span>
                </th>
                <th>
                  <span className="table-heading-info">
                    Avg days to activate
                    <InfoHint info={COLUMN_INFO.avgDaysToActivate} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="usage-totals-row">
                <td>
                  <span className="table-primary">
                    <strong>Total</strong>
                    <span>across all rows</span>
                  </span>
                </td>
                <td>
                  <strong>{formatNumber(totals.iosDownloads)}</strong>
                </td>
                <td>
                  <strong>
                    {totals.androidDownloads === null
                      ? "—"
                      : formatNumber(totals.androidDownloads)}
                  </strong>
                </td>
                <td>
                  <strong>
                    {totals.webFirstVisits === null
                      ? "—"
                      : formatNumber(totals.webFirstVisits)}
                  </strong>
                </td>
                <td>
                  <strong>{formatNumber(totals.signUps)}</strong>
                </td>
                <td>
                  <strong>{formatNumber(totals.activated)}</strong>
                </td>
                <td>
                  <strong>{formatAvgDays(totalAvgDays)}</strong>
                </td>
              </tr>
              {data.rows.map((row) => (
                <tr key={row.bucket}>
                  <td>
                    <span className="table-primary">
                      <strong>{row.bucketLabel}</strong>
                      <span>{row.bucket}</span>
                    </span>
                  </td>
                  <td>{formatNumber(row.iosDownloads)}</td>
                  <td>
                    {row.androidDownloads === null
                      ? "—"
                      : formatNumber(row.androidDownloads)}
                  </td>
                  <td>
                    {row.webFirstVisits === null
                      ? "—"
                      : formatNumber(row.webFirstVisits)}
                  </td>
                  <td>{formatNumber(row.signUps)}</td>
                  <td>{formatNumber(row.activated)}</td>
                  <td>{formatAvgDays(row.avgDaysToActivate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
