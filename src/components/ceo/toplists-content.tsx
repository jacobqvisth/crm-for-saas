"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatNumber, formatPercent } from "@/lib/ceo/format";
import type {
  ToplistsData,
  TopUserRow,
  TopCarRow,
} from "@/lib/ceo/data/toplists";
import type {
  InternalTestUserRecord,
  InternalTestWorkshopRecord,
} from "@/lib/ceo/internal-test/loader";
import { InternalTestExclusionsPanel } from "./internal-test-exclusions";

type ToplistsContentProps = {
  data: ToplistsData;
  internalTestUsers: InternalTestUserRecord[];
  internalTestWorkshops: InternalTestWorkshopRecord[];
};

// Top Lists keys every figure on crm_user_id / workshop_id, so internal
// accounts are removed from BOTH leaderboards — including the GA4 engagement
// columns (unlike the aggregate Usage page, which can't map GA4's pseudonymous
// counters back to the list).
const TOPLISTS_EXCLUSION_DESCRIPTION = (
  <>
    Both leaderboards exclude internal/test users (manual list + anyone signed
    up with an <code>@wrenchlane.com</code> email, auto-flagged at every
    core_app sync) and every user inside an internal/test workshop.{" "}
    <strong>Top users</strong> is keyed on <code>crm_user_id</code>, so internal
    accounts are dropped from the GA4 engagement columns (events, sessions, page
    views, engaged time) too — not just diagnoses. <strong>Top cars</strong>{" "}
    excludes any diagnosis from an internal user or workshop. Manage the list at{" "}
    <a href="/dashboard/settings">/dashboard/settings</a>.
  </>
);

type SortDir = "asc" | "desc";

const NUM = { textAlign: "right" as const };

const MEDALS = ["🥇", "🥈", "🥉"];

function rankBadge(index: number): string {
  return MEDALS[index] ?? `${index + 1}`;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function userLabel(row: TopUserRow): { primary: string; secondary: string } {
  if (row.name) return { primary: row.name, secondary: row.email ?? row.crmUserId };
  if (row.email) return { primary: row.email, secondary: row.crmUserId };
  // No CRM contact, but the sub exists in dashboard_users — show the app
  // username + role instead of a bare hex id (e.g. a workshop sub-user).
  if (row.identitySource === "app") {
    return {
      primary: row.appUsername ?? `${row.crmUserId.slice(0, 8)}…`,
      secondary: row.appRole ? `App user · ${row.appRole}` : "App user",
    };
  }
  return {
    primary: `${row.crmUserId.slice(0, 8)}…`,
    secondary: "Not in CRM yet",
  };
}

// Company/workshop cell, linked to the CEO workshop detail page when known.
function CompanyCell({ row }: { row: TopUserRow }) {
  if (!row.company) return <>—</>;
  if (!row.workshopId) return <>{row.company}</>;
  return (
    <Link href={`/dashboard/workshops/${row.workshopId}`}>{row.company}</Link>
  );
}

// A sortable numeric column header. Clicking re-sorts; clicking the active
// column flips direction.
function SortHeader<TKey extends string>({
  label,
  columnKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  columnKey: TKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: TKey) => void;
}) {
  return (
    <th
      style={NUM}
      aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`toplist-sort${active ? " is-active" : ""}`}
      >
        {label}
        <span className="toplist-sort-caret">
          {active ? (dir === "desc" ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
}

function useSortable<T, TKey extends string>(
  rows: T[],
  getters: Record<TKey, (row: T) => number>,
  initialKey: TKey,
) {
  const [sortKey, setSortKey] = useState<TKey>(initialKey);
  const [dir, setDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const get = getters[sortKey];
    const copy = [...rows];
    copy.sort((a, b) => {
      const diff = get(a) - get(b);
      return dir === "desc" ? -diff : diff;
    });
    return copy;
  }, [rows, getters, sortKey, dir]);

  function onSort(key: TKey) {
    if (key === sortKey) {
      setDir((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setDir("desc");
    }
  }

  return { sorted, sortKey, dir, onSort };
}

type UserSortKey =
  | "diagnostics"
  | "events"
  | "sessions"
  | "pageViews"
  | "engagedSeconds";

const USER_GETTERS: Record<UserSortKey, (row: TopUserRow) => number> = {
  diagnostics: (r) => r.diagnostics,
  events: (r) => r.events,
  sessions: (r) => r.sessions,
  pageViews: (r) => r.pageViews,
  engagedSeconds: (r) => r.engagedSeconds,
};

function TopUsersTable({ rows }: { rows: TopUserRow[] }) {
  const { sorted, sortKey, dir, onSort } = useSortable<TopUserRow, UserSortKey>(
    rows,
    USER_GETTERS,
    "diagnostics",
  );

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <strong>No user activity in this range</strong>
        <p>
          No identified activity on app.wrenchlane.com and no diagnostics were
          recorded. Note that crm_user_id only started populating on 2026-05-25.
        </p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "3rem" }}>#</th>
            <th className="col-user">User</th>
            <th>Company</th>
            <SortHeader label="Diagnoses" columnKey="diagnostics" active={sortKey === "diagnostics"} dir={dir} onSort={onSort} />
            <SortHeader label="GA4 events" columnKey="events" active={sortKey === "events"} dir={dir} onSort={onSort} />
            <SortHeader label="Sessions" columnKey="sessions" active={sortKey === "sessions"} dir={dir} onSort={onSort} />
            <SortHeader label="Page views" columnKey="pageViews" active={sortKey === "pageViews"} dir={dir} onSort={onSort} />
            <SortHeader label="Engaged" columnKey="engagedSeconds" active={sortKey === "engagedSeconds"} dir={dir} onSort={onSort} />
            <th className="col-actions">Top actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => {
            const label = userLabel(row);
            return (
              <tr key={row.crmUserId}>
                <td className="toplist-rank">{rankBadge(index)}</td>
                <td className="col-user">
                  <span className="table-primary">
                    <strong>{label.primary}</strong>
                    <span>{label.secondary}</span>
                  </span>
                </td>
                <td>
                  <CompanyCell row={row} />
                </td>
                <td style={NUM}>{formatNumber(row.diagnostics)}</td>
                <td style={NUM}>{formatNumber(row.events)}</td>
                <td style={NUM}>{formatNumber(row.sessions)}</td>
                <td style={NUM}>{formatNumber(row.pageViews)}</td>
                <td style={NUM}>{formatDuration(row.engagedSeconds)}</td>
                <td className="col-actions">
                  {row.topActions.length === 0
                    ? "—"
                    : row.topActions
                        .map((a) => `${a.event} ${formatNumber(a.count)}`)
                        .join(" · ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type CarSortKey =
  | "diagnostics"
  | "distinctUsers"
  | "distinctWorkshops"
  | "completionRate"
  | "avgCauses";

const CAR_GETTERS: Record<CarSortKey, (row: TopCarRow) => number> = {
  diagnostics: (r) => r.diagnostics,
  distinctUsers: (r) => r.distinctUsers,
  distinctWorkshops: (r) => r.distinctWorkshops,
  completionRate: (r) => r.completionRate,
  avgCauses: (r) => r.avgCauses,
};

function TopCarsTable({ rows }: { rows: TopCarRow[] }) {
  const { sorted, sortKey, dir, onSort } = useSortable<TopCarRow, CarSortKey>(
    rows,
    CAR_GETTERS,
    "diagnostics",
  );

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <strong>No car data in this range</strong>
        <p>
          No diagnostics with a recorded make/model were found for this window.
        </p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "3rem" }}>#</th>
            <th>Car</th>
            <th>Year</th>
            <SortHeader label="Diagnoses" columnKey="diagnostics" active={sortKey === "diagnostics"} dir={dir} onSort={onSort} />
            <SortHeader label="Users" columnKey="distinctUsers" active={sortKey === "distinctUsers"} dir={dir} onSort={onSort} />
            <SortHeader label="Workshops" columnKey="distinctWorkshops" active={sortKey === "distinctWorkshops"} dir={dir} onSort={onSort} />
            <SortHeader label="Completion" columnKey="completionRate" active={sortKey === "completionRate"} dir={dir} onSort={onSort} />
            <SortHeader label="Avg causes" columnKey="avgCauses" active={sortKey === "avgCauses"} dir={dir} onSort={onSort} />
            <th>Top DTCs</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={row.key}>
              <td className="toplist-rank">{rankBadge(index)}</td>
              <td>
                <span className="table-primary">
                  <strong>{row.label}</strong>
                  {row.model && row.make ? <span>{row.make}</span> : null}
                </span>
              </td>
              <td>
                {row.topYear ?? "—"}
                {row.yearSpan ? (
                  <span className="toplist-subtle"> ({row.yearSpan})</span>
                ) : null}
              </td>
              <td style={NUM}>{formatNumber(row.diagnostics)}</td>
              <td style={NUM}>{formatNumber(row.distinctUsers)}</td>
              <td style={NUM}>{formatNumber(row.distinctWorkshops)}</td>
              <td style={NUM}>{formatPercent(row.completionRate)}</td>
              <td style={NUM}>{row.avgCauses.toFixed(1)}</td>
              <td>
                {row.topDtcs.length === 0
                  ? "—"
                  : row.topDtcs
                      .map((d) => `${d.code} ${formatNumber(d.count)}`)
                      .join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ToplistsContent({
  data,
  internalTestUsers,
  internalTestWorkshops,
}: ToplistsContentProps) {
  const { totals, topUsers, topCars } = data;
  const topUser = topUsers[0];
  const topCar = topCars[0];

  return (
    <div className="section-stack">
      <section className="kpi-grid">
        <article className="kpi-card tone-growth">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Active users</span>
            </p>
            <strong>{formatNumber(totals.activeUsers)}</strong>
          </div>
          <span className="metric-icon">AU</span>
          <span className="kpi-card-hint">{data.rangeSpan}</span>
        </article>

        <article className="kpi-card tone-revenue">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Diagnostics run</span>
            </p>
            <strong>{formatNumber(totals.diagnostics)}</strong>
          </div>
          <span className="metric-icon">DG</span>
          <span className="kpi-card-hint">by these users</span>
        </article>

        <article className="kpi-card tone-product">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Distinct cars</span>
            </p>
            <strong>{formatNumber(totals.distinctCars)}</strong>
          </div>
          <span className="metric-icon">CR</span>
          <span className="kpi-card-hint">make + model diagnosed</span>
        </article>

        <article className="kpi-card tone-neutral">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Top user</span>
            </p>
            <strong>
              {topUser
                ? userLabel(topUser).primary
                : "—"}
            </strong>
          </div>
          <span className="metric-icon">🥇</span>
          <span className="kpi-card-hint">
            {topUser
              ? `${formatNumber(topUser.diagnostics)} diagnoses · ${formatNumber(topUser.events)} events`
              : "no activity yet"}
          </span>
        </article>

        <article className="kpi-card tone-neutral">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Top car</span>
            </p>
            <strong>{topCar ? topCar.label : "—"}</strong>
          </div>
          <span className="metric-icon">🚗</span>
          <span className="kpi-card-hint">
            {topCar
              ? `${formatNumber(topCar.diagnostics)} diagnoses`
              : "no car data yet"}
          </span>
        </article>
      </section>

      {data.note ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {data.note}
        </div>
      ) : null}

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Leaderboard · {data.rangeLabel}</p>
            <h2>Top users by activity</h2>
          </div>
          <span className="badge">{formatNumber(topUsers.length)} users</span>
        </div>
        <p className="panel-description">
          The most active logged-in users on app.wrenchlane.com. Diagnoses come
          from first-party data; GA4 events, sessions, page views, and engaged
          time come from GA4 (web app only). &ldquo;Top actions&rdquo; shows each
          user&apos;s most-fired event types — that&apos;s where car selects,
          button clicks, and other interactions surface. Click any numeric
          column to re-sort and re-rank. Default: most diagnoses.
        </p>
        <TopUsersTable rows={topUsers} />
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Leaderboard · {data.rangeLabel}</p>
            <h2>Top cars by diagnoses</h2>
          </div>
          <span className="badge">{formatNumber(topCars.length)} cars</span>
        </div>
        <p className="panel-description">
          The make/model combinations diagnosed most often, with distinct users
          and workshops, completion rate, average AI causes per diagnosis, and
          the most common fault codes. Cars are identified from
          dashboard_diagnostics metadata — GA4 events carry no vehicle
          dimension, so per-car click counts aren&apos;t available. Click any
          numeric column to re-sort. Default: most diagnoses.
        </p>
        <TopCarsTable rows={topCars} />
      </article>

      <InternalTestExclusionsPanel
        users={internalTestUsers}
        workshops={internalTestWorkshops}
        description={TOPLISTS_EXCLUSION_DESCRIPTION}
      />
    </div>
  );
}
