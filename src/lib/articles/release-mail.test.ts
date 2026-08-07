import { describe, expect, it } from "vitest";
import {
  buildReleaseBodyHtml,
  decodeTrackedLinks,
  extractReleaseVersion,
  looksLikeRelease,
  parseReleaseEmail,
  releaseImageUrls,
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
