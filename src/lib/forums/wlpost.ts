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

// Append a prefilled title to a Reddit submit URL. Reddit reliably prefills the
// title from the URL; the body is unreliable on new Reddit, which is why we put
// the body on the clipboard for a manual paste instead.
export function submitUrlWithTitle(submitUrl: string, title: string | null): string {
  if (!title) return submitUrl;
  const sep = submitUrl.includes("?") ? "&" : "?";
  return `${submitUrl}${sep}title=${encodeURIComponent(title)}`;
}

// Build the wlpost:// link the local handler listens for. `personaKey` is the
// Reddit username of the assigned account.
export function wlpostLink(personaKey: string, targetUrl: string): string {
  return `wlpost://open?persona=${encodeURIComponent(
    personaKey,
  )}&url=${encodeURIComponent(targetUrl)}`;
}
