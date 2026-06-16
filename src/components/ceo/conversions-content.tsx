import Link from "next/link";
import type { ConversionsData } from "@/lib/ceo/data/conversions";
import { formatNumber, formatPercent } from "@/lib/ceo/format";

export function ConversionsContent({ data }: { data: ConversionsData }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Audience-overlap KPIs. The headline is "how many app signups can we
          trace to outreach", NOT a raw send→signup rate — cold-email reaches
          workshops, but most app signups arrive via other channels. */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <KpiTile
          label="App signups (window)"
          value={formatNumber(data.totalAppSignups)}
          sub="all new app users"
        />
        <KpiTile
          label="Sourced from outreach"
          value={formatNumber(data.totalAttributedSignups)}
          sub="signed up after we emailed them"
        />
        <KpiTile
          label="Outreach-sourced share"
          value={
            data.outreachSourcedShare === null
              ? "—"
              : formatPercent(data.outreachSourcedShare / 100, 1)
          }
          sub="of all app signups"
        />
        <KpiTile
          label="Emails sent"
          value={formatNumber(data.totalSends)}
          sub={`${formatNumber(data.totalUniqueRecipients)} unique recipients`}
        />
      </section>

      <section className="rounded border border-amber-200 bg-amber-50 px-4 py-3">
        <h2 className="text-sm font-semibold text-amber-900">
          Why this number looks low — it&rsquo;s an audience mismatch, not broken
          email
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-amber-800">
          Cold outreach targets <strong>auto-repair workshops</strong>, but the
          vast majority of app signups come from a different channel (app store
          / consumer &amp; hobbyist installs) and were never on an outreach
          list. Across all history only ~25 of ~880 app users sit at a company
          we&rsquo;d emailed, so the share traceable to outreach is structurally
          tiny. Attribution requires the same person/company we emailed{" "}
          <em>before</em> they signed up — matched by email, company, or phone.
          To judge sequence performance, lean on{" "}
          <strong>reply and meeting rates</strong> rather than app-signup
          attribution.
        </p>
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Per-sequence funnel
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Signups attributed when the emailed prospect (or someone at the same
            company / sharing a phone) later became an app user. &ldquo;Rate&rdquo;
            is attributed signups ÷ unique recipients — expect it to be near
            zero for the reason above. Lag is the days between the attributed
            send and the signup landing in the CRM.
          </p>
        </div>
        {data.rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">
            No attributed signups in the window yet. New attributions land
            here whenever a wl-app signup matches someone we&rsquo;d already
            emailed.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Sequence</th>
                <th className="px-4 py-2 text-right">Sends</th>
                <th className="px-4 py-2 text-right">Unique recipients</th>
                <th className="px-4 py-2 text-right">Signups</th>
                <th className="px-4 py-2 text-right">Rate</th>
                <th className="px-4 py-2 text-right">Median lag (days)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((row) => (
                <tr key={row.sequenceId}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/sequences/${row.sequenceId}`}
                      className="text-slate-900 hover:underline"
                    >
                      {row.sequenceName}
                    </Link>
                    {row.sequenceStatus && (
                      <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                        {row.sequenceStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatNumber(row.totalSends)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatNumber(row.uniqueRecipients)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">
                    {formatNumber(row.attributedSignups)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {row.conversionRate === null
                      ? "—"
                      : formatPercent(row.conversionRate / 100, 2)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {row.medianLagDays === null
                      ? "—"
                      : row.medianLagDays.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
