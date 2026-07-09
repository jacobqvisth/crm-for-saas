// Long dashes (em "—", en "–", horizontal bar "―") are one of the strongest
// tells that a human didn't write a piece of text. Every model-generated string
// we surface to the outside world (forum posts, comments, replies, emails,
// marketing copy) must read like a person typed it, so we rewrite long dashes
// to ordinary commas / hyphens before the text ever leaves the app.
//
// This is deliberately conservative: number ranges ("2–5") become hyphens, a
// dash used as a clause break becomes a comma, and any stray em dash collapses
// to a comma. It never touches ordinary hyphens.
export function stripLongDashes(text: string): string {
  if (!text) return text;
  return (
    text
      // Number range with an en dash → hyphen ("2–5" / "10 – 20" → "2-5").
      .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
      // Spaced long dash used as a clause break → comma ("fast — cheap").
      .replace(/\s+[—–―]\s+/g, ", ")
      // Any remaining long dash (tight "word—word") → comma.
      .replace(/[—–―]/g, ", ")
      // Tidy up any doubled commas / comma-before-punctuation the swap created.
      .replace(/,\s*,/g, ",")
      .replace(/,\s*([.!?;:])/g, "$1")
  );
}
