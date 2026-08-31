/**
 * HTML to plain text for the `text/plain` half of a multipart/alternative send.
 *
 * The old derivation was `htmlBody.replace(/<[^>]*>/g, "")`, which produced a
 * text part that was:
 *
 *   - one run-on line, because block elements collapsed with no newline
 *   - littered with raw entities (`&nbsp;`, `&amp;`, `&ouml;`)
 *   - completely free of URLs, because `href` values live in the tag that got
 *     stripped
 *
 * So a sequence email shipped an HTML part full of links and a text part with
 * none. Content filters score the divergence between the two alternatives, and
 * "HTML has ten links, plaintext has zero" is about as wide as that gap gets.
 *
 * This produces a text part that carries the same words, the same structure and
 * the same destinations as the HTML.
 */

/**
 * Named entities worth decoding: what TipTap emits, plus the accented Latin-1
 * letters that show up in Nordic, Baltic, German and French copy. Anything not
 * listed passes through unchanged, which is visible and harmless rather than
 * silently wrong. Numeric entities (`&#233;` / `&#xE9;`) are always handled.
 */
const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  bull: "•",
  middot: "·",
  laquo: "«",
  raquo: "»",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  trade: "™",
  reg: "®",
  copy: "©",
  deg: "°",
  euro: "€",
  pound: "£",
  aring: "å",
  Aring: "Å",
  auml: "ä",
  Auml: "Ä",
  ouml: "ö",
  Ouml: "Ö",
  uuml: "ü",
  Uuml: "Ü",
  aelig: "æ",
  AElig: "Æ",
  oslash: "ø",
  Oslash: "Ø",
  szlig: "ß",
  eacute: "é",
  Eacute: "É",
  egrave: "è",
  Egrave: "È",
  ecirc: "ê",
  agrave: "à",
  Agrave: "À",
  acirc: "â",
  ccedil: "ç",
  Ccedil: "Ç",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  aacute: "á",
  ntilde: "ñ",
  Ntilde: "Ñ",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (match, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      const code = Number.parseInt(name.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    if (name.startsWith("#")) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return name in ENTITIES ? ENTITIES[name] : match;
  });
}

/**
 * Links are parked behind sentinels while the tag stripper runs.
 *
 * Rendering "text <url>" inline would not survive: the generic `<[^>]*>` strip
 * below cannot tell the angle brackets we just added from a real tag, and eats
 * the URL. NUL cannot appear in an email body, so it is a safe marker.
 */
const LINK_PLACEHOLDER = /\u0000L(\d+)\u0000/g;

function placeholderFor(index: number): string {
  return `\u0000L${index}\u0000`;
}

/**
 * Convert an email HTML body to plain text.
 *
 * Pass the *untracked* HTML: the text part should carry the real destination
 * so a reader (or a filter) sees where the link actually goes, not a
 * click-wrapper redirect.
 */
export function htmlToText(html: string): string {
  if (!html) return "";

  let out = html;

  // Drop anything whose text content is not body copy.
  out = out.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  // The tracking pixel must not leave a stray "" or a URL in the text part.
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag);
    return alt && alt[1].trim() ? alt[1] : "";
  });

  // Links become "text <url>", which is what a plaintext reader expects and
  // what keeps the two MIME parts talking about the same destinations.
  const links: string[] = [];
  out = out.replace(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, inner: string) => {
      const text = decodeEntities(inner.replace(/<[^>]*>/g, "")).trim();
      const url = href.trim();
      if (!url) return text;
      // A link whose text already is the URL, or a `{{unsubscribe_link}}`
      // placeholder, is left alone rather than printed twice.
      if (text && text === url) return text;
      links.push(text ? `${text} <${url}>` : url);
      return placeholderFor(links.length - 1);
    },
  );

  // Structural newlines. Do this before the generic tag strip so block
  // boundaries survive as line breaks instead of collapsing into one line.
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/(p|div|tr|h[1-6]|blockquote|table|ul|ol)\s*>/gi, "\n\n");
  out = out.replace(/<li\b[^>]*>/gi, "\n- ");
  out = out.replace(/<\/(td|th)\s*>/gi, " ");
  out = out.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");

  // Everything else goes.
  out = out.replace(/<[^>]*>/g, "");

  out = decodeEntities(out);

  // Links come back only now that no further tag stripping will run.
  out = out.replace(LINK_PLACEHOLDER, (_m, index: string) => links[Number(index)] ?? "");

  // Tidy up: normalize newlines, trim surrounding spaces, collapse runs of
  // blank lines to one so the result reads like a typed email.
  out = out.replace(/\r\n?/g, "\n");
  out = out
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n");
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}
