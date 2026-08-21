import { describe, expect, it } from "vitest";
import { buildMimeMessage } from "./send";

function headerBlock(mime: string): string {
  return mime.split("\r\n\r\n")[0];
}

function decodeSubject(mime: string): string {
  // Unfold first: a long encoded subject legitimately spans several lines,
  // joined by CRLF + whitespace.
  const line = headerBlock(mime)
    .replace(/\r\n[ \t]+/g, "")
    .split("\r\n")
    .find((l) => l.startsWith("Subject: "))!;
  const value = line.slice("Subject: ".length);
  const words = value.match(/=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/g);
  if (!words) return value;
  return Buffer.concat(
    words.map((w) => Buffer.from(w.slice("=?UTF-8?B?".length, -2), "base64")),
  ).toString("utf8");
}

/** Pull the decoded bodies of both alternative parts. */
function decodeParts(mime: string): { text: string; html: string } {
  const boundary = mime.match(/boundary="([^"]+)"/)![1];
  const parts = mime.split(`--${boundary}`).slice(1, 3);
  const decoded = parts.map((part) => {
    const [rawHeaders, ...rest] = part.split("\r\n\r\n");
    expect(rawHeaders).toContain("Content-Transfer-Encoding: base64");
    expect(rawHeaders).toContain('charset="UTF-8"');
    return Buffer.from(rest.join("\r\n\r\n").replace(/[\r\n]/g, ""), "base64").toString("utf8");
  });
  return { text: decoded[0], html: decoded[1] };
}

const SWEDISH_SUBJECT = "Test för hur ord med å som i åke, ä som i äng och ö som i bröd";
const SWEDISH_HTML =
  "<p>Hejsan, Valdemar här från Wrenchlane. Vår Ai-drivna diagnos sparar tid på verkstaden.</p>";

describe("buildMimeMessage", () => {
  it("emits no raw non-ASCII byte in the header block", () => {
    const mime = buildMimeMessage({
      from: "valdemar <valdemar@wrenchlane.com>",
      to: "jacob@qvisth.se",
      subject: SWEDISH_SUBJECT,
      htmlBody: SWEDISH_HTML,
    });
    // The whole bug in one assertion: headers must be 7-bit clean, otherwise
    // Google's gateway re-reads them as latin-1 and å/ä/ö arrive as mojibake.
    expect(headerBlock(mime)).toMatch(/^[\x00-\x7F]*$/);
  });

  it("round-trips a Swedish subject", () => {
    const mime = buildMimeMessage({
      from: "valdemar@wrenchlane.com",
      to: "jacob@qvisth.se",
      subject: SWEDISH_SUBJECT,
      htmlBody: SWEDISH_HTML,
    });
    expect(decodeSubject(mime)).toBe(SWEDISH_SUBJECT);
  });

  it("round-trips both body parts", () => {
    const mime = buildMimeMessage({
      from: "valdemar@wrenchlane.com",
      to: "jacob@qvisth.se",
      subject: SWEDISH_SUBJECT,
      htmlBody: SWEDISH_HTML,
      textBody: "Hejsan, Valdemar här från Wrenchlane.",
    });
    const { text, html } = decodeParts(mime);
    expect(text).toBe("Hejsan, Valdemar här från Wrenchlane.");
    expect(html).toBe(SWEDISH_HTML);
  });

  it("keeps every line inside the RFC 5322 998-character limit", () => {
    // Mirrors our longest real send: one unbroken HTML line of ~1,700 chars.
    const longHtml = `<p>${"Hejsan från Wrenchlane, snabbare diagnos. ".repeat(45)}</p>`;
    expect(longHtml.length).toBeGreaterThan(998);
    const mime = buildMimeMessage({
      from: "valdemar@wrenchlane.com",
      to: "jacob@qvisth.se",
      subject: SWEDISH_SUBJECT,
      htmlBody: longHtml,
    });
    for (const line of mime.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(998);
    }
    expect(decodeParts(mime).html).toBe(longHtml);
  });

  it("leaves an ASCII subject unencoded", () => {
    const mime = buildMimeMessage({
      from: "valdemar@wrenchlane.com",
      to: "jacob@qvisth.se",
      subject: "Uppfoljning med Wrenchlane",
      htmlBody: "<p>Hello</p>",
    });
    expect(headerBlock(mime)).toContain("Subject: Uppfoljning med Wrenchlane");
  });

  it("survives a base64 round-trip of the full message, as the send path does", () => {
    const mime = buildMimeMessage({
      from: "valdemar@wrenchlane.com",
      to: "jacob@qvisth.se",
      subject: SWEDISH_SUBJECT,
      htmlBody: SWEDISH_HTML,
    });
    const raw = Buffer.from(mime)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(Buffer.from(raw, "base64url").toString("utf8")).toBe(mime);
  });
});
