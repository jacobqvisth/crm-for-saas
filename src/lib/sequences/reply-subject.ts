/**
 * Subject line for a follow-up that threads onto the previous send.
 *
 * Follow-up steps usually carry no subject of their own, so the thread
 * subject is inherited from the last email that actually went out. Prepending
 * "Re: " to that inherited value without looking at it stacks a prefix per
 * step: step 2 sends "Re: X", step 3 inherits that and sends "Re: Re: X", and
 * a five-step sequence ends up shouting "Re: Re: Re: Re: X" at the reader.
 *
 * One "Re: " is what a real reply looks like, so that is what this returns.
 */

/**
 * Leading reply markers, including the ones non-English mail clients write
 * (SV/VS Nordic, AW/ANTW German and Dutch, ODP Polish). Deliberately narrow:
 * a real subject that happens to start with a word and a colon must not be
 * mistaken for a reply marker.
 */
const REPLY_PREFIX = /^\s*(?:re|sv|vs|aw|antw|odp)\s*(?:\[\d+\])?\s*:\s*/i;

/** Strip every stacked reply marker, leaving the original subject. */
export function stripReplyPrefixes(subject: string): string {
  let out = subject ?? "";
  // Bounded rather than while(true): a subject that is nothing but prefixes
  // should come back empty, not spin.
  for (let i = 0; i < 10 && REPLY_PREFIX.test(out); i++) {
    out = out.replace(REPLY_PREFIX, "");
  }
  return out.trim();
}

/** True when the subject already reads as a reply. */
export function hasReplyPrefix(subject: string): boolean {
  return REPLY_PREFIX.test(subject ?? "");
}

/**
 * Build the threaded subject for a follow-up.
 *
 * The previous send's subject wins over the step's own, which is what keeps
 * the thread together: Gmail groups a conversation on subject as well as
 * References, so changing the base subject mid-sequence splits the thread in
 * the reader's inbox. The step's own subject is the fallback for the case
 * where the previous row somehow carried none.
 *
 * Either way the result gets exactly one "Re: ". Returns null when there is
 * nothing to build from, so the caller leaves the queue row alone rather than
 * sending a bare "Re:".
 */
export function threadedReplySubject(
  ownSubject: string,
  previousSubject: string | null | undefined,
): string | null {
  const own = stripReplyPrefixes(ownSubject ?? "");
  const previous = stripReplyPrefixes(previousSubject ?? "");
  const base = previous || own;
  if (!base) return null;
  return `Re: ${base}`;
}
