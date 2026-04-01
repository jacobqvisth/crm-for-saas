"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  Users,
  AlertCircle,
} from "lucide-react";
import { useWorkspace } from "@/lib/hooks/use-workspace";

// ─── Types ───────────────────────────────────────────────────────────────────

type ProspeoSearchResult = {
  person: {
    person_id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    linkedin_url?: string;
    current_job_title?: string;
    headline?: string;
    location?: {
      country?: string;
      country_code?: string;
      state?: string;
      city?: string;
    };
  };
  company: {
    company_id: string;
    name: string;
    website?: string;
    domain?: string;
    industry?: string;
    employee_count?: number;
    employee_range?: string;
    location?: {
      country?: string;
      city?: string;
    };
  };
};

type Pagination = {
  current_page: number;
  per_page: number;
  total_page: number;
  total_count: number;
};

type SearchState = "idle" | "loading" | "results" | "empty" | "error";

type ListOption = { id: string; name: string };

// ─── Country list ─────────────────────────────────────────────────────────────

const NORDIC_COUNTRIES = ["Sweden", "Norway", "Denmark", "Finland", "Iceland"];

const ALL_COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Argentina","Armenia","Australia",
  "Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Belarus","Belgium","Belize",
  "Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei",
  "Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada","Cape Verde",
  "Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo",
  "Costa Rica","Croatia","Cuba","Cyprus","Czech Republic","Democratic Republic of the Congo",
  "Djibouti","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea",
  "Eritrea","Estonia","Ethiopia","Fiji","France","Gabon","Gambia","Georgia","Germany",
  "Ghana","Greece","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras",
  "Hungary","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Ivory Coast",
  "Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kosovo","Kuwait","Kyrgyzstan","Laos",
  "Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg",
  "Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Mauritania","Mauritius",
  "Mexico","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar",
  "Namibia","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria",
  "North Macedonia","Oman","Pakistan","Palestine","Panama","Papua New Guinea","Paraguay",
  "Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda",
  "Saudi Arabia","Senegal","Serbia","Sierra Leone","Singapore","Slovakia","Slovenia",
  "Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan",
  "Suriname","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Togo",
  "Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Uganda","Ukraine",
  "United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan",
  "Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
].filter((c) => !NORDIC_COUNTRIES.includes(c)).sort();

const COUNTRY_OPTIONS = [...NORDIC_COUNTRIES, ...ALL_COUNTRIES];

// ─── Industry options ─────────────────────────────────────────────────────────

type IndustryOption = {
  label: string;
  value: string;
};

const INDUSTRY_OPTIONS: IndustryOption[] = [
  { label: "Auto Repair & Service",  value: "Vehicle Repair and Maintenance" },
  { label: "Automotive",             value: "Automotive" },
  { label: "Car Dealers",            value: "Retail Motor Vehicles" },
  { label: "Motor Vehicle Mfg",      value: "Motor Vehicle Manufacturing" },
  { label: "Parts & Wholesale",      value: "Wholesale Motor Vehicles and Parts" },
  { label: "Transport & Logistics",  value: "Transportation Logistics Supply Chain and Storage" },
  { label: "Industrial Machinery",   value: "Industrial Machinery Manufacturing" },
  { label: "Construction",           value: "Construction" },
];

// ─── Company size options ─────────────────────────────────────────────────────

type SizeOption = {
  label: string;
  values: string[];
};

const SIZE_OPTIONS: SizeOption[] = [
  { label: "1–10",      values: ["1-10"] },
  { label: "11–50",     values: ["11-20", "21-50"] },
  { label: "51–200",    values: ["51-100", "101-200"] },
  { label: "201–500",   values: ["201-500"] },
  { label: "501–1000",  values: ["501-1000"] },
  { label: "1001–2000", values: ["1001-2000"] },
  { label: "2001–5000", values: ["2001-5000"] },
  { label: "5001+",     values: ["5001-10000", "10000+"] },
];

// ─── Seniority options ────────────────────────────────────────────────────────

const SENIORITY_OPTIONS = [
  "Founder/Owner",
  "C-Suite",
  "Partner",
  "Vice President",
  "Head",
  "Director",
  "Manager",
  "Senior",
];

// ─── Suggested job titles ─────────────────────────────────────────────────────

const SUGGESTED_JOB_TITLES = [
  "Workshop owner",
  "Verkstadschef",
  "Bilmekaniker",
  "Service manager",
  "Mekaniker",
  "VD",
];

// ─── Filters type ─────────────────────────────────────────────────────────────

type Filters = {
  // Who
  jobTitles: string[];
  seniorities: string[];

  // Where
  personCountries: string[];

  // Company
  industries: string[];
  sizeLabels: string[];
  keywords: string;

  // Quality
  verifiedEmailOnly: boolean;
  maxPerCompany: number;
};

const DEFAULT_FILTERS: Filters = {
  jobTitles: [],
  seniorities: [],
  personCountries: [],
  industries: [],
  sizeLabels: [],
  keywords: "",
  verifiedEmailOnly: true,
  maxPerCompany: 1,
};

// ─── Filters component ────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100">
      {children}
    </div>
  );
}

function ProspectorFilters({
  filters,
  onChange,
  onSearch,
  onReset,
  loading,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onSearch: () => void;
  onReset: () => void;
  loading: boolean;
}) {
  const [jobTitleInput, setJobTitleInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleCountry = (c: string) => {
    const next = filters.personCountries.includes(c)
      ? filters.personCountries.filter((x) => x !== c)
      : [...filters.personCountries, c];
    onChange({ ...filters, personCountries: next });
  };

  const addJobTitle = (title: string) => {
    const trimmed = title.trim();
    if (!trimmed || filters.jobTitles.includes(trimmed)) return;
    onChange({ ...filters, jobTitles: [...filters.jobTitles, trimmed] });
  };

  const removeJobTitle = (title: string) => {
    onChange({ ...filters, jobTitles: filters.jobTitles.filter((t) => t !== title) });
  };

  const handleJobTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addJobTitle(jobTitleInput);
      setJobTitleInput("");
    }
  };

  const toggleSeniority = (v: string) => {
    const next = filters.seniorities.includes(v)
      ? filters.seniorities.filter((x) => x !== v)
      : [...filters.seniorities, v];
    onChange({ ...filters, seniorities: next });
  };

  const toggleIndustry = (v: string) => {
    const next = filters.industries.includes(v)
      ? filters.industries.filter((x) => x !== v)
      : [...filters.industries, v];
    onChange({ ...filters, industries: next });
  };

  const toggleSize = (label: string) => {
    const next = filters.sizeLabels.includes(label)
      ? filters.sizeLabels.filter((x) => x !== label)
      : [...filters.sizeLabels, label];
    onChange({ ...filters, sizeLabels: next });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── WHO ─────────────────────────────────────────────────────────── */}
      <SectionHeader>Who</SectionHeader>

      {/* Job Title */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Job Title
        </label>
        {filters.jobTitles.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {filters.jobTitles.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs"
              >
                {t}
                <button onClick={() => removeJobTitle(t)} className="hover:text-indigo-900">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          value={jobTitleInput}
          onChange={(e) => setJobTitleInput(e.target.value)}
          onKeyDown={handleJobTitleKeyDown}
          onBlur={() => {
            if (jobTitleInput.trim()) {
              addJobTitle(jobTitleInput);
              setJobTitleInput("");
            }
          }}
          placeholder="Add a title and press Enter"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {SUGGESTED_JOB_TITLES.filter((t) => !filters.jobTitles.includes(t)).map((t) => (
            <button
              key={t}
              onClick={() => addJobTitle(t)}
              className="px-2 py-0.5 rounded-full border border-slate-200 text-slate-400 text-xs hover:border-indigo-300 hover:text-indigo-500 transition-colors"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Seniority */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Seniority
        </label>
        <div className="flex flex-wrap gap-2">
          {SENIORITY_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => toggleSeniority(s)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                filters.seniorities.includes(s)
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-slate-600 border-slate-300 hover:border-indigo-400 hover:text-indigo-600"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── WHERE ───────────────────────────────────────────────────────── */}
      <SectionHeader>Where</SectionHeader>

      {/* Country */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Country
        </label>
        <select
          multiple
          size={6}
          value={filters.personCountries}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
            onChange({ ...filters, personCountries: selected });
          }}
          className="w-full rounded-lg border border-slate-300 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        >
          {COUNTRY_OPTIONS.map((c) => (
            <option key={c} value={c} className={NORDIC_COUNTRIES.includes(c) ? "font-semibold" : ""}>
              {NORDIC_COUNTRIES.includes(c) ? `★ ${c}` : c}
            </option>
          ))}
        </select>
        {filters.personCountries.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {filters.personCountries.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs"
              >
                {c}
                <button onClick={() => toggleCountry(c)} className="hover:text-indigo-900">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── COMPANY ─────────────────────────────────────────────────────── */}
      <SectionHeader>Company</SectionHeader>

      {/* Industry */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Industry
        </label>
        <div className="flex flex-wrap gap-2">
          {INDUSTRY_OPTIONS.map((ind) => (
            <button
              key={ind.value}
              onClick={() => toggleIndustry(ind.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                filters.industries.includes(ind.value)
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-slate-600 border-slate-300 hover:border-indigo-400 hover:text-indigo-600"
              }`}
            >
              {ind.label}
            </button>
          ))}
        </div>
      </div>

      {/* Company size */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Company Size
        </label>
        <div className="flex flex-wrap gap-2">
          {SIZE_OPTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => toggleSize(s.label)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                filters.sizeLabels.includes(s.label)
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-slate-600 border-slate-300 hover:border-indigo-400 hover:text-indigo-600"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Company Keywords */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Company Keywords
        </label>
        <input
          type="text"
          value={filters.keywords}
          onChange={(e) => onChange({ ...filters, keywords: e.target.value })}
          placeholder="e.g. bilverkstad, verkstad, däck"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <p className="mt-1 text-xs text-slate-400">Searches company names and descriptions</p>
      </div>

      {/* ── QUALITY ─────────────────────────────────────────────────────── */}
      <SectionHeader>Quality</SectionHeader>

      {/* Verified emails only */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.verifiedEmailOnly}
            onChange={(e) => onChange({ ...filters, verifiedEmailOnly: e.target.checked })}
            className="text-indigo-600 rounded"
          />
          <span className="text-sm font-medium text-slate-700">Verified emails only</span>
        </label>
        <p className="mt-1 text-xs text-slate-400 ml-6">
          Only show contacts where Prospeo has a confirmed email address
        </p>
      </div>

      {/* Max per company */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Max per company
        </label>
        <input
          type="number"
          min={1}
          max={10}
          value={filters.maxPerCompany}
          onChange={(e) =>
            onChange({
              ...filters,
              maxPerCompany: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)),
            })
          }
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <p className="mt-1 text-xs text-slate-400">Limit results per company</p>
      </div>

      {/* Search button */}
      <button
        onClick={onSearch}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Search className="w-4 h-4" />
        )}
        {loading ? "Searching…" : "Search"}
      </button>

      <button
        onClick={onReset}
        className="text-sm text-slate-500 hover:text-slate-700 text-center"
      >
        Reset filters
      </button>
    </div>
  );
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="animate-pulse">
          <td className="px-4 py-3"><div className="h-4 w-4 bg-slate-200 rounded" /></td>
          <td className="px-4 py-3"><div className="h-4 bg-slate-200 rounded w-32" /></td>
          <td className="px-4 py-3"><div className="h-4 bg-slate-200 rounded w-40" /></td>
          <td className="px-4 py-3"><div className="h-4 bg-slate-200 rounded w-28" /></td>
          <td className="px-4 py-3"><div className="h-4 bg-slate-200 rounded w-24" /></td>
          <td className="px-4 py-3"><div className="h-4 bg-slate-200 rounded w-8" /></td>
        </tr>
      ))}
    </>
  );
}

// ─── Add contacts modal ───────────────────────────────────────────────────────

type ModalProps = {
  contacts: ProspeoSearchResult[];
  workspaceId: string;
  onClose: () => void;
  onSuccess: (added: number, skipped: number, listId: string | null) => void;
};

function AddContactsModal({ contacts, workspaceId, onClose, onSuccess }: ModalProps) {
  const [listMode, setListMode] = useState<"none" | "existing" | "new">("none");
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [newListName, setNewListName] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [lists, setLists] = useState<ListOption[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [progress, setProgress] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<{
    added: number;
    skipped: number;
    listId: string | null;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const handleListModeChange = async (mode: "none" | "existing" | "new") => {
    setListMode(mode);
    if (mode === "existing" && !listsLoaded) {
      try {
        const res = await fetch(`/api/lists?workspaceId=${workspaceId}`);
        if (res.ok) {
          const data = await res.json();
          setLists(data.lists || []);
        }
      } catch {
        // non-critical
      }
      setListsLoaded(true);
    }
  };

  const handleConfirm = async () => {
    setProgress("loading");
    try {
      const contactsPayload = contacts.map((r) => ({
        person_id: r.person.person_id,
        full_name: r.person.full_name,
        current_job_title: r.person.current_job_title || "",
        company_name: r.company?.name || "",
        company_domain: r.company?.domain || null,
        city: r.person.location?.city || null,
        country: r.person.location?.country || null,
      }));

      const res = await fetch("/api/prospector/add-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contacts: contactsPayload,
          listId: listMode === "existing" ? selectedListId || null : null,
          newListName: listMode === "new" ? newListName.trim() || null : null,
          skipDuplicates,
          workspaceId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "Failed to add contacts");
        setProgress("error");
        return;
      }

      setResult({ added: data.added, skipped: data.skipped, listId: data.listId });
      setProgress("done");
      onSuccess(data.added, data.skipped, data.listId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setProgress("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        {progress === "idle" && (
          <>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              Add {contacts.length} contact{contacts.length !== 1 ? "s" : ""} to CRM
            </h2>
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5">
              This will use <strong>{contacts.length} credit{contacts.length !== 1 ? "s" : ""}</strong> to reveal email addresses.
            </p>

            {/* List assignment */}
            <div className="mb-5">
              <p className="text-sm font-medium text-slate-700 mb-2">Add to list (optional)</p>
              <div className="flex flex-col gap-2">
                {(["none", "existing", "new"] as const).map((mode) => (
                  <label key={mode} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="listMode"
                      value={mode}
                      checked={listMode === mode}
                      onChange={() => handleListModeChange(mode)}
                      className="text-indigo-600"
                    />
                    <span className="text-sm text-slate-700">
                      {mode === "none" && "Don't add to a list"}
                      {mode === "existing" && "Add to existing list"}
                      {mode === "new" && "Create new list"}
                    </span>
                  </label>
                ))}
              </div>

              {listMode === "existing" && (
                <select
                  value={selectedListId}
                  onChange={(e) => setSelectedListId(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select a list…</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              )}

              {listMode === "new" && (
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="New list name"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              )}
            </div>

            {/* Duplicate handling */}
            <label className="flex items-center gap-2 cursor-pointer mb-6">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(e) => setSkipDuplicates(e.target.checked)}
                className="text-indigo-600 rounded"
              />
              <span className="text-sm text-slate-700">
                Skip contacts already in CRM (by email)
              </span>
            </label>

            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Add contacts
              </button>
              <button
                onClick={onClose}
                className="flex-1 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {progress === "loading" && (
          <div className="flex flex-col items-center py-8 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            <p className="text-sm text-slate-600">Enriching and adding contacts…</p>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className="bg-indigo-600 h-2 rounded-full w-1/2 animate-pulse" />
            </div>
          </div>
        )}

        {progress === "done" && result && (
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Users className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              {result.added} contact{result.added !== 1 ? "s" : ""} added
            </h3>
            {result.skipped > 0 && (
              <p className="text-sm text-slate-500 mb-4">
                {result.skipped} skipped (already existed)
              </p>
            )}
            <div className="flex gap-3 mt-4">
              {result.listId && (
                <Link
                  href={`/lists/${result.listId}`}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg text-sm text-center transition-colors"
                >
                  View list
                </Link>
              )}
              <Link
                href="/contacts"
                className="flex-1 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium py-2 rounded-lg text-sm text-center transition-colors"
              >
                View contacts
              </Link>
              <button
                onClick={onClose}
                className="flex-1 text-slate-500 hover:text-slate-700 text-sm"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {progress === "error" && (
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <p className="text-sm text-red-700 mb-4">{errorMsg}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setProgress("idle")}
                className="flex-1 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium py-2 rounded-lg text-sm"
              >
                Try again
              </button>
              <button
                onClick={onClose}
                className="flex-1 text-slate-500 hover:text-slate-700 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProspectorPage() {
  const { workspaceId } = useWorkspace();

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [results, setResults] = useState<ProspeoSearchResult[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [errorMsg, setErrorMsg] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [modalContacts, setModalContacts] = useState<ProspeoSearchResult[]>([]);

  const buildSearchPayload = useCallback(
    (page: number) => {
      const companySizes = SIZE_OPTIONS.filter((s) =>
        filters.sizeLabels.includes(s.label)
      ).flatMap((s) => s.values);

      const keywords = filters.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      return {
        personCountries: filters.personCountries,
        jobTitles: filters.jobTitles,
        seniorities: filters.seniorities,
        industries: filters.industries,
        companySizes,
        keywords,
        verifiedEmailOnly: filters.verifiedEmailOnly,
        maxPerCompany: filters.maxPerCompany,
        page,
      };
    },
    [filters]
  );

  const doSearch = useCallback(
    async (page: number) => {
      if (!workspaceId) {
        toast.error("No workspace found");
        return;
      }

      // Require at least one meaningful filter
      if (
        filters.personCountries.length === 0 &&
        filters.jobTitles.length === 0 &&
        filters.industries.length === 0 &&
        filters.seniorities.length === 0 &&
        filters.keywords.trim().length === 0
      ) {
        toast.error("Add at least one filter before searching");
        return;
      }

      setSearchState("loading");
      setSelectedIds(new Set());
      setCurrentPage(page);

      try {
        const res = await fetch("/api/prospector/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildSearchPayload(page)),
        });

        const data = await res.json();

        if (!res.ok) {
          setErrorMsg(data.error || "Search failed");
          setSearchState("error");
          toast.error(data.error || "Search failed");
          return;
        }

        const resultsArr: ProspeoSearchResult[] = data.results || [];
        setResults(resultsArr);
        setPagination(data.pagination || null);
        setSearchState(resultsArr.length === 0 ? "empty" : "results");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setErrorMsg(msg);
        setSearchState("error");
        toast.error(msg);
      }
    },
    [workspaceId, buildSearchPayload, filters]
  );

  const handleSearch = () => doSearch(1);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    setSearchState("idle");
    setResults([]);
    setPagination(null);
    setSelectedIds(new Set());
  };

  const handlePageChange = (newPage: number) => {
    doSearch(newPage);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === results.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(results.map((r) => r.person.person_id)));
    }
  };

  const openModal = (contacts: ProspeoSearchResult[]) => {
    setModalContacts(contacts);
    setShowModal(true);
  };

  const handleAddSingle = (result: ProspeoSearchResult) => {
    openModal([result]);
  };

  const handleBulkAdd = () => {
    const selected = results.filter((r) => selectedIds.has(r.person.person_id));
    openModal(selected);
  };

  const handleModalSuccess = (added: number, skipped: number, _listId: string | null) => {
    if (added > 0) {
      toast.success(
        skipped > 0
          ? `${added} added, ${skipped} skipped (already existed)`
          : `${added} contact${added !== 1 ? "s" : ""} added to CRM`
      );
    }
    setSelectedIds(new Set());
  };

  if (!workspaceId) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-8 py-6 border-b border-slate-200 bg-white">
        <h1 className="text-2xl font-bold text-slate-900">Prospector</h1>
        <p className="text-sm text-slate-500 mt-1">
          Find and add new contacts to your CRM
        </p>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Filter panel */}
        <aside className="w-72 flex-shrink-0 border-r border-slate-200 bg-white px-5 py-6 overflow-y-auto">
          <ProspectorFilters
            filters={filters}
            onChange={setFilters}
            onSearch={handleSearch}
            onReset={handleReset}
            loading={searchState === "loading"}
          />
        </aside>

        {/* Results panel */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-50">
          {searchState === "idle" && (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-slate-400" />
                </div>
                <p className="text-slate-500 text-sm">
                  Search for contacts using the filters on the left
                </p>
              </div>
            </div>
          )}

          {searchState === "empty" && (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-slate-400" />
                </div>
                <p className="text-slate-500 text-sm">
                  No contacts found for these filters. Try broader criteria.
                </p>
              </div>
            </div>
          )}

          {searchState === "error" && (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <p className="text-red-600 text-sm font-medium">Search failed</p>
                <p className="text-slate-500 text-sm mt-1">{errorMsg}</p>
              </div>
            </div>
          )}

          {(searchState === "loading" || searchState === "results") && (
            <div className="flex flex-col h-full">
              {/* Top bar */}
              <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200">
                <div className="flex items-center gap-3">
                  {searchState === "results" && pagination && (
                    <span className="text-sm text-slate-600">
                      <span className="font-semibold text-slate-900">
                        {pagination.total_count.toLocaleString()}
                      </span>{" "}
                      matching profiles
                    </span>
                  )}
                </div>
                {searchState === "results" && pagination && pagination.total_page > 1 && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage <= 1}
                      className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span>
                      Page {pagination.current_page} of {pagination.total_page}
                    </span>
                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage >= pagination.total_page}
                      className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Bulk action bar */}
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-4 px-6 py-2 bg-indigo-50 border-b border-indigo-100">
                  <span className="text-sm font-medium text-indigo-700">
                    {selectedIds.size} selected
                  </span>
                  <button
                    onClick={handleBulkAdd}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Reveal &amp; Add to CRM
                  </button>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    Clear selection
                  </button>
                </div>
              )}

              {/* Table */}
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left w-10">
                        <input
                          type="checkbox"
                          checked={
                            results.length > 0 &&
                            selectedIds.size === results.length
                          }
                          onChange={toggleSelectAll}
                          disabled={searchState === "loading"}
                          className="text-indigo-600 rounded"
                        />
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">Name</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">Current Title</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">Company</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">Location</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600 w-16">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {searchState === "loading" ? (
                      <SkeletonRows />
                    ) : (
                      results.map((r) => {
                        const id = r.person.person_id;
                        const location = [
                          r.person.location?.city,
                          r.person.location?.country,
                        ]
                          .filter(Boolean)
                          .join(", ");
                        return (
                          <tr
                            key={id}
                            className={`hover:bg-white transition-colors ${
                              selectedIds.has(id) ? "bg-indigo-50" : "bg-slate-50"
                            }`}
                          >
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(id)}
                                onChange={() => toggleSelect(id)}
                                className="text-indigo-600 rounded"
                              />
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900">
                              {r.person.full_name}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {r.person.current_job_title || "—"}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {r.company?.name || "—"}
                            </td>
                            <td className="px-4 py-3 text-slate-500">
                              {location || "—"}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => handleAddSingle(r)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                title="Add to CRM"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modal */}
      {showModal && (
        <AddContactsModal
          contacts={modalContacts}
          workspaceId={workspaceId}
          onClose={() => setShowModal(false)}
          onSuccess={(added, skipped, listId) => {
            handleModalSuccess(added, skipped, listId);
          }}
        />
      )}
    </div>
  );
}
