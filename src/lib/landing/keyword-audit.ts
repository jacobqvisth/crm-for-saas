/**
 * Deciding which fault-code keywords can never match a search.
 *
 * WHY THIS IS NOT JUST A REGEX
 *
 * The first pass at this was a spec argument: SAE J2012 allows only 0 to 3 as a
 * code's second character, so P8000 is not a code any vehicle emits, so a
 * keyword bidding on it can never match. That reasoning is sound and, applied
 * naively, wrong in a way worth writing down.
 *
 * `C4500` has the shape of a chassis code with an impossible second character.
 * It is also a Chevrolet truck. So is C5500, C6500, C7500, C8500 and several
 * GMC equivalents. A regex alone flags "chevrolet c4500" as a keyword bidding
 * on an impossible fault code, which is exactly backwards: it is a keyword
 * bidding on a vehicle, and those keywords have served real impressions.
 *
 * Two guards, and the second is the one that matters:
 *
 *  1. A vehicle-context word anywhere in the keyword disqualifies it. If a
 *     marque is named, the code-shaped token is far more likely to be a model.
 *
 *  2. Lifetime impressions. A keyword that has ever served has, by definition,
 *     matched a real search, whatever its shape suggests. This is evidence
 *     rather than inference, and it overrules the regex every time.
 *
 * Removal requires both: impossible by shape, and never once served.
 */

/** OBD-II shape: system letter plus four hex characters. */
const CODE_TOKEN = /\b([PBCU][0-9A-F]{4})\b/gi;

/**
 * Marques and model families whose designations collide with the code shape.
 *
 * Not exhaustive, and it does not need to be: it is a cheap first filter, and
 * the impressions check behind it catches anything this misses.
 */
const VEHICLE_CONTEXT =
  /\b(chevrolet|chevy|gmc|ford|isuzu|kodiak|topkick|silverado|sierra|savana|express)\b/i;

/** SAE J2012 allows only these as the second character of a real code. */
export function isPossibleCode(code: string): boolean {
  return "0123".includes(code.toUpperCase().charAt(1));
}

export function codeTokensIn(keyword: string): string[] {
  return [...keyword.matchAll(CODE_TOKEN)].map((match) =>
    match[1].toUpperCase(),
  );
}

export type KeywordVerdict =
  | { removable: true; reason: string }
  | { removable: false; reason: string };

/**
 * @param impressions Lifetime impressions for this keyword, all time.
 */
export function judgeKeyword(
  keyword: string,
  impressions: number,
): KeywordVerdict {
  const codes = codeTokensIn(keyword);
  if (codes.length === 0) {
    return { removable: false, reason: "no code-shaped token" };
  }
  if (codes.some(isPossibleCode)) {
    return { removable: false, reason: "contains a structurally valid code" };
  }
  if (VEHICLE_CONTEXT.test(keyword)) {
    return {
      removable: false,
      reason:
        "names a marque, so the code-shaped token is probably a model designation",
    };
  }
  if (impressions > 0) {
    return {
      removable: false,
      reason: `has served ${impressions} impression(s), so it matches something real whatever its shape suggests`,
    };
  }
  return {
    removable: true,
    reason: "no valid code, no vehicle context, and never served an impression",
  };
}
