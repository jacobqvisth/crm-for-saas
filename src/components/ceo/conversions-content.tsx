import Link from "next/link";
import type { ConversionsData } from "@/lib/ceo/data/conversions";
import { formatNumber, formatPercent } from "@/lib/ceo/format";

export function ConversionsContent({ data }: { data: ConversionsData }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <KpiTile label="Sends" value={formatNumber(data.totalSends)} />
        <KpiTile
          label="Unique recipients"
          value={formatNumber(data.totalUniqueRecipients)}
        />
        <KpiTile
          label="Attributed signups"
          value={formatNumber(data.totalAttributedSignups)}
        />
        <KpiTile
          label="Conversion rate"
          value={
            data.overallConversionRate === null
              ? "—"
              : formatPercent(data.overallConversionRate / 100, 2)
          }
        />
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Per-sequence funnel
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Signups attributed by company-match: the prospect contact who got
            the email isn&rsquo;t always the same person who signed up. Lag is the
            number of days between the most recent attributed send and the
            signup contact landing in the CRM.
          </p>
        </div>
        {data.rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">
            No attributed signups in the window yet. New attributions land
            here whenever a wl-app signup lands at a company we&rsquo;d already
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

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
