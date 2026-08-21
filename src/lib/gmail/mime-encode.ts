/**
 * RFC 2047 / RFC 2045 encoding helpers for the hand-built MIME messages we
 * hand to `gmail.users.messages.send({ raw })`.
 *
 * Why this exists: an email header is ASCII-only by spec. We were emitting
 * `Subject: Test för ...` as raw UTF-8 bytes, and Google's HTTPREST gateway
 * re-read those bytes as latin-1 on the way through, twice. A single `ö`
 * (c3 b6) shipped as c3 83 c2 83 c3 82 c2 b6 and rendered as "ÃÂ¶" in the
 * recipient's inbox. Every Swedish subject line with å/ä/ö was affected.
 */

const ASCII_PRINTABLE = /^[\x20-\x7E]*$/;

export function isAscii(value: string): boolean {
  return ASCII_PRINTABLE.test(value);
}

/**
 * Encode a header value as RFC 2047 base64 encoded-words.
 *
 * Encoded-words are capped at 75 characters *including* the `=?UTF-8?B?` and
 * `?=` delimiters, so we chunk the raw bytes and never split a multi-byte
 * UTF-8 sequence across two words. Splitting mid-sequence is the exact class
 * of bug this module exists to prevent. Multiple words are folded with
 * CRLF + a single space, which decoders join without inserting whitespace.
 */
export function encodeHeaderValue(value: string): string {
  if (isAscii(value)) return value;

  const PREFIX = "=?UTF-8?B?";
  const SUFFIX = "?=";
  // 75 total minus the delimiters, then round the base64 budget down to a
  // multiple of 4 so each chunk is a whole number of 3-byte groups.
  const b64Budget = Math.floor((75 - PREFIX.length - SUFFIX.length) / 4) * 4;
  const bytesPerChunk = (b64Budget / 4) * 3;

  const bytes = Buffer.from(value, "utf8");
  const words: string[] = [];

  let offset = 0;
  while (offset < bytes.length) {
    let end = Math.min(offset + bytesPerChunk, bytes.length);
    // Walk back off a UTF-8 continuation byte (0b10xxxxxx) so the chunk ends
    // on a complete character.
    while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }
    words.push(`${PREFIX}${bytes.subarray(offset, end).toString("base64")}${SUFFIX}`);
    offset = end;
  }

  return words.join("\r\n ");
}

/**
 * Encode the display-name half of an address header.
 *
 * Non-ASCII names become an encoded-word; ASCII names that contain RFC 5322
 * "specials" get quoted. Plain names are left alone so the common case stays
 * byte-identical to what we sent before.
 */
export function encodeAddressHeader(
  displayName: string | null | undefined,
  address: string,
): string {
  const name = displayName?.trim();
  if (!name) return address;

  if (!isAscii(name)) {
    return `${encodeHeaderValue(name)} <${address}>`;
  }
  if (/["(),:;<>@[\\\]]/.test(name)) {
    return `"${name.replace(/(["\\])/g, "\\$1")}" <${address}>`;
  }
  return `${name} <${address}>`;
}

/**
 * Base64-encode a MIME part body, wrapped at 76 characters per RFC 2045.
 *
 * Beyond correctness this removes a second hazard: our HTML bodies are a
 * single unbroken line (TipTap output plus signature plus tracking pixel),
 * routinely 1,400 to 1,700 characters. That blows past the 998-character line
 * ceiling in RFC 5322, and any relay that folds or downgrades such a line can
 * cut a multi-byte UTF-8 character in half. Base64 lines are always short.
 */
export function encodeBodyBase64(body: string): string {
  const b64 = Buffer.from(body, "utf8").toString("base64");
  return (b64.match(/.{1,76}/g) ?? []).join("\r\n");
}
