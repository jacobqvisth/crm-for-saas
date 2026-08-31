import { describe, expect, it } from "vitest";
import { buildMimeMessage } from "./send";

function headerBlock(mime: string): string {
  return mime.split("\r\n\r\n")[0];
}

/** All values of one header, in order of appearance. */
function headerValues(mime: string, name: string): string[] {
  return headerBlock(mime)
    .replace(/\r\n[ \t]+/g, "")
    .split("\r\n")
    .filter((line) => line.startsWith(`${name}: `))
    .map((line) => line.slice(name.length + 2));
}

/** Decoded bodies of both alternative parts, text first. */
function decodeParts(mime: string): { text: string; html: string } {
  const boundary = mime.match(/boundary="([^"]+)"/)![1];
  const parts = mime.split(`--${boundary}`).slice(1, 3);
  const decoded = parts.map((part) => {
    const [, ...rest] = part.split("\r\n\r\n");
    return Buffer.from(rest.join("\r\n\r\n").replace(/[\r\n]/g, ""), "base64").toString("utf8");
  });
  return { text: decoded[0], html: decoded[1] };
}

const SENDER = {
  from: "Hans Markebrant <hans@wrenchlane.com>",
  to: "shop@example.com",
  subject: "Faster diagnostics",
};

describe("buildMimeMessage threading headers", () => {
  const base = { ...SENDER, subject: "Re: WrenchLane - Faster diagnostics", htmlBody: "<p>Hi,</p>" };

  it("sets our own Message-ID when one is supplied", () => {
    const mime = buildMimeMessage({ ...base, messageId: "<crm-abc@wrenchlane.com>" });
    expect(headerValues(mime, "Message-ID")).toEqual(["<crm-abc@wrenchlane.com>"]);
  });

  it("omits Message-ID entirely when none is supplied", () => {
    expect(headerValues(buildMimeMessage(base), "Message-ID")).toEqual([]);
  });

  it("drops a bare Gmail API id instead of emitting a malformed In-Reply-To", () => {
    // The regression this guards: `In-Reply-To: 1a0384f90cd42904` shipped on
    // ~2,500 sends, an invalid identifier on a message whose subject also
    // claimed to be a reply.
    const mime = buildMimeMessage({ ...base, replyToMessageId: "1a0384f90cd42904" });
    expect(headerValues(mime, "In-Reply-To")).toEqual([]);
    expect(headerValues(mime, "References")).toEqual([]);
    expect(mime).not.toContain("1a0384f90cd42904");
  });

  it("emits a bracketed In-Reply-To and References for a real identifier", () => {
    const mime = buildMimeMessage({ ...base, replyToMessageId: "<crm-step2@wrenchlane.com>" });
    expect(headerValues(mime, "In-Reply-To")).toEqual(["<crm-step2@wrenchlane.com>"]);
    expect(headerValues(mime, "References")).toEqual(["<crm-step2@wrenchlane.com>"]);
  });

  it("builds the References chain in thread order, ending at In-Reply-To", () => {
    const mime = buildMimeMessage({
      ...base,
      replyToMessageId: "<crm-step2@wrenchlane.com>",
      references: ["<crm-step1@wrenchlane.com>"],
    });
    expect(headerValues(mime, "References")).toEqual([
      "<crm-step1@wrenchlane.com> <crm-step2@wrenchlane.com>",
    ]);
  });

  it("never duplicates the replied-to id inside References", () => {
    const mime = buildMimeMessage({
      ...base,
      replyToMessageId: "<crm-step2@wrenchlane.com>",
      references: ["<crm-step1@wrenchlane.com>", "<crm-step2@wrenchlane.com>"],
    });
    expect(headerValues(mime, "References")).toEqual([
      "<crm-step1@wrenchlane.com> <crm-step2@wrenchlane.com>",
    ]);
  });
});

describe("buildMimeMessage plaintext alternative", () => {
  it("carries the same destinations as the HTML part", () => {
    // The old naive tag strip left an HTML part full of links beside a text
    // part with none, which is exactly the divergence filters score.
    const mime = buildMimeMessage({
      ...SENDER,
      htmlBody: '<p>Read <a href="https://wrenchlane.com/pricing">the pricing</a>.</p>',
    });
    expect(decodeParts(mime).text).toBe("Read the pricing <https://wrenchlane.com/pricing>.");
  });

  it("keeps block structure instead of collapsing into one run-on line", () => {
    const mime = buildMimeMessage({
      ...SENDER,
      htmlBody: "<p>Hi,</p><p>Hans here.</p><p>Best regards,</p>",
    });
    expect(decodeParts(mime).text).toBe("Hi,\n\nHans here.\n\nBest regards,");
  });

  it("decodes entities rather than shipping &nbsp; into the inbox", () => {
    const mime = buildMimeMessage({
      ...SENDER,
      htmlBody: "<p>Bilverkstad&nbsp;&amp;&nbsp;service &ouml;ppen</p>",
    });
    expect(decodeParts(mime).text).toBe("Bilverkstad & service öppen");
  });
});

describe("tracking pixel", () => {
  it("does not carry display:none, which is a hidden-image heuristic", () => {
    const mime = buildMimeMessage({
      ...SENDER,
      htmlBody: "<p>Hi</p>",
      trackingId: "track-123",
    });
    const { html, text } = decodeParts(mime);
    expect(html).toContain("/api/tracking/open/track-123");
    expect(html).not.toContain("display:none");
    // And the pixel must not leak into the plaintext part.
    expect(text).not.toContain("tracking/open");
  });
});
