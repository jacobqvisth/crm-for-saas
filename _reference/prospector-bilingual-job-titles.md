# Prospector — Bilingual Job Title Search

**Goal:** Users pick job titles in English only. The UI automatically shows the local language translation next to each one. A checkbox controls whether to search in both English + local language, or local language only.

---

## Changes required

All changes are in `src/app/(dashboard)/prospector/page.tsx`.
The API route (`src/app/api/prospector/search/route.ts`) does NOT need changes — it already accepts whatever `jobTitles` array we send.

---

## Step 1 — Add translation data structures

Add these after the `SUGGESTED_JOB_TITLES` constant:

```ts
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
  "Service advisor":  { sv: "Servicerådgivare",   no: "Servicerådgiver", da: "Serviceadvisør", fi: "Huoltoneuvojа",    de: "Serviceberater",    nl: "Serviceadviseur" },
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

// Get all translations for a title given active languages
function getTranslations(title: string, langs: LanguageInfo[]): { lang: LanguageInfo; translation: string }[] {
  const map = JOB_TITLE_TRANSLATIONS[title];
  if (!map) return [];
  return langs.flatMap((lang) =>
    map[lang.code] ? [{ lang, translation: map[lang.code] }] : []
  );
}

// Build the final job titles array to send to Prospeo
function buildSearchTitles(jobTitles: string[], langs: LanguageInfo[], localOnly: boolean): string[] {
  const result: string[] = [];
  for (const title of jobTitles) {
    if (!localOnly) result.push(title); // include English
    const translations = getTranslations(title, langs);
    for (const { translation } of translations) {
      if (!result.includes(translation)) result.push(translation);
    }
    // If no translation found and localOnly is true, still include the English term
    if (localOnly && translations.length === 0) result.push(title);
  }
  return result;
}
```

---

## Step 2 — Replace SUGGESTED_JOB_TITLES with English-only list

```ts
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
```

---

## Step 3 — Add `localOnly` to the Filters type

```ts
type Filters = {
  countries: string[];
  jobTitles: string[];
  seniorities: string[];
  industries: string[];
  sizeLabels: string[];
  localOnly: boolean; // NEW
};
```

Also update the default filters state where it is initialized in the page component:

```ts
const [filters, setFilters] = useState<Filters>({
  countries: [],
  jobTitles: [],
  seniorities: [],
  industries: [],
  sizeLabels: [],
  localOnly: false, // NEW
});
```

---

## Step 4 — Update ProspectorFilters props

Add `activeLanguages: LanguageInfo[]` to the component's props interface and destructuring. Pass it from the parent (computed with `getActiveLanguages(filters.countries)`).

Replace the entire **Job Title / Role** section in the filters panel with:

```tsx
{/* Job Title / Role */}
<div>
  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
    Job Title / Role
  </label>

  {/* Selected title chips with inline translations */}
  {filters.jobTitles.length > 0 && (
    <div className="flex flex-wrap gap-2 mb-2">
      {filters.jobTitles.map((title) => {
        const translations = getTranslations(title, activeLanguages);
        return (
          <div key={title} className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-1 rounded-full">
              {title}
              <button onClick={() => removeJobTitle(title)} className="ml-1 hover:text-blue-600">
                <X className="w-3 h-3" />
              </button>
            </span>
            {translations.length > 0 && (
              <span className="text-[10px] text-gray-400 pl-2">
                {translations.map(({ lang, translation }) =>
                  `${translation} (${lang.code.toUpperCase()})`
                ).join(" · ")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  )}

  {/* Suggested English chips */}
  <div className="flex flex-wrap gap-1.5 mb-2">
    {SUGGESTED_JOB_TITLES.filter((t) => !filters.jobTitles.includes(t)).map((t) => (
      <button
        key={t}
        onClick={() => addJobTitle(t)}
        className="text-xs px-2 py-1 rounded-full border border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-600 transition-colors"
      >
        + {t}
      </button>
    ))}
  </div>

  {/* Free text input */}
  <input
    ref={inputRef}
    type="text"
    value={jobTitleInput}
    onChange={(e) => setJobTitleInput(e.target.value)}
    onKeyDown={handleJobTitleKeyDown}
    placeholder="Add a title and press Enter"
    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
  />

  {/* Language toggle — only visible when a known-language country is selected AND there are job titles */}
  {activeLanguages.length > 0 && filters.jobTitles.length > 0 && (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="checkbox"
        id="localOnly"
        checked={filters.localOnly}
        onChange={(e) => onChange({ ...filters, localOnly: e.target.checked })}
        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <label htmlFor="localOnly" className="text-xs text-gray-600 cursor-pointer">
        Search in {activeLanguages.map((l) => l.label).join(" + ")} only
        <span className="text-gray-400 ml-1">(skip English terms)</span>
      </label>
    </div>
  )}
</div>
```

---

## Step 5 — Wire up activeLanguages in the parent page component

In the page component (where `ProspectorFilters` is rendered), add:

```ts
const activeLanguages = getActiveLanguages(filters.countries);
```

Pass it as a prop:

```tsx
<ProspectorFilters
  filters={filters}
  onChange={setFilters}
  onSearch={handleSearch}
  onReset={handleReset}
  loading={searchState === "loading"}
  activeLanguages={activeLanguages}
/>
```

---

## Step 6 — Update the search payload in handleSearch

Find where the fetch body is built (the call to `/api/prospector/search`).
Replace `jobTitles: filters.jobTitles` with:

```ts
jobTitles: buildSearchTitles(filters.jobTitles, activeLanguages, filters.localOnly),
```

---

## Testing checklist for the PR

- Select Sweden → add "Workshop owner" chip → should show "Verkstadsägare (SV)" beneath it
- Select Sweden + Norway → chip shows "Verkstadsägare (SV) · Verkstedseier (NO)"
- Checkbox appears only when: (a) a country with a known language is selected AND (b) at least one job title chip is active
- Checkbox unchecked (default): Prospeo receives `["Workshop owner", "Verkstadsägare", ...]`
- Checkbox checked: Prospeo receives `["Verkstadsägare", ...]` (English dropped)
- Custom-typed title with no translation: works normally, checkbox has no effect on it
- No countries selected: no translation labels shown, no checkbox shown
- `npm run build`, `npm run lint`, `npx tsc --noEmit` must all pass
- Append summary to `cc-session-log.md` as usual
