/**
 * Post-login destination handling, shared by the auth middleware, the login
 * page and the OAuth callback. Kept free of `next/server` imports so the
 * client-side login page can use it too.
 */

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
