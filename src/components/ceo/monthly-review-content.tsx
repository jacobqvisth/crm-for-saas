import {
  ACTIVATION_WINDOW_DAYS,
  RETENTION_MIN_DIAGNOSTICS,
  RETENTION_WINDOW_DAYS,
  type MonthlyReviewData,
} from "@/lib/ceo/data/monthly-review";
import { formatNumber } from "@/lib/ceo/format";
import { InfoHint } from "./source-info";

type Props = {
  data: MonthlyReviewData;
};

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function money(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function money2(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function delta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "no change" : "no prior month";
  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(0)}% vs ${formatNumber(previous)}`;
}

function stamp(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/Stockholm",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function MonthlyReviewContent({ data }: Props) {
  if (data.error) {
    return (
      <article className="panel panel-wide">
        <p className="panel-description">
          Could not build the review for {data.monthLabel}: {data.error}
        </p>
      </article>
    );
  }

  const cov = data.coverage;
  const flatActivation =
    data.weeks.filter((w) => w.activationEligible > 0).length >= 3;

  return (
    <div className="section-stack">
      {/* Coverage first. Every wrong number this page exists to prevent came
          from reading a month whose data was incomplete without knowing it. */}
      {(!cov.dataCoversMonth || cov.coreAppFailuresInMonth > 0) && (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <h2>
                {cov.dataCoversMonth
                  ? "This month had ingest failures, since recovered"
                  : "Read this month with care"}
              </h2>
              <p className="panel-description" style={{ marginTop: 4 }}>
                {!cov.dataCoversMonth ? (
                  <>
                    The newest row-level data we hold predates the end of{" "}
                    {data.monthLabel}, so part of the month was never ingested
                    and every per-user number below is computed on a partial
                    cohort.{" "}
                  </>
                ) : (
                  <>
                    The numbers below are complete: the newest data we hold
                    reaches past the end of {data.monthLabel}, so the backfill
                    caught up.{" "}
                  </>
                )}
                {cov.coreAppFailuresInMonth > 0 && (
                  <>
                    For the record, the core_app sync recorded{" "}
                    <strong>{formatNumber(cov.coreAppFailuresInMonth)}</strong>{" "}
                    failed run(s) during {data.monthLabel}
                    {cov.dataCoversMonth
                      ? ", which is why this notice appears"
                      : ""}
                    .{" "}
                  </>
                )}
                Last core_app success: {stamp(cov.coreAppLastSuccessAt)}. Newest
                data held: {stamp(cov.newestDataAt)}.
              </p>
            </div>
          </div>
        </article>
      )}

      <section className="kpi-grid">
        <article className="kpi-card tone-growth">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>New sign-ups</span>
              <InfoHint
                info={{
                  title: "New sign-ups",
                  body: `Users whose signed_up_at falls inside ${data.monthLabel}, Stockholm civil time, half-open [start, end). Internal-test users and workshops excluded.`,
                  fields: ["dashboard_users.signed_up_at"],
                }}
              />
            </p>
            <strong>{formatNumber(data.newUsers)}</strong>
          </div>
          <span className="metric-icon">SU</span>
          <span className="kpi-card-hint">
            {delta(data.newUsers, data.newUsersPrev)}
          </span>
        </article>

        <article className="kpi-card tone-growth">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>New workshops</span>
            </p>
            <strong>{formatNumber(data.newWorkshops)}</strong>
          </div>
          <span className="metric-icon">WS</span>
          <span className="kpi-card-hint">
            {delta(data.newWorkshops, data.newWorkshopsPrev)}
          </span>
        </article>

        <article className="kpi-card tone-product">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Activated ({ACTIVATION_WINDOW_DAYS}d)</span>
              <InfoHint
                info={{
                  title: `Activation, ${ACTIVATION_WINDOW_DAYS}-day window`,
                  body: `Share of the cohort that ran a diagnosis within ${ACTIVATION_WINDOW_DAYS} days of their own sign-up. The denominator counts only users whose window has fully elapsed, so a recent month is not penalised for being recent. Read the absolute count next to it, not just the rate.`,
                  fields: [
                    `Numerator: >= 1 diagnosis in [signed_up_at, +${ACTIVATION_WINDOW_DAYS}d)`,
                    `Denominator: signed_up_at + ${ACTIVATION_WINDOW_DAYS}d <= now()`,
                  ],
                }}
              />
            </p>
            <strong>{pct(data.activatedRate)}</strong>
          </div>
          <span className="metric-icon">AC</span>
          <span className="kpi-card-hint">
            {formatNumber(data.activated)} of{" "}
            {formatNumber(data.activationEligible)} eligible
          </span>
        </article>

        <article className="kpi-card tone-product">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>
                Retained ({RETENTION_MIN_DIAGNOSTICS}+ in{" "}
                {RETENTION_WINDOW_DAYS}d)
              </span>
              <InfoHint
                info={{
                  title: "Retention",
                  body: `The stickier signal: one diagnosis is curiosity, coming back is adoption. Expect this to sit far below the activation rate.`,
                  fields: [
                    `>= ${RETENTION_MIN_DIAGNOSTICS} diagnoses in [signed_up_at, +${RETENTION_WINDOW_DAYS}d)`,
                  ],
                }}
              />
            </p>
            <strong>{pct(data.retainedRate)}</strong>
          </div>
          <span className="metric-icon">RT</span>
          <span className="kpi-card-hint">
            {formatNumber(data.retained)} of{" "}
            {formatNumber(data.retentionEligible)} eligible
          </span>
        </article>

        <article className="kpi-card tone-revenue">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Ad spend</span>
            </p>
            <strong>{money(data.adSpend)}</strong>
          </div>
          <span className="metric-icon">AD</span>
          <span className="kpi-card-hint">
            {data.adSignups === null
              ? "no campaign data"
              : `${formatNumber(data.adSignups)} attributed sign-ups`}
          </span>
        </article>

        <article className="kpi-card tone-revenue">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Cost per paying customer</span>
              <InfoHint
                info={{
                  title: "Cost per paying customer",
                  body: "Total ad spend in the month divided by the number of this month's workshops now on an active paid plan. Compare it against plan price before drawing a conclusion: if it exceeds annual plan value, the channel is losing money regardless of sign-up volume.",
                  fields: [
                    "ad_spend (Google Ads) / cohort workshops with core_subscription_status = active on a non-free plan",
                  ],
                }}
              />
            </p>
            <strong>{money(data.costPerPaidUser)}</strong>
          </div>
          <span className="metric-icon">CP</span>
          <span className="kpi-card-hint">
            {money2(data.costPerSignup)} per sign-up ·{" "}
            {formatNumber(data.paidActive)} paid
          </span>
        </article>
      </section>

      {/* The rate-vs-absolute view. This is the layout decision that matters:
          a rate-only trend reads as an onboarding problem, while absolute
          activations against rising sign-ups exposes acquisition quality. */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h2>
              <span className="heading-with-info">
                Activation through the month
                <InfoHint
                  info={{
                    title: "Why absolute counts sit next to the rate",
                    body: "In July 2026 the rate fell from 43.6% to 16.0% across the month while the absolute number of activating users held flat at 16-17 per block and sign-ups nearly tripled. Same yield, bigger denominator. A rate-only chart would have suggested onboarding regressed; the absolute column showed the extra spend simply bought people who were never going to activate.",
                    fields: [
                      "Sign-ups grouped by day-of-month block, so every row belongs to exactly one month",
                    ],
                  }}
                />
              </span>
            </h2>
            <p className="panel-description" style={{ marginTop: 4 }}>
              Watch the <strong>Activated</strong> column against{" "}
              <strong>Sign-ups</strong>. If sign-ups climb while activations stay
              flat, the problem is who you are acquiring, not your onboarding.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Sign-up block</th>
                <th>Sign-ups</th>
                <th>Eligible</th>
                <th>Activated</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.weeks.map((w) => (
                <tr key={w.label}>
                  <td>
                    <span className="table-primary">
                      <strong>{w.label}</strong>
                    </span>
                  </td>
                  <td>{formatNumber(w.signUps)}</td>
                  <td>{formatNumber(w.activationEligible)}</td>
                  <td>
                    <strong>{formatNumber(w.activated)}</strong>
                  </td>
                  <td>
                    {pct(w.activatedRate)}
                    {w.signUps > 0 && !w.windowComplete ? (
                      <span
                        className="cohort-partial"
                        title={`${w.signUps - w.activationEligible} of ${w.signUps} sign-ups in this block are still inside their ${ACTIVATION_WINDOW_DAYS}-day window.`}
                      >
                        partial
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
              {data.weeks.length === 0 && (
                <tr>
                  <td colSpan={5}>No sign-ups recorded for this month.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {flatActivation && (
          <p className="panel-description" style={{ marginTop: 8 }}>
            Average days from sign-up to first diagnosis:{" "}
            <strong>
              {data.avgDaysToActivate === null
                ? "—"
                : data.avgDaysToActivate.toFixed(1)}
            </strong>
            .
          </p>
        )}
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h2>Where the cohort landed</h2>
            <p className="panel-description" style={{ marginTop: 4 }}>
              Plan and subscription status of the workshops created in{" "}
              {data.monthLabel}. {formatNumber(data.onFree)} on free,{" "}
              {formatNumber(data.paidActive)} on an active paid plan,{" "}
              {formatNumber(data.pastDue)} past due. A past-due count above the
              paid count means billing is failing more often than it succeeds.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Status</th>
                <th>Workshops</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {data.planMix.map((row) => (
                <tr key={`${row.plan}-${row.status}`}>
                  <td>
                    <span className="table-primary">
                      <strong>{row.plan}</strong>
                    </span>
                  </td>
                  <td>{row.status}</td>
                  <td>{formatNumber(row.users)}</td>
                  <td>{pct(row.share)}</td>
                </tr>
              ))}
              {data.planMix.length === 0 && (
                <tr>
                  <td colSpan={4}>No workshops created in this month.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h2>
              <span className="heading-with-info">
                Feature depth
                <InfoHint
                  info={{
                    title: "Feature depth",
                    body: "Events per user is the column that matters. A feature at ~1.0 is being tried once and abandoned; a feature well above 1.0 is one people come back to. In July 2026 ai_search ran at 4.89 while diagnostics sat at 1.14 and chat at exactly 1.00, meaning nobody who opened chat opened it again.",
                    fields: [
                      "dashboard_feature_usage, granularity = day, period_start inside the month",
                    ],
                  }}
                />
              </span>
            </h2>
            <p className="panel-description" style={{ marginTop: 4 }}>
              All users active in {data.monthLabel}, not only the new cohort.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Users</th>
                <th>Events</th>
                <th>Events per user</th>
              </tr>
            </thead>
            <tbody>
              {data.featureDepth.map((row) => (
                <tr key={row.feature}>
                  <td>
                    <span className="table-primary">
                      <strong>{row.feature}</strong>
                    </span>
                  </td>
                  <td>{formatNumber(row.users)}</td>
                  <td>{formatNumber(row.events)}</td>
                  <td>
                    <strong>{row.perUser.toFixed(2)}</strong>
                  </td>
                </tr>
              ))}
              {data.featureDepth.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    No day-granularity feature rows for this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
