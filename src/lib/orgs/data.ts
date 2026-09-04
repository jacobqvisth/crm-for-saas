import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import type { AffiliatedContact, OrgContact, OrgRow, OrgsData } from "@/lib/orgs/types";

export type { AffiliatedContact, OrgContact, OrgRow, OrgsData } from "@/lib/orgs/types";
export { ORG_TYPE_LABELS, ORG_TYPE_STYLE, countryFlag } from "@/lib/orgs/types";

// ~127 organisations and ~230 contacts: small enough to hand to the client in one
// payload and filter there, same as the schools directory.

// PostgREST caps a response at 1000 rows whatever the filter says. These tables are
// well under that today, but the paging is explicit so growth cannot silently truncate
// the page. `.order("id")` is the unique tiebreaker.
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

export async function getOrgsData(): Promise<OrgsData> {
  const supabase = await createClient();

  // The DB hands affiliated_contacts back as Json; it is narrowed when the row is
  // mapped, not at the query boundary.
  type OrgDbRow = Omit<OrgRow, "contacts" | "affiliated_contacts"> & { affiliated_contacts: Json };

  const orgs = await selectAll<OrgDbRow>((from, to) =>
    supabase
      .from("industry_orgs")
      .select(
        "id,company_id,name,acronym,country,country_code,org_type,sector,website,resolved_website,email,phone,umbrellas,verified,blocked,notes,affiliated_contacts",
      )
      .order("id")
      .range(from, to),
  );

  const contacts = await selectAll<OrgContact & { company_id: string | null }>((from, to) =>
    supabase
      .from("contacts")
      .select("id,company_id,first_name,last_name,email,title")
      .eq("source", "industry-orgs")
      .order("id")
      .range(from, to),
  );

  const byCompany = new Map<string, OrgContact[]>();
  for (const c of contacts) {
    if (!c.company_id) continue;
    const list = byCompany.get(c.company_id) ?? [];
    list.push(c);
    byCompany.set(c.company_id, list);
  }

  const rows: OrgRow[] = orgs.map((o) => ({
    ...o,
    umbrellas: o.umbrellas ?? [],
    affiliated_contacts: (o.affiliated_contacts as unknown as AffiliatedContact[] | null) ?? null,
    contacts: (o.company_id ? byCompany.get(o.company_id) ?? [] : []).sort((a, b) =>
      (a.title ?? "zz").localeCompare(b.title ?? "zz"),
    ),
  }));

  // Country first so the table reads as a per-country directory, then name.
  rows.sort(
    (a, b) =>
      (a.country ?? "").localeCompare(b.country ?? "", "sv") || a.name.localeCompare(b.name, "sv"),
  );

  const all = rows.flatMap((r) => r.contacts);
  return {
    orgs: rows,
    totals: {
      orgs: rows.length,
      contacts: all.length,
      namedContacts: all.filter((c) => c.first_name).length,
      countries: new Set(rows.map((r) => r.country).filter((c) => c && c !== "Europe")).size,
      affiliated: rows.reduce((n, r) => n + (r.affiliated_contacts?.length ?? 0), 0),
    },
  };
}
