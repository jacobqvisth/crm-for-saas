import { refreshPilotStatsAction } from "@/app/(ceo)/ceo/pilot-stats/actions";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/ceo/format";
import type {
  PilotStatsBarItem,
  PilotStatsData,
  PilotStatsDailyPoint,
  PilotStatsStatusSlice,
} from "@/lib/ceo/data/pilot-stats";

type PilotStatsContentProps = {
  pilot: PilotStatsData;
};

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "never";
  const synced = new Date(iso).getTime();
  const diffMs = Date.now() - synced;
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function FreshnessBar({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const stamp = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString()
    : "never";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--surface)",
        marginBottom: 16,
      }}
    >
      <div style={{ flex: 1, display: "grid", gap: 2 }}>
        <strong style={{ fontSize: "0.95rem" }}>
          Last synced {formatRelativeTime(lastSyncedAt)}
        </strong>
        <span
          style={{
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.78rem",
          }}
        >
          {stamp} — auto-syncs hourly via Vercel cron
        </span>
      </div>
      <form action={refreshPilotStatsAction}>
        <button
          type="submit"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 6,
            border: 0,
            background: "var(--text)",
            color: "#ffffff",
            fontWeight: 500,
            fontSize: "0.85rem",
            cursor: "pointer",
          }}
        >
          Sync now
        </button>
      </form>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  ongoing: "#465fff",
  completed: "#12b76a",
  failed: "#f04438",
  pending: "#fdb022",
  unknown: "#667085",
};

function statusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? "#475467";
}

function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtCost(value: number): string {
  if (!value) return "$0.00";
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return formatCurrency(value, "USD", { maximumFractionDigits: 2 });
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="summary-card">
      <strong>{value}</strong>
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function DailyBarChart({ points }: { points: PilotStatsDailyPoint[] }) {
  if (points.length === 0) {
    return <p className="panel-description">No diagnostics in the last 30 days.</p>;
  }

  const maxValue = Math.max(...points.map((point) => point.count), 1);
  const barWidth = 100 / points.length;
  const labelStep = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="chart-wrap" style={{ height: 240 }}>
      <svg
        aria-label="Diagnostics per day, last 30 days"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
        style={{ width: "100%", height: "100%", overflow: "visible" }}
      >
        {[20, 40, 60, 80].map((line) => (
          <line
            className="chart-grid"
            key={line}
            x1="0"
            x2="100"
            y1={line}
            y2={line}
          />
        ))}
        {points.map((point, index) => {
          const height = (point.count / maxValue) * 88;
          const x = index * barWidth + barWidth * 0.15;
          const y = 92 - height;
          return (
            <rect
              key={point.date}
              x={x}
              y={y}
              width={barWidth * 0.7}
              height={Math.max(height, point.count > 0 ? 0.6 : 0)}
              fill="#465fff"
              rx="0.6"
            >
              <title>{`${shortDate(point.date)} — ${formatNumber(point.count)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.75rem",
          color: "var(--muted)",
          fontFamily: "var(--font-mono)",
          marginTop: 6,
        }}
      >
        {points.map((point, index) =>
          index % labelStep === 0 || index === points.length - 1 ? (
            <span key={point.date}>{shortDate(point.date)}</span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function HorizontalBarList({
  items,
  emptyLabel,
}: {
  items: PilotStatsBarItem[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="panel-description">{emptyLabel}</p>;
  }
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="bar-list">
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <div className="bar-row-copy">
            <strong>{item.label}</strong>
          </div>
          <div className="bar-row-main">
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${Math.max(4, (item.value / maxValue) * 100)}%`,
                }}
              />
            </div>
            <strong>{formatNumber(item.value)}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusDonut({ slices }: { slices: PilotStatsStatusSlice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  if (total === 0) {
    return <p className="panel-description">No diagnostics yet.</p>;
  }

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const arcs = slices.reduce<
    { slice: PilotStatsStatusSlice; length: number; start: number }[]
  >((acc, slice) => {
    const last = acc[acc.length - 1];
    const start = last ? last.start + last.length : 0;
    const length = (slice.count / total) * circumference;
    acc.push({ slice, length, start });
    return acc;
  }, []);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
        alignItems: "center",
      }}
    >
      <svg viewBox="0 0 100 100" style={{ width: "100%", maxWidth: 220 }}>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#f2f4f7" strokeWidth="14" />
        {arcs.map(({ slice, length, start }) => {
          const dash = `${length} ${circumference - length}`;
          return (
            <circle
              key={slice.status}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={statusColor(slice.status)}
              strokeWidth="14"
              strokeDasharray={dash}
              strokeDashoffset={-start}
              transform="rotate(-90 50 50)"
            >
              <title>{`${slice.status}: ${formatNumber(slice.count)} (${formatPercent(
                (slice.count / total) * 100,
              )})`}</title>
            </circle>
          );
        })}
      </svg>
      <div style={{ display: "grid", gap: 8 }}>
        {slices.map((slice) => (
          <div
            key={slice.status}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: statusColor(slice.status),
                display: "inline-block",
              }}
            />
            <span style={{ flex: 1 }}>{slice.status}</span>
            <strong>{formatNumber(slice.count)}</strong>
            <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
              {formatPercent((slice.count / total) * 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PilotStatsContent({ pilot }: PilotStatsContentProps) {
  if (!pilot.available) {
    return (
      <section className="panel">
        <h2>Pilot Stats</h2>
        <p className="panel-description">
          Supabase data is not available in this environment, so the pilot
          stats view cannot render. Check the dashboard service connection.
        </p>
      </section>
    );
  }

  const { kpi } = pilot;

  return (
    <div className="section-stack">
      <FreshnessBar lastSyncedAt={pilot.lastSyncedAt} />
      <section className="summary-grid columns-4">
        <KpiCard
          label="Total Users"
          value={formatNumber(kpi.totalUsers)}
          hint="Registered users across all workshops"
        />
        <KpiCard
          label="Total Workshops"
          value={formatNumber(kpi.totalWorkshops)}
          hint="Unique workshop accounts"
        />
        <KpiCard
          label="Total Diagnostics"
          value={formatNumber(kpi.totalDiagnostics)}
          hint="v2 diagnostic analyses run to date"
        />
        <KpiCard
          label="Total AI Cost"
          value={fmtCost(kpi.totalAiCost)}
          hint="Combined cost of diagnostics + chats"
        />
      </section>

      <section className="summary-grid columns-4">
        <KpiCard
          label="Active Users (7d)"
          value={formatNumber(kpi.activeUsers7d)}
          hint="Users with last_seen_at in the past 7 days"
        />
        <KpiCard
          label="Active Users (30d)"
          value={formatNumber(kpi.activeUsers30d)}
          hint="Users with last_seen_at in the past 30 days"
        />
        <KpiCard
          label="Chat Adoption"
          value={formatPercent(kpi.chatAdoptionRate * 100)}
          hint="% of diagnostics where the user also opened a chat"
        />
        <KpiCard
          label="Avg Blended Cost"
          value={fmtCost(kpi.blendedCostPerDiagnostic)}
          hint="(diag cost + chat cost) / total diagnostics"
        />
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Volume</p>
              <h2>Diagnostics per Day (last 30 days)</h2>
            </div>
          </div>
          <DailyBarChart points={pilot.diagnosticsLast30Days} />
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Workshops</p>
              <h2>Top 10 Workshops by Diagnostics</h2>
            </div>
          </div>
          <HorizontalBarList
            items={pilot.topWorkshops}
            emptyLabel="No workshop diagnostics yet."
          />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Status</p>
              <h2>Diagnostics by Status</h2>
            </div>
          </div>
          <StatusDonut slices={pilot.diagnosticsByStatus} />
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">People</p>
              <h2>Users by Role</h2>
            </div>
          </div>
          <HorizontalBarList
            items={pilot.usersByRole}
            emptyLabel="No users with role data yet."
          />
        </article>
      </section>

      <p
        style={{
          color: "var(--muted)",
          fontSize: "0.8rem",
          fontFamily: "var(--font-mono)",
        }}
      >
        Mirror of the legacy Streamlit Overview. Data refreshes when the core
        app sync runs.
      </p>
    </div>
  );
}
