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

      {/* Engagement funnel: how the emailed audience moves Sent → Opened →
          Clicked → Signed up. Opens/clicks are inflated by security scanners,
          so they read as upper bounds; the steep drop is click → signup. */}
      <section className="rounded border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Engagement funnel
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Distinct recipients at each step. Open / click rates are{" "}
            <strong>upper bounds</strong> — email security scanners (e.g.
            Microsoft Defender) auto-open and pre-click links, inflating both.
            The meaningful gap is click&nbsp;→&nbsp;signup.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
          <FunnelStep
            label="Emailed"
            value={formatNumber(data.totalUniqueRecipients)}
            note="unique recipients"
          />
          <FunnelStep
            label="Opened"
            value={formatNumber(data.totalOpenedRecipients)}
            note={`${rate(data.totalOpenedRecipients, data.totalUniqueRecipients)} of emailed`}
          />
          <FunnelStep
            label="Clicked"
            value={formatNumber(data.totalClickedRecipients)}
            note={`${rate(data.totalClickedRecipients, data.totalUniqueRecipients)} of emailed`}
          />
          <FunnelStep
            label="Signed up"
            value={formatNumber(data.totalAttributedSignups)}
            note={`${rate(data.totalAttributedSignups, data.totalClickedRecipients)} of clickers`}
            emphasize
          />
        </div>
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
            Each sequence is one market. Compare engagement (open / click) and
            signup conversion across countries to decide where outreach is
            working before expanding to the rest of the EU. Open / click rates
            are upper bounds (scanner-inflated); signups are the trustworthy
            end of the funnel. Lag is days between the attributed send and the
            signup landing in the CRM.
          </p>
        </div>
        {data.rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">
            No sends or attributed signups in the window yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Market (sequence)</th>
                  <th className="px-4 py-2 text-right">Recipients</th>
                  <th className="px-4 py-2 text-right">Opened</th>
                  <th className="px-4 py-2 text-right">Clicked</th>
                  <th className="px-4 py-2 text-right">Signups</th>
                  <th className="px-4 py-2 text-right">Signup rate</th>
                  <th className="px-4 py-2 text-right">Lag (d)</th>
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
                      {formatNumber(row.uniqueRecipients)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatNumber(row.openedRecipients)}
                      <span className="ml-1 text-xs text-slate-400">
                        {rate(row.openedRecipients, row.uniqueRecipients)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatNumber(row.clickedRecipients)}
                      <span className="ml-1 text-xs text-slate-400">
                        {rate(row.clickedRecipients, row.uniqueRecipients)}
                      </span>
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
          </div>
        )}
      </section>
    </div>
  );
}

// Percentage of a/b as a compact label, or an en-dash when undefined.
function rate(a: number, b: number): string {
  return b > 0 ? formatPercent(a / b, 1) : "—";
}

function FunnelStep({
  label,
  value,
  note,
  emphasize,
}: {
  label: string;
  value: string;
  note: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded border p-3 ${
        emphasize ? "border-slate-300 bg-slate-50" : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{note}</p>
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
