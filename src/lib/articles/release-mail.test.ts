import { describe, expect, it } from "vitest";
import {
  buildReleaseBodyHtml,
  decodeTrackedLinks,
  extractReleaseVersion,
  looksLikeRelease,
  parseReleaseEmail,
  releaseImageUrls,
  releaseLanguage,
  releaseSlug,
} from "./release-mail";

// Trimmed from the real 3.7 broadcast ("Your diagnosis now continues into the
// repair and the invoice", sent 2026-08-06). The style attributes are copied
// verbatim, because they are exactly what the parser keys on.
const IMG = (id: string, alt: string, maxW = 540) =>
  `<img src="https://userimg-assets-eu.customeriomail.com/images/client-env-197412/${id}.png" alt="${alt}" style="display:block;width:100%;max-width:${maxW}px;height:auto;border-radius:8px;"/>`;

const HEAD = (t: string) =>
  `<p style="margin:24px 0 8px;font-size:17px;font-weight:700;color:#1a1a1a;">${t}</p>`;
const BODY = (t: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${t}</p>`;

// Customer.io rewrites every href into a click tracker whose payload is
// base64url-encoded JSON. Nothing in the sent HTML is a real URL, so the fixture
// must not cheat by using one: decode({email_id, href}) is the only way in.
const TRACKED_VIDEO =
  "https://links.wrenchlane.com/e/c/eyJlbWFpbF9pZCI6ImFiYyIsImhyZWYiOiJodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PVg1bUhMUUZkLUNFJnV0bV9zb3VyY2U9Y3VzdG9tZXJpbyZ1dG1fbWVkaXVtPWVtYWlsJnV0bV9jYW1wYWlnbj1yZWxlYXNlXzNfNyZ1dG1fY29udGVudD12aWRlbyJ9";

const RELEASE_EMAIL = `
<body>
  ${IMG("01LOGO", "WrenchLane", 200)}
  <h1 style="font-size:26px;">Your diagnosis, continued into the repair and the invoice</h1>
  <p style="margin:0 0 16px;font-size:16px;">WrenchLane 3.7 turns the confirmed cause into a guided repair with labor time and parts.</p>
  <p style="margin:0 0 16px;font-size:16px;">Hi,</p>
  ${BODY('The biggest change in this release is the <strong>repair module</strong>. Confirm a cause and go straight into the <a href="https://app.wrenchlane.com?utm_source=customerio">repair guide</a>.')}
  ${IMG("01REPAIR", "The repair guide with completed steps")}
  ${HEAD("One chat for every car")}
  ${BODY("The search bar is now the chat too.")}
  ${IMG("01CHAT", "The vehicle chat answering questions")}
  ${HEAD("History grouped by the car")}
  ${BODY("Recent vehicles and saved work are one list.")}
  ${IMG("01HISTORY", "The History list with one card per car")}
  ${HEAD("See it in action")}
  <a href="${TRACKED_VIDEO}">${IMG("01POSTER", "Watch the demo")}</a>
  ${BODY("This release, like every release, was shaped by your feedback. Thank you for helping us build WrenchLane.")}
  <p style="font-size:16px;">Questions or feedback? Just reply to this email.</p>
  <p style="font-size:16px;">Best regards,<br/>Team WrenchLane</p>
  <p style="font-size:12px;">AI-driven car diagnostics</p>
  <p style="font-size:12px;">Unsubscribe</p>
  <img src="https://links.wrenchlane.com/e/o/tracking" alt=""/>
</body>`;

describe("release detection", () => {
  it("reads the version from the Customer.io campaign tag", () => {
    expect(extractReleaseVersion(RELEASE_EMAIL)).toBe("3.7");
  });

  it("decodes the click tracker to reach the real destination", () => {
    expect(decodeTrackedLinks(RELEASE_EMAIL)).toEqual([
      "https://www.youtube.com/watch?v=X5mHLQFd-CE&utm_source=customerio&utm_medium=email&utm_campaign=release_3_7&utm_content=video",
    ]);
  });

  it("survives a tracker payload that is not decodable", () => {
    expect(decodeTrackedLinks("https://links.wrenchlane.com/e/c/notvalidbase64json__")).toEqual([]);
  });

  it("recognises a release email", () => {
    expect(looksLikeRelease(RELEASE_EMAIL)).toBe(true);
  });

  it("does not mistake ordinary mail for a release", () => {
    expect(looksLikeRelease("<p>Hi, are we still on for Tuesday?</p>")).toBe(false);
    // A newsletter with an h1 but no release campaign tag.
    expect(looksLikeRelease('<h1>Our year in review</h1><a href="?utm_campaign=newsletter">x</a>')).toBe(
      false,
    );
  });
});

describe("parseReleaseEmail", () => {
  const parsed = parseReleaseEmail(RELEASE_EMAIL)!;

  it("takes the headline from the h1", () => {
    expect(parsed.title).toBe("Your diagnosis, continued into the repair and the invoice");
  });

  it("uses the first paragraph as the lead and drops the salutation", () => {
    expect(parsed.lead).toContain("WrenchLane 3.7 turns the confirmed cause");
    const everything = JSON.stringify(parsed);
    expect(everything).not.toContain("Hi,");
  });

  it("splits the body into the opening plus one section per bold heading", () => {
    expect(parsed.sections.map((s) => s.heading)).toEqual([
      null,
      "One chat for every car",
      "History grouped by the car",
      "See it in action",
    ]);
  });

  it("keeps strong emphasis but unwraps tracking links", () => {
    const opening = parsed.sections[0].paragraphs.join(" ");
    expect(opening).toContain("<strong>repair module</strong>");
    expect(opening).toContain("repair guide");
    expect(opening).not.toContain("utm_source");
    expect(opening).not.toContain("<a");
  });

  it("keeps the three screenshots and drops logo, poster and tracking pixel", () => {
    expect(releaseImageUrls(parsed).map((u) => u.split("/").pop())).toEqual([
      "01REPAIR.png",
      "01CHAT.png",
      "01HISTORY.png",
    ]);
  });

  it("turns the video block into an embed rather than a poster image", () => {
    const video = parsed.sections.find((s) => s.heading === "See it in action")!;
    expect(video.videoId).toBe("X5mHLQFd-CE");
    expect(video.images).toHaveLength(0);
  });

  it("cuts the sign-off, the footer and the thank-you", () => {
    const everything = JSON.stringify(parsed);
    expect(everything).not.toContain("Best regards");
    expect(everything).not.toContain("reply to this email");
    expect(everything).not.toContain("Thank you for helping us build");
    expect(everything).not.toContain("Unsubscribe");
  });
});

describe("buildReleaseBodyHtml", () => {
  const parsed = parseReleaseEmail(RELEASE_EMAIL)!;
  const hosted = new Map(
    releaseImageUrls(parsed).map((u) => [u, `https://cdn.prod.website-files.com/x/${u.split("/").pop()}`]),
  );
  const html = buildReleaseBodyHtml(parsed, hosted);

  it("opens with the headline and the lead", () => {
    expect(html.startsWith("<h1>Your diagnosis, continued into the repair and the invoice</h1>")).toBe(
      true,
    );
  });

  it("uses h3 for features and h4 for the video block", () => {
    expect(html).toContain("<h3><strong>One chat for every car</strong></h3>");
    expect(html).toContain("<h4><strong>See it in action</strong></h4>");
  });

  it("emits Webflow rich-text figures pointing at the hosted copies", () => {
    expect(html).toContain('class="w-richtext-align-center w-richtext-figure-type-image"');
    expect(html).toContain("cdn.prod.website-files.com/x/01REPAIR.png");
    expect(html).not.toContain("userimg-assets-eu.customeriomail.com");
  });

  it("embeds the video", () => {
    expect(html).toContain('src="https://www.youtube.com/embed/X5mHLQFd-CE"');
    expect(html).toContain("w-richtext-figure-type-video");
  });

  it("carries no long dashes", () => {
    expect(html).not.toMatch(/[—–]/);
  });
});

describe("releaseSlug", () => {
  it("reads like the slugs already on the site", () => {
    expect(releaseSlug(parseReleaseEmail(RELEASE_EMAIL)!)).toBe(
      "your-diagnosis-continued-into-the-repair-and-the-invoice-release-3-7",
    );
  });
});

// The 3.8 broadcast ("Your diagnosis, now easier to work through", sent
// 2026-08-20) worded the two closing blocks differently from 3.7, and both
// slipped past patterns written against 3.7 alone. Neither failure raised
// anything: the article was created, staged, and looked complete, minus the
// demo video. A second fixture makes the next rewording a red test rather than
// something caught by eye afterwards.
const RELEASE_EMAIL_38 = `
<body>
  ${IMG("01LOGO", "WrenchLane", 200)}
  <h1 style="font-size:26px;">Your diagnosis, now easier to work through</h1>
  <p style="margin:0 0 16px;font-size:16px;">WrenchLane 3.8 makes it easier to work through a diagnosis from start to finish.</p>
  ${HEAD("Faster fault code lookups")}
  ${BODY("Fault code descriptions now load faster when you enter a DTC.")}
  ${IMG("01DTC", "The fault code lookup")}
  ${HEAD("See WrenchLane 3.8 in action")}
  ${BODY("Watch the short demo below.")}
  <a href="${TRACKED_VIDEO}">${IMG("01POSTER", "Watch the WrenchLane 38 demo")}</a>
  ${BODY("As always, many of these improvements come directly from YOUR feedback. Thanks for helping us make WrenchLane better for everyday workshop use.")}
  <p style="font-size:16px;">Best regards,<br/>Team WrenchLane</p>
  <img src="https://links.wrenchlane.com/e/o/tracking" alt=""/>
</body>`;

describe("release 3.8 wording", () => {
  const parsed = parseReleaseEmail(RELEASE_EMAIL_38)!;

  it("finds the video when the release number is spliced into the heading", () => {
    const video = parsed.sections.find((s) => s.heading === "See WrenchLane 3.8 in action")!;
    expect(video.videoId).toBe("X5mHLQFd-CE");
    // The poster frame belongs to the embed, so it must not survive as an image.
    expect(video.images).toHaveLength(0);
  });

  it("cuts a thank-you that thanks the reader for helping us make, not build", () => {
    expect(JSON.stringify(parsed)).not.toContain("Thanks for helping us make");
  });

  it("cuts the feedback credit alongside it", () => {
    expect(JSON.stringify(parsed)).not.toContain("from YOUR feedback");
  });

  it("reaches the body as an embed under an h4, with no leftover poster image", () => {
    const hosted = new Map(
      releaseImageUrls(parsed).map((u) => [
        u,
        `https://cdn.prod.website-files.com/x/${u.split("/").pop()}`,
      ]),
    );
    const html = buildReleaseBodyHtml(parsed, hosted);
    expect(html).toContain("<h4><strong>See WrenchLane 3.8 in action</strong></h4>");
    expect(html).toContain('src="https://www.youtube.com/embed/X5mHLQFd-CE"');
    expect(html).not.toContain("01POSTER.png");
  });
});

// Trimmed from the real Swedish 3.9 broadcast ("WrenchLane 3.9: nu med lätta
// nyttofordon", sent 2026-08-27), which reached jacob@ minutes after the
// English one reached the jacob+NN@ seeds.
//
// Customer.io sends every release twice, once per language, and the Swedish
// send is the best source for the Swedish variant: it is copy the company
// wrote and approved, carrying house terminology a translation only guesses at
// ("lätta nyttofordon" and "transportbil", where the model produced "lätta
// lastbilar" and "skåpbil"). Using it needs the sign-off patterns to cover
// Swedish, because until they did, the entire closing block plus the footer's
// bold "WrenchLane" landed in the article body.
const SV_CTA =
  "https://links.wrenchlane.com/e/c/eyJlbWFpbF9pZCI6InN2MSIsImhyZWYiOiJodHRwczovL2FwcC53cmVuY2hsYW5lLmNvbT91dG1fc291cmNlPWN1c3RvbWVyaW8mdXRtX21lZGl1bT1lbWFpbCZ1dG1fY2FtcGFpZ249cmVsZWFzZV8zXzkmdXRtX2NvbnRlbnQ9cHJpbWFyeV9jdGEifQ";

const RELEASE_EMAIL_39_SV = `
<body>
  ${IMG("01LOGO", "WrenchLane", 200)}
  <h1 style="font-size:26px;">Lätta nyttofordon, nu tillgängliga</h1>
  <p style="margin:0 0 16px;font-size:16px;">WrenchLane 3.9 finns nu med lätta nyttofordon och transportbilar: hitta dem, slå upp dem och felsök dem precis som en personbil.</p>
  <p style="margin:0 0 16px;font-size:16px;">Hej,</p>
  ${HEAD("Transportbilar och lätta nyttofordon")}
  ${BODY("Sök en transportbil via registreringsnummer eller VIN, eller välj den i modellistan, från en Caddy till en Sprinter.")}
  ${BODY("Fordonstäckning och tekniska data tillhandahålls av Infopro i de europeiska länder som stöds.")}
  ${IMG("01VAN", "En Iveco Daily i fordonshubben med diagnos manualer elektronik och OEM-info")}
  ${HEAD("Premiumdata för fler fordon")}
  ${BODY("Small-planen omfattar nu premiumdata för 50 fordon i månaden och Large-planen för 200, tidigare 20 och 80.")}
  ${BODY("Som alltid kommer många av förbättringarna direkt från ER feedback. Tack för att ni hjälper oss göra WrenchLane bättre för verkstadens vardag.")}
  <p style="font-size:16px;"><a href="${SV_CTA}">Öppna WrenchLane</a></p>
  <p style="font-size:16px;">Frågor eller feedback? Svara bara på det här mejlet.</p>
  <p style="font-size:16px;">Med vänliga hälsningar,<br/>Team WrenchLane</p>
  ${HEAD("WrenchLane")}
  <p style="font-size:12px;">AI-driven car diagnostics</p>
  <p style="font-size:12px;">Unsubscribe</p>
  <img src="https://links.wrenchlane.com/e/o/tracking" alt=""/>
</body>`;

describe("the Swedish release mail", () => {
  const parsed = parseReleaseEmail(RELEASE_EMAIL_39_SV)!;
  const dump = JSON.stringify(parsed);

  it("parses, and finds the version in the Swedish copy", () => {
    expect(parsed).not.toBeNull();
    expect(parsed.version).toBe("3.9");
    expect(parsed.title).toBe("Lätta nyttofordon, nu tillgängliga");
  });

  it("keeps Swedish letters in the prose", () => {
    // Guards the failure that actually shipped: a Swedish variant reading
    // "Latta nyttofordon" and "for personbilar", written by the translator
    // because its own glossary was spelled without diacritics.
    expect(parsed.title).toContain("ä");
    expect(parsed.sections[1].heading).toBe("Premiumdata för fler fordon");
  });

  it("cuts the Swedish sign-off", () => {
    expect(dump).not.toContain("Med vänliga hälsningar");
    expect(dump).not.toContain("Team WrenchLane");
  });

  it("cuts the Swedish thank-you and the feedback credit", () => {
    expect(dump).not.toContain("Tack för att ni hjälper oss");
    expect(dump).not.toContain("från ER feedback");
  });

  it("cuts the reply-to-this-email line", () => {
    expect(dump).not.toContain("Svara bara på det här mejlet");
    expect(dump).not.toContain("Frågor eller feedback");
  });

  it("leaves no dangling footer heading", () => {
    // The footer's bold "WrenchLane" used to survive as a section with nothing
    // under it, rendering an empty h3 at the end of the article.
    expect(parsed.sections.every((s) => s.paragraphs.length || s.images.length || s.videoId)).toBe(
      true,
    );
    expect(parsed.sections.map((s) => s.heading)).not.toContain("WrenchLane");
  });

  it("keeps the two real features and the screenshot", () => {
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0].heading).toBe("Transportbilar och lätta nyttofordon");
    expect(releaseImageUrls(parsed)).toHaveLength(1);
    // 3.9 shipped without a demo video, unlike 3.7 and 3.8.
    expect(parsed.videoId).toBeNull();
  });

  it("transliterates the slug to ASCII", () => {
    expect(releaseSlug(parsed)).toBe("latta-nyttofordon-nu-tillgangliga-release-3-9");
  });

  it("builds a body with the screenshot and no leaked furniture", () => {
    const html = buildReleaseBodyHtml(parsed, new Map());
    expect(html).toContain("<h3><strong>Premiumdata för fler fordon</strong></h3>");
    expect(html).toContain("figure-type-image");
    expect(html).not.toContain("hälsningar");
    expect(html).not.toContain("mejlet");
  });
});

describe("releaseLanguage", () => {
  it("calls the Swedish broadcast Swedish", () => {
    expect(releaseLanguage(RELEASE_EMAIL_39_SV)).toBe("sv");
  });

  it("calls the English broadcasts English", () => {
    // The English fixtures carry the same product nouns as the Swedish one
    // ("Caddy", "OEM", "VIN"), so this is the check that the furniture patterns
    // key on the template rather than on the prose.
    expect(releaseLanguage(RELEASE_EMAIL)).toBe("en");
    expect(releaseLanguage(RELEASE_EMAIL_38)).toBe("en");
  });
});
