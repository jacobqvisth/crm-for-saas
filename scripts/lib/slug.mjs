const DIACRITIC_MAP = {
  'å': 'a', 'ä': 'a', 'ö': 'o', 'Å': 'a', 'Ä': 'a', 'Ö': 'o',
  'é': 'e', 'è': 'e', 'ê': 'e', 'É': 'e', 'È': 'e', 'Ê': 'e',
  'ü': 'u', 'Ü': 'u', 'ø': 'o', 'Ø': 'o', 'æ': 'a', 'Æ': 'a',
};

export function slugify(s) {
  if (!s) return '';
  let out = '';
  for (const ch of s) out += DIACRITIC_MAP[ch] ?? ch;
  return out
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}
