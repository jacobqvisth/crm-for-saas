// Shapes and labels for the vehicle-education directory.
//
// Kept apart from data.ts on purpose: data.ts imports the server-only Supabase
// client, so a client component that reached in for a label would pull that whole
// module into the browser bundle and fail the build.

export type SchoolProgram = {
  id: string;
  program_code: string | null;
  program_name: string;
  program_kind: string | null;
  relevance_tier: string;
  school_form: string | null;
  start_date: string | null;
  credits: string | null;
  distance: boolean | null;
  admission_points_min: string | null;
  admission_points_average: string | null;
  program_url: string | null;
};

export type SchoolContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  title: string | null;
};

export type SchoolRow = {
  id: string;
  company_id: string | null;
  name: string;
  school_type: string;
  relevance_tier: string;
  principal_organizer_type: string | null;
  corporation_name: string | null;
  org_number: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  municipality: string | null;
  county: string | null;
  orientations: string[];
  notes: string | null;
  programs: SchoolProgram[];
  contacts: SchoolContact[];
};

export type SchoolsData = {
  schools: SchoolRow[];
  totals: {
    schools: number;
    programs: number;
    contacts: number;
    namedContacts: number;
    counties: number;
    municipalities: number;
  };
};

export const SCHOOL_TYPE_LABELS: Record<string, string> = {
  gymnasium: "Gymnasieskola",
  anpassad_gymnasium: "Anpassad gymnasieskola",
  yrkeshogskola: "Yrkeshögskola",
  komvux: "Komvux",
  folkhogskola: "Folkhögskola",
  arbetsmarknadsutbildning: "Arbetsmarknadsutbildning",
  nationell_yrkesutbildning: "Nationell yrkesutbildning",
  hogskola: "Högskola",
  forberedande: "Förberedande utbildning",
};

export const TIER_LABELS: Record<string, string> = {
  core: "Fordon/personbil",
  adjacent: "Tunga fordon, maskin, flyg, marin, spår",
  transport: "Transport och logistik",
};
