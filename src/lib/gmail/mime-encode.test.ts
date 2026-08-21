import { describe, expect, it } from "vitest";
import {
  encodeAddressHeader,
  encodeBodyBase64,
  encodeHeaderValue,
  isAscii,
} from "./mime-encode";

/** Decode an RFC 2047 header value back to a plain string. */
function decodeHeaderValue(encoded: string): string {
  // Unfold first (CRLF + whitespace), then concatenate the encoded-words.
  const unfolded = encoded.replace(/\r\n[ \t]+/g, "");
  const words = unfolded.match(/=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/g);
  if (!words) return unfolded;
  return Buffer.concat(
    words.map((w) => Buffer.from(w.slice("=?UTF-8?B?".length, -2), "base64")),
  ).toString("utf8");
}

describe("isAscii", () => {
  it("accepts printable ASCII and rejects Swedish letters", () => {
    expect(isAscii("Wrenchlane Demo - Finspang")).toBe(true);
    expect(isAscii("Wrenchlane Demo - Finspång")).toBe(false);
  });
});

describe("encodeHeaderValue", () => {
  it("leaves an ASCII subject byte-identical", () => {
    const subject = "Uppfoljning med Wrenchlane";
    expect(encodeHeaderValue(subject)).toBe(subject);
  });

  it("round-trips the subject that shipped as mojibake", () => {
    // This exact subject went out as "Wrenchlane Demo - FinspÃÂ¥ng".
    const subject = "Wrenchlane Demo - Finspång";
    const encoded = encodeHeaderValue(subject);
    expect(encoded).toContain("=?UTF-8?B?");
    expect(decodeHeaderValue(encoded)).toBe(subject);
  });

  it("round-trips every Swedish letter", () => {
    const subject = "Test för hur ord med å som i åke, ä som i äng och ö som i bröd";
    expect(decodeHeaderValue(encodeHeaderValue(subject))).toBe(subject);
  });

  it("keeps each encoded-word within the 75-character RFC 2047 limit", () => {
    const subject =
      "Vridmomentspecifikationer, tidsguider och ett möjligt Motorrenoverarna-avtal för din verkstad i Finspång";
    const encoded = encodeHeaderValue(subject);
    for (const word of encoded.split("\r\n ")) {
      expect(word.length).toBeLessThanOrEqual(75);
    }
    expect(decodeHeaderValue(encoded)).toBe(subject);
  });

  it("never splits a multi-byte character across two encoded-words", () => {
    // A long run of 2-byte characters is the case most likely to land a chunk
    // boundary mid-sequence.
    const subject = "ö".repeat(200);
    const encoded = encodeHeaderValue(subject);
    for (const word of encoded.split("\r\n ")) {
      const bytes = Buffer.from(word.slice("=?UTF-8?B?".length, -2), "base64");
      // Each word must itself be valid standalone UTF-8.
      expect(bytes.toString("utf8")).not.toContain("�");
    }
    expect(decodeHeaderValue(encoded)).toBe(subject);
  });

  it("round-trips emoji (4-byte sequences)", () => {
    const subject = "Snabbare diagnos 🔧 för din verkstad";
    expect(decodeHeaderValue(encodeHeaderValue(subject))).toBe(subject);
  });
});

describe("encodeAddressHeader", () => {
  it("leaves a plain ASCII display name unchanged", () => {
    expect(encodeAddressHeader("Hans Markebrant", "hans@wrenchlane.com")).toBe(
      "Hans Markebrant <hans@wrenchlane.com>",
    );
  });

  it("falls back to the bare address when there is no display name", () => {
    expect(encodeAddressHeader(null, "hans@wrenchlane.com")).toBe("hans@wrenchlane.com");
    expect(encodeAddressHeader("   ", "hans@wrenchlane.com")).toBe("hans@wrenchlane.com");
  });

  it("encodes a non-ASCII display name", () => {
    const header = encodeAddressHeader("Håkan Öberg", "hakan@wrenchlane.com");
    expect(header).toMatch(/^=\?UTF-8\?B\?.+\?= <hakan@wrenchlane\.com>$/);
    expect(decodeHeaderValue(header.replace(" <hakan@wrenchlane.com>", ""))).toBe("Håkan Öberg");
  });

  it("quotes an ASCII display name containing specials", () => {
    expect(encodeAddressHeader("Wrenchlane, AB", "hej@wrenchlane.com")).toBe(
      '"Wrenchlane, AB" <hej@wrenchlane.com>',
    );
  });
});

describe("encodeBodyBase64", () => {
  it("round-trips a Swedish body", () => {
    const body = "<p>Hejsan, Valdemar här från Wrenchlane. Vår Ai-drivna diagnos.</p>";
    expect(Buffer.from(encodeBodyBase64(body).replace(/\r\n/g, ""), "base64").toString("utf8")).toBe(
      body,
    );
  });

  it("wraps at 76 characters, well under the 998-character line limit", () => {
    // A body the length of our longest real send, on a single source line.
    const body = `<p>${"Hejsan från Wrenchlane. ".repeat(80)}</p>`;
    expect(body.length).toBeGreaterThan(998);
    const encoded = encodeBodyBase64(body);
    for (const line of encoded.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
    expect(Buffer.from(encoded.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe(body);
  });

  it("handles an empty body", () => {
    expect(encodeBodyBase64("")).toBe("");
  });
});
