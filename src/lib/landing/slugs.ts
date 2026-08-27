/**
 * URL rules for the landing-page programme.
 *
 * Everything in the fault-code cluster sits under one path prefix on purpose.
 * A few hundred generated pages is the kind of thing that occasionally has to
 * be measured as a block, de-indexed as a block, or moved as a block, and a
 * shared prefix is what makes each of those a one-line operation instead of a
 * migration. It also gives Search Console a folder to report on, which is the
 * only way to tell whether the cluster is earning its keep.
 *
 * Locale prefixes follow the live Webflow site (/en, /sv), not the Astro
 * repo's region variants (/en-us, /en-gb, /sv-se). If the cutover happens the
 * mapping is mechanical and already described in that repo's slug map.
 */

/** The one prefix the whole generated cluster lives under. */
export const FAULT_CODE_PREFIX = "fault-code";

export const SYMPTOM_PREFIX = "symptom";

export type LandingLocale = "en" | "sv";

export const LANDING_LOCALES: readonly LandingLocale[] = ["en", "sv"];

export const SITE_ORIGIN = "https://wrenchlane.com";

/**
 * Codes are uppercase everywhere a human reads them and lowercase in the URL.
 *
 * Mixed case in a path is a duplicate-content generator: /fault-code/P0420 and
 * /fault-code/p0420 are different URLs to a crawler and the same page to a
 * person. Lowercase is the canonical form and the only one we ever emit.
 */
export function codeSlug(code: string): string {
  return code.trim().toLowerCase();
}

/** `p0420` back to `P0420`. */
export function slugToCode(slug: string): string {
  return slug.trim().toUpperCase();
}

/** Lowercase, ASCII, hyphenated. Shared by symptom and make slugs. */
export function textSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[åä]/gi, "a")
    .replace(/[ö]/gi, "o")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function faultCodePath(code: string, locale: LandingLocale = "en") {
  return `/${locale}/${FAULT_CODE_PREFIX}/${codeSlug(code)}`;
}

export function faultCodeFamilyPath(
  familyKey: string,
  locale: LandingLocale = "en",
) {
  return `/${locale}/${FAULT_CODE_PREFIX}/family/${textSlug(familyKey)}`;
}

export function faultCodeSystemPath(
  systemKey: string,
  locale: LandingLocale = "en",
) {
  return `/${locale}/${FAULT_CODE_PREFIX}/system/${textSlug(systemKey)}`;
}

export function makeHubPath(make: string, locale: LandingLocale = "en") {
  return `/${locale}/${FAULT_CODE_PREFIX}/make/${textSlug(make)}`;
}

export function symptomPath(symptom: string, locale: LandingLocale = "en") {
  return `/${locale}/${SYMPTOM_PREFIX}/${textSlug(symptom)}`;
}

export function absolute(path: string): string {
  return `${SITE_ORIGIN}${path}`;
}
