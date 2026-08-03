/**
 * Post-login destination handling, shared by the auth middleware, the login
 * page and the OAuth callback. Kept free of `next/server` imports so the
 * client-side login page can use it too.
 */

/**
 * Where the post-login destination is stashed while the user is away at Google.
 *
 * It must NOT ride along in the OAuth `redirectTo` as a query param. Supabase
 * matches `redirectTo` against its Redirect URL allow-list, and that list holds
 * one exact entry (".../auth/callback"). Appending "?next=..." made it stop
 * matching, so Supabase silently fell back to the project's Site URL, which is
 * http://localhost:3000 — real users landed on "localhost refused to connect"
 * with the auth code in the URL. A cookie keeps redirectTo byte-identical to
 * the allow-listed value, so the destination cannot break sign-in.
 */
export const POST_LOGIN_NEXT_COOKIE = "wl_post_login_next";

/** Short window: it only has to survive one trip through the OAuth provider. */
export const POST_LOGIN_NEXT_MAX_AGE = 600;

/**
 * Only same-site absolute paths survive as a post-login destination, so a
 * crafted `?next=` can't bounce someone off to another host after signing in.
 * A protocol-relative "//evil.com" reads as a path but resolves to a different
 * origin, so it is rejected alongside anything that isn't rooted at "/".
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

/** Cookie-safe encoding of a destination path. */
export function encodeNextCookie(next: string): string {
  return encodeURIComponent(next);
}

/**
 * Decode a stashed destination. Tolerates a malformed value (a stray "%" makes
 * decodeURIComponent throw) rather than letting a bad cookie break sign-in.
 */
export function decodeNextCookie(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return safeNextPath(decodeURIComponent(raw));
  } catch {
    return null;
  }
}
