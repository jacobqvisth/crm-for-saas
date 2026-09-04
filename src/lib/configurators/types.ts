// Shapes and labels for the configurator prospect directory.
//
// Split from data.ts because data.ts imports the server-only Supabase client and the
// client component needs the labels. Same reason as lib/orgs/types.ts.

export type ConfiguratorContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  title: string | null;
};

export type ConfiguratorCandidate = {
  url: string;
  text: string | null;
  score: number;
};

export type ConfiguratorRow = {
  id: string;
  company_id: string | null;
  name: string;
  domain: string | null;
  entry_type: string;
  vendor_kind: string | null;
  country: string | null;
  country_code: string | null;
  country_source: string | null;
  industry: string | null;
  website: string | null;
  resolved_website: string | null;
  page_title: string | null;
  description: string | null;
  email: string | null;
  phone: string | null;
  configurator_url: string | null;
  configurator_score: number;
  configurator_candidates: ConfiguratorCandidate[] | null;
  platforms: string[];
  platform_source: string | null;
  cited_by: string[];
  verified: boolean;
  blocked: boolean;
  notes: string | null;
  contacts: ConfiguratorContact[];
};

export type ConfiguratorsData = {
  rows: ConfiguratorRow[];
  totals: {
    prospects: number;
    vendors: number;
    withConfigurator: number;
    confirmedPlatform: number;
    contacts: number;
    namedContacts: number;
    countries: number;
    switchers: number;
  };
};

export const ENTRY_TYPE_LABELS: Record<string, string> = {
  prospect: "Runs a configurator",
  vendor: "Sells configurators",
};

export const ENTRY_TYPE_STYLE: Record<string, string> = {
  prospect: "bg-blue-50 text-blue-700 border-blue-200",
  vendor: "bg-violet-50 text-violet-700 border-violet-200",
};

export const VENDOR_KIND_LABELS: Record<string, string> = {
  visual: "3D / visual",
  cpq: "Rules / CPQ",
  vertical: "Vertical specialist",
};

/**
 * How much to trust the platform claim. This drives the badge colour, because the
 * difference between "their configurator loads Roomle" and "Roomle's marketing page
 * still lists them" is the difference between a confident opener and an embarrassing one.
 */
export const PLATFORM_SOURCE_LABELS: Record<string, string> = {
  "configurator page": "Confirmed on the live configurator",
  homepage: "Detected on their homepage",
  "vendor reference page": "Vendor claim only, unconfirmed",
};

export const PLATFORM_SOURCE_STYLE: Record<string, string> = {
  "configurator page": "bg-emerald-50 text-emerald-700 border-emerald-200",
  homepage: "bg-sky-50 text-sky-700 border-sky-200",
  "vendor reference page": "bg-amber-50 text-amber-700 border-amber-200",
};

// ISO alpha-2 to flag emoji. "EU" is not a country code, so it gets the union flag.
export function countryFlag(code: string | null): string {
  if (!code) return "";
  if (code === "EU") return "🇪🇺";
  if (code === "GB") return "🇬🇧";
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

// Countries Animech can realistically sell into on this list. Used only for the "Europe
// only" filter, so a US furniture retailer harvested from a US vendor's logo wall can be
// hidden without being deleted -- it is still evidence about the platform.
export const EUROPE_CODES = new Set([
  "SE", "NO", "DK", "FI", "IS", "DE", "AT", "CH", "NL", "BE", "LU", "FR", "IT", "ES",
  "PT", "GB", "IE", "PL", "CZ", "SK", "HU", "RO", "BG", "HR", "SI", "RS", "GR", "EE",
  "LV", "LT", "TR", "UA", "MT", "CY", "AL", "BA", "MK", "ME", "MD", "EU",
]);
