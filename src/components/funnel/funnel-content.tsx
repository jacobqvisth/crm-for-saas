// Server-rendered content for /funnel. No interactivity: every panel is a
// read of FunnelData, so this stays out of the client bundle.
import type {
  CrmSequenceRow,
  FunnelData,
  Journey,
  LifecycleCampaignRow,
  PayerOriginBucket,
} from "@/lib/ceo/data/funnel";
import { formatNumber, formatPercent } from "@/lib/ceo/format";

const ORIGIN_COLORS: Record<PayerOriginBucket["key"], string> = {
  outbound_email: "bg-amber-500",
  outbound_call: "bg-amber-700",
  partner: "bg-violet-500",
  pre_ads_organic: "bg-emerald-500",
  google_ads: "bg-sky-500",
  self_serve_other: "bg-emerald-400",
  ads_era_self_serve: "bg-slate-400",
  unknown: "bg-slate-400",
};

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-900 tabular-nums">
        {value}
      </p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function BarRow({
  label,
  count,
  total,
  colorClass,
  detail,
}: {
  label: string;
  count: number;
  total: number;
  colorClass: string;
  detail?: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-slate-700">{label}</span>
        <span className="text-sm font-medium text-slate-900 tabular-nums whitespace-nowrap">
          {formatNumber(count)}
          <span className="text-slate-400 font-normal">
            {" "}
            · {formatPercent(pct, 0)}
          </span>
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${colorClass}`}
          style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }}
        />
      </div>
      {detail && <p className="text-[11px] text-slate-400 mt-0.5">{detail}</p>}
    </div>
  );
}

function FunnelFlow({ data }: { data: FunnelData }) {
  const { stages } = data;
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
  const steps = [
    {
      label: "Signed up",
      count: stages.signedUp,
      sub: "workshops",
      rate: null as number | null,
    },
    {
      label: "Activated",
      count: stages.activated,
      sub: "ran ≥1 diagnostic",
      rate: pct(stages.activated, stages.signedUp),
    },
    {
      label: "Ever charged",
      count: stages.everPaid,
      sub: `+ ${stages.paidPlanTrials} paid-plan trials pending`,
      rate: pct(stages.everPaid, stages.signedUp),
    },
    {
      label: "Active subs",
      count: stages.activeSubs,
      sub: `+ ${stages.trialing} trialing`,
      rate: pct(stages.activeSubs, stages.everPaid),
    },
  ];
  const max = Math.max(...steps.map((s) => s.count), 1);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {steps.map((step, index) => (
        <div key={step.label} className="relative">
          <div className="border border-slate-200 rounded-lg p-3 h-full">
            <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
              {step.label}
            </p>
            <p className="text-xl font-semibold text-slate-900 tabular-nums mt-0.5">
              {formatNumber(step.count)}
            </p>
            <p className="text-[11px] text-slate-400">{step.sub}</p>
            <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500"
                style={{ width: `${(step.count / max) * 100}%` }}
              />
            </div>
            {step.rate != null && (
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {formatPercent(step.rate, 0)}{" "}
                {index === 3 ? "of ever-paid still active" : "of signups"}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const JOURNEY_TONE_CHIP: Record<Journey["tone"], { label: string; className: string } | null> = {
  good: { label: "CONVERTING", className: "bg-emerald-50 text-emerald-600" },
  neutral: null,
  pending: { label: "TOO EARLY TO JUDGE", className: "bg-amber-50 text-amber-700" },
  dead: { label: "NOT WORKING", className: "bg-red-50 text-red-600" },
};

function JourneyStrip({ journey }: { journey: Journey }) {
  const chip = JOURNEY_TONE_CHIP[journey.tone];
  const endToEnd =
    journey.entrants > 0 ? (journey.payers / journey.entrants) * 100 : 0;
  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-slate-900">{journey.name}</h3>
        {chip && (
          <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${chip.className}`}>
            {chip.label}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500 tabular-nums whitespace-nowrap">
          end to end:{" "}
          <b className="text-slate-900">
            {formatNumber(journey.payers)} payers
          </b>{" "}
          ({endToEnd >= 10 ? formatPercent(endToEnd, 0) : formatPercent(endToEnd, 1)} of{" "}
          {formatNumber(journey.entrants)})
        </span>
      </div>
      <p className="text-xs text-slate-500 mt-1">{journey.description}</p>
      <div className="mt-3 overflow-x-auto">
        <div className="flex items-stretch gap-0 min-w-max pb-1">
          {journey.steps.map((step, index) => {
            const prev = index > 0 ? journey.steps[index - 1] : null;
            const pct =
              prev && prev.count > 0 ? (step.count / prev.count) * 100 : null;
            const isLast = index === journey.steps.length - 1;
            return (
              <div key={step.label} className="flex items-stretch">
                {index > 0 && (
                  <div className="flex flex-col items-center justify-center px-2 w-[110px] flex-shrink-0">
                    <span className="text-[11px] font-bold text-slate-700 tabular-nums">
                      {pct != null && pct <= 100
                        ? `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}% →`
                        : "→"}
                    </span>
                    {step.trigger && (
                      <span className="text-[10px] text-slate-400 text-center leading-tight mt-0.5">
                        {step.trigger}
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={`w-[130px] flex-shrink-0 rounded-lg border px-3 py-2.5 ${
                    isLast && step.label.toLowerCase().includes("pay")
                      ? "border-emerald-300 bg-emerald-50/50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <p className="text-lg font-semibold text-slate-900 tabular-nums leading-tight">
                    {formatNumber(step.count)}
                  </p>
                  <p className="text-[11px] font-medium text-slate-600 leading-tight mt-0.5">
                    {step.label}
                  </p>
                  {step.note && (
                    <p className="text-[10px] text-slate-400 leading-tight mt-0.5">
                      {step.note}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function sequenceStateChip(row: CrmSequenceRow) {
  if (row.stalled) {
    return (
      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
        STALLED
      </span>
    );
  }
  if (row.replies > 0) {
    return (
      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
        GETTING REPLIES
      </span>
    );
  }
  return (
    <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
      SENDING
    </span>
  );
}

// Analysis-derived recommendations (funnel report 2026-08-12). Static on
// purpose: these change when the strategy changes, not when the data does.
const SUGGESTED_EMAILS: { title: string; trigger: string; why: string; owner: string }[] = [
  {
    title: "Post-diagnostic follow-up: the fault, explained",
    trigger: "diagnostic_analyzed +2h, first diagnostic only",
    why: "66% of payers hit a paywall or quota before paying. This email manufactures that exposure: recap the finding, point at InfoPro/Motor depth on the same car.",
    owner: "Customer.io",
  },
  {
    title: "Rebuilt dunning, 3 touches",
    trigger: "payment_failed day 0, +3d, +7d, plain text from Hans",
    why: "Current dunning recovered 0 of 211. Paying customers are walking out unbothered; 7 sit in past_due right now.",
    owner: "Customer.io + unstall the CRM recovery sequence",
  },
  {
    title: "Cold email 4: the breakup",
    trigger: "step 4 in all six cold sequences, ~day 20",
    why: "Email 3 is already the best reply step (36 vs 31 for the intro) and 4,190 enrollments ended in silence. Breakups classically out-pull every prior step.",
    owner: "CRM sequences",
  },
  {
    title: "Trial-will-end rewrite: show their own usage",
    trigger: "-3d and -1d before trial end, no card",
    why: "Current version converted 0 of 31. Lead with what they did during the trial so the loss is concrete; one-click card add.",
    owner: "Customer.io",
  },
  {
    title: "Pre-quota warning with an offer",
    trigger: "80% of the free monthly quota consumed",
    why: "quota_exceeded fires after the wall (177 sent, 5 converted). Catch them one diagnostic before it and convert intent instead of frustration.",
    owner: "Customer.io, needs one new app event",
  },
  {
    title: "Paying-but-idle rescue",
    trigger: "paid plan + 0 diagnostics 14d after first charge",
    why: "33 confirmed payers have never diagnosed: the highest-churn-risk money in the base. Offer a 15-minute onboarding call.",
    owner: "CRM sequence + call task",
  },
  {
    title: "Review ask",
    trigger: "4+ star in-app rating, or 5th diagnostic",
    why: "Known gap since June; the Reviews dashboard is empty because there is nothing to sync. Social proof feeds every self-serve channel for free.",
    owner: "Customer.io",
  },
  {
    title: "14-day inactivity win-back",
    trigger: "no login 14d after signup",
    why: "The day-3 nudge is the last automatic touch a silent signup ever gets, and 70% of workshops go silent.",
    owner: "Customer.io",
  },
  {
    title: "Canceled win-back with WRENCH30",
    trigger: "30d after cancellation or card-revert",
    why: "15 genuine cancellations plus 191 reverted-after-carding. The 30% offer machinery exists (campaign 52), it just points at the wrong segment.",
    owner: "Customer.io",
  },
];

function campaignStateChip(row: LifecycleCampaignRow) {
  if (row.sent >= 30 && row.converted === 0) {
    return (
      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
        NOT CONVERTING
      </span>
    );
  }
  if (row.conversionRate >= 10) {
    return (
      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
        WORKING
      </span>
    );
  }
  return (
    <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
      {row.state.toUpperCase()}
    </span>
  );
}

export function FunnelContent({ data }: { data: FunnelData }) {
  const { stages, payerTriggers: triggers, outbound, ads } = data;
  const payerTotal = stages.everPaid;
  const monthlyMax = Math.max(...data.signupsByMonth.map((m) => m.signups), 1);

  return (
    <div className="space-y-6">
      {data.error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          Partial data: {data.error}
        </p>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile
          label="Signups"
          value={formatNumber(stages.signedUp)}
          sub="workshops, all time"
        />
        <Tile
          label="Activated"
          value={formatPercent(
            stages.signedUp > 0 ? (stages.activated / stages.signedUp) * 100 : 0,
            0,
          )}
          sub={`${formatNumber(stages.activated)} workshops`}
        />
        <Tile
          label="Ever charged"
          value={formatNumber(stages.everPaid)}
          sub={formatPercent(
            stages.signedUp > 0 ? (stages.everPaid / stages.signedUp) * 100 : 0,
            1,
          ) + " of signups"}
        />
        <Tile
          label="Paid-plan trials"
          value={formatNumber(stages.paidPlanTrials)}
          sub="checked out, never charged yet"
        />
        <Tile
          label="Active subs"
          value={formatNumber(stages.activeSubs)}
          sub={`+ ${stages.trialing} trialing`}
        />
        <Tile
          label="Ads cost / signup"
          value={ads.costPerSignup != null ? `$${ads.costPerSignup}` : "n/a"}
          sub={`$${formatNumber(Math.round(ads.spendUsd))} since ${ads.sinceDate}`}
        />
      </div>

      {/* Stage funnel */}
      <SectionCard
        title="The funnel"
        subtitle="Workshops per stage, all time, internal-test excluded."
      >
        <FunnelFlow data={data} />
      </SectionCard>

      {/* Journeys, left to right */}
      <SectionCard
        title="Journeys: every way a workshop finds us, step by step"
        subtitle="Read each strip left to right: the count that reached the step, the percentage that continued, and what triggers the next step. The green box at the end is money."
      >
        {/* comparison summary */}
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-4 font-semibold">Journey</th>
                <th className="py-1.5 pr-4 font-semibold text-right">Entrants</th>
                <th className="py-1.5 pr-4 font-semibold text-right">Payers</th>
                <th className="py-1.5 font-semibold text-right">End-to-end</th>
              </tr>
            </thead>
            <tbody>
              {[...data.journeys]
                .sort((a, b) => {
                  const rateA = a.entrants > 0 ? a.payers / a.entrants : 0;
                  const rateB = b.entrants > 0 ? b.payers / b.entrants : 0;
                  return rateB - rateA;
                })
                .map((journey) => {
                  const rate =
                    journey.entrants > 0
                      ? (journey.payers / journey.entrants) * 100
                      : 0;
                  return (
                    <tr key={journey.key} className="border-t border-slate-100">
                      <td className="py-1.5 pr-4 text-slate-700">{journey.name}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {formatNumber(journey.entrants)}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums font-medium">
                        {formatNumber(journey.payers)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {rate >= 10 ? formatPercent(rate, 0) : formatPercent(rate, 1)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          {data.journeys.map((journey) => (
            <JourneyStrip key={journey.key} journey={journey} />
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          Cohorts are first-touch: a workshop that got a cold email before
          signup counts in the cold-email journey even if it also saw an ad.
          The ads-era strips split by GA4 per-user first-touch (both sites
          share one GTM container, so the attribution survives the hop from
          the marketing site into the app; trust it from ~June 2026).
          Percentages compare adjacent steps only where the unit is the same;
          arrows without a percentage cross a unit or system boundary (GA4
          clicks vs workshops, PostHog users vs workshops). The paywall-path
          strip counts users, not workshops.
        </p>
      </SectionCard>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Where payers come from */}
        <SectionCard
          title="Where paying customers come from"
          subtitle={`First touch before signup, for the ${formatNumber(payerTotal)} workshops that were actually charged (paid-plan trials excluded: plan_key is set at checkout, before any charge).`}
        >
          {data.payerOrigins.map((bucket) => (
            <BarRow
              key={bucket.key}
              label={bucket.label}
              count={bucket.count}
              total={payerTotal}
              colorClass={ORIGIN_COLORS[bucket.key]}
              detail={bucket.description}
            />
          ))}
          <p className="text-[11px] text-slate-400 mt-3">
            Outbound touches are matched per linked contact (send or call
            timestamped before the workshop&apos;s first signup). Ads-era
            buckets split by GA4 per-user first-touch
            (dashboard_user_attribution, synced hourly): reliable from ~June
            2026 when the user-id wiring landed. Pre-ads signups stay
            date-bucketed regardless of GA4.
          </p>
        </SectionCard>

        {/* What made them pay */}
        <SectionCard
          title="What pushed them to pay"
          subtitle="Behaviour and touches before the first payment."
        >
          <BarRow
            label="Activated first (diagnostic before paying)"
            count={triggers.activatedBeforePaying}
            total={payerTotal}
            colorClass="bg-indigo-500"
          />
          <BarRow
            label="Paid without activating first"
            count={triggers.paidWithoutActivating}
            total={payerTotal}
            colorClass="bg-slate-400"
            detail="Never diagnosed, or diagnosed only after paying. Highest churn-risk segment."
          />
          <BarRow
            label="No payment date on record"
            count={triggers.paidDateUnknown}
            total={payerTotal}
            colorClass="bg-slate-300"
            detail="Legacy or comped plans with no Stripe history"
          />
          <BarRow
            label="Came through a trial"
            count={triggers.cameThroughTrial}
            total={payerTotal}
            colorClass="bg-indigo-400"
          />
          <BarRow
            label="Our email reached them before they paid"
            count={triggers.crmEmailedBeforePaying}
            total={payerTotal}
            colorClass="bg-amber-500"
            detail="Any CRM sequence or one-off email before first payment"
          />
          <BarRow
            label="We called them before they paid"
            count={triggers.crmCalledBeforePaying}
            total={payerTotal}
            colorClass="bg-amber-700"
          />
        </SectionCard>
      </div>

      {/* PostHog friction mix */}
      <SectionCard
        title="Friction events before subscribing"
        subtitle={
          triggers.posthogError
            ? `PostHog unavailable: ${triggers.posthogError}`
            : `Of ${formatNumber(triggers.posthogSubscribers)} subscribers PostHog has seen (events start 2026-06-08), what they hit before their subscription started. Note: subscription_started fires at checkout/trial start, before the first charge. A subscriber can appear in several rows.`
        }
      >
        {!triggers.posthogError && (
          <div className="grid sm:grid-cols-2 gap-x-8">
            <div>
              <BarRow
                label="Hit a feature paywall (InfoPro/Motor)"
                count={triggers.priorPaywallHit}
                total={triggers.posthogSubscribers}
                colorClass="bg-indigo-500"
              />
              <BarRow
                label="Hit a free-plan quota"
                count={triggers.priorQuotaExceeded}
                total={triggers.posthogSubscribers}
                colorClass="bg-indigo-500"
              />
              <BarRow
                label="Opened the billing page"
                count={triggers.priorBillingPageOpened}
                total={triggers.posthogSubscribers}
                colorClass="bg-indigo-400"
              />
            </div>
            <div>
              <BarRow
                label="Started an upgrade"
                count={triggers.priorUpgradeStarted}
                total={triggers.posthogSubscribers}
                colorClass="bg-indigo-400"
              />
              <BarRow
                label="Started a trial first"
                count={triggers.priorTrialStarted}
                total={triggers.posthogSubscribers}
                colorClass="bg-indigo-400"
              />
              <BarRow
                label="No friction event at all (self-driven)"
                count={triggers.noFrictionEvent}
                total={triggers.posthogSubscribers}
                colorClass="bg-emerald-500"
              />
            </div>
          </div>
        )}
      </SectionCard>

      {/* Lifecycle campaigns */}
      <SectionCard
        title="Lifecycle emails (Customer.io)"
        subtitle="Lifetime numbers per campaign. Converted = the campaign's own conversion goal (first diagnostic for activation emails, card added / plan change for payment emails)."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-semibold">Campaign</th>
                <th className="py-2 pr-4 font-semibold text-right">Sent</th>
                <th className="py-2 pr-4 font-semibold text-right">Opened</th>
                <th className="py-2 pr-4 font-semibold text-right">Clicked</th>
                <th className="py-2 pr-4 font-semibold text-right">Converted</th>
                <th className="py-2 pr-4 font-semibold text-right">Conv rate</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.lifecycleCampaigns.map((row) => (
                <tr key={row.campaignId} className="border-t border-slate-100">
                  <td className="py-2 pr-4 text-slate-700">{row.name}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatNumber(row.sent)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatNumber(row.opened)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatNumber(row.clicked)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums font-medium">
                    {formatNumber(row.converted)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPercent(row.conversionRate, 1)}
                  </td>
                  <td className="py-2">{campaignStateChip(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* CRM-sent emails */}
      <SectionCard
        title="Emails we send from the CRM"
        subtitle="Every active sequence: cold outreach plus the post-signup check-ins. Opens are unique emails opened; replies exclude out-of-office."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-semibold">Sequence</th>
                <th className="py-2 pr-4 font-semibold text-right">Emails</th>
                <th className="py-2 pr-4 font-semibold text-right">Enrolled</th>
                <th className="py-2 pr-4 font-semibold text-right">Sent</th>
                <th className="py-2 pr-4 font-semibold text-right">Opened</th>
                <th className="py-2 pr-4 font-semibold text-right">Replies</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.crmSequences.map((row) => (
                <tr key={row.sequenceId} className="border-t border-slate-100">
                  <td className="py-2 pr-4 text-slate-700">{row.name}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.emailSteps}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(row.enrolled)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(row.sent)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatNumber(row.opened)}
                    {row.sent > 0 && (
                      <span className="text-slate-400">
                        {" "}
                        ({formatPercent((row.opened / row.sent) * 100, 0)})
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums font-medium">{formatNumber(row.replies)}</td>
                  <td className="py-2">{sequenceStateChip(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          STALLED = a real audience is enrolled but sends are not happening,
          almost always the unverified-address pause: the send cron demotes
          never-verified addresses instead of sending blind. Verify the
          audience (MillionVerifier) and resume.
        </p>
      </SectionCard>

      {/* Suggested new emails */}
      <SectionCard
        title="Suggested next emails"
        subtitle="Ranked by expected impact, each derived from a number on this page. From the funnel analysis, 2026-08-12."
      >
        <div className="space-y-3">
          {SUGGESTED_EMAILS.map((suggestion, index) => (
            <div key={suggestion.title} className="flex gap-3 border border-slate-200 rounded-lg p-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold flex items-center justify-center">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {suggestion.title}
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {suggestion.owner}
                  </span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="text-slate-400">Trigger:</span> {suggestion.trigger}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{suggestion.why}</p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Signups per month */}
      <SectionCard
        title="Signups per month"
        subtitle="Google Ads Pmax launched 2026-05-19."
      >
        <div className="flex items-end gap-1.5 h-36">
          {data.signupsByMonth.map((point) => (
            <div
              key={point.month}
              className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
              title={`${point.month}: ${point.signups}`}
            >
              <span className="text-[10px] text-slate-500 tabular-nums">
                {point.signups}
              </span>
              <div
                className="w-full rounded-t bg-indigo-500"
                style={{
                  height: `${Math.max((point.signups / monthlyMax) * 100, 2)}%`,
                }}
              />
              <span className="text-[10px] text-slate-400">
                {point.month.slice(2).replace("-", "/")}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>

      <p className="text-xs text-slate-400">
        Generated {new Date(data.generatedAt).toLocaleString("sv-SE")} · cached
        5 minutes · counting unit is the workshop · outbound attribution is a
        lower bound (only timestamped CRM touches count; word of mouth and ad
        clicks now attribute via GA4 per-user first-touch, word of mouth stays
        invisible).
      </p>
    </div>
  );
}
