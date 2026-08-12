// Server-rendered content for /funnel. No interactivity: every panel is a
// read of FunnelData, so this stays out of the client bundle.
import type {
  FunnelData,
  LifecycleCampaignRow,
  PayerOriginBucket,
} from "@/lib/ceo/data/funnel";
import { formatNumber, formatPercent } from "@/lib/ceo/format";

const ORIGIN_COLORS: Record<PayerOriginBucket["key"], string> = {
  outbound_email: "bg-amber-500",
  outbound_call: "bg-amber-700",
  partner: "bg-violet-500",
  pre_ads_organic: "bg-emerald-500",
  ads_era_self_serve: "bg-sky-500",
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
            self-serve cannot be split into ads vs App Store vs organic until
            UTM forwarding into signup lands.
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
        clicks are invisible until UTM forwarding lands).
      </p>
    </div>
  );
}
