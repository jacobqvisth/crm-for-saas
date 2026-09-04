"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, Building2, Users, Globe2, Download, ChevronRight, ExternalLink,
  Mail, Phone, CalendarDays, X, AlertTriangle,
} from "lucide-react";
import {
  ORG_TYPE_LABELS, ORG_TYPE_STYLE, countryFlag,
  type OrgsData, type OrgRow,
} from "@/lib/orgs/types";

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

export function OrgsClient({ data }: { data: OrgsData }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState(ALL);
  const [country, setCountry] = useState(ALL);
  const [umbrella, setUmbrella] = useState(ALL);
  const [onlyWithContacts, setOnlyWithContacts] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const options = useMemo(() => ({
    countries: [...new Set(data.orgs.map((o) => o.country).filter(Boolean))]
      .sort((a, b) => a!.localeCompare(b!, "sv")),
    types: [...new Set(data.orgs.map((o) => o.org_type))].sort(),
    umbrellas: [...new Set(data.orgs.flatMap((o) => o.umbrellas))].sort(),
  }), [data.orgs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.orgs.filter((o) => {
      if (type !== ALL && o.org_type !== type) return false;
      if (country !== ALL && o.country !== country) return false;
      if (umbrella !== ALL && !o.umbrellas.includes(umbrella)) return false;
      if (onlyWithContacts && o.contacts.length === 0) return false;
      if (!needle) return true;
      const hay = [
        o.name, o.acronym, o.country, o.sector, o.notes, o.website,
        ...o.umbrellas,
        ...o.contacts.map((c) => `${c.first_name ?? ""} ${c.last_name ?? ""} ${c.email} ${c.title ?? ""}`),
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [data.orgs, q, type, country, umbrella, onlyWithContacts]);

  const shownContacts = useMemo(
    () => filtered.reduce((n, o) => n + o.contacts.length, 0),
    [filtered],
  );

  function exportCsv() {
    const head = [
      "organisation", "akronym", "typ", "land", "landskod", "sektor",
      "paraplyorganisationer", "webbplats", "epost", "telefon",
      "kontakt_namn", "kontakt_roll", "kontakt_epost",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")];
    for (const o of filtered) {
      const base = [
        o.name, o.acronym, ORG_TYPE_LABELS[o.org_type] ?? o.org_type, o.country,
        o.country_code, o.sector, o.umbrellas.join("; "),
        o.resolved_website ?? o.website, o.email, o.phone,
      ];
      if (o.contacts.length === 0) lines.push([...base, "", "", ""].map(esc).join(","));
      else for (const c of o.contacts) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
        lines.push([...base, name, c.title, c.email].map(esc).join(","));
      }
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `branschorganisationer-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const dirty = q || type !== ALL || country !== ALL || umbrella !== ALL || onlyWithContacts;

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Branschorganisationer</h1>
          <p className="mt-1 text-sm text-slate-500">
            Trade associations, European umbrella bodies, trade fairs and trade press across
            the automotive sector, by country.
          </p>
        </div>
        <button
          onClick={exportCsv}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile icon={Building2} label="Organisationer" value={data.totals.orgs} sub={`${filtered.length} i urvalet`} />
        <Tile icon={Globe2} label="Länder" value={data.totals.countries} sub="plus EU-nivå" />
        <Tile icon={Users} label="Kontakter" value={data.totals.contacts} sub={`${data.totals.namedContacts} med namn`} />
        <Tile
          icon={CalendarDays}
          label="Mässor"
          value={data.orgs.filter((o) => o.org_type === "trade_fair").length}
          sub={`${data.orgs.filter((o) => o.org_type === "media").length} mediehus`}
        />
        <Tile icon={Users} label="Via medlemsföretag" value={data.totals.affiliated} sub="ej importerade" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">Sök</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Organisation, land, sektor eller kontaktperson"
                className="h-9 w-full rounded-md border border-slate-200 pl-8 pr-2 text-sm"
              />
            </div>
          </label>
          <Select
            label="Typ" value={type} onChange={setType}
            options={[[ALL, "Alla"], ...options.types.map((t) => [t, ORG_TYPE_LABELS[t] ?? t])] as [string, string][]}
          />
          <Select
            label="Land" value={country} onChange={setCountry}
            options={[[ALL, "Alla"], ...options.countries.map((c) => [c!, c!])] as [string, string][]}
          />
          <Select
            label="Paraply" value={umbrella} onChange={setUmbrella}
            options={[[ALL, "Alla"], ...options.umbrellas.map((u) => [u, u])] as [string, string][]}
          />
          <label className="flex h-9 items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={onlyWithContacts}
              onChange={(e) => setOnlyWithContacts(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Endast med kontakter
          </label>
          {dirty ? (
            <button
              onClick={() => { setQ(""); setType(ALL); setCountry(ALL); setUmbrella(ALL); setOnlyWithContacts(false); }}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 px-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" /> Rensa
            </button>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {filtered.length} organisationer · {shownContacts} kontakter
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2">Organisation</th>
              <th className="px-3 py-2">Typ</th>
              <th className="px-3 py-2">Land</th>
              <th className="px-3 py-2">Sektor</th>
              <th className="px-3 py-2">Paraply</th>
              <th className="px-3 py-2 text-right">Kontakter</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((o) => (
              <OrgRowView key={o.id} o={o} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} />
            ))}
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-500">Inga organisationer matchar filtret.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrgRowView({ o, open, onToggle }: { o: OrgRow; open: boolean; onToggle: () => void }) {
  const site = o.resolved_website ?? o.website;
  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <td className="px-3 py-2 align-top text-slate-400">
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
        </td>
        <td className="px-3 py-2 align-top">
          <div className="font-medium text-slate-900">
            {o.name}{o.acronym ? <span className="ml-1.5 text-xs text-slate-400">{o.acronym}</span> : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            {o.company_id ? (
              <Link
                href={`/companies/${o.company_id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] text-blue-600 hover:underline"
              >
                CRM-profil
              </Link>
            ) : null}
            {o.blocked ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
                <AlertTriangle className="h-3 w-3" /> blockerar robotar
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 align-top">
          <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${ORG_TYPE_STYLE[o.org_type] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
            {ORG_TYPE_LABELS[o.org_type] ?? o.org_type}
          </span>
        </td>
        <td className="px-3 py-2 align-top text-slate-600">
          <span className="mr-1">{countryFlag(o.country_code)}</span>{o.country ?? "—"}
        </td>
        <td className="px-3 py-2 align-top text-xs text-slate-600">{o.sector ?? <span className="text-slate-300">—</span>}</td>
        <td className="px-3 py-2 align-top">
          <div className="flex flex-wrap gap-1">
            {o.umbrellas.map((u) => (
              <span key={u} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{u}</span>
            ))}
          </div>
        </td>
        <td className="px-3 py-2 align-top text-right font-medium text-slate-700">{o.contacts.length}</td>
      </tr>

      {open ? (
        <tr className="bg-slate-50/60">
          <td />
          <td colSpan={6} className="px-3 pb-4 pt-1">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Om organisationen</h3>
                <div className="space-y-1 text-xs text-slate-600">
                  {site ? (
                    <a href={site} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-blue-600 hover:underline">
                      <ExternalLink className="h-3 w-3" /> {site.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                  ) : null}
                  {o.email ? <div className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-slate-400" /> {o.email}</div> : null}
                  {o.phone ? <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-slate-400" /> {o.phone}</div> : null}
                </div>
                {o.notes ? <p className="mt-2 text-xs leading-relaxed text-slate-600">{o.notes}</p> : null}

                {o.affiliated_contacts?.length ? (
                  <div className="mt-3">
                    <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Hittade via organisationen ({o.affiliated_contacts.length})
                    </h4>
                    <p className="mb-1.5 text-[11px] text-slate-500">
                      Personer som listas hos organisationen men arbetar på medlemsföretag. Inte
                      importerade som kontakter, men ofta intressanta i sig.
                    </p>
                    <ul className="space-y-0.5">
                      {o.affiliated_contacts.slice(0, 12).map((a) => (
                        <li key={a.email} className="truncate text-[11px] text-slate-600">
                          {a.title ? <span className="text-slate-400">{a.title} · </span> : null}{a.email}
                        </li>
                      ))}
                      {o.affiliated_contacts.length > 12 ? (
                        <li className="text-[11px] text-slate-400">+{o.affiliated_contacts.length - 12} till</li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Kontakter ({o.contacts.length})
                </h3>
                {o.contacts.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    {o.blocked
                      ? "Webbplatsen blockerar automatiska anrop, så inga kontakter är hämtade."
                      : "Inga publika kontaktadresser hittade. Många organisationer använder formulär."}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {o.contacts.map((c) => (
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
