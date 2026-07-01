/**
 * Language labels + picker ordering, shared by client and server.
 *
 * Kept dependency-free (no Anthropic SDK / server imports) so client
 * components can import LANGUAGE_OPTIONS without bundling server-only code.
 */

export const TARGET_LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  et: "Estonian",
  lv: "Latvian",
  lt: "Lithuanian",
  de: "German",
  fr: "French",
  pl: "Polish",
  cs: "Czech",
  ru: "Russian",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
};

export function languageLabel(code: string | null | undefined): string {
  if (!code) return "English";
  return TARGET_LANGUAGE_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}

/**
 * Language codes in display order for pickers: English first, then the Nordic /
 * Baltic markets Wrenchlane sells into, then the rest alphabetically by label.
 */
export const LANGUAGE_OPTIONS: { code: string; label: string }[] = (() => {
  const priority = ["en", "sv", "no", "da", "fi", "et", "lv", "lt"];
  const rest = Object.keys(TARGET_LANGUAGE_LABELS)
    .filter((c) => !priority.includes(c))
    .sort((a, b) => TARGET_LANGUAGE_LABELS[a].localeCompare(TARGET_LANGUAGE_LABELS[b]));
  return [...priority, ...rest].map((code) => ({
    code,
    label: TARGET_LANGUAGE_LABELS[code],
  }));
})();
