import { describe, it, expect } from "vitest";
import {
  defaultLanguage,
  resolveContactLanguage,
  sequenceLanguages,
} from "./language";
import {
  isSupportedLanguage,
  languageForCountry,
  languageLabel,
  normalizeLanguage,
} from "@/lib/i18n/languages";

describe("normalizeLanguage", () => {
  it("lowercases and strips region suffixes in either separator", () => {
    expect(normalizeLanguage("SV")).toBe("sv");
    expect(normalizeLanguage("sv-SE")).toBe("sv");
    expect(normalizeLanguage("en_US")).toBe("en");
    expect(normalizeLanguage("  pl  ")).toBe("pl");
  });

  it("maps Norwegian Bokmal and Nynorsk onto the code we label", () => {
    // Contacts synced from the app carry `nb`; without this every Norwegian
    // falls through to the sequence default.
    expect(normalizeLanguage("nb")).toBe("no");
    expect(normalizeLanguage("nb-NO")).toBe("no");
    expect(normalizeLanguage("nn")).toBe("no");
  });

  it("returns null for empty input so callers can use their own default", () => {
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
    expect(normalizeLanguage("")).toBeNull();
    expect(normalizeLanguage("   ")).toBeNull();
  });
});

describe("language coverage", () => {
  it("covers every language present on prod contacts", () => {
    // Codes observed in the contacts table on 2026-08-10. Romanian alone is
    // 102 contacts and used to be unselectable.
    const observed = [
      "sv", "lt", "en", "lv", "et", "ro", "ru", "pl", "bg", "uk",
      "de", "cs", "fr", "tr", "nl", "sk", "it", "ar", "fi", "es",
      "nb", "fa", "pt", "zh",
    ];
    for (const code of observed) {
      expect(isSupportedLanguage(code), `missing label for ${code}`).toBe(true);
    }
  });

  it("labels a Bokmal contact as Norwegian rather than shouting the code", () => {
    expect(languageLabel("nb")).toBe("Norwegian");
  });
});

describe("languageForCountry", () => {
  it("maps unambiguous countries", () => {
    expect(languageForCountry("SE")).toBe("sv");
    expect(languageForCountry("pl")).toBe("pl");
    expect(languageForCountry("RO")).toBe("ro");
  });

  it("refuses to guess for multilingual countries", () => {
    // Belgium is nl/fr and Switzerland de/fr/it. Guessing wrong is worse than
    // falling back to the sequence default.
    expect(languageForCountry("BE")).toBeNull();
    expect(languageForCountry("CH")).toBeNull();
    expect(languageForCountry("CY")).toBeNull();
    expect(languageForCountry(null)).toBeNull();
  });
});

describe("sequenceLanguages / defaultLanguage", () => {
  it("normalises, dedupes and preserves order", () => {
    expect(
      sequenceLanguages({ languages: ["EN", "sv-SE", "en", "nb"] }),
    ).toEqual(["en", "sv", "no"]);
  });

  it("treats a missing or malformed list as unbounded", () => {
    expect(sequenceLanguages(null)).toEqual([]);
    expect(sequenceLanguages({})).toEqual([]);
  });

  it("defaults to the explicit setting, then the first language, then en", () => {
    expect(defaultLanguage({ languages: ["sv", "en"], default_language: "en" })).toBe("en");
    expect(defaultLanguage({ languages: ["sv", "en"] })).toBe("sv");
    expect(defaultLanguage({})).toBe("en");
    expect(defaultLanguage(null)).toBe("en");
  });
});

describe("resolveContactLanguage", () => {
  const settings = { languages: ["en", "sv", "pl"], default_language: "en" };

  it("prefers the contact's own language over their country", () => {
    // Real prod shape: Romanian and Lithuanian app users who picked English.
    const contact = { language: "en", country_code: "RO" };
    expect(resolveContactLanguage(contact, settings)).toBe("en");
  });

  it("falls back to the country default when no language is set", () => {
    expect(
      resolveContactLanguage({ language: null, country_code: "PL" }, settings),
    ).toBe("pl");
  });

  it("falls back to the sequence default when the campaign doesn't speak it", () => {
    // Lithuanian contact, campaign authored in en/sv/pl only.
    expect(
      resolveContactLanguage({ language: "lt", country_code: "LT" }, settings),
    ).toBe("en");
  });

  it("falls back to the sequence default when nothing is known", () => {
    expect(resolveContactLanguage({}, settings)).toBe("en");
    expect(resolveContactLanguage(null, settings)).toBe("en");
  });

  it("ignores a country default the campaign doesn't speak", () => {
    // Romanian country, but this campaign has no Romanian copy.
    expect(
      resolveContactLanguage({ language: null, country_code: "RO" }, settings),
    ).toBe("en");
  });

  it("accepts any resolved language when the sequence is unbounded", () => {
    expect(
      resolveContactLanguage({ language: "lt" }, { default_language: "en" }),
    ).toBe("lt");
    expect(
      resolveContactLanguage({ country_code: "RO" }, { default_language: "en" }),
    ).toBe("ro");
  });

  it("normalises what it stores, so nb is pinned as no", () => {
    expect(
      resolveContactLanguage({ language: "nb-NO" }, { languages: ["en", "no"] }),
    ).toBe("no");
  });
});
