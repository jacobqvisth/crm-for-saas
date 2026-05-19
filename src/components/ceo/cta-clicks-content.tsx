import Link from "next/link";
import { DEFAULT_TIME_RANGE_KEY } from "@/lib/ceo/time-ranges";
import type {
  CtaClicksData,
  CtaClicksHostFilter,
} from "@/lib/ceo/data/cta-clicks";

const HOST_LABELS: Record<CtaClicksHostFilter, string> = {
  app: "App",
  marketing: "Marketing site",
  all: "All hosts",
};

const HOST_DESCRIPTIONS: Record<CtaClicksHostFilter, string> = {
  app: "app.wrenchlane.com",
  marketing: "wrenchlane.com",
  all: "Both hosts combined",
};

const LOCATION_LABELS: Record<string, string> = {
  // App (app.wrenchlane.com)
  dashboard: "Dashboard",
  signup: "Sign-up",
  profile: "Profile",
  pricing: "Pricing",
  support: "Support",
  chat: "Chat",
  diagnostics: "Diagnostics session",
  vehicle: "Vehicle",
  vehicle_service: "Vehicle — Service",
  home: "Home / Landing",
  other: "Other",
  // Marketing (wrenchlane.com)
  marketing_home: "Marketing — Home",
  marketing_pricing: "Marketing — Pricing",
  marketing_wrenchlane_one: "Marketing — WrenchLane ONE",
  marketing_landing: "Marketing — Faster Diagnostics LP",
  marketing_about: "Marketing — About",
  marketing_book_demo: "Marketing — Book Demo",
  marketing_contact: "Marketing — Contact",
  marketing_faq: "Marketing — FAQ",
  marketing_signup: "Marketing — Sign-up",
  marketing_article: "Marketing — Articles",
  marketing_tag: "Marketing — Tags",
  marketing_other: "Marketing — Other",
};

function formatNumber(n: number) {
  return n.toLocaleString("en-US");
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function CtaHostTabs({
  rangeKey,
  active,
}: {
  rangeKey: string;
  active: CtaClicksHostFilter;
}) {
  const rangePart =
    rangeKey === DEFAULT_TIME_RANGE_KEY ? "" : `&range=${rangeKey}`;
  return (
    <div
      className="flex gap-1 rounded-md border border-slate-200 bg-white p-1"
      role="tablist"
      aria-label="Filter CTA clicks by host"
    >
      {(["app", "marketing", "all"] as CtaClicksHostFilter[]).map((host) => {
        const href = `/ceo/cta-clicks?host=${host}${rangePart}`;
        const isActive = host === active;
        return (
          <Link
            key={host}
            href={href}
            aria-current={isActive ? "true" : undefined}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? "bg-indigo-600 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {HOST_LABELS[host]}
          </Link>
        );
      })}
    </div>
  );
}

function KpiCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold text-slate-900">{value}</div>
      {subtext ? (
        <div className="mt-1 text-xs text-slate-500">{subtext}</div>
      ) : null}
    </div>
  );
}

function DailyChart({
  daily,
}: {
  daily: { date: string; events: number; users: number }[];
}) {
  const max = Math.max(1, ...daily.map((p) => p.events));
  if (daily.length === 0) {
    return (
      <p className="text-sm text-slate-500">No daily data in this range.</p>
    );
  }
  const HEIGHT = 160;
  const BAR_GAP = 2;
  const WIDTH = Math.max(daily.length * 14, 320);
  const barWidth = (WIDTH - (daily.length - 1) * BAR_GAP) / daily.length;
  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT + 28}`}
        className="block w-full min-w-[320px]"
        role="img"
        aria-label="Daily cta_click events"
      >
        {daily.map((p, i) => {
          const h = (p.events / max) * HEIGHT;
          const x = i * (barWidth + BAR_GAP);
          const y = HEIGHT - h;
          return (
            <g key={p.date}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={h}
                fill={p.events > 0 ? "#4f46e5" : "#e2e8f0"}
                rx={2}
              >
                <title>
                  {formatDate(p.date)} — {formatNumber(p.events)} events,{" "}
                  {formatNumber(p.users)} users
                </title>
              </rect>
            </g>
          );
        })}
        {/* Sparse labels: first, middle, last */}
        {daily.length > 0 ? (
          <text
            x={0}
            y={HEIGHT + 16}
            className="text-[10px] fill-slate-500"
            textAnchor="start"
          >
            {formatDate(daily[0].date)}
          </text>
        ) : null}
        {daily.length > 2 ? (
          <text
            x={WIDTH / 2}
            y={HEIGHT + 16}
            className="text-[10px] fill-slate-500"
            textAnchor="middle"
          >
            {formatDate(daily[Math.floor(daily.length / 2)].date)}
          </text>
        ) : null}
        {daily.length > 1 ? (
          <text
            x={WIDTH}
            y={HEIGHT + 16}
            className="text-[10px] fill-slate-500"
            textAnchor="end"
          >
            {formatDate(daily[daily.length - 1].date)}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

function LocationBars({
  rows,
  total,
}: {
  rows: { location: string; events: number; users: number }[];
  total: number;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No clicks in this range.</p>;
  }
  const max = Math.max(1, ...rows.map((r) => r.events));
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const pct = total > 0 ? (row.events / total) * 100 : 0;
        const barPct = (row.events / max) * 100;
        return (
          <li key={row.location} className="text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-slate-900">
                {LOCATION_LABELS[row.location] ?? row.location}
              </span>
              <span className="font-mono tabular-nums text-slate-700">
                {formatNumber(row.events)}{" "}
                <span className="text-slate-400">events</span>{" "}
                <span className="text-slate-400">·</span>{" "}
                {formatNumber(row.users)}{" "}
                <span className="text-slate-400">users</span>{" "}
                <span className="text-slate-400">·</span>{" "}
                {pct.toFixed(1)}%
              </span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-500"
                style={{ width: `${barPct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TopButtonsTable({
  rows,
  warming,
}: {
  rows: {
    buttonText: string;
    location: string;
    events: number;
    users: number;
  }[];
  warming: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No clicks in this range.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      {warming ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          Custom dimensions are still warming up — GA4 takes up to 24h to start
          attributing <code>button_text</code> to events. Until then this table
          shows <code>(no text)</code> for every row.
        </div>
      ) : null}
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Button text</th>
            <th className="px-4 py-2">Location</th>
            <th className="px-4 py-2 text-right">Events</th>
            <th className="px-4 py-2 text-right">Users</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, i) => (
            <tr key={`${row.buttonText}-${row.location}-${i}`}>
              <td className="px-4 py-2 text-slate-900">{row.buttonText}</td>
              <td className="px-4 py-2 text-slate-600">
                {LOCATION_LABELS[row.location] ?? row.location}
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900">
                {formatNumber(row.events)}
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-600">
                {formatNumber(row.users)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CtaClicksContent({ data }: { data: CtaClicksData }) {
  const hostDescription = HOST_DESCRIPTIONS[data.hostnameFilter];

  return (
    <div className="space-y-8">
      {data.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong className="font-semibold">GA4 fetch failed:</strong>{" "}
          {data.error}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="cta_click events"
          value={formatNumber(data.totals.events)}
          subtext={hostDescription}
        />
        <KpiCard
          label="Unique users"
          value={formatNumber(data.totals.users)}
          subtext={hostDescription}
        />
        <KpiCard
          label="Events per user"
          value={
            data.totals.eventsPerUser
              ? data.totals.eventsPerUser.toFixed(2)
              : "0"
          }
          subtext="Avg cta_click count per active user"
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Daily clicks</h2>
        <p className="mt-1 text-sm text-slate-500">
          One bar per day in the selected range. Hover for the exact count.
        </p>
        <div className="mt-4">
          <DailyChart daily={data.daily} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Clicks by location
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Derived from <code>pagePath</code> server-side, mirroring the GTM CTA
          Location variable.
        </p>
        <div className="mt-4">
          <LocationBars rows={data.byLocation} total={data.totals.events} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Top 30 buttons
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Grouped by <code>button_text</code> × <code>cta_location</code>{" "}
          (custom GA4 event-scoped dimensions).
        </p>
        <div className="mt-4">
          <TopButtonsTable
            rows={data.topButtons}
            warming={data.dimensionsWarming}
          />
        </div>
      </section>

      <p className="text-xs text-slate-400">
        Data generated {new Date(data.generatedAt).toLocaleString("sv-SE", {
          timeZone: "Europe/Stockholm",
          hour12: false,
        })}{" "}
        (Stockholm). Source: Google Analytics 4 property{" "}
        <code>479182799</code>, event <code>cta_click</code>.
      </p>
    </div>
  );
}
