import "server-only";
import { createClient } from "@/lib/supabase/server";

// Who is allowed to operate the control plane.
//
// This is the most privileged credential in the system: it can turn features
// off for three paying customers. The checks below are deliberately stricter
// than the CEO_ALLOWED_EMAILS gate they are modelled on.
//
// The four properties worth keeping from that older gate:
//   - lowercase both sides before comparing
//   - exact `===` for a plain address (no substring hole)
//   - an EMPTY list denies, it does not allow
//   - the list lives in the environment, not in a database row
//
// And the things it did not do, added here:
//   1. No `@domain` entries. The older gate supports them; this one refuses
//      them. `@gmail.com` would admit the entire internet, and the primary
//      super-admin address is a Gmail one.
//   2. Check the email is CONFIRMED. An unconfirmed address is a claim, not a
//      fact.
//   3. Check the identity PROVIDER is Google. Matching the address alone
//      assumes the only way to hold an address is to own it; if
//      email/password or magic-link were ever enabled on the project, anyone
//      who could receive one mail would inherit super-admin.
//
// The allow-list is an environment variable and not a table on purpose: a row
// is editable by anyone with database access, an env var needs deploy access.
// Do not add an `is_super_admin` column, and do not let one exist.

/** Addresses permitted to operate the control plane. Exact matches only. */
export function superAdminAllowList(): string[] {
  return (process.env.CONTROL_PLANE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    // A domain-wide entry in the control plane is always a mistake. Drop it
    // rather than honour it: failing closed on a misconfiguration is the whole
    // job of this file.
    .filter((entry) => !entry.startsWith("@"));
}

/** Exact, case-insensitive membership. An empty list denies. */
export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const allowed = superAdminAllowList();
  if (allowed.length === 0) return false;
  return allowed.includes(email.toLowerCase());
}

export type SuperAdmin = { email: string };
export type AuthFailure = { error: string };

/**
 * Resolve the current super admin, or explain why not.
 *
 * Call this in every route handler and every server action, not only in
 * middleware. Middleware is a convenience; it is not the boundary. A server
 * action invoked directly does not pass through it.
 */
export async function requireSuperAdmin(): Promise<SuperAdmin | AuthFailure> {
  if (!isControlPlane()) return { error: "Not found." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not signed in." };

  // 1. allow-listed
  if (!isSuperAdminEmail(user.email)) return { error: "Not authorized." };

  // 2. confirmed
  if (!user.email_confirmed_at) return { error: "Email not confirmed." };

  // 3. arrived via Google
  const providers = [
    user.app_metadata?.provider,
    ...((user.app_metadata?.providers as string[] | undefined) ?? []),
    ...(user.identities ?? []).map((i) => i.provider),
  ].filter(Boolean);
  if (!providers.includes("google")) return { error: "Google sign-in required." };

  return { email: user.email!.toLowerCase() };
}

export function isAuthFailure(r: SuperAdmin | AuthFailure): r is AuthFailure {
  return "error" in r;
}

/**
 * Is this deployment the control plane?
 *
 * A tenant deployment must never serve the console, so this gates the whole
 * route group. Unset means no, which is the safe default for the many
 * deployments that are not the control plane.
 */
export function isControlPlane(): boolean {
  return process.env.IS_CONTROL_PLANE === "1";
}
