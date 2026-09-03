import { createClient } from "@/lib/supabase/server";
import type {
  SchoolContact, SchoolProgram, SchoolRow, SchoolsData,
} from "@/lib/schools/types";

// Re-exported so server callers can keep importing everything from one place.
export type { SchoolContact, SchoolProgram, SchoolRow, SchoolsData } from "@/lib/schools/types";
export { SCHOOL_TYPE_LABELS, TIER_LABELS } from "@/lib/schools/types";

// The Swedish vehicle-education directory behind /schools.
//
// The whole directory is 327 schools, ~750 programmes and ~1250 contacts, which is
// small enough to hand to the client in one payload and filter there. That keeps the
// page a single round trip and makes every filter instant, instead of building a
// paginated API for a dataset that fits comfortably in memory.

// PostgREST answers at most 1000 rows whatever the filter says, and silently
// truncates rather than erroring, so every table that can exceed that is paged
// explicitly. `.order("id")` is the unique tiebreaker: ordering on a non-unique
// column lets rows shuffle between pages, which both duplicates and skips them.
async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

export async function getSchoolsData(): Promise<SchoolsData> {
  const supabase = await createClient();

  const schools = await selectAll<Omit<SchoolRow, "programs" | "contacts">>((from, to) =>
    supabase
      .from("schools")
      .select(
        "id,company_id,name,school_type,relevance_tier,principal_organizer_type,corporation_name,org_number,website,email,phone,city,municipality,county,orientations,notes",
      )
      .order("id")
      .range(from, to),
  );

  const programs = await selectAll<SchoolProgram & { school_id: string }>((from, to) =>
    supabase
      .from("school_programs")
      .select(
        "id,school_id,program_code,program_name,program_kind,relevance_tier,school_form,start_date,credits,distance,admission_points_min,admission_points_average,program_url",
      )
      .order("id")
      .range(from, to),
  );

  // Contacts are linked to the school through its company, which is the CRM's own
  // relationship — the schools table does not own them.
  const contacts = await selectAll<SchoolContact & { company_id: string | null }>((from, to) =>
    supabase
      .from("contacts")
      .select("id,company_id,first_name,last_name,email,title")
      .eq("source", "skolverket")
      .order("id")
      .range(from, to),
  );

  const programsBySchool = new Map<string, SchoolProgram[]>();
  for (const p of programs) {
    const list = programsBySchool.get(p.school_id) ?? [];
    list.push(p);
    programsBySchool.set(p.school_id, list);
  }

  const contactsByCompany = new Map<string, SchoolContact[]>();
  for (const c of contacts) {
    if (!c.company_id) continue;
    const list = contactsByCompany.get(c.company_id) ?? [];
    list.push(c);
    contactsByCompany.set(c.company_id, list);
  }

  const rows: SchoolRow[] = schools.map((s) => ({
    ...s,
    orientations: s.orientations ?? [],
    programs: (programsBySchool.get(s.id) ?? []).sort((a, b) =>
      (a.program_code ?? "").localeCompare(b.program_code ?? "") || a.program_name.localeCompare(b.program_name),
    ),
    contacts: (s.company_id ? contactsByCompany.get(s.company_id) ?? [] : []).sort((a, b) =>
      (a.title ?? "zz").localeCompare(b.title ?? "zz"),
    ),
  }));

  rows.sort((a, b) => a.name.localeCompare(b.name, "sv"));

  const allContacts = rows.flatMap((r) => r.contacts);
  return {
    schools: rows,
    totals: {
      schools: rows.length,
      programs: programs.length,
      contacts: allContacts.length,
      namedContacts: allContacts.filter((c) => c.first_name).length,
      counties: new Set(rows.map((r) => r.county).filter(Boolean)).size,
      municipalities: new Set(rows.map((r) => r.municipality).filter(Boolean)).size,
    },
  };
}
