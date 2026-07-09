/**
 * No-long-dash rule for all AI-generated, user-facing text.
 *
 * Jacob's rule: the long dash — the em-dash (—) and en-dash (–) — is a tell that
 * copy was written by an AI. Real people almost never type it. So every piece of
 * text the CRM generates and shows to (or sends on behalf of) a human — forum
 * posts, comments, cold emails, sequence steps, inbox reply drafts, outbound
 * translations — must be free of it.
 *
 * Two layers, used together at each generation site:
 *   1. NO_LONG_DASH_INSTRUCTION — appended to the model's system prompt so it
 *      avoids the character in the first place (keeps the prose natural).
 *   2. stripLongDashes() — a deterministic post-processor that guarantees the
 *      rule even when the model slips. Run it on the model's output before the
 *      text is stored or shown.
 *
 * Do NOT run stripLongDashes() on INBOUND content (e.g. a customer's email we
 * translate for the rep to read) — that would alter their actual words. This is
 * only for text WE generate.
 */

/** Append to any generation system prompt. */
export const NO_LONG_DASH_INSTRUCTION =
  "IMPORTANT: Never use an em-dash (—) or an en-dash (–) anywhere in your output. " +
  "The long dash is a tell that text was written by an AI. Use a comma, a period, " +
  "parentheses, or rephrase the sentence instead. A normal hyphen (-) in compound " +
  "words (e.g. follow-up) or numeric ranges is fine.";

/**
 * Replace every em-dash / en-dash with human punctuation (a comma by default,
 * matching Jacob's stated preference), tidying up any doubled punctuation the
 * substitution can create.
 *
 * Safe on both plain text and HTML: the dash characters only appear in
 * human-readable text, never inside the tag/attribute syntax we generate, so a
 * straight character replace does not corrupt markup. HTML entity forms
 * (&mdash;, &ndash;, and their numeric variants) are normalized first.
 *
 * Numeric ranges (e.g. "9–5", "2010–2020") become a plain hyphen instead of a
 * comma, since a comma there would be wrong.
 */
export function stripLongDashes(input: string): string {
  if (!input) return input;

  let out = input;

  // 1. Normalize HTML entity forms to the literal characters so the rules below apply.
  out = out
    .replace(/&mdash;/gi, "—")
    .replace(/&#8212;/g, "—")
    .replace(/&#x2014;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&#8211;/g, "–")
    .replace(/&#x2013;/gi, "–");

  // 2. Numeric ranges (9–5, 2010 – 2020) → plain hyphen, no comma.
  out = out.replace(/(\d)[ \t]*[–—][ \t]*(\d)/g, "$1-$2");

  // 3. ASCII "--" used as an em-dash substitute (spaced) → comma.
  out = out.replace(/[ \t]+--[ \t]+/g, ", ");

  // 4. A long dash used as a pause, with surrounding spaces/tabs (not newlines,
  //    so we never eat a line break) → comma + single space.
  out = out.replace(/[ \t]*[–—][ \t]*(?=\S)/g, ", ");

  // 5. Any remaining long dash (unspaced between words, or trailing) → comma.
  out = out.replace(/[–—]/g, ", ");

  // 6. Tidy doubled/awkward punctuation the substitution can produce.
  out = out
    .replace(/[ \t]+,/g, ",") // " ," → ","
    .replace(/,[ \t]*,/g, ",") // ", ," → ","
    .replace(/([,;:])[ \t]*,/g, "$1") // "; ," → ";"
    .replace(/,[ \t]*([.!?])/g, "$1"); // ", ." → "."

  return out;
}
