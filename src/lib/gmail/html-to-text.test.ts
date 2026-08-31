import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-to-text";

describe("htmlToText", () => {
  it("keeps paragraph breaks instead of collapsing to one run-on line", () => {
    const html = "<p>Hi,</p><p>Hans from Wrenchlane again.</p><p>Best regards,</p>";
    expect(htmlToText(html)).toBe("Hi,\n\nHans from Wrenchlane again.\n\nBest regards,");
  });

  it("preserves link destinations, so the text part is not URL-free", () => {
    // The old tag-strip dropped every href, leaving an HTML part full of
    // links beside a plaintext part with none.
    const html = '<p>See <a href="https://wrenchlane.com/pricing">our pricing</a>.</p>';
    expect(htmlToText(html)).toBe("See our pricing <https://wrenchlane.com/pricing>.");
  });

  it("does not duplicate a link whose text is already the URL", () => {
    const html = '<a href="https://wrenchlane.com">https://wrenchlane.com</a>';
    expect(htmlToText(html)).toBe("https://wrenchlane.com");
  });

  it("decodes entities rather than shipping them raw", () => {
    expect(htmlToText("<p>caf&eacute;&nbsp;&amp;&nbsp;bar &ouml;ppen</p>")).toBe(
      "café & bar öppen",
    );
    expect(htmlToText("<p>5 &lt; 10 &#39;yes&#39;</p>")).toBe("5 < 10 'yes'");
  });

  it("turns <br> into a single newline", () => {
    expect(htmlToText("Best regards,<br>Hans")).toBe("Best regards,\nHans");
  });

  it("drops the tracking pixel without leaving a stray URL", () => {
    const html =
      '<p>Hello</p><img src="https://link.wrenchlane.se/api/tracking/open/abc" width="1" height="1" alt="" />';
    expect(htmlToText(html)).toBe("Hello");
  });

  it("renders list items as bullets", () => {
    expect(htmlToText("<ul><li>One</li><li>Two</li></ul>")).toBe("- One\n- Two");
  });

  it("strips script and style content", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Visible</p>")).toBe("Visible");
  });

  it("collapses runs of blank lines so it reads like a typed email", () => {
    expect(htmlToText("<p>A</p><div></div><div></div><p>B</p>")).toBe("A\n\nB");
  });

  it("handles a realistic signature card, keeping phone and site", () => {
    const sig = `<p style="margin:0">Hans</p>
      <table><tr><td>
        <div>Hans Markebrant</div>
        <div><a href="https://WrenchLane.com">WrenchLane.com</a></div>
        <div><a href="tel:+46709105182">+46 70 910 51 82</a></div>
      </td></tr></table>`;
    const text = htmlToText(sig);
    expect(text).toContain("Hans Markebrant");
    expect(text).toContain("WrenchLane.com <https://WrenchLane.com>");
    expect(text).toContain("+46 70 910 51 82 <tel:+46709105182>");
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
  });
});
