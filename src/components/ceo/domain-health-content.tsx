// Renders the snapshot from getDomainHealthData. Server component — pure
// presentation, no client state. The page wraps this in DashboardShell.

import type { DomainHealthPageData } from "@/lib/ceo/data/domain-health";
import type { DomainHealthStatus } from "@/lib/domain-health";

function statusBadge(status: DomainHealthStatus | null) {
  if (status === "critical") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-800">
        Critical
      </span>
    );
  }
  if (status === "warning") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">
        Warning
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
        Healthy
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
      No data
    </span>
  );
}

function formatPct(v: number) {
  return `${(v * 100).toFixed(2)}%`;
}

function formatStockholm(iso: string) {
  return new Date(iso).toLocaleString("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour12: false,
  });
}

export function DomainHealthContent({ data }: { data: DomainHealthPageData }) {
  const { latest, history, domain } = data;

  if (!latest) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          No checks yet for {domain}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          The daily cron runs at 08:30 UTC. You can trigger an immediate run by
          POSTing to{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">
            /api/cron/domain-health
          </code>{" "}
          with the <code>CRON_SECRET</code> bearer header.
        </p>
      </div>
    );
  }

  const dns = latest.dns_records;
  const metrics = latest.send_metrics;

  return (
    <div className="space-y-8">
      {/* Status card */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-slate-900">{domain}</h2>
              {statusBadge(latest.status)}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Last checked {formatStockholm(latest.checked_at)} (Stockholm)
            </p>
          </div>
        </div>

        {latest.alerts.length > 0 ? (
          <ul className="mt-4 space-y-1 text-sm">
            {latest.alerts.map((a, i) => (
              <li key={i} className="text-amber-900">
                • {a}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-600">
            Every check passed. Domain auth, blocklist, and send-rate signals are clean.
          </p>
        )}
      </section>

      {/* Send health */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Send health (last 24h)
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Sent" value={metrics.sent.toString()} />
          <Metric
            label="Bounce rate"
            value={formatPct(metrics.bounce_rate)}
            sub={`${metrics.bounces} bounces`}
            tone={
              metrics.bounce_rate >= 0.05
                ? "critical"
                : metrics.bounce_rate >= 0.03
                  ? "warning"
                  : "ok"
            }
          />
          <Metric
            label="Unsubscribe rate"
            value={formatPct(metrics.unsubscribe_rate)}
            sub={`${metrics.unsubscribes} unsubs`}
            tone={metrics.unsubscribe_rate >= 0.02 ? "warning" : "ok"}
          />
          <Metric
            label="Queue failures"
            value={metrics.queue_failures.toString()}
            tone={metrics.queue_failures > 0 ? "warning" : "ok"}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 text-sm text-slate-600">
          <div>
            7-day avg daily volume:{" "}
            <span className="font-medium text-slate-900">
              {metrics.rolling_7d_avg_daily_volume.toFixed(1)}
            </span>
          </div>
          <div>
            Volume vs 7-day avg:{" "}
            <span className="font-medium text-slate-900">
              {metrics.volume_vs_7d_avg.toFixed(2)}×
            </span>
          </div>
          <div>
            Replies:{" "}
            <span className="font-medium text-slate-900">{metrics.replies}</span>
          </div>
        </div>
      </section>

      {/* DNS auth */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">DNS authentication</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Record</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <DnsRow name="SPF" ok={dns.spf.ok} value={dns.spf.value} note={dns.spf.note} />
              <DnsRow
                name={`DKIM (${dns.dkim.selector || "—"})`}
                ok={dns.dkim.ok}
                value={dns.dkim.value}
                note={dns.dkim.note}
              />
              <DnsRow
                name={`DMARC (p=${dns.dmarc.policy ?? "—"})`}
                ok={dns.dmarc.ok}
                value={dns.dmarc.value}
                note={dns.dmarc.note}
              />
              <DnsRow name="MX" ok={dns.mx.ok} value={dns.mx.value} note={dns.mx.note} />
            </tbody>
          </table>
        </div>
      </section>

      {/* Blocklists */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Domain blocklists</h2>
        <p className="mt-1 text-xs text-slate-500">
          Queried through Quad9 (9.9.9.9). Refused responses are surfaced
          separately — they indicate a rate-limited resolver, not a real
          listing.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Blocklist</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {latest.blocklists.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-3 text-slate-500">
                    No blocklist data captured.
                  </td>
                </tr>
              ) : (
                latest.blocklists.map((bl) => (
                  <tr key={bl.list}>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-700">
                      {bl.list}
                    </td>
                    <td className="py-2 pr-4">
                      <BlocklistStateBadge state={bl.state} />
                    </td>
                    <td className="py-2 text-slate-600">
                      {bl.note ?? bl.raw ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* History */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Last 30 checks</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Checked at</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Sent</th>
                <th className="py-2 pr-4">Bounce</th>
                <th className="py-2 pr-4">Unsub</th>
                <th className="py-2">Alerts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...history].reverse().map((h) => (
                <tr key={h.checked_at}>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-700">
                    {formatStockholm(h.checked_at)}
                  </td>
                  <td className="py-2 pr-4">{statusBadge(h.status)}</td>
                  <td className="py-2 pr-4 text-slate-700">{h.send_metrics.sent}</td>
                  <td className="py-2 pr-4 text-slate-700">
                    {formatPct(h.send_metrics.bounce_rate)}
                  </td>
                  <td className="py-2 pr-4 text-slate-700">
                    {formatPct(h.send_metrics.unsubscribe_rate)}
                  </td>
                  <td className="py-2 text-slate-600">
                    {h.alerts.length === 0 ? "—" : h.alerts.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "ok",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warning" | "critical";
}) {
  const toneClass =
    tone === "critical"
      ? "text-red-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function DnsRow({
  name,
  ok,
  value,
  note,
}: {
  name: string;
  ok: boolean;
  value: string | null;
  note?: string;
}) {
  return (
    <tr>
      <td className="py-2 pr-4 font-medium text-slate-700">{name}</td>
      <td className="py-2 pr-4">
        {ok ? (
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            OK
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
            Missing
          </span>
        )}
      </td>
      <td className="py-2 font-mono text-xs text-slate-600 break-all">
        {value ?? note ?? "—"}
      </td>
    </tr>
  );
}

function BlocklistStateBadge({
  state,
}: {
  state: "clean" | "listed" | "refused" | "error";
}) {
  if (state === "clean") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
        Clean
      </span>
    );
  }
  if (state === "listed") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
        Listed
      </span>
    );
  }
  if (state === "refused") {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
        Refused
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
      Error
    </span>
  );
}
