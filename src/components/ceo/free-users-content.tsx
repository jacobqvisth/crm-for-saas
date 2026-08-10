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
    "Every signup starts on Free — there is no direct paid signup. Conversion is read from the CURRENT Stripe-synced plan on the workshop (dashboard_workshops.plan_key + core_subscription_status). There is no plan-history table, so a workshop that upgraded and later reverted to Free counts as free again — the upgrade-funnel section reconstructs those from Stripe fingerprints.",
  sources: ["dashboard_workshops (Stripe sync)", "dashboard_metric_snapshots · stripe.new_paid_workshops"],
  logic:
    "Paid tier = plan_key prefix one/small/large. Paying = subscription status active; trialing and past_due are shown separately so trials don't inflate the paying count.",
};

const FUNNEL_INFO: SourceInfo = {
  title: "Upgrade funnel reconstruction",
  body:
    "Upgrading to One/Small/Large starts a 14-day free trial that requires a card; cancelling (during the trial or later) reverts the workshop to Free. Because only the current plan is stored, historical funnel states are reconstructed from Stripe fingerprints on the workshop row.",
  sources: ["dashboard_workshops · core_stripe_subscription_id / core_stripe_customer_id / payment_status"],
  logic:
    "Free workshop WITH a subscription id = upgraded then reverted (cancelled or charge failed). Customer id without subscription id = started checkout, never subscribed (abandoned). Paid workshop without Stripe ids = manually provisioned / comped, outside the self-serve funnel. Trial survival = (active + past_due paid workshops with a subscription id) ÷ completed trials (trials started minus those still in-flight).",
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

      {/* ---- Upgrade funnel: Free → trial → paid ----------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Upgrade funnel</p>
            <h2 className="heading-with-info">
              <span>Free → 14-day card trial → paid (and back)</span>
              <InfoHint info={FUNNEL_INFO} />
            </h2>
            <p className="panel-description">
              Every signup starts on Free. An upgrade requires a card and opens
              a 14-day free trial; cancelling at any point reverts the workshop
              to Free. The states below are reconstructed from Stripe
              fingerprints, since only the current plan is stored.
            </p>
          </div>
          <span className="badge">
            {pctLabel(data.funnel.trialSurvivalPct)} trial survival
          </span>
        </div>
        <MiniBarList
          items={[
            {
              label: "On Free today",
              value: data.funnel.freeNow,
              valueLabel: formatNumber(data.funnel.freeNow),
              hint: "Everyone starts here",
            },
            {
              label: "Ever started checkout",
              value: data.funnel.checkoutStarted,
              valueLabel: formatNumber(data.funnel.checkoutStarted),
              hint: "Stripe customer exists",
            },
            {
              label: "Ever started a trial",
              value: data.funnel.trialsStarted,
              valueLabel: formatNumber(data.funnel.trialsStarted),
              hint: "Stripe subscription created (card entered)",
            },
            {
              label: "In trial right now",
              value: data.funnel.trialingNow,
              valueLabel: formatNumber(data.funnel.trialingNow),
            },
            {
              label: "Paying today",
              value: data.funnel.payingNow,
              valueLabel: formatNumber(data.funnel.payingNow),
              hint: `+ ${formatNumber(data.funnel.pastDueNow)} past due`,
            },
            {
              label: "Reverted to Free",
              value: data.funnel.revertedToFree,
              valueLabel: formatNumber(data.funnel.revertedToFree),
              hint: "Cancelled or charge failed",
            },
          ]}
        />
        <div className="summary-grid columns-4">
          <SummaryCard
            value={pctLabel(data.funnel.trialSurvivalPct)}
            label="Trial survival"
            hint={`Still on a paid plan after the trial, of ${formatNumber(
              data.funnel.completedTrials,
            )} completed trials (${pctLabel(data.funnel.payingSurvivalPct)} paying cleanly)`}
          />
          <SummaryCard
            value={formatNumber(data.funnel.revertedToFree)}
            label="Upgraded, then reverted"
            hint={`${formatNumber(
              data.funnel.revertedNeverUsed,
            )} of them never ran a single diagnostic`}
          />
          <SummaryCard
            value={formatNumber(data.funnel.abandonedCheckout)}
            label="Abandoned checkout"
            hint="Started upgrading, never entered a card"
          />
          <SummaryCard
            value={formatNumber(data.funnel.paidManualNoStripe)}
            label="Paid without Stripe ids"
            hint="Manually provisioned / comped — outside the self-serve funnel"
          />
        </div>

        <div className="panel-heading">
          <div>
            <h2>Live trials — the rescue list</h2>
            <p className="panel-description">
              Soonest deadline first. A trial with no product activity is a
              near-certain cancellation: the card is already entered, so usage
              in the next days decides the charge. Zero active days = call or
              email before the trial ends.
            </p>
          </div>
          <span className="badge">{formatNumber(data.liveTrials.length)} trialing</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Workshop</th>
                <th>Plan</th>
                <th>Country</th>
                <th>Trial ends</th>
                <th>Days left</th>
                <th>Active days · 14d</th>
                <th>Diagnostics · 14d</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {data.liveTrials.map((row) => (
                <tr key={row.workshopId}>
                  <td>
                    <a href={`/dashboard/workshops/${row.workshopId}`}>
                      {row.name ?? row.workshopId}
                    </a>
                  </td>
                  <td>{row.tier}</td>
                  <td>{row.country ?? "—"}</td>
                  <td>{formatDate(row.trialEnd)}</td>
                  <td>
                    {row.daysLeft === null
                      ? "—"
                      : row.daysLeft < 0
                        ? "ended (stale status)"
                        : formatNumber(row.daysLeft)}
                  </td>
                  <td>{formatNumber(row.activeDays14)}</td>
                  <td>{formatNumber(row.diags14)}</td>
                  <td>{formatDate(row.lastActiveDate)}</td>
                </tr>
              ))}
              {data.liveTrials.length === 0 ? (
                <tr>
                  <td colSpan={8}>No workshops are trialing right now.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="panel-heading">
          <div>
            <h2>Reverted upgrades — the win-back list</h2>
            <p className="panel-description">
              Workshops that upgraded, cancelled (or failed the charge), and
              are back on Free. Most recently active first — a reverted
              workshop that still uses the product proved intent twice and is
              the warmest win-back target. Top 30 shown.
            </p>
          </div>
          <span className="badge">
            {formatNumber(data.funnel.revertedToFree)} total
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Workshop</th>
                <th>Country</th>
                <th>Signed up</th>
                <th>Diagnostics · lifetime</th>
                <th>Active days · 30d</th>
                <th>Last active</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {data.revertedWorkshops.map((row) => (
                <tr key={row.workshopId}>
                  <td>
                    <a href={`/dashboard/workshops/${row.workshopId}`}>
                      {row.name ?? row.workshopId}
                    </a>
                  </td>
                  <td>{row.country ?? "—"}</td>
                  <td>{row.signupMonth ?? "—"}</td>
                  <td>{formatNumber(row.diagsLifetime)}</td>
                  <td>{formatNumber(row.activeDays30)}</td>
                  <td>{formatDate(row.lastActiveDate)}</td>
                  <td>{row.paymentFailed ? "charge failed" : "cancelled"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel-heading">
          <div>
            <h2>Payment failures — the recovery list</h2>
            <p className="panel-description">
              Past-due paid workshops plus free workshops demoted by a failed
              charge. These tried to pay — the fix is a card update, not a
              pitch.
            </p>
          </div>
          <span className="badge">{formatNumber(data.paymentFailed.length)} workshops</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Workshop</th>
                <th>Plan now</th>
                <th>Country</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.paymentFailed.map((row) => (
                <tr key={row.workshopId}>
                  <td>
                    <a href={`/dashboard/workshops/${row.workshopId}`}>
                      {row.name ?? row.workshopId}
                    </a>
                  </td>
                  <td>{row.tier}</td>
                  <td>{row.country ?? "—"}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
              {data.paymentFailed.length === 0 ? (
                <tr>
                  <td colSpan={4}>No payment failures right now.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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

      {/* ---- How to analyse this --------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Method</p>
            <h2>How to analyse the freemium funnel</h2>
            <p className="panel-description">
              The operating manual for this page: what each state means, which
              rates to watch, and where the data has blind spots.
            </p>
          </div>
        </div>
        <div className="insight-list">
          <p>
            <strong>The model.</strong> Every signup lands on Free — nobody can
            sign up directly on a paid plan. Upgrading to One, Small, or Large
            requires a card and opens a 14-day free trial; cancelling during
            the trial costs nothing, and cancelling at any point reverts the
            workshop to Free. Two consequences: every paid workshop is a
            converted free user, and the Free pool is not one population — it
            mixes never-tried, tried-and-cancelled (reverted upgrades), and
            demoted-by-failed-charge workshops. Segment before concluding
            anything about &quot;free users&quot;.
          </p>
          <p>
            <strong>What each state signals.</strong> A trial is not a lead —
            the card is already entered, so by default it CONVERTS unless they
            cancel; the only real question is whether they used the product
            before day 14. A silent trial (zero active days) is a churn
            certainty, and around day 13 is when cancellations cluster. A
            reverted upgrade proved willingness to pay once; if it is still
            active on Free it is the warmest win-back target on this page. A
            payment failure is not a sales problem at all — it is a card
            update.
          </p>
          <p>
            <strong>The four rates that matter, in funnel order.</strong>{" "}
            (1)&nbsp;Upgrade rate: trials started per week ÷ free workshops
            active that week — measures whether the paywall moments (quota hit,
            InfoPro/Motor locked) convert. (2)&nbsp;Trial engagement: share of
            live trials with product activity in their trial window — the
            leading indicator of everything downstream. (3)&nbsp;Trial
            survival: share of completed trials still on a paid plan — the
            headline number of this section. (4)&nbsp;Churn-back rate: paying
            workshops reverting to Free per month. Improving (2) is usually the
            cheapest way to move (3): the card is in, only usage is missing.
          </p>
          <p>
            <strong>Blind spots to keep in mind.</strong> Plan state is
            current-state only — there are no transition timestamps, so
            time-to-upgrade, exact cancellation dates, and &quot;cancelled on
            day 13 vs day 40&quot; cannot be computed yet. The funnel here is
            reconstructed from Stripe fingerprints, which slightly undercounts
            history: paid workshops without Stripe ids (mostly Large pilots)
            were provisioned manually, and a workshop whose Stripe ids were
            cleared would be invisible. A few &quot;trialing&quot; rows carry a
            trial_end in the past — stale status from the sync, flagged in the
            rescue list. Feature counters only exist from 2026-06-11, and they
            undercount repeat days — lifetime usage judgements should lean on
            the diagnostics table.
          </p>
          <p>
            <strong>The data ask that unlocks the rest.</strong> One small
            plan-transition table — workshop id, old plan/status, new
            plan/status, seen-at — appended by the hourly core_app sync
            whenever plan_key or subscription status changes. That single
            addition turns this reconstructed funnel into a real one:
            time-from-signup-to-upgrade, cancellation timing inside the 14-day
            window, win-back success rate, and true cohort trial-survival
            curves.
          </p>
          <p>
            <strong>How to act on each list.</strong> Live trials with zero
            activity → personal outreach before the trial ends (the Swedish
            ones through the calling pipeline). Reverted upgrades still active
            on Free → win-back offer; ask why they cancelled — at 14 days many
            never reached the value moment. Reverted upgrades that never ran a
            diagnostic → onboarding failed them, not pricing. Abandoned
            checkouts → resume-checkout nudge. Payment failures → card-update
            link, then a call.
          </p>
        </div>
      </article>
    </div>
  );
}
