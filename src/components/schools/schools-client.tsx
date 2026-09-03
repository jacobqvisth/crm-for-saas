"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, GraduationCap, Users, BookOpen, MapPin, Download, ChevronRight,
  ExternalLink, Mail, Phone, Building2, X,
} from "lucide-react";
// From types.ts, not data.ts: data.ts imports the server-only Supabase client and
// would be pulled into the browser bundle.
import {
  SCHOOL_TYPE_LABELS, TIER_LABELS,
  type SchoolsData, type SchoolRow,
} from "@/lib/schools/types";

const TIER_STYLE: Record<string, string> = {
  core: "bg-emerald-50 text-emerald-700 border-emerald-200",
  adjacent: "bg-amber-50 text-amber-700 border-amber-200",
  transport: "bg-slate-100 text-slate-600 border-slate-200",
};

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

export function SchoolsClient({ data }: { data: SchoolsData }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState(ALL);
  const [county, setCounty] = useState(ALL);
  const [tier, setTier] = useState("core");
  const [organizer, setOrganizer] = useState(ALL);
  const [orientation, setOrientation] = useState(ALL);
  const [onlyWithContacts, setOnlyWithContacts] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const options = useMemo(() => {
    const counties = [...new Set(data.schools.map((s) => s.county).filter(Boolean))].sort((a, b) => a!.localeCompare(b!, "sv"));
    const types = [...new Set(data.schools.map((s) => s.school_type))].sort();
    const organizers = [...new Set(data.schools.map((s) => s.principal_organizer_type).filter(Boolean))].sort();
    const orientations = [...new Set(data.schools.flatMap((s) => s.orientations))].sort();
    return { counties, types, organizers, orientations };
  }, [data.schools]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.schools.filter((s) => {
      if (tier !== ALL && s.relevance_tier !== tier) return false;
      if (type !== ALL && s.school_type !== type) return false;
      if (county !== ALL && s.county !== county) return false;
      if (organizer !== ALL && s.principal_organizer_type !== organizer) return false;
      if (orientation !== ALL && !s.orientations.includes(orientation)) return false;
      if (onlyWithContacts && s.contacts.length === 0) return false;
      if (!needle) return true;
      // Search covers the things you actually hunt by: school, town, programme and
      // the people, so typing a teacher's surname finds their school.
      const hay = [
        s.name, s.municipality, s.city, s.county, s.corporation_name, s.org_number,
        ...s.programs.map((p) => `${p.program_code ?? ""} ${p.program_name}`),
        ...s.contacts.map((c) => `${c.first_name ?? ""} ${c.last_name ?? ""} ${c.email} ${c.title ?? ""}`),
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [data.schools, q, type, county, tier, organizer, orientation, onlyWithContacts]);

  const shown = useMemo(() => ({
    programs: filtered.reduce((n, s) => n + s.programs.length, 0),
    contacts: filtered.reduce((n, s) => n + s.contacts.length, 0),
  }), [filtered]);

  function exportCsv() {
    // One row per contact so the file is directly usable for outreach, plus a row for
    // schools that have no contact at all, which would otherwise vanish from the export.
    const head = [
      "skola", "skolform", "relevans", "huvudman", "kommun", "lan", "ort",
      "orgnr", "webbplats", "skolans_epost", "telefon", "inriktningar", "program",
      "kontakt_namn", "kontakt_roll", "kontakt_epost",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")];
    for (const s of filtered) {
      const base = [
        s.name, SCHOOL_TYPE_LABELS[s.school_type] ?? s.school_type, s.relevance_tier,
        s.principal_organizer_type, s.municipality, s.county, s.city, s.org_number,
        s.website, s.email, s.phone, s.orientations.join("; "),
        s.programs.map((p) => `${p.program_code ?? ""} ${p.program_name}`.trim()).join("; "),
      ];
      if (s.contacts.length === 0) {
        lines.push([...base, "", "", ""].map(esc).join(","));
      } else {
        for (const c of s.contacts) {
          const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
          lines.push([...base, name, c.title, c.email].map(esc).join(","));
        }
      }
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fordonsutbildningar-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const resetable = q || type !== ALL || county !== ALL || tier !== "core"
    || organizer !== ALL || orientation !== ALL || onlyWithContacts;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Fordonsutbildningar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every school in Sweden that teaches vehicle mechanics, from Skolverket&rsquo;s
            planned-educations register: gymnasium, yrkeshögskola, komvux and adult training.
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
        <Tile icon={GraduationCap} label="Skolor" value={data.totals.schools} sub={`${filtered.length} i urvalet`} />
        <Tile icon={BookOpen} label="Program" value={data.totals.programs} sub={`${shown.programs} i urvalet`} />
        <Tile icon={Users} label="Kontakter" value={data.totals.contacts} sub={`${data.totals.namedContacts} med namn`} />
        <Tile icon={MapPin} label="Län" value={data.totals.counties} sub={`${data.totals.municipalities} kommuner`} />
        <Tile
          icon={Building2}
          label="Gymnasieskolor"
          value={data.schools.filter((s) => s.school_type.includes("gymnasium")).length}
          sub={`${data.schools.filter((s) => s.school_type === "yrkeshogskola").length} YH`}
        />
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
                placeholder="Skola, kommun, program eller kontaktperson"
                className="h-9 w-full rounded-md border border-slate-200 pl-8 pr-2 text-sm"
              />
            </div>
          </label>

          <Select
            label="Relevans" value={tier} onChange={setTier}
            options={[[ALL, "Alla"], ...Object.entries(TIER_LABELS)] as [string, string][]}
          />
          <Select
            label="Skolform" value={type} onChange={setType}
            options={[[ALL, "Alla"], ...options.types.map((t) => [t, SCHOOL_TYPE_LABELS[t] ?? t])] as [string, string][]}
          />
          <Select
            label="Län" value={county} onChange={setCounty}
            options={[[ALL, "Alla"], ...options.counties.map((c) => [c!, c!])] as [string, string][]}
          />
          <Select
            label="Huvudman" value={organizer} onChange={setOrganizer}
            options={[[ALL, "Alla"], ...options.organizers.map((o) => [o!, o!])] as [string, string][]}
          />
          {options.orientations.length > 0 ? (
            <Select
              label="Inriktning" value={orientation} onChange={setOrientation}
              options={[[ALL, "Alla"], ...options.orientations.map((o) => [o, o])] as [string, string][]}
            />
          ) : null}

          <label className="flex h-9 items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={onlyWithContacts}
              onChange={(e) => setOnlyWithContacts(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Endast med kontakter
          </label>

          {resetable ? (
            <button
              onClick={() => {
                setQ(""); setType(ALL); setCounty(ALL); setTier("core");
                setOrganizer(ALL); setOrientation(ALL); setOnlyWithContacts(false);
              }}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 px-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" /> Rensa
            </button>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {filtered.length} skolor · {shown.programs} program · {shown.contacts} kontakter
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2">Skola</th>
              <th className="px-3 py-2">Skolform</th>
              <th className="px-3 py-2">Ort</th>
              <th className="px-3 py-2">Huvudman</th>
              <th className="px-3 py-2">Program</th>
              <th className="px-3 py-2">Inriktningar</th>
              <th className="px-3 py-2 text-right">Kontakter</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((s) => (
              <SchoolRowView key={s.id} s={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
            ))}
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-500">Inga skolor matchar filtret.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SchoolRowView({ s, open, onToggle }: { s: SchoolRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <td className="px-3 py-2 align-top text-slate-400">
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
        </td>
        <td className="px-3 py-2 align-top">
          <div className="font-medium text-slate-900">{s.name}</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${TIER_STYLE[s.relevance_tier] ?? TIER_STYLE.transport}`}>
              {TIER_LABELS[s.relevance_tier] ?? s.relevance_tier}
            </span>
            {s.company_id ? (
              <Link
                href={`/companies/${s.company_id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] text-blue-600 hover:underline"
              >
                CRM-profil
              </Link>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 align-top text-slate-600">{SCHOOL_TYPE_LABELS[s.school_type] ?? s.school_type}</td>
        <td className="px-3 py-2 align-top text-slate-600">
          <div>{s.municipality ?? s.city ?? "—"}</div>
          <div className="text-xs text-slate-400">{s.county ?? ""}</div>
        </td>
        <td className="px-3 py-2 align-top text-slate-600">{s.principal_organizer_type ?? "—"}</td>
        <td className="px-3 py-2 align-top">
          <div className="flex flex-wrap gap-1">
            {s.programs.slice(0, 3).map((p) => (
              <span key={p.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                {p.program_code ?? p.program_name.slice(0, 22)}
              </span>
            ))}
            {s.programs.length > 3 ? (
              <span className="text-[11px] text-slate-400">+{s.programs.length - 3}</span>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 align-top text-xs text-slate-600">
          {s.orientations.length ? s.orientations.join(", ") : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-3 py-2 align-top text-right font-medium text-slate-700">{s.contacts.length}</td>
      </tr>

      {open ? (
        <tr className="bg-slate-50/60">
          <td />
          <td colSpan={7} className="px-3 pb-4 pt-1">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Program ({s.programs.length})
                </h3>
                <ul className="space-y-1.5">
                  {s.programs.map((p) => (
                    <li key={p.id} className="rounded border border-slate-200 bg-white px-2.5 py-1.5">
                      <div className="flex items-baseline gap-2">
                        {p.program_code ? (
                          <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-white">{p.program_code}</span>
                        ) : null}
                        <span className="text-sm text-slate-800">{p.program_name}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {[
                          p.school_form,
                          p.admission_points_average ? `Antagningspoäng snitt ${p.admission_points_average}` : null,
                          p.credits ? `${p.credits} p` : null,
                          p.distance ? "Distans" : null,
                        ].filter(Boolean).join(" · ")}
                      </div>
                      {p.program_url ? (
                        <a
                          href={p.program_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                        >
                          Utbildningssida <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Kontakter ({s.contacts.length})
                </h3>
                <div className="mb-2 space-y-0.5 text-xs text-slate-600">
                  {s.website ? (
                    <a href={s.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-blue-600 hover:underline">
                      <ExternalLink className="h-3 w-3" /> {s.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                  ) : null}
                  {s.email ? <div className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-slate-400" /> {s.email}</div> : null}
                  {s.phone ? <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-slate-400" /> {s.phone}</div> : null}
                  {s.org_number ? <div className="text-slate-400">Org.nr {s.org_number}</div> : null}
                </div>
                {s.notes ? <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{s.notes}</p> : null}
                {s.contacts.length === 0 ? (
                  <p className="text-xs text-slate-400">Inga kontaktpersoner hittade på skolans webbplats.</p>
                ) : (
                  <ul className="space-y-1">
                    {s.contacts.map((c) => (
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
