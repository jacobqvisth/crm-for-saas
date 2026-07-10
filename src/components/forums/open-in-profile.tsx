"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { RedditAccount } from "@/lib/forums/accounts";
import { wlpostLink } from "@/lib/forums/wlpost";

// "Open as <member>" — copies the post/comment body to the clipboard, then
// fires a wlpost:// link that the local WLPost helper (see ~/.wlpost/) resolves
// to the Chrome profile logged into that account's Reddit login, opening
// `targetUrl` there and bringing it to the front. You then paste and click Post.
//
// If the helper is not installed, the OS ignores the unregistered wlpost://
// scheme and nothing happens, so these buttons are safe for every member.

export function OpenAsButton({
  account,
  targetUrl,
  body,
}: {
  account: RedditAccount;
  targetUrl: string;
  body: string;
}) {
  const [opening, setOpening] = useState(false);
  async function open() {
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      // clipboard may be blocked; the page still opens
    }
    setOpening(true);
    setTimeout(() => setOpening(false), 2500);
    if (account.username) {
      window.location.href = wlpostLink(account.username, targetUrl);
    }
  }
  return (
    <button
      onClick={open}
      title={`Copy the body and open this page in the Chrome profile logged into u/${account.username}, then paste and post`}
      className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-700"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      {opening ? "Copied, opening…" : account.owner_label}
    </button>
  );
}

// One OpenAsButton per active account that has a Reddit username.
export function OpenInProfile({
  accounts,
  targetUrl,
  body,
  prefix = "Open as",
}: {
  accounts: RedditAccount[];
  targetUrl: string;
  body: string;
  prefix?: string;
}) {
  const usable = accounts.filter((a) => a.active && a.username);
  if (usable.length === 0 || !targetUrl) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-slate-500">{prefix}:</span>
      {usable.map((a) => (
        <OpenAsButton key={a.id} account={a} targetUrl={targetUrl} body={body} />
      ))}
    </div>
  );
}
