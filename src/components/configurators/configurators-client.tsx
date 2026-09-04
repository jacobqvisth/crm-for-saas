"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, Building2, Users, Globe2, Download, ChevronRight, ExternalLink,
  Mail, Phone, X, AlertTriangle, Boxes, Repeat, ShieldCheck,
} from "lucide-react";
import {
  ENTRY_TYPE_LABELS, ENTRY_TYPE_STYLE, VENDOR_KIND_LABELS,
  PLATFORM_SOURCE_LABELS, PLATFORM_SOURCE_STYLE, EUROPE_CODES, countryFlag,
  type ConfiguratorsData, type ConfiguratorRow,
} from "@/lib/configurators/types";

const ALL = "__all__";

function Tile({ icon: Icon, label, value, sub }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function ConfiguratorsClient({ data }: { data: ConfiguratorsData }) {
  const [q, setQ] = useState("");
  const [entry, setEntry] = useState("prospect");
  const [country, setCountry] = useState(ALL);
  const [platform, setPlatform] = useState(ALL);
  const [confidence, setConfidence] = useState(ALL);
  const [europeOnly, setEuropeOnly] = useState(true);
  const [onlyWithConfigurator, setOnlyWithConfigurator] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const options = useMemo(() => ({
    countries: [...new Set(data.rows.map((r) => r.country).filter(Boolean))]
      .sort((a, b) => a!.localeCompare(b!, "sv")),
    platforms: [...new Set(data.rows.flatMap((r) => r.platforms))].sort(),
  }), [data.rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (entry !== ALL && r.entry_type !== entry) return false;
      if (country !== ALL && r.country !== country) return false;
      if (platform !== ALL && !r.platforms.includes(platform)) return false;
      if (confidence !== ALL && r.platform_source !== confidence) return false;
      // A row with no country at all is kept under "Europe only": the site simply did
      // not say, and dropping it would hide real European companies behind a .com.
      if (europeOnly && r.country_code && !EUROPE_CODES.has(r.country_code)) return false;
      if (onlyWithConfigurator && !r.configurator_url) return false;
      if (!needle) return true;
      const hay = [
        r.name, r.domain, r.country, r.industry, r.description, r.page_title,
        r.configurator_url, ...r.platforms, ...r.cited_by,
        ...r.contacts.map((c) => `${c.first_name ?? ""} ${c.last_name ?? ""} ${c.email} ${c.title ?? ""}`),
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [data.rows, q, entry, country, platform, confidence, europeOnly, onlyWithConfigurator]);

  const shownContacts = useMemo(
    () => filtered.reduce((n, r) => n + r.contacts.length, 0),
    [filtered],
  );

  function exportCsv() {
    const head = [
      "company", "type", "country", "country_code", "country_source", "industry",
      "website", "configurator_url", "configurator_confidence", "platforms",
      "platform_evidence", "cited_by_vendors", "email", "phone",
      "contact_name", "contact_title", "contact_email",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")];
    for (const r of filtered) {
      const base = [
        r.name, ENTRY_TYPE_LABELS[r.entry_type] ?? r.entry_type, r.country, r.country_code,
        r.country_source, r.industry, r.resolved_website ?? r.website,
        r.configurator_url, r.configurator_score, r.platforms.join("; "),
        r.platform_source, r.cited_by.join("; "), r.email, r.phone,
      ];
      if (r.contacts.length === 0) lines.push([...base, "", "", ""].map(esc).join(","));
      else for (const c of r.contacts) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
        lines.push([...base, name, c.title, c.email].map(esc).join(","));
      }
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `configurators-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const dirty = q || entry !== "prospect" || country !== ALL || platform !== ALL
    || confidence !== ALL || !europeOnly || onlyWithConfigurator;

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Configurators</h1>
          <p className="mt-1 text-sm text-slate-500">
            European companies already running a product configurator, the platform behind
            each one, and a link to the live configurator. Assembled from the customer and
            case pages of {data.totals.vendors} configurator and CPQ vendors.
          </p>
        </div>
        <button
          onClick={exportCsv}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Tile icon={Building2} label="Prospects" value={data.totals.prospects} sub={`${filtered.length} in view`} />
        <Tile icon={ExternalLink} label="With a live link" value={data.totals.withConfigurator} sub="configurator URL found" />
        <Tile icon={ShieldCheck} label="Platform confirmed" value={data.totals.confirmedPlatform} sub="read off the configurator" />
        <Tile icon={Repeat} label="Have switched" value={data.totals.switchers} sub="cited by 2+ vendors" />
        <Tile icon={Globe2} label="Countries" value={data.totals.countries} />
        <Tile icon={Users} label="Contacts" value={data.totals.contacts} sub={`${data.totals.namedContacts} named`} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">Search</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Company, domain, platform, country or contact"
                className="h-9 w-full rounded-md border border-slate-200 pl-8 pr-2 text-sm"
              />
            </div>
          </label>
          <Select
            label="List" value={entry} onChange={setEntry}
            options={[["prospect", "Prospects"], ["vendor", "Vendors"], [ALL, "Both"]]}
          />
          <Select
            label="Country" value={country} onChange={setCountry}
            options={[[ALL, "All"], ...options.countries.map((c) => [c!, c!])] as [string, string][]}
          />
          <Select
            label="Platform" value={platform} onChange={setPlatform}
            options={[[ALL, "All"], ...options.platforms.map((p) => [p, p])] as [string, string][]}
          />
          <Select
            label="Evidence" value={confidence} onChange={setConfidence}
            options={[[ALL, "Any"], ...Object.entries(PLATFORM_SOURCE_LABELS)] as [string, string][]}
          />
          <label className="flex h-9 items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox" checked={europeOnly}
              onChange={(e) => setEuropeOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Europe only
          </label>
          <label className="flex h-9 items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox" checked={onlyWithConfigurator}
              onChange={(e) => setOnlyWithConfigurator(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Has a configurator link
          </label>
          {dirty ? (
            <button
              onClick={() => {
                setQ(""); setEntry("prospect"); setCountry(ALL); setPlatform(ALL);
                setConfidence(ALL); setEuropeOnly(true); setOnlyWithConfigurator(false);
              }}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 px-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {filtered.length} companies · {shownContacts} contacts
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Country</th>
              <th className="px-3 py-2">Platform</th>
              <th className="px-3 py-2">Evidence</th>
              <th className="px-3 py-2">Configurator</th>
              <th className="px-3 py-2 text-right">Contacts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => (
              <RowView key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
            ))}
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-500">No companies match the filter.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowView({ r, open, onToggle }: { r: ConfiguratorRow; open: boolean; onToggle: () => void }) {
  const site = r.resolved_website ?? r.website;
  const short = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <td className="px-3 py-2 align-top text-slate-400">
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
        </td>
        <td className="px-3 py-2 align-top">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900">{r.name}</span>
            {r.entry_type === "vendor" ? (
              <span className={`rounded border px-1.5 py-0.5 text-[11px] ${ENTRY_TYPE_STYLE.vendor}`}>
                {r.vendor_kind ? VENDOR_KIND_LABELS[r.vendor_kind] ?? "Vendor" : "Vendor"}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[11px] text-slate-400">{r.domain}</span>
            {r.company_id ? (
              <Link
                href={`/companies/${r.company_id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] text-blue-600 hover:underline"
              >
                CRM profile
              </Link>
            ) : null}
            {r.blocked ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
                <AlertTriangle className="h-3 w-3" /> blocks robots
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 align-top text-slate-600">
          <span className="mr-1">{countryFlag(r.country_code)}</span>{r.country ?? "—"}
        </td>
        <td className="px-3 py-2 align-top">
          <div className="flex flex-wrap gap-1">
            {r.platforms.slice(0, 3).map((p) => (
              <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{p}</span>
            ))}
            {r.platforms.length > 3 ? (
              <span className="text-[11px] text-slate-400">+{r.platforms.length - 3}</span>
            ) : null}
            {r.platforms.length === 0 ? <span className="text-slate-300">—</span> : null}
          </div>
        </td>
        <td className="px-3 py-2 align-top">
          {r.platform_source ? (
            <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${PLATFORM_SOURCE_STYLE[r.platform_source] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
              {PLATFORM_SOURCE_LABELS[r.platform_source] ?? r.platform_source}
            </span>
          ) : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-3 py-2 align-top">
          {r.configurator_url ? (
            <a
              href={r.configurator_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex max-w-[240px] items-center gap-1 truncate text-xs text-blue-600 hover:underline"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{short(r.configurator_url)}</span>
            </a>
          ) : (
            <span className="text-xs text-slate-400">not found</span>
          )}
        </td>
        <td className="px-3 py-2 align-top text-right font-medium text-slate-700">{r.contacts.length}</td>
      </tr>

      {open ? (
        <tr className="bg-slate-50/60">
          <td />
          <td colSpan={6} className="px-3 pb-4 pt-1">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">About</h3>
                <div className="space-y-1 text-xs text-slate-600">
                  {site ? (
                    <a href={site} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-blue-600 hover:underline">
                      <ExternalLink className="h-3 w-3" /> {short(site)}
                    </a>
                  ) : null}
                  {r.email ? <div className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-slate-400" /> {r.email}</div> : null}
                  {r.phone ? <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-slate-400" /> {r.phone}</div> : null}
                  {r.country_source ? (
                    <div className="text-slate-400">Country from: {r.country_source}</div>
                  ) : null}
                </div>
                {r.description ? <p className="mt-2 text-xs leading-relaxed text-slate-600">{r.description}</p> : null}

                {r.cited_by.length ? (
                  <div className="mt-3">
                    <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Named as a customer by ({r.cited_by.length})
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {r.cited_by.map((v) => (
                        <span key={v} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">{v}</span>
                      ))}
                    </div>
                    {r.cited_by.length > 1 ? (
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        Named by more than one vendor, so they have changed configurator at
                        least once. They are willing to move.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {r.configurator_candidates?.length ? (
                  <div className="mt-3">
                    <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Other pages that looked like a configurator
                    </h4>
                    <ul className="space-y-0.5">
                      {r.configurator_candidates.slice(0, 6).map((c) => (
                        <li key={c.url} className="truncate text-[11px]">
                          <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-blue-600 hover:underline">
                            {short(c.url)}
                          </a>
                          <span className="ml-1 text-slate-300">{c.score}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Boxes className="h-3.5 w-3.5" /> Contacts ({r.contacts.length})
                </h3>
                {r.contacts.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    {r.blocked
                      ? "The site blocks automated requests, so no contacts were fetched."
                      : "No public addresses found. Many manufacturers publish a form only."}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {r.contacts.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5">
                        <div className="min-w-0">
                          <Link href={`/contacts/${c.id}`} className="text-sm text-slate-800 hover:text-blue-600 hover:underline">
                            {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email}
                          </Link>
                          <div className="truncate text-[11px] text-slate-500">{c.email}</div>
                        </div>
                        {c.title ? (
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{c.title}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
