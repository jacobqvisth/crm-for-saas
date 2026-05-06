/**
 * Type guard helpers for the post-strict-null type-regen cleanup.
 *
 * After regenerating database.types.ts from prod, columns that are NOT NULL
 * in the DB but have DEFAULTs come through as `string | null`. Most call sites
 * built before the regen used `.filter(Boolean)` which TypeScript doesn't
 * recognize as a type-narrowing predicate.
 *
 * Use these instead:
 *   const ids = rows.map(r => r.contact_id).filter(notNull)
 *   //    ^? string[]   ✓ (was string|null[])
 */

export function notNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

export function notEmpty<T>(value: T | null | undefined | ""): value is T {
  return value !== null && value !== undefined && value !== ""
}
