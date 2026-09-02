// Bridge to the local "WLPost" helper on a teammate's Mac (see ~/.wlpost/).
//
// A forum post assigned to a Reddit account gets an "Open as <member>" button.
// Clicking it copies the post body to the clipboard and navigates to a
// `wlpost://` link. The local handler receives that link and opens the
// prefilled Reddit submit page in the Chrome profile that is logged into that
// Reddit account, then brings it to the front — so you just paste and click
// Post, from the right account, without hunting for the right browser window.
//
// The username -> Chrome-profile mapping lives on the Mac in ~/.wlpost/config.json,
// keyed by the same Reddit username the CRM stores in `reddit_accounts`. If the
// handler is not installed, the OS ignores the unregistered `wlpost://` scheme
// and nothing happens — so this is safe to ship to every workspace member.

import { garagetReplyUrl, garagetTopicId } from "./garaget";
import type { ForumPlatform } from "./types";

// Append a prefilled title to a Reddit submit URL. Reddit reliably prefills the
// title from the URL; the body is unreliable on new Reddit, which is why we put
// the body on the clipboard for a manual paste instead.
export function submitUrlWithTitle(submitUrl: string, title: string | null): string {
  if (!title) return submitUrl;
  const sep = submitUrl.includes("?") ? "&" : "?";
  return `${submitUrl}${sep}title=${encodeURIComponent(title)}`;
}

/**
 * Where a human lands to answer one thread, per platform.
 *
 * Reddit prefills a title from the query string; Garaget prefills nothing at
 * all. That difference does not matter to the flow, because the body always
 * travels on the clipboard anyway: the button's job is only to open the right
 * page in the right logged-in profile.
 *
 * Garaget's reply endpoint returns 401 when signed out, which is exactly why
 * this has to open in the profile that holds the session rather than in
 * whatever window happens to be frontmost.
 */
export function replyComposeUrl(
  platform: ForumPlatform,
  opts: { threadUrl: string | null; externalId: string | null },
): string | null {
  if (platform === "garaget") {
    const id = opts.externalId ?? garagetTopicId(opts.threadUrl);
    return id ? garagetReplyUrl(id) : opts.threadUrl;
  }
  // On Reddit you reply inline on the thread page, so the thread URL is the
  // right destination.
  return opts.threadUrl;
}

// Build the wlpost:// link the local handler listens for. `personaKey` is the
// Reddit username of the assigned account.
export function wlpostLink(personaKey: string, targetUrl: string): string {
  return `wlpost://open?persona=${encodeURIComponent(
    personaKey,
  )}&url=${encodeURIComponent(targetUrl)}`;
}
