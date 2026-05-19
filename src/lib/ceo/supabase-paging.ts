// Pagination helper for Supabase reads.
//
// PostgREST caps every response at `db-max-rows` (1000 on this project) and
// silently ignores larger `.limit()` values. A naive `.select(...).limit(50000)`
// or `.select(...)` with no limit at all just returns the first 1000 rows —
// usually the OLDEST ones (when ordered ASC) or some arbitrary slice (when
// unordered). The truncation is silent: `error` is null, the response just ends
// short, and downstream aggregations look correct until a table crosses 1000
// rows in the queried window. See PR #217 for the /ceo/app-usage symptom.
//
// `pageAll` walks the result set in fixed-size pages via `.range()` and
// concatenates them. Always pair with an `.order(stable-column)` on the
// underlying query so each page's `(from, to)` slice is deterministic — without
// an order clause Postgres can return rows in any order per request, so two
// pages may overlap or skip rows.
//
// Returns Supabase's familiar `{ data, error }` shape so call sites that did
// `const { data, error } = await query` keep working with a single-token swap.

const DEFAULT_PAGE_SIZE = 1000;

// Subset of PostgrestError relevant to callers — keeping it nominal here so we
// don't pull in the full @supabase/postgrest-js type just for one helper.
export type PagedError = {
  message: string;
  details?: string;
  hint?: string;
  code?: string;
};

export type PagedResult<T> = {
  data: T[];
  error: PagedError | null;
};

type RangeFactory<T> = (slice: {
  from: number;
  to: number;
}) => PromiseLike<{ data: T[] | null; error: PagedError | null }>;

export async function pageAll<T>(
  factory: RangeFactory<T>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PagedResult<T>> {
  const out: T[] = [];
  let offset = 0;

  // Guard against runaway loops if a caller forgets an order clause and pages
  // never get shorter. 200 pages × 1000 rows = 200k rows — well past anything
  // the dashboard layer should be pulling in a single request.
  const MAX_PAGES = 200;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const { data, error } = await factory({
      from: offset,
      to: offset + pageSize - 1,
    });
    if (error) {
      return { data: out, error };
    }
    const page = data ?? [];
    out.push(...page);
    if (page.length < pageSize) {
      return { data: out, error: null };
    }
    offset += pageSize;
  }
  return { data: out, error: null };
}
