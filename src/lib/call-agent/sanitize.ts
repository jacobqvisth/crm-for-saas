// Voice-safe text sanitizer. Everything we hand a TTS voice (prompt snippets,
// dynamic variables, first messages) goes through here: long dashes read
// terribly out loud, markdown/URLs are visual artifacts, and control
// characters can break provider payloads.

/** Replace long dashes with a comma pause and strip visual markup for TTS. */
export function voiceSafe(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ") // em/en dash → comma pause
    .replace(/[*_`#>]+/g, "") // markdown markers
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1") // [label](url) → label
    .replace(/https?:\/\/\S+/g, "") // bare URLs say nothing out loud
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") // control chars
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Single-line variant for dynamic variables (provider payloads). */
export function voiceSafeInline(text: string): string {
  return voiceSafe(text).replace(/\s*\n+\s*/g, ". ");
}
