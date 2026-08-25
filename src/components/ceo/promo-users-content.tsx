"use client";

import { useMemo, useState } from "react";
import { formatNumber } from "@/lib/ceo/format";
import {
  COHORT_LABELS,
  LIKE_FOR_LIKE,
  MAIN_COHORTS,
  PROMO_TABS,
  type CohortKey,
  type CohortStats,
  type PromoTab,
  type PromoUserRow,
  type PromoUsersData,
  type TermCount,
} from "@/lib/ceo/promo-users-shared";
import { InfoHint, type SourceInfo } from "./source-info";

type PromoUsersContentProps = {
  data: PromoUsersData;
  initialTab: PromoTab;
};

const COHORT_COLORS: Record<CohortKey, string> = {
  promo: "#7c5cff",
  promo_charged: "#a78bfa",
  charged_no_promo: "#25b3a3",
  checkout_no_promo: "#4b9fd8",
  free_no_promo: "#8b93a7",
};

const GRANT_INFO: SourceInfo = {
  title: "What counts as a promo, and what a row is",
  body:
    "Every coupon or promotion code Stripe has ever applied to a customer. A grant is one (customer, coupon) pair: a 90%-off coupon riding twelve monthly invoices is ONE grant, not twelve. The promotion code is an attribute rather than part of the key, because the same coupon is routinely applied both through a code and by hand in the Stripe dashboard.",
  sources: [
    "dashboard_promo_grants (hourly Stripe sync)",
    "Stripe subscriptions.discounts + invoices.total_discount_amounts",
  ],
  logic:
    "Three grains are in play and mixing them produces wrong numbers. MONEY is per grant. BEHAVIOUR is per app user (a diagnosis is run by a person). OUTREACH is per CRM contact, deduped, so one workshop's shared phone call is not counted once per tech.",
};

const CAUSALITY_INFO: SourceInfo = {
  title: "Why this is association, not proof",
  body:
    "Promo recipients were not randomly chosen. They are workshops that were actively sold to and that reached checkout, so comparing them against ALL other users mostly measures 'engaged customer vs random free signup' rather than the effect of a discount.",
  sources: ["promo_cohort_stats()"],
  logic:
    "Read 'Promo, charged' against 'Paid, no promo' for the like-for-like answer: everybody on both sides was actually charged. There, activation, repeat use and 30-day retention come out the same and only volume differs. Volume itself partly reflects tenure, because diagnoses per ACTIVE DAY is flat between them: discounted customers have more active days, not busier ones.",
};

const CHECKOUT_INFO: SourceInfo = {
  title: "Why 'Reached checkout' is not the same as 'Paid'",
  body:
    "This cohort is everyone who got as far as checkout without a discount: it includes trials that were never charged, which is why its own 'ever paid' cell sits well under 100%. plan_key and trial_end are both stamped at checkout, before any money moves, so treating them as evidence of payment is the standard trap here.",
  sources: [
    "dashboard_subscriptions.metadata.ever_paid (money actually moved)",
    "trial_end / plan_key (stamped at checkout)",
  ],
  logic:
    "'Paid, no promo' is the strict subset that was actually charged. Because it is a subset, the two columns must never be added together.",
};

const ACTIVITY_INFO: SourceInfo = {
  title: "Where outreach and product columns come from",
  body:
    "Outreach is the CRM side: calls placed through the calling pipeline (with the rep who placed them), sequence emails actually sent (with the sending mailbox), replies landed in the inbox, and logged activities. Product is the app side: diagnoses, diagnostic chats, feature events and logins.",
  sources: [
    "call_sessions · email_queue · email_events · inbox_messages · activities",
    "dashboard_diagnostics · dashboard_feature_usage · dashboard_user_logins",
  ],
  logic:
    "A grant is joined to a CRM contact by billing email first, then Stripe customer id; the contact carries wl_user_id, which keys the app-side tables. Diagnostics are all-history, but feature counters only exist from 2026-06-11, so a long-standing user's feature total understates lifetime usage.",
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

function pctLabel(value: number, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

function num(value: number, digits = 1) {
  return value.toFixed(digits);
}

function ratio(a: number, b: number) {
  if (b === 0) return a === 0 ? "—" : "n/a";
  return `${(a / b).toFixed(1)}x`;
}

function secs(value: number | null) {
  if (value === null) return "—";
  if (value < 60) return `${value}s`;
  return `${Math.floor(value / 60)}m ${value % 60}s`;
}

/**
 * Hand-rolled multi-series line chart on the shared ceo-legacy.css classes.
 * The dashboard's own TrendChart is a private function in dashboard-sections,
 * so this mirrors its SVG maths (0-100 viewBox, 78% band with an 8% top gutter)
 * rather than exporting and reshaping it.
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
      <p className="panel-description">Peak on this chart: {formatNumber(Math.round(maxValue))}.</p>
    </div>
  );
}

function Bars({
  rows,
  total,
  suffix,
}: {
  rows: Array<{ key: string; label: string; count: number; description?: string }>;
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
              style={{ width: `${total === 0 ? 0 : (row.count / total) * 100}%` }}
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

type Metric = {
  label: string;
  hint?: string;
  /** Numeric so ratios are computed from values, never parsed back out of text. */
  pick: (c: CohortStats) => number;
  format: (value: number) => string;
};

/**
 * Metrics are (pick, format) pairs rather than pre-formatted strings. The first
 * version derived its ratio column by stripping non-digits out of the rendered
 * text, which produced nonsense for counts (a "0.4x" ratio of user-counts) and
 * would silently break on any format change.
 */
const METRICS: Metric[] = [
  { label: "Users", pick: (c) => c.users, format: (v) => formatNumber(v) },
  {
    label: "Workshops",
    pick: (c) => c.workshops,
    format: (v) => formatNumber(v),
  },
  {
    label: "Ran a diagnosis",
    hint: "Activation. The share who used the core feature at least once.",
    pick: (c) => c.pctActivated,
    format: (v) => pctLabel(v),
  },
  {
    label: "Came back (2+)",
    hint: "Repeat usage.",
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
    hint: "The median is the honest middle: averages here are dragged up by a handful of very heavy users.",
    pick: (c) => c.medianDiagnostics,
    format: (v) => num(v, 1),
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
    hint: "Intensity while actually present, which strips out how long they have been a customer. This one being flat is why the volume gap reads as tenure rather than enthusiasm.",
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
    hint: "Money actually moved, from dashboard_subscriptions.metadata.ever_paid. It is under 100% for 'Reached checkout' because that cohort includes trials that were never charged.",
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
  const columns = MAIN_COHORTS.map((key) =>
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
                {cohort.key === "checkout_no_promo" ? (
                  <span className="label-with-info">
                    <span>{cohort.label}</span>
                    <InfoHint info={CHECKOUT_INFO} />
                  </span>
                ) : (
                  cohort.label
                )}
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

/**
 * The comparison that actually isolates the discount: everyone on both sides
 * was charged, so neither column is diluted by never-charged trials.
 */
function LikeForLikeTable({ cohorts }: { cohorts: CohortStats[] }) {
  const [promo, paid] = LIKE_FOR_LIKE.map((key) =>
    cohorts.find((cohort) => cohort.key === key),
  );
  if (!promo || !paid) return null;

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>
              {promo.label}
              <br />
              <small>{formatNumber(promo.users)} users</small>
            </th>
            <th>
              {paid.label}
              <br />
              <small>{formatNumber(paid.users)} users</small>
            </th>
            <th>Promo vs paid</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.filter((metric) => metric.label !== "Ever paid real money").map(
            (metric) => {
              const a = metric.pick(promo);
              const b = metric.pick(paid);
              return (
                <tr key={metric.label}>
                  <td className="table-primary">
                    <MetricLabel metric={metric} />
                  </td>
                  <td>{metric.format(a)}</td>
                  <td>{metric.format(b)}</td>
                  <td>{ratio(a, b)}</td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>
    </div>
  );
}

function UserTable({ users }: { users: PromoUserRow[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Workshop</th>
            <th>Code</th>
            <th>Applied</th>
            <th>State</th>
            <th>Diag</th>
            <th>Before</th>
            <th>After</th>
            <th>Chats</th>
            <th>Features</th>
            <th>Logins</th>
            <th>Active days</th>
            <th>Calls</th>
            <th>Emails</th>
            <th>Opens</th>
            <th>Clicks</th>
            <th>Replies</th>
            <th>First use</th>
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
              </td>
              <td>{user.workshop ?? "—"}</td>
              <td>{user.code ?? `(no code) ${user.couponId ?? ""}`}</td>
              <td>{day(user.appliedAt)}</td>
              <td>
                {user.promoActive ? (user.subscriptionStatus ?? "active") : "expired"}
                {user.everPaid ? (
                  <>
                    {" "}
                    <span className="badge">paid</span>
                  </>
                ) : null}
              </td>
              <td>{formatNumber(user.diagnostics)}</td>
              <td>{formatNumber(user.diagnosticsBefore)}</td>
              <td>{formatNumber(user.diagnosticsAfter)}</td>
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
              <td>{day(user.diagnosticsFirstAt)}</td>
              <td>{day(user.lastActiveAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PromoUsersContent({
  data,
  initialTab,
}: PromoUsersContentProps) {
  const [tab, setTab] = useState<PromoTab>(initialTab);
  const [openUser, setOpenUser] = useState<string | null>(null);

  const switchTab = (next: PromoTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", next);
    }
    window.history.replaceState(null, "", url.toString());
  };

  const promo = data.cohorts.find((c) => c.key === "promo");
  // `paid` is the strict charged cohort, which is the only fair comparison for
  // the promo cohort. `checkout` is the wider "reached checkout" group whose
  // ever-paid share is deliberately below 100%.
  const promoCharged = data.cohorts.find((c) => c.key === "promo_charged");
  const paid = data.cohorts.find((c) => c.key === "charged_no_promo");
  const checkout = data.cohorts.find((c) => c.key === "checkout_no_promo");
  const free = data.cohorts.find((c) => c.key === "free_no_promo");
  const primaryMoney = data.money[0] ?? null;

  const engagementTotal = data.engagement.reduce((s, b) => s + b.count, 0);
  const outreachTotal = data.outreach.reduce((s, b) => s + b.count, 0);

  const timelineUser = useMemo(
    () =>
      data.timeline.find((row) => row.userId === openUser) ??
      data.timeline[0] ??
      null,
    [data.timeline, openUser],
  );

  if (data.error) {
    return (
      <article className="panel panel-wide">
        <p>Could not load promo users: {data.error}</p>
      </article>
    );
  }

  if (data.kpis.recipients === 0) {
    return (
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Promo users</p>
            <h2>No promo grants synced yet</h2>
          </div>
        </div>
        <p className="panel-description">{data.note}</p>
      </article>
    );
  }

  return (
    <div className="section-stack">
      <div className="platform-tabs" role="tablist">
        {PROMO_TABS.map((entry) => (
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
                <p className="eyebrow">Promo users</p>
                <h2 className="heading-with-info">
                  <span>Who got a discount, and what did they do with it?</span>
                  <InfoHint info={GRANT_INFO} />
                </h2>
              </div>
            </div>
            <div className="summary-grid columns-4">
              <SummaryCard
                value={formatNumber(data.kpis.recipients)}
                label="Discounted customers"
                hint={`${formatNumber(data.kpis.users)} app users across them · ${formatNumber(data.kpis.internalRecipients)} internal or partner`}
                info={GRANT_INFO}
              />
              <SummaryCard
                value={formatNumber(data.kpis.activeNow)}
                label="Still discounted today"
                hint={`${formatNumber(data.kpis.distinctCodes)} distinct codes or coupons`}
              />
              <SummaryCard
                value={
                  primaryMoney
                    ? money(primaryMoney.discountedCents, primaryMoney.currency)
                    : "—"
                }
                label="Discount given up"
                hint={
                  data.money.length > 1
                    ? `plus ${data.money
                        .slice(1)
                        .map((row) => money(row.discountedCents, row.currency))
                        .join(" + ")}`
                    : "single currency"
                }
              />
              <SummaryCard
                value={formatNumber(data.kpis.everPaid)}
                label="Ever paid real money"
                hint={`${pct(data.kpis.everPaid, data.kpis.recipients)} of discounted customers`}
              />
            </div>
            <div className="summary-grid columns-4">
              <SummaryCard
                value={formatNumber(data.kpis.neverDiagnosed)}
                label="Never ran a diagnosis"
                hint={`${pct(data.kpis.neverDiagnosed, data.kpis.recipients)} never used the core feature`}
                info={ACTIVITY_INFO}
              />
              <SummaryCard
                value={formatNumber(data.kpis.everCalled)}
                label="Ever called"
                hint={`${formatNumber(data.kpis.recipients - data.kpis.everCalled)} never got a call`}
              />
              <SummaryCard
                value={formatNumber(data.kpis.neverContacted)}
                label="Never called or emailed"
                hint="No call, no sequence email"
              />
              <SummaryCard
                value={
                  data.kpis.medianDaysToFirstUse === null
                    ? "—"
                    : `${data.kpis.medianDaysToFirstUse} d`
                }
                label="Median days, promo to first diagnosis"
                hint="Negative means they were already using it before the discount"
              />
            </div>
          </article>

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2 className="heading-with-info">
                  <span>The short answer</span>
                  <InfoHint info={CAUSALITY_INFO} />
                </h2>
              </div>
            </div>
            {promoCharged && paid ? (
              <div className="summary-grid columns-4">
                <SummaryCard
                  value={`${pctLabel(promoCharged.pctActivated)} vs ${pctLabel(paid.pctActivated)}`}
                  label="Activation, charged promo vs charged no-promo"
                  hint="No lift. Discounting does not get more paying customers to try the product"
                  info={CAUSALITY_INFO}
                />
                <SummaryCard
                  value={`${pctLabel(promoCharged.pctRepeat)} vs ${pctLabel(paid.pctRepeat)}`}
                  label="Repeat use (2+)"
                  hint="Also flat once both sides actually paid"
                />
                <SummaryCard
                  value={`${pctLabel(promoCharged.pctActive30d)} vs ${pctLabel(paid.pctActive30d)}`}
                  label="Still active (30d)"
                  hint="Flat as well, so no retention effect either"
                />
                <SummaryCard
                  value={ratio(
                    promoCharged.avgDiagnostics,
                    paid.avgDiagnostics,
                  )}
                  label="Diagnoses per user"
                  hint={`${num(promoCharged.avgDiagnostics, 1)} vs ${num(paid.avgDiagnostics, 1)}. Volume is the only real gap, and per ACTIVE DAY it is ${num(promoCharged.diagnosticsPerActiveDay, 2)} vs ${num(paid.diagnosticsPerActiveDay, 2)}`}
                />
              </div>
            ) : null}
            <p className="panel-description">{data.note}</p>
          </article>

          {data.weekly.length > 0 ? (
            <article className="panel panel-wide">
              <LineChart
                info={ACTIVITY_INFO}
                points={data.weekly}
                series={[
                  {
                    key: "promoPerUser",
                    label: "Promo: diagnoses per active user",
                    color: COHORT_COLORS.promo,
                  },
                  {
                    key: "controlPerUser",
                    label: "Everyone else: diagnoses per active user",
                    color: COHORT_COLORS.checkout_no_promo,
                  },
                ]}
                subtitle="Per active user, so the two cohorts are comparable despite very different sizes"
                title="Weekly intensity, promo versus everyone else"
              />
            </article>
          ) : null}

          <article className="content-grid">
            <div className="panel">
              <div className="panel-heading">
                <div>
                  <h2 className="heading-with-info">
                    <span>Did the discount produce a user?</span>
                    <InfoHint info={ACTIVITY_INFO} />
                  </h2>
                </div>
              </div>
              <Bars rows={data.engagement} total={engagementTotal} />
            </div>
            <div className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Did anyone follow the discount up?</h2>
                </div>
              </div>
              <Bars rows={data.outreach} total={outreachTotal} />
            </div>
          </article>

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2>What the discounts cost, per currency</h2>
                <p className="panel-description">
                  Never summed across currencies. Discount amounts are exact;
                  paid alongside is attributed to the first coupon on an invoice.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th>Grants</th>
                    <th>Invoices</th>
                    <th>Discount given up</th>
                    <th>Paid alongside</th>
                    <th>Discount share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.money.map((row) => (
                    <tr key={row.currency}>
                      <td className="table-primary">{row.currency}</td>
                      <td>{formatNumber(row.grants)}</td>
                      <td>{formatNumber(row.invoices)}</td>
                      <td>{money(row.discountedCents, row.currency)}</td>
                      <td>{money(row.paidCents, row.currency)}</td>
                      <td>
                        {pct(
                          row.discountedCents,
                          row.discountedCents + row.paidCents,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </>
      ) : null}

      {/* ================= DOES IT WORK ================================ */}
      {tab === "evidence" ? (
        <>
          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Does it work</p>
                <h2 className="heading-with-info">
                  <span>Promo against two honest comparisons</span>
                  <InfoHint info={CAUSALITY_INFO} />
                </h2>
                <p className="panel-description">
                  Free users mostly never reached checkout, so promo versus free
                  measures the sales motion rather than the discount. Compare
                  against the paid columns instead. Note that &quot;Paid&quot;
                  is a strict subset of &quot;Reached checkout&quot;, so those
                  two columns must never be added together.
                </p>
              </div>
            </div>
            <CohortTable cohorts={data.cohorts} />
            {data.checkoutComposition ? (
              <p className="panel-description">
                Why &quot;Reached checkout, no promo&quot; is not the same as
                paying: of its{" "}
                {formatNumber(
                  data.checkoutComposition.charged +
                    data.checkoutComposition.trialOnly +
                    data.checkoutComposition.cardedNeverCharged,
                )}{" "}
                users, {formatNumber(data.checkoutComposition.charged)} were
                actually charged,{" "}
                {formatNumber(data.checkoutComposition.trialOnly)} started a
                trial and never paid, and{" "}
                {formatNumber(data.checkoutComposition.cardedNeverCharged)}{" "}
                carded at checkout without a trial and were never charged.
                Both <code>plan_key</code> and <code>trial_end</code> are
                stamped at checkout, before any money moves.
              </p>
            ) : null}
          </article>

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2 className="heading-with-info">
                  <span>Like for like: everyone here paid</span>
                  <InfoHint info={CAUSALITY_INFO} />
                </h2>
                <p className="panel-description">
                  The cleanest read on the page. Both columns are customers who
                  were actually charged, so neither is diluted by trials that
                  never paid. Activation, repeat use and 30-day retention come
                  out the same; only volume differs, and diagnoses per active
                  day being flat says that is mostly tenure rather than
                  enthusiasm.
                </p>
              </div>
            </div>
            <LikeForLikeTable cohorts={data.cohorts} />
          </article>

          {data.relative.length > 0 ? (
            <article className="panel panel-wide">
              <LineChart
                info={{
                  title: "Before and after the discount landed",
                  body:
                    "Diagnoses per week for promo users, aligned so week 0 is the week their discount was applied. If a discount changed behaviour, the line should step up to the right of week 0.",
                  sources: ["promo_relative_activity()"],
                  logic:
                    "Anchored on the FIRST grant per user. Users who joined recently contribute fewer weeks on the right, so the far edges are thinner and should not be over-read.",
                }}
                points={data.relative}
                series={[
                  {
                    key: "diagnostics",
                    label: "Diagnoses",
                    color: COHORT_COLORS.promo,
                  },
                  {
                    key: "users",
                    label: "Active users",
                    color: COHORT_COLORS.charged_no_promo,
                  },
                ]}
                subtitle="Week 0 is the week the discount was applied"
                title="Before and after the discount landed"
              />
            </article>
          ) : null}

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2>Before and after, counted</h2>
                <p className="panel-description">
                  Split on each user&apos;s own promo date, so it is the same
                  people on both sides.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Measure</th>
                    <th>Before</th>
                    <th>After</th>
                    <th>Change</th>
                    <th>Users</th>
                  </tr>
                </thead>
                <tbody>
                  {data.beforeAfter.map((row) => (
                    <tr key={row.label}>
                      <td className="table-primary">{row.label}</td>
                      <td>{formatNumber(row.before)}</td>
                      <td>{formatNumber(row.after)}</td>
                      <td>
                        {row.delta > 0 ? "+" : ""}
                        {formatNumber(row.delta)}
                      </td>
                      <td>{formatNumber(row.users)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2>Per code and coupon</h2>
                <p className="panel-description">
                  Codes that were never redeemed do not appear: this is built
                  from grants that actually landed on a customer.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Terms</th>
                    <th>Recipients</th>
                    <th>Active now</th>
                    <th>Ever paid</th>
                    <th>Diagnosed</th>
                    <th>Diagnoses</th>
                    <th>Avg per recipient</th>
                    <th>Median days to first use</th>
                    <th>Discount given up</th>
                    <th>First</th>
                    <th>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {data.codes.map((row) => (
                    <tr key={row.key}>
                      <td className="table-primary">
                        {row.code ?? `(no code) ${row.couponId}`}
                      </td>
                      <td>{row.terms}</td>
                      <td>{formatNumber(row.recipients)}</td>
                      <td>{formatNumber(row.activeNow)}</td>
                      <td>{formatNumber(row.everPaid)}</td>
                      <td>
                        {formatNumber(row.withDiagnostics)} ·{" "}
                        {pct(row.withDiagnostics, row.recipients)}
                      </td>
                      <td>{formatNumber(row.totalDiagnostics)}</td>
                      <td>{num(row.avgDiagnostics, 1)}</td>
                      <td>
                        {row.medianDaysToFirstUse === null
                          ? "—"
                          : `${row.medianDaysToFirstUse} d`}
                      </td>
                      <td>
                        {row.discountByCurrency
                          .map((entry) => money(entry.cents, entry.currency))
                          .join(" + ")}
                      </td>
                      <td>{day(row.firstAppliedAt)}</td>
                      <td>{day(row.lastAppliedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </>
      ) : null}

      {/* ================= USERS ======================================= */}
      {tab === "users" ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Users</p>
              <h2 className="heading-with-info">
                <span>Every discounted app user</span>
                <InfoHint info={ACTIVITY_INFO} />
              </h2>
              <p className="panel-description">
                One row per app user, so a workshop with three techs shows three
                rows. Live discounts first, then by diagnoses. Before and After
                are diagnoses either side of that user&apos;s promo date. Calls
                show connected in brackets.
              </p>
            </div>
          </div>
          <UserTable users={data.users} />
          {data.unresolvedGrants > 0 ? (
            <p className="panel-description">
              {formatNumber(data.unresolvedGrants)} grant
              {data.unresolvedGrants === 1 ? "" : "s"} could not be matched to an
              app user, usually a Stripe customer that has since been deleted,
              which keeps the redemption but drops the email. They are counted in
              the money totals and absent from this table.
            </p>
          ) : null}
        </article>
      ) : null}

      {/* ================= TIMELINE =================================== */}
      {tab === "timeline" ? (
        <>
          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Timeline</p>
                <h2 className="heading-with-info">
                  <span>Everything that happened, per user</span>
                  <InfoHint info={ACTIVITY_INFO} />
                </h2>
                <p className="panel-description">
                  Pick a user to see their full history in one stream: signup,
                  the promo landing, every call with the rep who placed it, every
                  email with the mailbox that sent it, replies, and every
                  diagnosis with the car and what they typed.
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
                    {timelineUser.workshop ?? "no workshop"} ·{" "}
                    {timelineUser.code ?? "no code"} · promo applied{" "}
                    {day(timelineUser.appliedAt)} ·{" "}
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
                          <span className="badge">{event.kind}</span>{" "}
                          {event.title}
                        </td>
                        <td>{event.actor ?? "—"}</td>
                        <td>
                          {event.detail
                            ? event.detail.slice(0, 160)
                            : "—"}
                        </td>
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

      {/* ================= OUTREACH =================================== */}
      {tab === "outreach" ? (
        <>
          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Outreach</p>
                <h2 className="heading-with-info">
                  <span>Every call placed to a discounted customer</span>
                  <InfoHint info={ACTIVITY_INFO} />
                </h2>
                <p className="panel-description">
                  Who called, when, whether anyone picked up, and how long after
                  the discount landed. Negative days mean the call came before
                  the discount.
                </p>
              </div>
            </div>
            {data.calls.length === 0 ? (
              <p className="panel-description">
                No calls have ever been placed to a discounted customer.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Customer</th>
                      <th>Workshop</th>
                      <th>Rep</th>
                      <th>Direction</th>
                      <th>Connected</th>
                      <th>Duration</th>
                      <th>Outcome</th>
                      <th>Days from promo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.calls.map((row) => (
                      <tr key={row.id}>
                        <td>{day(row.at)}</td>
                        <td className="table-primary">{row.email ?? "—"}</td>
                        <td>{row.workshop ?? "—"}</td>
                        <td>{row.rep ?? "—"}</td>
                        <td>{row.direction ?? "—"}</td>
                        <td>{row.connected ? "yes" : "no"}</td>
                        <td>{secs(row.durationSeconds)}</td>
                        <td>{row.outcome ?? "—"}</td>
                        <td>
                          {row.daysFromPromo === null
                            ? "—"
                            : `${row.daysFromPromo > 0 ? "+" : ""}${row.daysFromPromo}`}
                        </td>
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
                <h2>Every email sent to a discounted customer</h2>
                <p className="panel-description">
                  Which mailbox sent it, which sequence it belonged to, and
                  whether it was opened, clicked or replied to.
                </p>
              </div>
            </div>
            {data.emails.length === 0 ? (
              <p className="panel-description">
                No sequence emails have ever been sent to a discounted customer.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Customer</th>
                      <th>Sender</th>
                      <th>Subject</th>
                      <th>Sequence</th>
                      <th>Opened</th>
                      <th>Clicked</th>
                      <th>Replied</th>
                      <th>Days from promo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.emails.map((row) => (
                      <tr key={row.id}>
                        <td>{day(row.at)}</td>
                        <td className="table-primary">{row.email ?? "—"}</td>
                        <td>{row.sender ?? "—"}</td>
                        <td>{row.subject ?? "—"}</td>
                        <td>{row.sequence ?? "one-off"}</td>
                        <td>{row.opened ? "yes" : "no"}</td>
                        <td>{row.clicked ? "yes" : "no"}</td>
                        <td>{row.replied ? "yes" : "no"}</td>
                        <td>
                          {row.daysFromPromo === null
                            ? "—"
                            : `${row.daysFromPromo > 0 ? "+" : ""}${row.daysFromPromo}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </>
      ) : null}

      {/* ================= PRODUCT USE ================================= */}
      {tab === "product" ? (
        <>
          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Product use</p>
                <h2 className="heading-with-info">
                  <span>What discounted users actually do in the app</span>
                  <InfoHint info={ACTIVITY_INFO} />
                </h2>
              </div>
            </div>
            {promo && checkout && free ? (
              <div className="summary-grid columns-4">
                <SummaryCard
                  value={formatNumber(promo.totalDiagnostics)}
                  label="Diagnoses by promo users"
                  hint={`${pct(promo.totalDiagnostics, promo.totalDiagnostics + checkout.totalDiagnostics + free.totalDiagnostics)} of all diagnoses, from ${pct(promo.users, promo.users + checkout.users + free.users)} of users`}
                />
                <SummaryCard
                  value={num(promo.diagnosticsPerActiveDay, 2)}
                  label="Diagnoses per active day"
                  hint={`checkout ${num(checkout.diagnosticsPerActiveDay, 2)} · free ${num(free.diagnosticsPerActiveDay, 2)}. Flat, so promo users have more days rather than busier ones`}
                />
                <SummaryCard
                  value={num(promo.avgActiveDays)}
                  label="Active days per promo user"
                  hint={`checkout ${num(checkout.avgActiveDays)} · free ${num(free.avgActiveDays)}`}
                />
                <SummaryCard
                  value={num(promo.avgChats, 2)}
                  label="Chats per promo user"
                  hint={`checkout ${num(checkout.avgChats, 2)} · free ${num(free.avgChats, 2)}`}
                />
              </div>
            ) : null}
          </article>

          <article className="content-grid">
            <TermTable
              caption="Free text a tech typed when starting a diagnosis. The full taxonomy lives on the Diagnostic Search Terms page; this is the raw verbatim, promo users only."
              terms={data.searchTerms}
              title="What they searched for"
            />
            <TermTable
              caption="Car makes behind promo users' diagnoses."
              terms={data.carMakes}
              title="Cars they worked on"
            />
          </article>

          <article className="content-grid">
            <TermTable
              caption="Fault codes entered by promo users."
              terms={data.dtcs}
              title="DTC codes"
            />
            <TermTable
              caption="Symptoms recorded on promo users' diagnoses."
              terms={data.symptoms}
              title="Symptoms"
            />
          </article>
        </>
      ) : null}

      {/* ================= FUNNEL ===================================== */}
      {tab === "funnel" ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Funnel</p>
              <h2 className="heading-with-info">
                <span>How far each cohort gets</span>
                <InfoHint info={CAUSALITY_INFO} />
              </h2>
              <p className="panel-description">
                Each stage is a share of that cohort&apos;s own users, so the
                three columns are comparable despite very different sizes.
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
                  {MAIN_COHORTS.map(
                    (key) => (
                      <div
                        className="funnel-bar"
                        key={key}
                        style={{
                          width: `${stage.pct[key]}%`,
                          background: COHORT_COLORS[key],
                        }}
                        title={`${COHORT_LABELS[key]}: ${formatNumber(stage.counts[key])} (${pctLabel(stage.pct[key])})`}
                      />
                    ),
                  )}
                </div>
                <div className="funnel-rate">
                  {MAIN_COHORTS.map((key) => pctLabel(stage.pct[key] ?? 0)).join(
                    " / ",
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            {MAIN_COHORTS.map((key) => (
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
                  {MAIN_COHORTS.map((key) => (
                    <th key={key}>{COHORT_LABELS[key]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.funnel.map((stage) => (
                  <tr key={stage.key}>
                    <td className="table-primary">{stage.label}</td>
                    {MAIN_COHORTS.map((key) => (
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
      ) : null}
    </div>
  );
}
