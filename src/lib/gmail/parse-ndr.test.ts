import { describe, it, expect } from "vitest";
import { parseNdr } from "./parse-ndr";

const LOOPIA_VIA_MICROSOFT = `Your message to dalens@adbilverkstad.se couldn't be delivered.

Original Message Details
Created Date: 5/19/2026 5:40:20 PM
Sender Address: magnus@wrenchlane.com
Recipient Address: dalens@adbilverkstad.se
Subject: WrenchLane - snabbare diagnos

Error Details
Error: 550 5.7.350 Remote server returned message detected as spam -> 554 5.7.1 Spam message rejected
Message rejected by: s899.loopia.se

Notification Details
Sent by: PR3PR01MB6267.eurprd01.prod.exchangelabs.com

Original Message Headers
Message-ID: <CAJLSg73+zwBQC7RO__UkFtPk+1yrdQHu5Td4ucgNzpcv-dNBkA@mail.gmail.com>
From: magnus <magnus@wrenchlane.com>
To: dalens@adbilverkstad.se
Subject: WrenchLane - snabbare diagnos
`;

const RFC3464_GMAIL_BOUNCE = `Delivery to the following recipient failed permanently:

     bogus@example.invalid

----- The following errors were reported -----

Final-Recipient: rfc822; bogus@example.invalid
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550-5.1.1 The email account you tried to reach does not exist.

----- Original message -----

Message-ID: <CAKLooP-original-id@mail.gmail.com>
From: sender@example.com
To: bogus@example.invalid
Subject: Hello
`;

const SOFT_BOUNCE_4XX = `Delivery temporarily suspended.

Final-Recipient: rfc822; queue.full@example.org
Action: delayed
Status: 4.2.2
Diagnostic-Code: smtp; 452 4.2.2 Mailbox full

Message-ID: <orig-soft@example.com>
`;

describe("parseNdr — Microsoft 365 / Loopia bounce", () => {
  const parsed = parseNdr(LOOPIA_VIA_MICROSOFT);

  it("extracts the recipient address", () => {
    expect(parsed.recipients).toContain("dalens@adbilverkstad.se");
  });

  it("extracts both SMTP code (highest) and enhanced status", () => {
    // The Loopia error chains "550 5.7.350 ... 554 5.7.1 ..."; the parser
    // greedily picks the first 5xx code which is 550. The enhanced status
    // grabs the first 5.x.y which is 5.7.350.
    expect(parsed.smtpCode).toBe("550");
    expect(parsed.enhancedStatus).toBe("5.7.350");
  });

  it("captures the full error chain", () => {
    expect(parsed.errorText).toContain("spam");
  });

  it("extracts the original Gmail Message-ID for queue lookup", () => {
    expect(parsed.originalMessageId).toBe(
      "CAJLSg73+zwBQC7RO__UkFtPk+1yrdQHu5Td4ucgNzpcv-dNBkA@mail.gmail.com",
    );
  });

  it("identifies the rejecting host", () => {
    expect(parsed.rejectingHost).toBe("s899.loopia.se");
  });

  it("classifies as permanent on 5xx", () => {
    expect(parsed.permanence).toBe("permanent");
  });
});

describe("parseNdr — RFC 3464 standard DSN", () => {
  const parsed = parseNdr(RFC3464_GMAIL_BOUNCE);

  it("extracts the recipient from Final-Recipient", () => {
    expect(parsed.recipients).toContain("bogus@example.invalid");
  });

  it("extracts SMTP + enhanced status", () => {
    expect(parsed.smtpCode).toBe("550");
    expect(parsed.enhancedStatus).toBe("5.1.1");
  });

  it("extracts the original Message-ID", () => {
    expect(parsed.originalMessageId).toBe("CAKLooP-original-id@mail.gmail.com");
  });

  it("classifies as permanent", () => {
    expect(parsed.permanence).toBe("permanent");
  });
});

describe("parseNdr — temporary 4xx soft bounce", () => {
  const parsed = parseNdr(SOFT_BOUNCE_4XX);

  it("classifies as temporary", () => {
    expect(parsed.permanence).toBe("temporary");
  });

  it("captures the 4xx status", () => {
    expect(parsed.enhancedStatus).toBe("4.2.2");
    expect(parsed.smtpCode).toBe("452");
  });
});

// Gmail's "Address not found" NDR for a nonexistent domain. The readable
// text part carries NO SMTP code and NO enhanced status — only prose plus
// the DNS NXDOMAIN line. Real incident 2026-08-18 (bilexpert@gmail.comert):
// permanence parsed as "unknown", so the contact was never suppressed.
const GMAIL_NXDOMAIN_NO_CODES = `Address not found

Your message wasn't delivered to bilexpert@gmail.comert because the domain gmail.comert couldn't be found. Check for typos or unnecessary spaces and try again.

The response was:

DNS type 'mx' lookup of gmail.comert responded with code NXDOMAIN

----- Original message -----

Message-ID: <CAJLSg73-nxdomain-example@mail.gmail.com>
From: magnus <magnus@wrenchlane.com>
To: bilexpert@gmail.comert
Subject: Followup
`;

describe("parseNdr — Gmail NXDOMAIN NDR without status codes", () => {
  const parsed = parseNdr(GMAIL_NXDOMAIN_NO_CODES);

  it("has no SMTP or enhanced status code", () => {
    expect(parsed.smtpCode).toBeNull();
    expect(parsed.enhancedStatus).toBeNull();
  });

  it("still classifies as permanent via failure-text fallback", () => {
    expect(parsed.permanence).toBe("permanent");
  });

  it("extracts the failing recipient", () => {
    expect(parsed.recipients).toContain("bilexpert@gmail.comert");
  });

  it("extracts the original Message-ID", () => {
    expect(parsed.originalMessageId).toBe(
      "CAJLSg73-nxdomain-example@mail.gmail.com",
    );
  });
});

describe("parseNdr — permanent-text fallback stays subordinate to codes", () => {
  it("a 4xx bounce mentioning 'mailbox full' stays temporary", () => {
    const parsed = parseNdr(SOFT_BOUNCE_4XX);
    expect(parsed.permanence).toBe("temporary");
  });

  it("code-less prose without hard-failure phrases stays unknown", () => {
    const parsed = parseNdr(
      "Delivery incomplete. There was a temporary problem delivering your message to someone@example.com. Gmail will retry.",
    );
    expect(parsed.permanence).toBe("unknown");
  });
});

describe("parseNdr — defensive paths", () => {
  it("returns empty recipients for an unparseable body", () => {
    const parsed = parseNdr("just garbage no useful content");
    expect(parsed.recipients).toEqual([]);
    expect(parsed.smtpCode).toBeNull();
    expect(parsed.permanence).toBe("unknown");
  });

  it("skips obvious system addresses when fallback-scanning", () => {
    // Body with no structured fields, just a couple of email addresses
    const body =
      "Auto-generated from MicrosoftExchange329e71ec88ae4615@tenant.onmicrosoft.com to mailer-daemon@google.com about your message to real@target.example.com";
    const parsed = parseNdr(body);
    expect(parsed.recipients).toEqual(["real@target.example.com"]);
  });
});
