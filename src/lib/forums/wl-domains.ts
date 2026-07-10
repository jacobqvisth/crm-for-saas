// Wrenchlane footprint detection on Reddit. Kept in code (like targets.ts's
// subreddit list) rather than the DB so the domain set is versioned with the
// scanner. Used by the mention backfill (our own posts) and, later, the
// third-party scan job.

// Any host containing one of these tokens counts as a Wrenchlane link. We match
// on the registrable stem so every ccTLD (.com/.se/.co/.fr/…) and the tracking
// subdomain (link.wrenchlane.se) are covered without listing each one.
const WL_HOST_TOKENS = ["wrenchlane"];

// The word on its own (case-insensitive), for plaintext mentions.
const WL_WORD = /\bwrenchlane\b/i;

// Grab URLs out of free text (markdown links, bare URLs).
const URL_RE = /\bhttps?:\/\/[^\s)\]<>"']+/gi;

export interface WrenchlaneHit {
  kind: "link" | "plaintext";
  // The matched host for kind='link' (e.g. "link.wrenchlane.se"); null for plaintext.
  matchedDomain: string | null;
}

function hostIsWrenchlane(host: string): boolean {
  const h = host.toLowerCase();
  return WL_HOST_TOKENS.some((t) => h === t || h.includes(`${t}.`) || h.includes(`.${t}`) || h.includes(t));
}

// Find the strongest Wrenchlane signal in a blob of text. A link beats a bare
// word mention (a link is the higher-intent footprint). Returns null when the
// text neither links to nor names Wrenchlane.
export function detectWrenchlane(text: string | null | undefined): WrenchlaneHit | null {
  if (!text) return null;

  const urls = text.match(URL_RE) ?? [];
  for (const raw of urls) {
    try {
      const host = new URL(raw).hostname;
      if (hostIsWrenchlane(host)) return { kind: "link", matchedDomain: host.toLowerCase() };
    } catch {
      // ignore malformed URLs
    }
  }

  if (WL_WORD.test(text)) return { kind: "plaintext", matchedDomain: null };
  return null;
}

// A short window of text around the first Wrenchlane signal, for the UI.
export function wrenchlaneExcerpt(text: string, radius = 90): string {
  const urlMatch = text.match(URL_RE)?.find((u) => {
    try {
      return hostIsWrenchlane(new URL(u).hostname);
    } catch {
      return false;
    }
  });
  const idx = urlMatch ? text.indexOf(urlMatch) : text.search(WL_WORD);
  if (idx < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}
