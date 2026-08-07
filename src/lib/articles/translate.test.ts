import { describe, expect, it } from "vitest";
import { asciiSlug, preservesStructure } from "./translate";

const EN =
  '<h1>From diagnosis to completed repair</h1><p>Body.</p>' +
  '<figure class="w-richtext-figure-type-image"><div><img alt="Repair guide" src="https://cdn.prod.website-files.com/x/repair.png" loading="lazy"></div></figure>' +
  '<figure class="w-richtext-figure-type-video"><div><iframe src="https://www.youtube.com/embed/X5mHLQFd-CE"></iframe></div></figure>';

describe("preservesStructure", () => {
  it("accepts a translation that keeps every media URL and figure", () => {
    const sv = EN.replace("From diagnosis to completed repair", "Fran diagnos till slutford reparation")
      .replace("Body.", "Brodtext.")
      .replace('alt="Repair guide"', 'alt="Reparationsguiden"');
    expect(preservesStructure(EN, sv)).toBe(true);
  });

  it("rejects a translation that dropped a figure", () => {
    const sv = EN.replace(
      '<figure class="w-richtext-figure-type-video"><div><iframe src="https://www.youtube.com/embed/X5mHLQFd-CE"></iframe></div></figure>',
      "",
    );
    expect(preservesStructure(EN, sv)).toBe(false);
  });

  it("rejects a translation that rewrote an image URL", () => {
    // The failure mode that matters: a model "helpfully" localising a path
    // leaves a broken image that nobody sees until the Swedish page is opened.
    const sv = EN.replace("/x/repair.png", "/x/reparation.png");
    expect(preservesStructure(EN, sv)).toBe(false);
  });

  it("rejects a translation that dropped the video embed URL", () => {
    const sv = EN.replace("https://www.youtube.com/embed/X5mHLQFd-CE", "");
    expect(preservesStructure(EN, sv)).toBe(false);
  });

  it("tolerates prose growing, since Swedish runs longer", () => {
    const sv = EN.replace("Body.", "En betydligt langre svensk brodtext som fortsatter ett tag till.");
    expect(preservesStructure(EN, sv)).toBe(true);
  });
});

describe("asciiSlug", () => {
  it("transliterates Swedish characters the way the site does", () => {
    expect(asciiSlug("Från diagnos till slutförd reparation - Release 3.7")).toBe(
      "fran-diagnos-till-slutford-reparation-release-3-7",
    );
  });

  it("matches the existing 3.5 Swedish slug style", () => {
    expect(asciiSlug("Slutför en service och spara den som en rapport")).toBe(
      "slutfor-en-service-och-spara-den-som-en-rapport",
    );
  });

  it("leaves no trailing or repeated hyphens", () => {
    expect(asciiSlug("  Hej!!  Då??  ")).toBe("hej-da");
  });
});
