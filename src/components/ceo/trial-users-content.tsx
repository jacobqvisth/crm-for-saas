"use client";

import { useMemo, useState } from "react";
import { formatNumber } from "@/lib/ceo/format";
import {
  COHORT_LABELS,
  COHORT_ORDER,
  OUTCOME_LABELS,
  TRIAL_START_SOURCE_LABELS,
  TRIAL_TABS,
  type CohortKey,
  type CohortStats,
  type ConversionCut,
  type LiveTrialRow,
  type TermCount,
  type TrialTab,
  type TrialUserRow,
  type TrialUsersData,
} from "@/lib/ceo/trial-users-shared";
import { InfoHint, type SourceInfo } from "./source-info";

type TrialUsersContentProps = {
  data: TrialUsersData;
  initialTab: TrialTab;
};

const COHORT_COLORS: Record<CohortKey, string> = {
  trial_converted: "#25b3a3",
  trial_expired: "#e0745f",
  trial_live: "#7c5cff",
  never_trialed: "#8b93a7",
};

const TRIAL_INFO: SourceInfo = {
  title: "What counts as a trial, and what a row is",
  body:
    "Every Stripe subscription that ever carried a trial_end: a One, Small or Large plan opened with a card on file and a free window in front of it. A row here is one TRIAL, not one workshop and not one person — a handful of customers trialled twice, so the trial count runs slightly ahead of the workshop count and both are shown.",
  sources: [
    "dashboard_subscriptions (hourly Stripe sync), trial_end / status / metadata",
    "trial_subscriptions() — resolves the trial window and the outcome",
  ],
  logic:
    "Three grains are in play and mixing them produces wrong numbers. CONVERSION is per trial. BEHAVIOUR is per app user, because a diagnosis is run by a person and a workshop can have several techs. OUTREACH is per CRM contact, deduped, so one workshop's shared phone call is not counted once per tech.",
};

const CONVERSION_INFO: SourceInfo = {
  title: "What 'converted' means, and against what denominator",
  body:
    "Converted means money actually moved at least once: dashboard_subscriptions.metadata.ever_paid, set from an invoice with amount_paid above zero. It is never read off plan_key or trial_end, both of which are stamped at CHECKOUT while the trial is still running — that is the standard trap here, and it has previously overstated payers by around half.",
  sources: [
    "metadata.ever_paid / metadata.first_paid_at (money actually moved)",
    "trial_end, status (stamped at checkout, not evidence of payment)",
  ],
  logic:
    "The denominator is CONCLUDED trials only. A trial still inside its window has no outcome yet, and folding it in makes every recent slice look worse purely for being recent. Live trials are shown in their own column throughout.",
};

const WINDOW_INFO: SourceInfo = {
  title: "How the trial window is dated",
  body:
    "Stripe knows exactly when a trial opened, but the warehouse did not store it until the sync change that shipped with this page. Until that sync has run once, a historical trial falls back to the Stripe CUSTOMER creation date when that lands within 40 days of trial_end, and otherwise to the product default of 14 days before it.",
  sources: [
    "metadata.trial_start (exact, written by the Stripe sync)",
    "metadata.customer_created_at (fallback), trial_end minus 14 days (last resort)",
  ],
  logic:
    "The fallback needs the 40-day guard because a Stripe customer is routinely created at an abandoned checkout weeks before any trial opens: 142 of 335 rows had a gap over 40 days, so treating that gap as the trial window would count activity from long before the trial began. Click Update to run the Stripe sync and make every window exact.",
};

const USAGE_INFO: SourceInfo = {
  title: "Why usage is measured inside the window only",
  body:
    "A converted trial has months of paying life behind it, so counting 'diagnoses ever' against conversion measures the subscription rather than the trial. Only activity strictly between the trial opening and closing can say anything about what the trial itself did.",
  sources: [
    "dashboard_diagnostics, joined to the trial window per workshop",
    "dashboard_feature_usage · dashboard_user_logins (active days)",
  ],
  logic:
    "Usage is rolled up across every app user at the workshop, because the trial belongs to the workshop while the diagnoses belong to individual techs. Feature counters only exist from 2026-06-11 onward, so an older workshop's feature total understates its lifetime usage.",
};

const RISK_INFO: SourceInfo = {
  title: "How the rescue ranking is built",
  body:
    "A blunt additive score, not a model: no diagnosis yet adds 40, barely used adds 15, never called or emailed adds 20, three days or fewer left adds 25 (under a week adds 15), and nothing at all in the last seven days adds 15. Capped at 100.",
  sources: ["trial_subscriptions() joined to the per-user activity rollup"],
  logic:
    "It is a queue, not a prediction. The point is that a trial with no usage and no contact and two days left should be at the top of somebody's call list this morning, and the score just puts it there.",
};

const OUTREACH_INFO: SourceInfo = {
  title: "Where the call and email columns come from",
  body:
    "The CRM side: calls placed through the calling pipeline with the rep who placed them, sequence emails actually sent with the sending mailbox, replies landed in the inbox, and logged call activities for the outcome.",
  sources: [
    "call_sessions · email_queue · email_events · inbox_messages · activities",
  ],
  logic:
    "Outreach joins through the CRM contact carrying wl_user_id, and is deduped per contact before being rolled up to a trial. 'During the trial' means the timestamp falls inside that workshop's trial window, so it inherits the window's dating.",
};

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

function money(cents: number, currency: string | null) {
  const amount = formatNumber(Math.round(cents / 100));
  if (!currency || currency === "—") return amount;
  return currency === "SEK" ? `${amount} kr` : `${amount} ${currency}`;
}

function day(value: string | null) {
  if (!value) return "—";
  return value.slice(0, 10);
}

function pct(part: number, whole: number) {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function pctLabel(value: number | null, digits = 0) {
  if (value === null) return "—";
  return `${value.toFixed(digits)}%`;
}

function num(value: number, digits = 1) {
  return value.toFixed(digits);
}

function secs(value: number | null) {
  if (value === null) return "—";
  if (value < 60) return `${value}s`;
  return `${Math.floor(value / 60)}m ${value % 60}s`;
}

/**
 * Hand-rolled multi-series line chart on the shared ceo-legacy.css classes,
 * mirroring the promo page's copy. The dashboard's own TrendChart is a private
 * function inside dashboard-sections, so this repeats its SVG maths (0-100
 * viewBox, 78% band with an 8% top gutter) rather than exporting and reshaping
 * it for a second caller.
 */
function LineChart<TPoint extends { date: string }>({
  points,
  series,
  title,
  subtitle,
  info,
}: {
  points: TPoint[];
  series: Array<{ key: keyof TPoint & string; label: string; color: string }>;
  title: string;
  subtitle?: string;
  info?: SourceInfo;
}) {
  const maxValue = Math.max(
    1,
    ...points.flatMap((point) =>
      series.map((item) => Number(point[item.key] ?? 0)),
    ),
  );

  const path = (key: keyof TPoint & string) =>
    points
      .map((point, index) => {
        const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
        const y = 100 - (Number(point[key] ?? 0) / maxValue) * 78 - 8;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

  const labels =
    points.length <= 8
      ? points.map((point) => point.date)
      : [
          points[0]?.date,
          points[Math.floor(points.length / 3)]?.date,
          points[Math.floor((points.length * 2) / 3)]?.date,
          points.at(-1)?.date,
        ].filter(Boolean as unknown as (v: string | undefined) => v is string);

  return (
    <div className="trend-chart-wrap">
      <div className="trend-chart-head">
        <div>
          <strong className="heading-with-info compact">
            <span>{title}</span>
            {info ? <InfoHint info={info} /> : null}
          </strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        <div className="chart-legend">
          {series.map((item) => (
            <span key={item.key}>
              <i style={{ background: item.color }} />
              {item.label}
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
          {series.map((item) => (
            <path
              d={path(item.key)}
              fill="none"
              key={item.key}
              stroke={item.color}
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <div className="chart-axis">
        {labels.map((label, index) => (
          <span key={`${label}-${index}`}>{label}</span>
        ))}
      </div>
      <p className="panel-description">
        Peak on this chart: {formatNumber(Math.round(maxValue))}.
      </p>
    </div>
  );
}

function Bars({
  rows,
  total,
  suffix,
}: {
  rows: Array<{
    key: string;
    label: string;
    count: number;
    description?: string;
  }>;
  total: number;
  suffix?: string;
}) {
  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div className="bar-row" key={row.key}>
          <div className="bar-row-main">
            <span className="bar-row-copy">{row.label}</span>
            <span>
              {formatNumber(row.count)}
              {suffix ? ` ${suffix}` : ""} · {pct(row.count, total)}
            </span>
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: `${total === 0 ? 0 : (row.count / total) * 100}%`,
              }}
            />
          </div>
          {row.description ? <small>{row.description}</small> : null}
        </div>
      ))}
    </div>
  );
}

function TermTable({
  terms,
  title,
  caption,
}: {
  terms: TermCount[];
  title: string;
  caption: string;
}) {
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p className="panel-description">{caption}</p>
        </div>
      </div>
      {terms.length === 0 ? (
        <p className="panel-description">Nothing recorded.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Value</th>
                <th>Times</th>
                <th>Users</th>
              </tr>
            </thead>
            <tbody>
              {terms.map((term) => (
                <tr key={term.term}>
                  <td className="table-primary">{term.term}</td>
                  <td>{formatNumber(term.count)}</td>
                  <td>{formatNumber(term.users)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * One conversion cut. Live trials get their own column rather than being folded
 * into the denominator, and the rate cell reads "—" when a bucket has no
 * concluded trials at all instead of rendering a misleading 0%.
 */
function CutTable({ cut }: { cut: ConversionCut }) {
  const maxPct = Math.max(1, ...cut.rows.map((row) => row.pct ?? 0));

  return (
    <article className="panel panel-wide">
      <div className="panel-heading">
        <div>
          <h2 className="heading-with-info">
            <span>{cut.label}</span>
            <InfoHint info={CONVERSION_INFO} />
          </h2>
          <p className="panel-description">{cut.description}</p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{cut.label.replace(/^By /, "")}</th>
              <th>Trials</th>
              <th>Still running</th>
              <th>Concluded</th>
              <th>Converted</th>
              <th>Conversion</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {cut.rows.map((row) => (
              <tr key={row.key}>
                <td className="table-primary">{row.label}</td>
                <td>{formatNumber(row.trials)}</td>
                <td>{formatNumber(row.live)}</td>
                <td>{formatNumber(row.concluded)}</td>
                <td>{formatNumber(row.converted)}</td>
                <td>{pctLabel(row.pct, 1)}</td>
                <td>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${((row.pct ?? 0) / maxPct) * 100}%`,
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cut.caveat ? <p className="panel-description">{cut.caveat}</p> : null}
    </article>
  );
}

type Metric = {
  label: string;
  hint?: string;
  /** Numeric so any ratio is computed from values, never parsed out of text. */
  pick: (c: CohortStats) => number;
  format: (value: number) => string;
};

const METRICS: Metric[] = [
  { label: "Users", pick: (c) => c.users, format: (v) => formatNumber(v) },
  {
    label: "Workshops",
    pick: (c) => c.workshops,
    format: (v) => formatNumber(v),
  },
  {
    label: "Used it inside the trial",
    hint: "Share who ran at least one diagnosis between the trial opening and closing. Zero by construction for the never-trialed column.",
    pick: (c) => c.pctUsedDuringTrial,
    format: (v) => pctLabel(v),
  },
  {
    label: "Ran a diagnosis (ever)",
    hint: "Activation. The share who used the core feature at least once, at any point in their life.",
    pick: (c) => c.pctActivated,
    format: (v) => pctLabel(v),
  },
  {
    label: "Came back (2+)",
    pick: (c) => c.pctRepeat,
    format: (v) => pctLabel(v),
  },
  {
    label: "Heavy use (10+)",
    pick: (c) => c.pctPower,
    format: (v) => pctLabel(v),
  },
  {
    label: "Diagnoses per user (avg)",
    pick: (c) => c.avgDiagnostics,
    format: (v) => num(v, 2),
  },
  {
    label: "Diagnoses per user (median)",
    hint: "The honest middle: the averages here are dragged up by a handful of very heavy users.",
    pick: (c) => c.medianDiagnostics,
    format: (v) => num(v, 1),
  },
  {
    label: "Diagnoses inside the trial (avg)",
    pick: (c) => c.avgDiagnosticsDuringTrial,
    format: (v) => num(v, 2),
  },
  {
    label: "Busiest single user",
    pick: (c) => c.maxDiagnostics,
    format: (v) => formatNumber(v),
  },
  {
    label: "Active days per user (avg)",
    pick: (c) => c.avgActiveDays,
    format: (v) => num(v),
  },
  {
    label: "Diagnoses per active day",
    hint: "Intensity while actually present, which strips out how long they have been around.",
    pick: (c) => c.diagnosticsPerActiveDay,
    format: (v) => num(v, 2),
  },
  {
    label: "Active in last 30d",
    pick: (c) => c.pctActive30d,
    format: (v) => pctLabel(v),
  },
  {
    label: "Chats per user (avg)",
    pick: (c) => c.avgChats,
    format: (v) => num(v, 2),
  },
  {
    label: "Feature events per user (avg)",
    hint: "Only counts from 2026-06-11 onward.",
    pick: (c) => c.avgFeatureEvents,
    format: (v) => num(v, 1),
  },
  {
    label: "Ever paid real money",
    hint: "100% for the converted cohort by definition, and 0% for the other three by definition. It is here as a check that the cohorts are what they claim to be.",
    pick: (c) => c.pctEverPaid,
    format: (v) => pctLabel(v),
  },
];

function MetricLabel({ metric }: { metric: Metric }) {
  if (!metric.hint) return <>{metric.label}</>;
  return (
    <span className="label-with-info">
      <span>{metric.label}</span>
      <InfoHint info={{ title: metric.label, body: metric.hint }} />
    </span>
  );
}

function CohortTable({ cohorts }: { cohorts: CohortStats[] }) {
  const columns = COHORT_ORDER.map((key) =>
    cohorts.find((cohort) => cohort.key === key),
  ).filter((cohort): cohort is CohortStats => Boolean(cohort));

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Metric</th>
            {columns.map((cohort) => (
              <th key={cohort.key}>
                {cohort.label}
                <br />
                <small>{formatNumber(cohort.users)} users</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((metric) => (
            <tr key={metric.label}>
              <td className="table-primary">
                <MetricLabel metric={metric} />
              </td>
              {columns.map((cohort) => (
                <td key={cohort.key}>{metric.format(metric.pick(cohort))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiveTable({ rows }: { rows: LiveTrialRow[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Risk</th>
            <th>Workshop</th>
            <th>Billing email</th>
            <th>Country</th>
            <th>Plan</th>
            <th>Days left</th>
            <th>Trial ends</th>
            <th>Users</th>
            <th>Diagnoses in trial</th>
            <th>Active days</th>
            <th>Last activity</th>
            <th>Calls</th>
            <th>Emails</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.subscriptionId}>
              <td className="table-primary">
                {row.risk}
                {row.hasPromo ? (
                  <>
                    {" "}
                    <span className="badge">promo</span>
                  </>
                ) : null}
              </td>
              <td>{row.workshop ?? "—"}</td>
              <td>{row.email ?? "—"}</td>
              <td>{row.country ?? "—"}</td>
              <td>{row.planLabel}</td>
              <td>{row.daysLeft}</td>
              <td>{day(row.trialEnd)}</td>
              <td>{formatNumber(row.users)}</td>
              <td>{formatNumber(row.diagnosticsDuringTrial)}</td>
              <td>{formatNumber(row.activeDaysDuringTrial)}</td>
              <td>{day(row.lastActiveAt)}</td>
              <td>{formatNumber(row.calls)}</td>
              <td>{formatNumber(row.emailsSent)}</td>
              <td>{row.riskReasons.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserTable({ users }: { users: TrialUserRow[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Workshop</th>
            <th>Country</th>
            <th>Plan</th>
            <th>Trial</th>
            <th>Outcome</th>
            <th>Diag</th>
            <th>Before</th>
            <th>In trial</th>
            <th>After</th>
            <th>Day 1st use</th>
            <th>Chats</th>
            <th>Features</th>
            <th>Logins</th>
            <th>Active days</th>
            <th>Calls</th>
            <th>Emails</th>
            <th>Opens</th>
            <th>Clicks</th>
            <th>Replies</th>
            <th>Last active</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.userId}>
              <td className="table-primary">
                {user.email ?? "(no contact)"}
                {user.isInternal ? (
                  <>
                    {" "}
                    <span className="badge">internal</span>
                  </>
                ) : null}
                {user.hasPromo ? (
                  <>
                    {" "}
                    <span className="badge">promo</span>
                  </>
                ) : null}
              </td>
              <td>{user.workshop ?? "—"}</td>
              <td>{user.country ?? "—"}</td>
              <td>{user.planLabel}</td>
              <td>
                {day(user.trialStart)} → {day(user.trialEnd)}
                {user.trialCount > 1 ? (
                  <>
                    {" "}
                    <span className="badge">
                      {user.trialCount} trials
                    </span>
                  </>
                ) : null}
              </td>
              <td>
                {OUTCOME_LABELS[user.outcome]}
                {user.everPaid ? (
                  <>
                    {" "}
                    <span className="badge">paid</span>
                  </>
                ) : null}
              </td>
              <td>{formatNumber(user.diagnostics)}</td>
              <td>{formatNumber(user.diagnosticsBeforeTrial)}</td>
              <td>{formatNumber(user.diagnosticsDuringTrial)}</td>
              <td>{formatNumber(user.diagnosticsAfterTrial)}</td>
              <td>
                {user.daysToFirstDiagnosis === null
                  ? "—"
                  : user.daysToFirstDiagnosis}
              </td>
              <td>{formatNumber(user.chats)}</td>
              <td>{formatNumber(user.featureEvents)}</td>
              <td>{formatNumber(user.logins)}</td>
              <td>{formatNumber(user.activeDays)}</td>
              <td>
                {formatNumber(user.calls)}
                {user.calls > 0 ? ` (${user.callsConnected})` : ""}
              </td>
              <td>{formatNumber(user.emailsSent)}</td>
              <td>{formatNumber(user.opens)}</td>
              <td>{formatNumber(user.clicks)}</td>
              <td>{formatNumber(user.replies)}</td>
              <td>{day(user.lastActiveAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrialUsersContent({
  data,
  initialTab,
}: TrialUsersContentProps) {
  const [tab, setTab] = useState<TrialTab>(initialTab);
  const [openUser, setOpenUser] = useState<string | null>(null);

  const switchTab = (next: TrialTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", next);
    }
    window.history.replaceState(null, "", url.toString());
  };

  const timelineUser = useMemo(
    () =>
      data.timeline.find((row) => row.userId === openUser) ??
      data.timeline[0] ??
      null,
    [data.timeline, openUser],
  );

  const cutByKey = useMemo(
    () => new Map(data.cuts.map((cut) => [cut.key, cut])),
    [data.cuts],
  );

  const primaryMoney = data.money[0] ?? null;
  const converted = data.cohorts.find((c) => c.key === "trial_converted");
  const expired = data.cohorts.find((c) => c.key === "trial_expired");
  const never = data.cohorts.find((c) => c.key === "never_trialed");

  if (data.error) {
    return (
      <article className="panel panel-wide">
        <p>Could not load trial users: {data.error}</p>
      </article>
    );
  }

  if (data.kpis.trials === 0) {
    return (
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Trial users</p>
            <h2>No trials found</h2>
          </div>
        </div>
        <p className="panel-description">{data.note}</p>
      </article>
    );
  }

  return (
    <div className="section-stack">
      <div className="platform-tabs" role="tablist">
        {TRIAL_TABS.map((entry) => (
          <button
            aria-selected={tab === entry.key}
            className={`platform-tab${tab === entry.key ? " active" : ""}`}
            key={entry.key}
            onClick={() => switchTab(entry.key)}
            role="tab"
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* ================= OVERVIEW ==================================== */}
      {tab === "overview" ? (
        <>
          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Trial users</p>
                <h2 className="heading-with-info">
                  <span>Who started a trial, and did it turn into money?</span>
                  <InfoHint info={TRIAL_INFO} />
                </h2>
                <p className="panel-description">
                  Every One, Small or Large free trial ever opened. Internal-test
                  and partner comps are excluded from the rates below and
                  flagged wherever they appear in a table.
                </p>
              </div>
            </div>
            <div className="summary-grid columns-4">
              <SummaryCard
                value={formatNumber(data.kpis.trials)}
                label="Trials ever started"
                hint={`${formatNumber(data.kpis.workshops)} workshops · ${formatNumber(data.kpis.users)} app users`}
                info={TRIAL_INFO}
              />
              <SummaryCard
                value={formatNumber(data.kpis.live)}
                label="Running right now"
                hint={`${formatNumber(data.kpis.concluded)} have concluded`}
              />
              <SummaryCard
                value={pctLabel(data.kpis.conversionPct, 1)}
                label="Converted to paying"
                hint={`${formatNumber(data.kpis.converted)} of ${formatNumber(data.kpis.concluded)} concluded trials`}
                info={CONVERSION_INFO}
              />
              <SummaryCard
                value={
                  primaryMoney
                    ? money(primaryMoney.activeMrrCents, primaryMoney.currency)
                    : "—"
                }
                label="MRR still running from converted trials"
                hint={
                  data.money.length > 1
                    ? `plus ${data.money
                        .slice(1)
                        .map((row) => money(row.activeMrrCents, row.currency))
                        .join(" + ")}`
                    : "single currency"
                }
              />
            </div>
            <div className="summary-grid columns-4">
              <SummaryCard
                value={formatNumber(data.kpis.stillPaying)}
                label="Converted and still paying"
                hint={`${formatNumber(data.kpis.churnedAfterPaying)} paid and then cancelled`}
              />
              <SummaryCard
                value={formatNumber(data.kpis.convertedWithoutUsing)}
                label="Charged without ever using it"
                hint={`${pct(data.kpis.convertedWithoutUsing, data.kpis.converted)} of conversions ran zero diagnoses before the trial closed`}
                info={USAGE_INFO}
              />
              <SummaryCard
                value={formatNumber(data.kpis.usedDuringTrial)}
                label="Trials that were actually used"
                hint={`${pct(data.kpis.usedDuringTrial, data.kpis.trials)} of all trials · median ${data.kpis.medianDaysToFirstUse ?? "—"} days to first diagnosis`}
                info={USAGE_INFO}
              />
              <SummaryCard
                value={formatNumber(data.kpis.neverContacted)}
                label="Never called or emailed"
                hint={`${pct(data.kpis.neverContacted, data.kpis.trials)} of trials got no outreach at all`}
                info={OUTREACH_INFO}
              />
            </div>
            <p className="panel-description">{data.note}</p>
          </article>

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2 className="heading-with-info">
                  <span>What happened to every trial</span>
                  <InfoHint info={CONVERSION_INFO} />
                </h2>
                <p className="panel-description">
                  Mutually exclusive, and these do sum to the trial total. A
                  trial that was charged and later cancelled counts as a
                  conversion: the trial did its job before the product or the
                  price did not.
                </p>
              </div>
            </div>
            <Bars
              rows={data.outcomes.map((bucket) => ({
                key: bucket.key,
                label: bucket.label,
                count: bucket.trials,
                description: bucket.description,
              }))}
              suffix="trials"
              total={data.kpis.trials}
            />
          </article>

          {data.weekly.length > 0 ? (
            <article className="panel panel-wide">
              <LineChart
                info={CONVERSION_INFO}
                points={data.weekly}
                series={[
                  { key: "started", label: "Trials started", color: "#7c5cff" },
                  { key: "ended", label: "Trials ended", color: "#8b93a7" },
                  {
                    key: "converted",
                    label: "First payments",
                    color: "#25b3a3",
                  },
                ]}
                subtitle="Weekly, last 26 weeks"
                title="Trial flow"
              />
            </article>
          ) : null}

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2>Money riding on trials, per currency</h2>
                <p className="panel-description">
                  MRR is stored in the subscription&apos;s own currency and is
                  never summed across currencies. &quot;At risk&quot; is the MRR
                  attached to trials that have not closed yet, which is what is
                  still winnable this month.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th>Converted trials</th>
                    <th>MRR still running</th>
                    <th>MRR won then lost</th>
                    <th>Live trials</th>
                    <th>MRR at risk in live trials</th>
                  </tr>
                </thead>
                <tbody>
                  {data.money.map((row) => (
                    <tr key={row.currency}>
                      <td className="table-primary">{row.currency}</td>
                      <td>{formatNumber(row.converted)}</td>
                      <td>{money(row.activeMrrCents, row.currency)}</td>
                      <td>{money(row.churnedMrrCents, row.currency)}</td>
                      <td>{formatNumber(row.live)}</td>
                      <td>{money(row.liveTrialMrrCents, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2 className="heading-with-info">
                  <span>What this page cannot see</span>
                  <InfoHint info={WINDOW_INFO} />
                </h2>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Gap</th>
                    <th>Rows</th>
                    <th>What it means</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="table-primary">
                      Trial windows that are estimated
                    </td>
                    <td>{formatNumber(data.kpis.estimatedWindows)}</td>
                    <td>
                      Stripe&apos;s exact trial_start is not on the row yet.
                      Click Update to run the Stripe sync and every window
                      becomes exact. Until then, anything measured &quot;inside
                      the trial&quot; carries that estimate.
                    </td>
                  </tr>
                  <tr>
                    <td className="table-primary">
                      Trials with no workshop attached
                    </td>
                    <td>{formatNumber(data.kpis.unmatchedTrials)}</td>
                    <td>
                      The Stripe customer never resolved to a workshop, usually a
                      deleted customer, so no product or outreach data can be
                      joined to them. They are still counted as trials.
                    </td>
                  </tr>
                  <tr>
                    <td className="table-primary">
                      Internal-test and partner trials
                    </td>
                    <td>{formatNumber(data.kpis.internalTrials)}</td>
                    <td>
                      Flagged and kept out of every rate on this page, and shown
                      with a badge in the tables.
                    </td>
                  </tr>
                  <tr>
                    <td className="table-primary">
                      Prices the plan map does not recognise
                    </td>
                    <td>{formatNumber(data.unmappedPlanKeys.length)}</td>
                    <td>
                      {data.unmappedPlanKeys.length === 0
                        ? "Every trial resolved to a known plan tier."
                        : `Add these to src/lib/ceo/plan-prices.ts, otherwise their tier falls back to the workshop's current plan, which reads "free" once a subscription is cancelled: ${data.unmappedPlanKeys.join(", ")}`}
                    </td>
                  </tr>
                  <tr>
                    <td className="table-primary">
                      No plan-transition history
                    </td>
                    <td>—</td>
                    <td>
                      There is no table recording plan changes over time, so a
                      trial is only visible while its Stripe subscription row
                      survives. A workshop that trialled, cancelled and had its
                      subscription deleted upstream would vanish from this page
                      entirely.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </>
      ) : null}

      {/* ================= CONVERSION ================================== */}
      {tab === "conversion" ? (
        <>
          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">What converts</p>
                <h2 className="heading-with-info">
                  <span>
                    {pctLabel(data.kpis.conversionPct, 1)} of concluded trials
                    were charged
                  </span>
                  <InfoHint info={CONVERSION_INFO} />
                </h2>
                <p className="panel-description">
                  Every cut below shares one denominator rule: live trials sit in
                  their own column and never enter the rate. Read the counts
                  before the percentages — several buckets are small enough that
                  one more conversion moves them by ten points.
                </p>
              </div>
            </div>
            <div className="summary-grid columns-4">
              <SummaryCard
                value={formatNumber(data.kpis.convertedWithoutUsing)}
                label="Conversions with zero trial usage"
                hint={`of ${formatNumber(data.kpis.converted)} conversions · the card is required up front, so an unopened trial still charges`}
                info={USAGE_INFO}
              />
              <SummaryCard
                value={pctLabel(
                  converted ? converted.pctUsedDuringTrial : null,
                )}
                label="Converters who used it in the window"
                hint={`against ${pctLabel(expired ? expired.pctUsedDuringTrial : null)} of trials that never paid`}
              />
              <SummaryCard
                value={
                  data.kpis.medianTrialLength === null
                    ? "—"
                    : `${data.kpis.medianTrialLength} days`
                }
                label="Median trial length"
                info={WINDOW_INFO}
              />
              <SummaryCard
                value={
                  data.kpis.medianDaysToFirstUse === null
                    ? "—"
                    : `${data.kpis.medianDaysToFirstUse} days`
                }
                label="Median days from trial start to first diagnosis"
                hint="Among users who ever ran one"
              />
            </div>
          </article>

          {[
            "usage",
            "country",
            "tier",
            "interval",
            "currency",
            "length",
            "month",
            "outreach",
            "promo",
            "seats",
          ]
            .map((key) => cutByKey.get(key))
            .filter((cut): cut is ConversionCut => Boolean(cut))
            .map((cut) => (
              <CutTable cut={cut} key={cut.key} />
            ))}
        </>
      ) : null}

      {/* ================= LIVE ======================================== */}
      {tab === "live" ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Live trials</p>
              <h2 className="heading-with-info">
                <span>
                  {formatNumber(data.live.length)} trials are running right now
                </span>
                <InfoHint info={RISK_INFO} />
              </h2>
              <p className="panel-description">
                Ranked by how likely they look to lapse, highest first, then by
                how little time is left. This is the call list: a trial with no
                usage, no outreach and two days left is the one to phone this
                morning.
              </p>
            </div>
          </div>
          {data.live.length === 0 ? (
            <p className="panel-description">No trials are running right now.</p>
          ) : (
            <>
              <div className="summary-grid columns-4">
                <SummaryCard
                  value={formatNumber(
                    data.live.filter((row) => row.diagnosticsDuringTrial === 0)
                      .length,
                  )}
                  label="Have not run a single diagnosis"
                />
                <SummaryCard
                  value={formatNumber(
                    data.live.filter((row) => !row.contacted).length,
                  )}
                  label="Never called or emailed"
                  info={OUTREACH_INFO}
                />
                <SummaryCard
                  value={formatNumber(
                    data.live.filter((row) => row.daysLeft <= 7).length,
                  )}
                  label="Under a week left"
                />
                <SummaryCard
                  value={formatNumber(
                    data.live.filter(
                      (row) =>
                        row.daysLeft <= 7 && row.diagnosticsDuringTrial === 0,
                    ).length,
                  )}
                  label="Under a week left AND unused"
                  hint="The list worth working today"
                />
              </div>
              <LiveTable rows={data.live} />
            </>
          )}
        </article>
      ) : null}

      {/* ================= USERS ======================================= */}
      {tab === "users" ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Users</p>
              <h2 className="heading-with-info">
                <span>Every app user inside a trial workshop</span>
                <InfoHint info={USAGE_INFO} />
              </h2>
              <p className="panel-description">
                One row per app user, so a workshop with three techs shows three
                rows, and its trial columns repeat across them. Before, In trial
                and After are diagnoses either side of that workshop&apos;s
                trial window. Calls show connected in brackets.
              </p>
            </div>
          </div>
          <UserTable users={data.users} />
        </article>
      ) : null}

      {/* ================= TIMELINE ==================================== */}
      {tab === "timeline" ? (
        <>
          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Timeline</p>
                <h2 className="heading-with-info">
                  <span>Everything that happened, per user</span>
                  <InfoHint info={OUTREACH_INFO} />
                </h2>
                <p className="panel-description">
                  Pick a user to see their whole history in one stream: signup,
                  the trial opening and closing, the first payment, every call
                  with the rep who placed it, every email with the mailbox that
                  sent it, replies, and every diagnosis with the car and what
                  they typed. The {formatNumber(data.timeline.length)} busiest
                  users are listed.
                </p>
              </div>
            </div>
            <div className="hero-pill-list">
              {data.timeline.map((row) => (
                <button
                  className={`hero-pill${
                    timelineUser?.userId === row.userId ? " active" : ""
                  }`}
                  key={row.userId}
                  onClick={() => setOpenUser(row.userId)}
                  type="button"
                >
                  {row.email ?? row.userId.slice(0, 8)} (
                  {formatNumber(row.events.length)})
                </button>
              ))}
            </div>
          </article>

          {timelineUser ? (
            <article className="panel panel-wide">
              <div className="panel-heading">
                <div>
                  <h2>{timelineUser.email ?? timelineUser.userId}</h2>
                  <p className="panel-description">
                    {timelineUser.workshop ?? "no workshop"} · trial{" "}
                    {day(timelineUser.trialStart)} →{" "}
                    {day(timelineUser.trialEnd)} ·{" "}
                    {OUTCOME_LABELS[timelineUser.outcome]} ·{" "}
                    {formatNumber(timelineUser.diagnostics)} diagnoses ·{" "}
                    {formatNumber(timelineUser.events.length)} events
                  </p>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>What</th>
                      <th>Who</th>
                      <th>Detail</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timelineUser.events.map((event) => (
                      <tr key={event.id}>
                        <td>{event.at.slice(0, 16).replace("T", " ")}</td>
                        <td className="table-primary">
                          <span className="badge">
                            {event.kind.replace("_", " ")}
                          </span>{" "}
                          {event.title}
                        </td>
                        <td>{event.actor ?? "—"}</td>
                        <td>{event.detail ? event.detail.slice(0, 160) : "—"}</td>
                        <td>{event.outcome ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ) : null}
        </>
      ) : null}

      {/* ================= OUTREACH ==================================== */}
      {tab === "outreach" ? (
        <>
          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Outreach</p>
                <h2 className="heading-with-info">
                  <span>Every call placed to a trial customer</span>
                  <InfoHint info={OUTREACH_INFO} />
                </h2>
                <p className="panel-description">
                  Who called, when, whether anyone picked up, and where the call
                  landed relative to the trial. Negative &quot;from start&quot;
                  means the call came before the trial opened; negative &quot;to
                  end&quot; means it came before the trial closed, so a value
                  near zero is a last-minute call.
                </p>
                {data.kpis.totalCalls > data.calls.length ? (
                  <p className="panel-description">
                    Showing the {formatNumber(data.calls.length)} most recent of{" "}
                    {formatNumber(data.kpis.totalCalls)} calls. The counts on
                    every other tab are computed over all of them.
                  </p>
                ) : null}
              </div>
            </div>
            {data.calls.length === 0 ? (
              <p className="panel-description">
                No calls have ever been placed to a trial customer.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>Workshop</th>
                      <th>Rep</th>
                      <th>Direction</th>
                      <th>Connected</th>
                      <th>Duration</th>
                      <th>From start</th>
                      <th>To end</th>
                      <th>In trial</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.calls.map((call) => (
                      <tr key={call.id}>
                        <td>{day(call.at)}</td>
                        <td className="table-primary">{call.email ?? "—"}</td>
                        <td>{call.workshop ?? "—"}</td>
                        <td>{call.rep ?? "—"}</td>
                        <td>{call.direction ?? "—"}</td>
                        <td>{call.connected ? "yes" : "no"}</td>
                        <td>{secs(call.durationSeconds)}</td>
                        <td>{call.daysFromTrialStart ?? "—"}</td>
                        <td>{call.daysFromTrialEnd ?? "—"}</td>
                        <td>{call.duringTrial ? "yes" : "no"}</td>
                        <td>{call.outcome ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2 className="heading-with-info">
                  <span>Every sequence email sent to a trial customer</span>
                  <InfoHint info={OUTREACH_INFO} />
                </h2>
                <p className="panel-description">
                  The sending mailbox, the sequence it belonged to, and whether
                  it was opened, clicked or replied to.
                </p>
                {data.kpis.totalEmails > data.emails.length ? (
                  <p className="panel-description">
                    Showing the {formatNumber(data.emails.length)} most recent
                    of {formatNumber(data.kpis.totalEmails)} emails. The counts
                    on every other tab are computed over all of them.
                  </p>
                ) : null}
              </div>
            </div>
            {data.emails.length === 0 ? (
              <p className="panel-description">
                No sequence emails have been sent to a trial customer.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>Workshop</th>
                      <th>Sent from</th>
                      <th>Sequence</th>
                      <th>Subject</th>
                      <th>From start</th>
                      <th>In trial</th>
                      <th>Opened</th>
                      <th>Clicked</th>
                      <th>Replied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.emails.map((mail) => (
                      <tr key={mail.id}>
                        <td>{day(mail.at)}</td>
                        <td className="table-primary">{mail.email ?? "—"}</td>
                        <td>{mail.workshop ?? "—"}</td>
                        <td>{mail.sender ?? "—"}</td>
                        <td>{mail.sequence ?? "—"}</td>
                        <td>{mail.subject ?? "—"}</td>
                        <td>{mail.daysFromTrialStart ?? "—"}</td>
                        <td>{mail.duringTrial ? "yes" : "no"}</td>
                        <td>{mail.opened ? "yes" : "no"}</td>
                        <td>{mail.clicked ? "yes" : "no"}</td>
                        <td>{mail.replied ? "yes" : "no"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </>
      ) : null}

      {/* ================= PRODUCT ===================================== */}
      {tab === "product" ? (
        <>
          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Product use</p>
                <h2 className="heading-with-info">
                  <span>What trial users actually brought to it</span>
                  <InfoHint info={USAGE_INFO} />
                </h2>
                <p className="panel-description">
                  Free text and structured fields off every diagnosis run by a
                  user inside a trial workshop, all-history rather than only
                  inside the window. &quot;Users&quot; is how many distinct
                  people typed that value, which separates one workshop&apos;s
                  habit from a broad pattern.
                </p>
              </div>
            </div>
          </article>
          <article className="content-grid">
            <TermTable
              caption="Free text a tech typed when starting a diagnosis. The full taxonomy lives on the Diagnostic Search Terms page; this is the raw verbatim, trial users only."
              terms={data.searchTerms}
              title="What they searched for"
            />
            <TermTable
              caption="Car makes behind trial users' diagnoses."
              terms={data.carMakes}
              title="Cars they worked on"
            />
          </article>

          <article className="content-grid">
            <TermTable
              caption="Fault codes entered by trial users."
              terms={data.dtcs}
              title="DTC codes"
            />
            <TermTable
              caption="Symptoms recorded on trial users' diagnoses."
              terms={data.symptoms}
              title="Symptoms"
            />
          </article>
        </>
      ) : null}

      {/* ================= COHORTS ===================================== */}
      {tab === "cohorts" ? (
        <>
          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Cohorts</p>
                <h2 className="heading-with-info">
                  <span>Trialers against the rest of the base</span>
                  <InfoHint info={TRIAL_INFO} />
                </h2>
                <p className="panel-description">
                  Four cohorts at APP USER grain. The trial columns split by
                  outcome, and &quot;Never trialed&quot; is everyone else — the
                  free base that never reached checkout. These do not overlap, so
                  they may be summed, but they are not a fair experiment: people
                  who opened a trial had already decided to try buying.
                </p>
              </div>
            </div>
            <CohortTable cohorts={data.cohorts} />
            {converted && never ? (
              <p className="panel-description">
                Converted trialers activate at {pctLabel(converted.pctActivated)}{" "}
                against {pctLabel(never.pctActivated)} for the never-trialed
                base, and run {num(converted.avgDiagnostics, 1)} diagnoses each
                against {num(never.avgDiagnostics, 1)}. The gap is real but it
                runs both ways: engaged users are likelier to open a trial in the
                first place.
              </p>
            ) : null}
          </article>

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2 className="heading-with-info">
                  <span>How far each cohort gets</span>
                  <InfoHint info={USAGE_INFO} />
                </h2>
                <p className="panel-description">
                  Each stage is a share of that cohort&apos;s own users, so the
                  four columns are comparable despite very different sizes.
                </p>
              </div>
            </div>
            <div className="funnel-list">
              {data.funnel.map((stage) => (
                <div className="funnel-row" key={stage.key}>
                  <div className="funnel-label">
                    <span className="label-with-info">
                      <span>{stage.label}</span>
                      <InfoHint
                        info={{ title: stage.label, body: stage.description }}
                      />
                    </span>
                  </div>
                  <div className="funnel-track">
                    {COHORT_ORDER.map((key) => (
                      <div
                        className="funnel-bar"
                        key={key}
                        style={{
                          width: `${stage.pct[key]}%`,
                          background: COHORT_COLORS[key],
                        }}
                        title={`${COHORT_LABELS[key]}: ${formatNumber(stage.counts[key])} (${pctLabel(stage.pct[key])})`}
                      />
                    ))}
                  </div>
                  <div className="funnel-rate">
                    {COHORT_ORDER.map((key) =>
                      pctLabel(stage.pct[key] ?? 0),
                    ).join(" / ")}
                  </div>
                </div>
              ))}
            </div>
            <div className="chart-legend">
              {COHORT_ORDER.map((key) => (
                <span key={key}>
                  <i style={{ background: COHORT_COLORS[key] }} />
                  {COHORT_LABELS[key]}
                </span>
              ))}
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Stage</th>
                    {COHORT_ORDER.map((key) => (
                      <th key={key}>{COHORT_LABELS[key]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.funnel.map((stage) => (
                    <tr key={stage.key}>
                      <td className="table-primary">{stage.label}</td>
                      {COHORT_ORDER.map((key) => (
                        <td key={key}>
                          {formatNumber(stage.counts[key] ?? 0)} ·{" "}
                          {pctLabel(stage.pct[key] ?? 0)}
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
                <h2 className="heading-with-info">
                  <span>How the trial windows on this page were dated</span>
                  <InfoHint info={WINDOW_INFO} />
                </h2>
              </div>
            </div>
            <Bars
              rows={(
                ["stripe", "customer", "assumed"] as const
              ).map((source) => ({
                key: source,
                label: TRIAL_START_SOURCE_LABELS[source],
                count: data.trials.filter(
                  (trial) => trial.trialStartSource === source,
                ).length,
              }))}
              suffix="trials"
              total={data.trials.length}
            />
          </article>
        </>
      ) : null}
    </div>
  );
}
