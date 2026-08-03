/**
 * Distinguishes "the user clicked Sign out" from "this session died on its
 * own". Supabase emits the same SIGNED_OUT event for both, and the session
 * watcher must not tell someone their session expired when they deliberately
 * signed out.
 */

let intentional = false;

/** Call immediately before `supabase.auth.signOut()` in a user-initiated flow. */
export function markIntentionalSignOut(): void {
  intentional = true;
}

/** Reads and clears the flag — a single SIGNED_OUT event consumes it. */
export function consumeIntentionalSignOut(): boolean {
  const was = intentional;
  intentional = false;
  return was;
}
