/**
 * sessionStorage-backed persistence for list page UI state (filters, sort,
 * page, scrollY). Lives per browser tab so backing out of a contact/company
 * detail returns to the same filtered, scrolled view; closing the tab clears.
 *
 * Keyed by `${prefix}:${workspaceId}` so each list page + workspace is
 * isolated. SSR-safe (no-op when `window` is unavailable). Tolerant of
 * malformed payloads — a stale schema is dropped silently rather than
 * throwing on rehydrate.
 */

export function loadListState<T>(
  prefix: string,
  workspaceId: string | null | undefined,
  fallback: T,
): T {
  if (!workspaceId || typeof window === 'undefined') return fallback;
  try {
    const raw = window.sessionStorage.getItem(`${prefix}:${workspaceId}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as T;
    return fallback;
  } catch {
    return fallback;
  }
}

export function saveListState<T>(
  prefix: string,
  workspaceId: string | null | undefined,
  state: T,
): void {
  if (!workspaceId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${prefix}:${workspaceId}`, JSON.stringify(state));
  } catch {
    // Quota / privacy mode — silently ignore.
  }
}

export function clearListState(
  prefix: string,
  workspaceId: string | null | undefined,
): void {
  if (!workspaceId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(`${prefix}:${workspaceId}`);
  } catch {
    // ignore
  }
}
