"use client";

import { formatNumber } from "@/lib/ceo/format";
import type {
  FreeUsersData,
  TierStatusBreakdown,
} from "@/lib/ceo/free-users-shared";
import { InfoHint, type SourceInfo } from "./source-info";

type FreeUsersContentProps = {
  data: FreeUsersData;
};

const ACTIVITY_INFO: SourceInfo = {
  title: "Free-user activity",
  body:
    "Active = the user produced at least one tracked feature event (diagnostics, chat, AI search, VRM, InfoPro, Motor) or a diagnostic in the window. Behaviour-based on purpose: logins are a misleading signal in this app (long-lived sessions, median 1 login event ever).",
  sources: ["dashboard_feature_usage", "dashboard_diagnostics"],
  logic:
    "Feature counters exist from 2026-06-11 onward; the diagnostics table covers full history, so lifetime numbers lean on diagnostics while 7/30-day windows use both.",
};

const CONVERSION_INFO: SourceInfo = {
  title: "Free → paid conversion",
  body:
    "Conversion is read from the CURRENT Stripe-synced plan on the workshop (dashboard_workshops.plan_key + core_subscription_status). There is no plan-history table, so a workshop that upgraded and churned back to Free counts as free again.",
  sources: ["dashboard_workshops (Stripe sync)", "dashboard_metric_snapshots · stripe.new_paid_workshops"],
  logic:
    "Paid tier = plan_key prefix one/small/large. Paying = subscription status active; trialing and past_due are shown separately so trials don't inflate the paying count.",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Stockholm",
  });
}

function pctLabel(value: number) {
  return `${value.toFixed(1)}%`;
}

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

function MiniBarList({
  items,
}: {
  items: Array<{ label: string; value: number; valueLabel: string; hint?: string }>;
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="bar-list">
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <div className="bar-row-copy">
            <strong>{item.label}</strong>
            {item.hint ? <span>{item.hint}</span> : null}
          </div>
          <div className="bar-row-main">
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${Math.max(3, (item.value / maxValue) * 100)}%` }}
              />
            </div>
            <strong>{item.valueLabel}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function TierCard({ tier }: { tier: TierStatusBreakdown }) {
  return (
    <div className="summary-card">
      <strong>{formatNumber(tier.workshops)}</strong>
      <span>{tier.label} plan workshops</span>
      <small>
        {formatNumber(tier.active)} paying · {formatNumber(tier.trialing)}{" "}
        trialing · {formatNumber(tier.pastDue)} past due
        {tier.other > 0 ? ` · ${formatNumber(tier.other)} other` : ""}
      </small>
      <small>
        {tier.topCountries
          .map((entry) => `${entry.country} ${entry.workshops}`)
          .join(" · ") || "No workshops yet"}
      </small>
    </div>
  );
}

export function FreeUsersContent({ data }: FreeUsersContentProps) {
  const { kpis, activation } = data;
  const trendMax = Math.max(...data.newPaidTrend.map((row) => row.newPaid), 1);

  return (
    <div className="section-stack">
      {/* ---- KPI header ---------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Freemium base</p>
            <h2 className="heading-with-info">
              <span>How big is the free base, and does it use the product?</span>
              <InfoHint info={ACTIVITY_INFO} />
            </h2>
          </div>
        </div>
        <div className="summary-grid columns-4">
          <SummaryCard
            value={formatNumber(kpis.freeUsers)}
            label="Free users"
            hint={`${formatNumber(kpis.freeWorkshops)} free workshops`}
          />
          <SummaryCard
            value={formatNumber(kpis.active7d)}
            label="Active last 7 days"
            hint={pctLabel((kpis.active7d / Math.max(kpis.freeUsers, 1)) * 100)}
          />
          <SummaryCard
            value={formatNumber(kpis.active30d)}
            label="Active last 30 days"
            hint={pctLabel((kpis.active30d / Math.max(kpis.freeUsers, 1)) * 100)}
          />
          <SummaryCard
            value={formatNumber(kpis.everDiagnosed)}
            label="Ever ran a diagnostic"
            hint={pctLabel(activation.everDiagnosedPct)}
          />
        </div>
        <div className="summary-grid columns-4">
          <SummaryCard
            value={formatNumber(kpis.paidWorkshopsNow)}
            label="Workshops on a paid plan"
            hint={`${pctLabel(kpis.conversionRatePct)} of all workshops`}
            info={CONVERSION_INFO}
          />
          <SummaryCard
            value={formatNumber(kpis.payingActiveNow)}
            label="Paying (active subscription)"
          />
          <SummaryCard
            value={formatNumber(kpis.trialingNow)}
            label="Trialing a paid plan"
          />
          <SummaryCard
            value={formatNumber(kpis.pastDueNow)}
            label="Past due (payment failed)"
          />
        </div>
        <p className="panel-description">{data.note}</p>
      </article>

      {/* ---- Usage frequency + feature mix --------------------------------- */}
      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">How often</p>
              <h2>Active days per free user, last 30 days</h2>
              <p className="panel-description">
                Distinct days with at least one feature event or diagnostic.
                The overwhelming pattern is one-and-done.
              </p>
            </div>
          </div>
          <MiniBarList
            items={data.activityBuckets.map((row) => ({
              label: row.bucket,
              value: row.users,
              valueLabel: formatNumber(row.users),
              hint: pctLabel(row.sharePct),
            }))}
          />
        </article>

        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">What they use</p>
              <h2>Feature mix among free users</h2>
              <p className="panel-description">
                Feature counters exist from 2026-06-11 onward, so
                &quot;all&nbsp;time&quot; here means since that date.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Users · 30d</th>
                  <th>Events · 30d</th>
                  <th>Users · all time</th>
                  <th>Events · all time</th>
                </tr>
              </thead>
              <tbody>
                {data.featureMix.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{formatNumber(row.users30d)}</td>
                    <td>{formatNumber(row.events30d)}</td>
                    <td>{formatNumber(row.usersAll)}</td>
                    <td>{formatNumber(row.eventsAll)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="summary-grid columns-4">
            <SummaryCard
              value={pctLabel(activation.everDiagnosedPct)}
              label="Ever ran a diagnostic"
              hint="Share of current free users"
            />
            <SummaryCard
              value={pctLabel(activation.firstDiagDay1Pct)}
              label="First diagnostic on day 0–1"
              hint={
                activation.medianDaysToFirstDiag !== null
                  ? `Median ${activation.medianDaysToFirstDiag} days after signup`
                  : "No signup-dated diagnostics yet"
              }
            />
            <SummaryCard
              value={pctLabel(activation.returnedAfterWeekPct)}
              label="Returned a week later"
              hint={`Ran another diagnostic 7+ days after their first (of ${formatNumber(
                activation.returnedAfterWeekBase,
              )} users with a first diagnostic ≥14 days old)`}
            />
            <SummaryCard
              value={formatNumber(kpis.everActive)}
              label="Ever active (any feature)"
              hint={pctLabel((kpis.everActive / Math.max(kpis.freeUsers, 1)) * 100)}
            />
          </div>
        </article>
      </section>

      {/* ---- Conversions ---------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Free → paid</p>
            <h2 className="heading-with-info">
              <span>Who has moved onto One, Small, or Large</span>
              <InfoHint info={CONVERSION_INFO} />
            </h2>
          </div>
          <span className="badge">{pctLabel(kpis.conversionRatePct)} of all workshops</span>
        </div>
        <div className="summary-grid columns-3">
          {data.tiers.map((tier) => (
            <TierCard key={tier.tier} tier={tier} />
          ))}
        </div>

        <div className="panel-heading">
          <div>
            <h2>New paid workshops per month</h2>
            <p className="panel-description">
              Stripe&apos;s daily new-paid counter summed per month (tracked
              from 2026-04-17).
            </p>
          </div>
        </div>
        <MiniBarList
          items={data.newPaidTrend.map((row) => ({
            label: row.month,
            value: row.newPaid,
            valueLabel: formatNumber(row.newPaid),
          }))}
        />
        {data.newPaidTrend.length === 0 ? (
          <p className="panel-description">No Stripe trend rows synced yet.</p>
        ) : null}
        <p className="panel-description">
          Peak month context: the bar scale tops out at {formatNumber(trendMax)}{" "}
          new paid workshops in a month.
        </p>
      </article>

      {/* ---- Cohorts + countries -------------------------------------------- */}
      <section className="content-grid">
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Cohorts</p>
              <h2>Signup month → where those workshops are today</h2>
              <p className="panel-description">
                Current plan by workshop signup month. Paid tier includes
                trialing; the Paying column is card-charging subscriptions
                only.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Signup month</th>
                  <th>Workshops</th>
                  <th>Still free</th>
                  <th>On paid tier</th>
                  <th>Paying</th>
                  <th>Trialing</th>
                  <th>Conv. rate</th>
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{formatNumber(row.workshops)}</td>
                    <td>{formatNumber(row.stillFree)}</td>
                    <td>{formatNumber(row.paidTierNow)}</td>
                    <td>{formatNumber(row.payingActive)}</td>
                    <td>{formatNumber(row.trialing)}</td>
                    <td>{pctLabel(row.conversionPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Geography</p>
              <h2>Conversion by country</h2>
              <p className="panel-description">
                Top countries by workshop count, with how many sit on a paid
                tier today.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Country</th>
                  <th>Workshops</th>
                  <th>Paid</th>
                  <th>Paying</th>
                  <th>Conv.</th>
                </tr>
              </thead>
              <tbody>
                {data.countries.map((row) => (
                  <tr key={row.country}>
                    <td>{row.country}</td>
                    <td>{formatNumber(row.workshops)}</td>
                    <td>{formatNumber(row.paidNow)}</td>
                    <td>{formatNumber(row.payingActive)}</td>
                    <td>{pctLabel(row.conversionPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      {/* ---- Engaged free users ---------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Upgrade candidates</p>
            <h2>Most engaged free users, last 30 days</h2>
            <p className="panel-description">
              Every free user with at least one active day in the last 30 days,
              ordered by active days then feature events. This is the warm list
              for quota upsells and personal outreach.
            </p>
          </div>
          <span className="badge">{formatNumber(data.engagedUsers.length)} users</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Company</th>
                <th>Country</th>
                <th>Active days · 30d</th>
                <th>Feature events · 30d</th>
                <th>Diagnostics · 30d</th>
                <th>Diagnostics · lifetime</th>
                <th>Last active</th>
                <th>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {data.engagedUsers.map((row) => (
                <tr key={row.internalUserId}>
                  <td>
                    <div className="table-primary">
                      <strong>{row.name ?? row.username ?? "Unknown user"}</strong>
                      {row.username && row.name ? <span>{row.username}</span> : null}
                    </div>
                  </td>
                  <td>
                    {row.workshopId ? (
                      <a href={`/dashboard/workshops/${row.workshopId}`}>
                        {row.company ?? row.workshopId}
                      </a>
                    ) : (
                      (row.company ?? "—")
                    )}
                  </td>
                  <td>{row.country ?? "—"}</td>
                  <td>{formatNumber(row.activeDays30d)}</td>
                  <td>{formatNumber(row.featureEvents30d)}</td>
                  <td>{formatNumber(row.diags30d)}</td>
                  <td>{formatNumber(row.diagsAll)}</td>
                  <td>{formatDate(row.lastActiveDate)}</td>
                  <td>{formatDate(row.signedUpAt)}</td>
                </tr>
              ))}
              {data.engagedUsers.length === 0 ? (
                <tr>
                  <td colSpan={9}>No free users were active in the last 30 days.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
