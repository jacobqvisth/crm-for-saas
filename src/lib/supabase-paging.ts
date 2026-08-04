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

// Runaway-loop guard, and the ceiling on how much one read can pull.
//
// This used to be 200 pages (200k rows), which dashboard_metric_snapshots was
// about to cross: 161k rows on 2026-08-04, growing ~1,300/day from the four
// per-keyword organic_search_* metrics. Crossing it would have TRUNCATED
// silently and quietly wronged every all-time dashboard number, which is the
// exact failure mode this module exists to prevent. Raised well clear of that,
// with a warning at the old ceiling so the growth stays visible.
const MAX_PAGES = 600;
const WARN_AFTER_PAGES = 200;

/**
 * Read an entire result set in `.range()` pages.
 *
 * Paging is sequential. Fetching pages in parallel was tried and measured on the
 * real 161k-row dashboard_metric_snapshots read: 39s sequential vs 44s with 8
 * lanes. The constraint is response volume (~87 MB), not round-trip latency, so
 * concurrency bought nothing and was dropped rather than shipped as complexity.
 * Reducing rows or columns is the only thing that makes a read like that faster.
 */
export async function pageAll<T>(
  factory: RangeFactory<T>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PagedResult<T>> {
  const out: T[] = [];
  let offset = 0;

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
    if (i + 1 === WARN_AFTER_PAGES) {
      console.warn(
        `[pageAll] read passed ${WARN_AFTER_PAGES} pages (${offset} rows) — ` +
          `heading for the ${MAX_PAGES}-page ceiling, past which rows are ` +
          `silently dropped. Narrow the query or pre-aggregate it.`,
      );
    }
  }
  return { data: out, error: null };
}

// Chunked-`.in()` helper.
//
// PostgREST encodes `.in("col", [...])` into a `col=in.(a,b,c,...)` URL query
// string. ~500+ UUIDs (36 chars + comma each) blow past the upstream URL
// length limit (Cloudflare, Vercel, PostgREST all reject huge URLs) and the
// request silently returns `{ data: null, error: { message: "Bad Request" }}`.
// PR #99 fixed enrollment by chunking at 200; this generalises the pattern.
//
// Each chunk is ALSO paginated via `pageAll` so a chunk that fans out into
// >1000 result rows (one-to-many joins like email_events) doesn't silently
// truncate at the db-max-rows ceiling. Caller supplies a factory that takes
// the `(chunk, { from, to })` slice and runs `.in(col, chunk).range(from, to)`.
const DEFAULT_IN_CHUNK_SIZE = 200;

type ChunkedFactory<T, V> = (
  chunk: V[],
  slice: { from: number; to: number },
) => PromiseLike<{ data: T[] | null; error: PagedError | null }>;

export async function chunkedIn<T, V = string>(
  factory: ChunkedFactory<T, V>,
  values: V[],
  chunkSize: number = DEFAULT_IN_CHUNK_SIZE,
): Promise<PagedResult<T>> {
  const out: T[] = [];
  if (values.length === 0) {
    return { data: out, error: null };
  }
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    const { data, error } = await pageAll<T>(({ from, to }) =>
      factory(chunk, { from, to }),
    );
    if (error) {
      return { data: out, error };
    }
    out.push(...data);
  }
  return { data: out, error: null };
}
