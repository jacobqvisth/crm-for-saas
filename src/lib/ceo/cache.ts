// Shared caching config for the CEO dashboard data layer.
//
// Every `/ceo/*` page used to re-run its full data fetch on every navigation
// (all pages are `dynamic = "force-dynamic"`), including the shared
// `getDashboardData()` (6 parallel Supabase reads) plus per-page external
// calls (GA4 runReport, Postgres RPCs). The underlying data is only refreshed
// hourly by cron and each page has an "Update" button that force-syncs, so a
// short-lived cache is safe and matches the existing periodically-synced model.
//
// Loaders are wrapped in `unstable_cache` with these options. All caches share
// the `ceo-data` tag so the refresh server actions can bust everything at once
// via `revalidateTag(CEO_CACHE_TAG)` when the user clicks "Update".

export const CEO_CACHE_TAG = "ceo-data";

// 5 minutes. Long enough that clicking between pages in a session is instant,
// short enough that auto-loaded numbers never lag the hourly sync by much.
export const CEO_CACHE_REVALIDATE_SECONDS = 300;

// Not `as const` — unstable_cache's options type wants a mutable string[] for
// `tags`, and a plain `number` for `revalidate`.
export const CEO_CACHE_OPTIONS: { revalidate: number; tags: string[] } = {
  revalidate: CEO_CACHE_REVALIDATE_SECONDS,
  tags: [CEO_CACHE_TAG],
};
