// Repairing escape sequences the model leaves behind in generated text.
//
// WHY THIS EXISTS
// A stat fact pack can contain non-ASCII characters, because the labels come from
// the existing dashboards: the search-terms length bands include "Short phrase
// (<= 25 chars)" written with a real U+2264 character. When the model emits its
// JSON via structured outputs it sometimes escapes that character AND the
// backslash, so parsing yields the literal seven characters ≤ rather than
// the symbol. That then rides all the way through to a published article, where
// a table cell reads "Short phrase (≤ 25 chars)".
//
// Caught 2026-08-05 on a real staged Webflow item, which is the reason the
// publish flow stages by default instead of going straight live.
//
// Deliberately narrow: only \uXXXX (and the surrogate-pair form) are decoded.
// Sequences like \n are left alone, because a real body contains genuine
// newlines and rewriting a literal backslash-n could corrupt legitimate content
// such as a code sample.

const UNICODE_ESCAPE = /\\u([0-9a-fA-F]{4})/g;

/**
 * Turn literal `\uXXXX` sequences back into the characters they denote.
 * Surrogate pairs work because each half is decoded in place and JavaScript
 * strings are UTF-16, so an adjacent high/low pair recombines naturally.
 */
export function decodeStrayUnicodeEscapes(input: string): string {
  if (!input.includes("\\u")) return input;
  return input.replace(UNICODE_ESCAPE, (whole, hex: string) => {
    const code = Number.parseInt(hex, 16);
    if (!Number.isFinite(code)) return whole;
    // Leave control characters alone; nothing legitimate needs them and turning
    // them into real control bytes could break the HTML we later generate.
    if (code < 0x20) return whole;
    return String.fromCharCode(code);
  });
}
