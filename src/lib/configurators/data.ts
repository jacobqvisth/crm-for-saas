import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import type {
  ConfiguratorCandidate, ConfiguratorContact, ConfiguratorRow, ConfiguratorsData,
} from "@/lib/configurators/types";

export type {
  ConfiguratorCandidate, ConfiguratorContact, ConfiguratorRow, ConfiguratorsData,
} from "@/lib/configurators/types";
export {
  ENTRY_TYPE_LABELS, ENTRY_TYPE_STYLE, VENDOR_KIND_LABELS,
  PLATFORM_SOURCE_LABELS, PLATFORM_SOURCE_STYLE, EUROPE_CODES, countryFlag,
} from "@/lib/configurators/types";

// PostgREST caps a response at 1000 rows whatever the filter says. This table is under
// that today, but the paging is explicit so growth cannot silently truncate the page.
// `.order("id")` is the unique tiebreaker -- pageAll without one was returning totals
// that were ~18% wrong elsewhere in this codebase.
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

export async function getConfiguratorsData(): Promise<ConfiguratorsData> {
  const supabase = await createClient();

  type DbRow = Omit<ConfiguratorRow, "contacts" | "configurator_candidates"> & {
    configurator_candidates: Json;
  };

  const entries = await selectAll<DbRow>((from, to) =>
    supabase
      .from("configurator_prospects")
      // ONE STRING LITERAL, not a concatenation. supabase-js parses the select list at
      // the type level, and `"a," + "b"` widens to `string`, which types the result as
      // GenericStringError[] and fails with a wall of unrelated-looking errors.
      .select("id,company_id,name,domain,entry_type,vendor_kind,country,country_code,country_source,industry,website,resolved_website,page_title,description,email,phone,configurator_url,configurator_score,configurator_candidates,platforms,platform_source,cited_by,verified,blocked,notes")
      .order("id")
      .range(from, to),
  );

  const contacts = await selectAll<ConfiguratorContact & { company_id: string | null }>((from, to) =>
    supabase
      .from("contacts")
      .select("id,company_id,first_name,last_name,email,title")
      .eq("source", "configurators")
      .order("id")
      .range(from, to),
  );

  const byCompany = new Map<string, ConfiguratorContact[]>();
  for (const c of contacts) {
    if (!c.company_id) continue;
    const list = byCompany.get(c.company_id) ?? [];
    list.push(c);
    byCompany.set(c.company_id, list);
  }

  const rows: ConfiguratorRow[] = entries.map((e) => ({
    ...e,
    platforms: e.platforms ?? [],
    cited_by: e.cited_by ?? [],
    configurator_candidates:
      (e.configurator_candidates as unknown as ConfiguratorCandidate[] | null) ?? null,
    contacts: (e.company_id ? byCompany.get(e.company_id) ?? [] : []).sort((a, b) =>
      (a.title ?? "zz").localeCompare(b.title ?? "zz"),
    ),
  }));

  // Best prospects first: a confirmed platform beats a vendor claim, a company cited by
  // two vendors beats one cited by one, and a live configurator link beats none. Vendors
  // sort after prospects, because the page is a prospect list first.
  const rank = (r: ConfiguratorRow) =>
    (r.entry_type === "vendor" ? 0 : 1000) +
    (r.platform_source === "configurator page" ? 300 : r.platform_source === "homepage" ? 150 : 0) +
    Math.min(r.cited_by.length, 4) * 60 +
    (r.configurator_url ? 100 : 0) +
    r.contacts.length * 20;

  rows.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name, "sv"));

  const prospects = rows.filter((r) => r.entry_type !== "vendor");
  const all = rows.flatMap((r) => r.contacts);

  return {
    rows,
    totals: {
      prospects: prospects.length,
      vendors: rows.length - prospects.length,
      withConfigurator: prospects.filter((r) => r.configurator_url).length,
      confirmedPlatform: prospects.filter((r) => r.platform_source === "configurator page").length,
      contacts: all.length,
      namedContacts: all.filter((c) => c.first_name).length,
      countries: new Set(rows.map((r) => r.country).filter(Boolean)).size,
      // Cited by more than one vendor: they have changed configurator at least once, so
      // they are demonstrably willing to.
      switchers: prospects.filter((r) => r.cited_by.length > 1).length,
    },
  };
}
