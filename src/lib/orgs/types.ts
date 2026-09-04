// Shapes and labels for the industry-organisation directory.
//
// Split from data.ts because data.ts imports the server-only Supabase client, and the
// client component needs the labels. Same reason as lib/schools/types.ts.

export type OrgContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  title: string | null;
};

export type AffiliatedContact = {
  email: string;
  name: string | null;
  title: string | null;
  domain?: string | null;
};

export type OrgRow = {
  id: string;
  company_id: string | null;
  name: string;
  acronym: string | null;
  country: string | null;
  country_code: string | null;
  org_type: string;
  sector: string | null;
  website: string | null;
  resolved_website: string | null;
  email: string | null;
  phone: string | null;
  umbrellas: string[];
  verified: boolean;
  blocked: boolean;
  notes: string | null;
  affiliated_contacts: AffiliatedContact[] | null;
  contacts: OrgContact[];
};

export type OrgsData = {
  orgs: OrgRow[];
  totals: {
    orgs: number;
    contacts: number;
    namedContacts: number;
    countries: number;
    affiliated: number;
  };
};

export const ORG_TYPE_LABELS: Record<string, string> = {
  association: "Branschorganisation",
  umbrella: "Paraplyorganisation (EU)",
  trade_fair: "Mässa",
  event_organiser: "Mässarrangör",
  media: "Branschmedia",
};

export const ORG_TYPE_STYLE: Record<string, string> = {
  association: "bg-blue-50 text-blue-700 border-blue-200",
  umbrella: "bg-violet-50 text-violet-700 border-violet-200",
  trade_fair: "bg-emerald-50 text-emerald-700 border-emerald-200",
  event_organiser: "bg-teal-50 text-teal-700 border-teal-200",
  media: "bg-amber-50 text-amber-700 border-amber-200",
};

// ISO alpha-2 to flag emoji. "EU" is not a country code, so it gets the union flag.
export function countryFlag(code: string | null): string {
  if (!code) return "";
  if (code === "EU") return "🇪🇺";
  if (code === "GB") return "🇬🇧";
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}
