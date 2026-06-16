import type {
  LabeledCount,
  PaymentMethodsData,
} from "@/lib/ceo/data/payment-methods";
import { formatNumber, formatPercent } from "@/lib/ceo/format";

export function PaymentMethodsContent({ data }: { data: PaymentMethodsData }) {
  const generatedAt = new Date(data.generatedAtIso);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-slate-600">
        How many accounts have a real payment method (card) on file in Stripe.
        Headline figures are read <strong>live from Stripe</strong> at load and
        cached for 5 minutes; the CRM-mirror section cross-references the
        hourly-synced <code className="text-xs">dashboard_*</code> tables.
        Billing is per <strong>workshop / account</strong> (one Stripe customer
        ≈ one workshop), not per individual app user.
      </p>

      {!data.stripeAvailable && (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Live Stripe data is unavailable (no <code>STRIPE_SECRET_KEY</code> in
          this environment). Showing the CRM-mirror cross-reference only.
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <KpiTile
          label="Cards on file now"
          value={formatNumber(data.customersWithPaymentMethod)}
          hint="Stripe customers with ≥1 payment method attached"
        />
        <KpiTile
          label="Total Stripe customers"
          value={formatNumber(data.totalCustomers)}
        />
        <KpiTile
          label="% with card on file"
          value={
            data.totalCustomers > 0
              ? formatPercent(data.pctWithPaymentMethod, 1)
              : "—"
          }
        />
        <KpiTile
          label="Ever attached a card"
          value={formatNumber(data.subscriptionsWithDefaultPm)}
          hint="Subscriptions referencing a default PM (incl. since-detached)"
        />
      </section>

      <section className="rounded border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">
          Card on file now vs. ever added
        </h2>
        <p className="mt-1">
          <strong>{formatNumber(data.customersWithPaymentMethod)}</strong>{" "}
          customers have a card attached right now. By contrast,{" "}
          <strong>{formatNumber(data.subscriptionsWithDefaultPm)}</strong>{" "}
          subscriptions reference a default payment method historically — many
          of those cards were later detached, or the customer was deleted
          entirely (<strong>{formatNumber(data.deletedCustomerSubscriptions)}</strong>{" "}
          subscriptions point to a now-deleted Stripe customer). The gap is
          churn: paused / canceled accounts whose card was removed. Only{" "}
          <strong>{formatNumber(data.customersWithDefaultPm)}</strong> have a PM
          set as their invoice default.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CountTable
          title="Subscriptions by status"
          subtitle="All Stripe subscriptions (any status)."
          rows={data.subscriptionsByStatus}
          headerLabel="Status"
          total={data.subscriptionsTotal}
          emptyText="No subscriptions found."
        />
        <CountTable
          title="Card-on-file accounts, by subscription status"
          subtitle="Subscriptions whose customer currently has a card attached."
          rows={data.withPmByStatus}
          headerLabel="Status"
          emptyText="No matching subscriptions."
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CountTable
          title="Payment-method mix"
          subtitle="One row per attached payment method, by type / card brand (live Stripe)."
          rows={data.methodMix}
          headerLabel="Method"
          emptyText="No payment methods attached."
        />
        <CountTable
          title="Plan mix (active + trialing)"
          subtitle="From the synced dashboard_subscriptions mirror."
          rows={data.planMix}
          headerLabel="Plan"
          emptyText={
            data.mirrorAvailable
              ? "No active or trialing subscriptions."
              : "CRM mirror unavailable."
          }
        />
      </div>

      <section className="rounded border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            CRM mirror cross-reference
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            From the hourly-synced <code>dashboard_workshops</code> table. &ldquo;Has
            a Stripe record&rdquo; is created when checkout starts, so it
            overcounts true card-on-file — use the live Stripe figure above as
            the source of truth.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <KpiTile
            label="Workshops (total)"
            value={formatNumber(data.workshopsTotal)}
          />
          <KpiTile
            label="With Stripe customer ID"
            value={formatNumber(data.workshopsWithStripeCustomer)}
          />
          <KpiTile
            label="With subscription ID"
            value={formatNumber(data.workshopsWithSubscription)}
          />
        </div>
        {data.paymentStatusBreakdown.length > 0 && (
          <div className="border-t border-slate-200 px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Workshop payment_status
            </h3>
            <div className="flex flex-wrap gap-2">
              {data.paymentStatusBreakdown.map((row) => (
                <span
                  key={row.label}
                  className="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700"
                >
                  <span className="font-medium">{row.label}</span>
                  <span className="tabular-nums text-slate-500">
                    {formatNumber(row.count)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <p className="text-xs text-slate-400">
        Generated {generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC
        · live Stripe + dashboard_* mirror · cached 5 min.
      </p>
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function CountTable({
  title,
  subtitle,
  rows,
  headerLabel,
  total,
  emptyText,
}: {
  title: string;
  subtitle?: string;
  rows: LabeledCount[];
  headerLabel: string;
  total?: number;
  emptyText: string;
}) {
  return (
    <section className="rounded border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          {emptyText}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">{headerLabel}</th>
              <th className="px-4 py-2 text-right">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="px-4 py-2 capitalize text-slate-700">
                  {row.label}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">
                  {formatNumber(row.count)}
                </td>
              </tr>
            ))}
            {typeof total === "number" && (
              <tr className="bg-slate-50">
                <td className="px-4 py-2 font-semibold text-slate-700">Total</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">
                  {formatNumber(total)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
