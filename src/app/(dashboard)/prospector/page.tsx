"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { formatDistanceToNow } from "date-fns";
import {
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  Users,
  AlertCircle,
  Sparkles,
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

type SavedSearch = {
  id: string;
  name: string;
  filters: Filters;
  last_run_at: string | null;
  result_count: number | null;
};

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
  "Workshop manager",
  "Service manager",
  "Mechanic",
  "Auto technician",
  "Service advisor",
  "Parts manager",
  "Fleet manager",
];

// ─── Language mapping ─────────────────────────────────────────────────────────

type LanguageInfo = { code: string; label: string };

const COUNTRY_LANGUAGE: Record<string, LanguageInfo> = {
  Sweden:      { code: "sv", label: "Swedish" },
  Norway:      { code: "no", label: "Norwegian" },
  Denmark:     { code: "da", label: "Danish" },
  Finland:     { code: "fi", label: "Finnish" },
  Iceland:     { code: "is", label: "Icelandic" },
  Germany:     { code: "de", label: "German" },
  France:      { code: "fr", label: "French" },
  Netherlands: { code: "nl", label: "Dutch" },
  Spain:       { code: "es", label: "Spanish" },
  Italy:       { code: "it", label: "Italian" },
  Poland:      { code: "pl", label: "Polish" },
};

// English title → { languageCode: localTranslation }
const JOB_TITLE_TRANSLATIONS: Record<string, Record<string, string>> = {
  "Workshop owner":   { sv: "Verkstadsägare",   no: "Verkstedseier",   da: "Værkstedsejer",  fi: "Korjaamonomistaja", de: "Werkstattinhaber",  nl: "Werkplaatseigenaar" },
  "Workshop manager": { sv: "Verkstadschef",     no: "Verkstedsjef",    da: "Værkstedsleder", fi: "Korjaamopäällikkö", de: "Werkstattleiter",   nl: "Werkplaatsbeheerder" },
  "Service manager":  { sv: "Servicechef",       no: "Servicesjef",     da: "Servicechef",    fi: "Huoltopäällikkö",  de: "Serviceleiter",     nl: "Servicemanager" },
  "Mechanic":         { sv: "Mekaniker",          no: "Mekaniker",       da: "Mekaniker",      fi: "Mekaanikko",       de: "Mechaniker",        nl: "Monteur" },
  "Auto technician":  { sv: "Biltekniker",        no: "Biltekniker",     da: "Biltekniker",    fi: "Autoteknikko",     de: "Kfz-Techniker",     nl: "Autotechnicus" },
  "Service advisor":  { sv: "Servicerådgivare",   no: "Servicerådgiver", da: "Serviceadvisør", fi: "Huoltoneuvoaja",   de: "Serviceberater",    nl: "Serviceadviseur" },
  "Parts manager":    { sv: "Reservdelschef",     no: "Reservdelssjef",  da: "Reservdelschef", fi: "Varaosapäällikkö", de: "Teileleiter",       nl: "Onderdelenmanager" },
  "Fleet manager":    { sv: "Fordonsflottachef",  no: "Flåtesjef",       da: "Flådesjef",      fi: "Kalustopäällikkö", de: "Fuhrparkleiter",    nl: "Wagenparkbeheerder" },
};

// Derive all active languages from selected countries (deduped)
function getActiveLanguages(countries: string[]): LanguageInfo[] {
  const seen = new Set<string>();
  const result: LanguageInfo[] = [];
  for (const country of countries) {
    const lang = COUNTRY_LANGUAGE[country];
    if (lang && !seen.has(lang.code)) {
      seen.add(lang.code);
      result.push(lang);
    }
  }
  return result;
}

// Get translations for a given title across the active languages
function getTranslations(
  title: string,
  langs: LanguageInfo[]
): { lang: LanguageInfo; translation: string }[] {
  const map = JOB_TITLE_TRANSLATIONS[title];
  if (!map) return [];
  return langs.flatMap((lang) =>
    map[lang.code] ? [{ lang, translation: map[lang.code] }] : []
  );
}

// Build the final job titles array to send to Prospeo
function buildSearchTitles(
  jobTitles: string[],
  langs: LanguageInfo[],
  localOnly: boolean
): string[] {
  const result: string[] = [];
  for (const title of jobTitles) {
    if (!localOnly) result.push(title); // include English
    const translations = getTranslations(title, langs);
    for (const { translation } of translations) {
      if (!result.includes(translation)) result.push(translation);
    }
    // If no translation found and localOnly is on, still include the English term
    if (localOnly && translations.length === 0) result.push(title);
  }
  return result;
}

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

  // Bilingual
  localOnly: boolean;
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
  localOnly: false,
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
  activeLanguages,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onSearch: () => void;
  onReset: () => void;
  loading: boolean;
  activeLanguages: LanguageInfo[];
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

        {/* Selected chips with inline translation labels */}
        {filters.jobTitles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {filters.jobTitles.map((title) => {
              const translations = getTranslations(title, activeLanguages);
              return (
                <div key={title} className="flex flex-col gap-0.5">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-medium">
                    {title}
                    <button
                      onClick={() => removeJobTitle(title)}
                      className="hover:text-indigo-900"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                  {translations.length > 0 && (
                    <span className="text-[10px] text-slate-400 pl-2">
                      {translations
                        .map(({ lang, translation }) => `${translation} (${lang.code.toUpperCase()})`)
                        .join(" · ")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Free-text input */}
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

        {/* Suggested English quick-add chips */}
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

        {/* Language-only toggle — only shown when relevant */}
        {activeLanguages.length > 0 && filters.jobTitles.length > 0 && (
          <div className="mt-3 flex items-start gap-2">
            <input
              type="checkbox"
              id="localOnly"
              checked={filters.localOnly}
              onChange={(e) => onChange({ ...filters, localOnly: e.target.checked })}
              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="localOnly" className="text-xs text-slate-600 cursor-pointer leading-tight">
              Search in {activeLanguages.map((l) => l.label).join(" + ")} only
              <span className="text-slate-400 ml-1">(skip English terms)</span>
            </label>
          </div>
        )}
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
        linkedin_url: r.person.linkedin_url || null,
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

// ─── AI Fit types and badge ───────────────────────────────────────────────────

type FitVerdict = { verdict: "good" | "maybe" | "poor"; reason: string };

function FitBadge({ verdict }: { verdict: FitVerdict }) {
  const config = {
    good:  { label: "Good",  color: "bg-green-50 text-green-700 border-green-200",   icon: "✓" },
    maybe: { label: "Maybe", color: "bg-yellow-50 text-yellow-700 border-yellow-200", icon: "?" },
    poor:  { label: "Poor",  color: "bg-red-50 text-red-700 border-red-200",         icon: "✗" },
  }[verdict.verdict];

  return (
    <div className="relative group inline-flex">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium border rounded-full ${config.color}`}>
        {config.icon} {config.label}
      </span>
      <div className="absolute bottom-full left-0 mb-1 z-10 hidden group-hover:block w-48 p-2 text-xs text-white bg-slate-800 rounded-lg shadow-lg">
        {verdict.reason}
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

  const [verdicts, setVerdicts] = useState<Record<string, FitVerdict>>({});
  const [aiCheckLoading, setAiCheckLoading] = useState(false);
  const [fitFilter, setFitFilter] = useState<"all" | "good" | "maybe" | "poor">("all");
  const [aiFilterEnabled, setAiFilterEnabled] = useState(false);
  const [smartReveal, setSmartReveal] = useState(false);

  // In CRM badges
  const [inCrmIds, setInCrmIds] = useState<Set<string>>(new Set());

  // Cache indicator
  const [resultsCached, setResultsCached] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  // Saved searches
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState("");
  const [savingSearch, setSavingSearch] = useState(false);

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
        jobTitles: buildSearchTitles(
          filters.jobTitles,
          getActiveLanguages(filters.personCountries),
          filters.localOnly
        ),
        seniorities: filters.seniorities,
        industries: filters.industries,
        companySizes,
        keywords,
        verifiedEmailOnly: filters.verifiedEmailOnly,
        maxPerCompany: filters.maxPerCompany,
        page,
        workspaceId,
      };
    },
    [filters, workspaceId]
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
      setInCrmIds(new Set());
      setResultsCached(false);
      setCachedAt(null);

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

        // Set cache indicator
        setResultsCached(data.cached === true);
        setCachedAt(data.cachedAt || null);

        // Fire-and-forget in-CRM check
        if (resultsArr.length > 0 && workspaceId) {
          const personIds = resultsArr.map((r) => r.person.person_id);
          const linkedinUrls = resultsArr.map((r) => r.person.linkedin_url || "");
          fetch("/api/prospector/check-in-crm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ personIds, linkedinUrls, workspaceId }),
          })
            .then((r) => r.json())
            .then((d) => {
              if (d.inCrmIds) setInCrmIds(new Set(d.inCrmIds));
            })
            .catch(() => {}); // non-fatal
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setErrorMsg(msg);
        setSearchState("error");
        toast.error(msg);
      }
    },
    [workspaceId, buildSearchPayload, filters]
  );

  const activeLanguages = getActiveLanguages(filters.personCountries);

  // Load AI filter settings and saved searches on mount
  useEffect(() => {
    fetch("/api/settings/ai-filter")
      .then((r) => r.json())
      .then((data) => {
        setAiFilterEnabled(data.filter_enabled ?? false);
      })
      .catch(() => {});

    const saved = localStorage.getItem("prospector_smart_reveal");
    if (saved === "true") setSmartReveal(true);
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/prospector/saved-searches?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((data) => setSavedSearches(data.searches || []))
      .catch(() => {});
  }, [workspaceId]);

  const handleAiCheck = async () => {
    const selectedProfiles = results.filter((r) => selectedIds.has(r.person.person_id));
    if (selectedProfiles.length === 0) return;

    setAiCheckLoading(true);
    try {
      const payload = selectedProfiles.map((r) => ({
        person_id: r.person.person_id,
        full_name: r.person.full_name,
        current_job_title: r.person.current_job_title,
        headline: r.person.headline,
        company_name: r.company.name,
        company_industry: r.company.industry,
        company_employee_range: r.company.employee_range,
        location_country: r.person.location?.country,
        location_city: r.person.location?.city,
      }));

      const res = await fetch("/api/prospector/ai-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles: payload }),
      });

      if (!res.ok) {
        const err = await res.json();
        if (err.error === "no_icp_prompt") {
          toast.error("Set up your ICP in Settings → AI Lead Filter first");
        } else {
          toast.error("AI filter unavailable — add contacts manually");
        }
        return;
      }

      const { verdicts: newVerdicts } = await res.json();
      const verdictMap: Record<string, FitVerdict> = {};
      for (const v of newVerdicts) {
        verdictMap[v.person_id] = { verdict: v.verdict, reason: v.reason };
      }
      setVerdicts((prev) => ({ ...prev, ...verdictMap }));

      const poorIds: string[] = newVerdicts
        .filter((v: { verdict: string }) => v.verdict === "poor")
        .map((v: { person_id: string }) => v.person_id);
      if (poorIds.length > 0) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          poorIds.forEach((id: string) => next.delete(id));
          return next;
        });
        toast(`${poorIds.length} poor fit${poorIds.length > 1 ? "s" : ""} deselected`, { icon: "⚠️" });
      }

      const goodCount = newVerdicts.filter((v: { verdict: string }) => v.verdict === "good").length;
      const maybeCount = newVerdicts.filter((v: { verdict: string }) => v.verdict === "maybe").length;
      toast.success(`AI check complete: ${goodCount} good, ${maybeCount} maybe, ${poorIds.length} poor`);
    } catch {
      toast.error("AI filter unavailable — add contacts manually");
    } finally {
      setAiCheckLoading(false);
    }
  };

  const handleSearch = () => doSearch(1);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    setSearchState("idle");
    setResults([]);
    setPagination(null);
    setSelectedIds(new Set());
    setInCrmIds(new Set());
    setResultsCached(false);
    setCachedAt(null);
  };

  const handleSaveSearch = async () => {
    if (!saveSearchName.trim() || !workspaceId) return;
    setSavingSearch(true);
    try {
      const res = await fetch("/api/prospector/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveSearchName.trim(),
          filters,
          workspaceId,
          resultCount: pagination?.total_count || results.length,
        }),
      });
      const data = await res.json();
      setSavedSearches((prev) => [data.search, ...prev]);
      setShowSaveDialog(false);
      toast.success("Search saved");
    } catch {
      toast.error("Failed to save search");
    } finally {
      setSavingSearch(false);
    }
  };

  const loadSavedSearch = (s: SavedSearch) => {
    setFilters(s.filters);
    toast(`Loaded "${s.name}" — click Search to run`, { icon: "📂" });
    fetch(`/api/prospector/saved-searches/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ last_run_at: new Date().toISOString(), result_count: s.result_count }),
    }).catch(() => {});
  };

  const handleDeleteSavedSearch = async (id: string) => {
    try {
      await fetch(`/api/prospector/saved-searches/${id}?workspaceId=${workspaceId}`, {
        method: "DELETE",
      });
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    } catch {
      toast.error("Failed to delete saved search");
    }
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
    const idsToReveal = smartReveal
      ? Array.from(selectedIds).filter((id) => verdicts[id]?.verdict !== "poor")
      : Array.from(selectedIds);

    const skippedCount = selectedIds.size - idsToReveal.length;
    const selected = results.filter((r) => idsToReveal.includes(r.person.person_id));
    openModal(selected);

    if (skippedCount > 0) {
      setTimeout(() => {
        toast(`${skippedCount} poor fit${skippedCount > 1 ? "s" : ""} skipped`, { icon: "🔒" });
      }, 100);
    }
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

  const displayedResults =
    fitFilter === "all"
      ? results
      : results.filter((r) => verdicts[r.person.person_id]?.verdict === fitFilter);

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
          {savedSearches.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                Saved Searches
              </p>
              <div className="space-y-1">
                {savedSearches.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 group"
                  >
                    <button
                      onClick={() => loadSavedSearch(s)}
                      className="flex-1 text-left text-sm text-slate-700 font-medium"
                    >
                      {s.name}
                      {s.result_count != null && (
                        <span className="ml-1 text-xs text-slate-400">
                          ({s.result_count} results)
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => handleDeleteSavedSearch(s.id)}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <ProspectorFilters
            filters={filters}
            onChange={setFilters}
            onSearch={handleSearch}
            onReset={handleReset}
            loading={searchState === "loading"}
            activeLanguages={activeLanguages}
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
                      {resultsCached && cachedAt && (
                        <span className="text-xs text-slate-500 ml-2">
                          (cached —{" "}
                          {formatDistanceToNow(new Date(cachedAt), {
                            addSuffix: true,
                          })}
                          )
                        </span>
                      )}
                    </span>
                  )}
                  {searchState === "results" && (
                    <button
                      onClick={() => {
                        setSaveSearchName("");
                        setShowSaveDialog(true);
                      }}
                      className="text-sm text-slate-500 hover:text-slate-700 underline"
                    >
                      Save search
                    </button>
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
                <div className="flex items-center gap-4 px-6 py-2 bg-indigo-50 border-b border-indigo-100 flex-wrap">
                  <span className="text-sm font-medium text-indigo-700">
                    {selectedIds.size} selected
                  </span>
                  {aiFilterEnabled && (
                    <button
                      onClick={handleAiCheck}
                      disabled={aiCheckLoading || selectedIds.size === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {aiCheckLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      {aiCheckLoading ? "Checking…" : `AI Check (${selectedIds.size})`}
                    </button>
                  )}
                  {aiFilterEnabled && Object.keys(verdicts).length > 0 && (
                    <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={smartReveal}
                        onChange={(e) => {
                          setSmartReveal(e.target.checked);
                          localStorage.setItem("prospector_smart_reveal", String(e.target.checked));
                        }}
                        className="rounded border-slate-300 text-indigo-600"
                      />
                      Smart Reveal
                    </label>
                  )}
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

              {/* Fit filter bar */}
              {Object.keys(verdicts).length > 0 && (
                <div className="flex gap-1 px-6 py-2 bg-white border-b border-slate-100">
                  {(["all", "good", "maybe", "poor"] as const).map((f) => {
                    const count =
                      f === "all"
                        ? results.length
                        : results.filter((r) => verdicts[r.person.person_id]?.verdict === f).length;
                    return (
                      <button
                        key={f}
                        onClick={() => setFitFilter(f)}
                        className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                          fitFilter === f
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
                        }`}
                      >
                        {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)} ({count})
                      </button>
                    );
                  })}
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
                      {Object.keys(verdicts).length > 0 && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide w-28">
                          Fit
                        </th>
                      )}
                      <th className="px-4 py-3 text-left font-medium text-slate-600 w-16">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {searchState === "loading" ? (
                      <SkeletonRows />
                    ) : (
                      displayedResults.map((r) => {
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
                            } ${verdicts[id]?.verdict === "poor" ? "opacity-50" : ""}`}
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
                              {inCrmIds.has(id) && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 ml-2">
                                  In CRM
                                </span>
                              )}
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
                            {Object.keys(verdicts).length > 0 && (
                              <td className="px-4 py-3">
                                {verdicts[id] ? <FitBadge verdict={verdicts[id]} /> : null}
                              </td>
                            )}
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

      {/* Save search dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 shadow-xl w-80">
            <h3 className="font-semibold text-slate-900 mb-3">Save this search</h3>
            <input
              type="text"
              placeholder="Search name..."
              value={saveSearchName}
              onChange={(e) => setSaveSearchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveSearch();
              }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="text-sm px-3 py-1.5 border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSearch}
                disabled={!saveSearchName.trim() || savingSearch}
                className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingSearch ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

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
