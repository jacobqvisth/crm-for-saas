// Reasons an operator can pick when removing a stop from a Field Route.
//
// This used to live in `src/app/api/routes/[routeId]/stops/[stopId]/route.ts`
// alongside a duplicate copy in `src/components/routes/remove-stop-modal.tsx`.
// Next.js 16 rejects non-handler exports from Route files at build time
// (`"REMOVE_REASONS" is not a valid Route export field`), and the duplicate
// in the client component meant the two definitions could drift. Hoisting
// both to this lib module fixes the route-export error and makes the
// constant the single source of truth.

export const REMOVE_REASONS = [
  "route_too_long",
  "recent_contact",
  "wrong_location",
  "not_icp",
  "permanently_closed",
  "other",
] as const;

export type RemoveReason = (typeof REMOVE_REASONS)[number];

// Reasons that flag the shop globally (companies.do_not_route) so future
// routes skip it. The route handler reads this set when applying the
// remove; the modal copy uses it for the hint text.
export const FLAGS_DO_NOT_ROUTE: ReadonlySet<RemoveReason> = new Set<RemoveReason>([
  "wrong_location",
  "not_icp",
  "permanently_closed",
]);
