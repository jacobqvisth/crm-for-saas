// Helpers for adding a video from a pasted YouTube link. Pure functions —
// safe to use on both the client and the server.

// Extract the 11-char video id from any common YouTube URL shape:
//   watch?v=ID, youtu.be/ID, /shorts/ID, /live/ID, /embed/ID, plus extra params.
// Also accepts a bare 11-char id. Returns null if nothing valid is found.
export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // Bare id
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const v = url.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const m = url.pathname.match(/\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

// Pull DTC codes (P/B/C/U + 4 digits, e.g. P0420, U0100) out of free text such
// as a video title. Returns a de-duplicated, upper-cased list.
export function extractDtcCodes(text: string): string[] {
  const matches = text.toUpperCase().match(/\b[PBCU][0-9]{4}\b/g) ?? [];
  return Array.from(new Set(matches));
}
