/**
 * LinkedIn sequence steps: what a rep is handed, and where they go to do it.
 *
 * There is no automated send here on purpose. LinkedIn's official API cannot
 * send a connection request or a member-to-member message at any tier, so
 * every tool that does it drives a real logged-in session outside LinkedIn's
 * terms. Modelling the step as a task keeps the send in a human's hands and
 * leaves the door open for a provider later: the row this produces is the same
 * row a provider would read.
 */

import type { Tables } from "@/lib/database.types";

type Contact = Tables<"contacts">;
type Company = Tables<"companies">;

/** The two step types this module governs. */
export const LINKEDIN_STEP_TYPES = ["linkedin_invite", "linkedin_message"] as const;

export type LinkedInStepType = (typeof LINKEDIN_STEP_TYPES)[number];

export function isLinkedInStepType(type: string | null): type is LinkedInStepType {
  return (LINKEDIN_STEP_TYPES as readonly string[]).includes(type ?? "");
}

/**
 * LinkedIn truncates a connection-request note past 300 characters. A message
 * to an existing connection has no comparable limit, so this is enforced in the
 * invite editor only, and never in the database.
 */
export const INVITE_NOTE_MAX_CHARS = 300;

/**
 * Where the rep should click.
 *
 * Contacts rarely have `linkedin_url` — it is null for every contact in
 * Wrenchlane's database today — so a missing profile falls back to a people
 * search seeded with whatever identity we do hold. That keeps the step useful
 * before any profile enrichment exists: "find and invite this person" is still
 * twenty seconds of work, where a task with no link at all is a dead end.
 *
 * Returns null only when there is nothing to search on either, in which case
 * the step has nothing to act on and the caller skips it.
 */
export function linkedInTarget(
  contact: Pick<Contact, "linkedin_url" | "first_name" | "last_name" | "email">,
  company?: Pick<Company, "name"> | null,
): { url: string; kind: "profile" | "search" } | null {
  const profile = contact.linkedin_url?.trim();
  if (profile) return { url: profile, kind: "profile" };

  const terms = [
    [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim(),
    company?.name?.trim() ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!terms) return null;

  return {
    url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(terms)}`,
    kind: "search",
  };
}

/** Default task title when the step does not set one. */
export function defaultLinkedInTitle(
  type: LinkedInStepType,
  who: string,
): string {
  return type === "linkedin_invite"
    ? `LinkedIn invite: ${who}`
    : `LinkedIn message: ${who}`;
}

interface DescriptionParts {
  /** The message text, variables already resolved. Empty is allowed. */
  body: string;
  /** Rep-facing notes from the step, variables already resolved. */
  notes: string | null;
  target: { url: string; kind: "profile" | "search" };
}

/**
 * The task description a rep actually reads: where to go, what to send, then
 * any notes.
 *
 * A search fallback says so out loud rather than presenting a guessed link as
 * if it were the person's profile.
 */
export function linkedInTaskDescription({
  body,
  notes,
  target,
}: DescriptionParts): string {
  const blocks: string[] = [];

  blocks.push(
    target.kind === "profile"
      ? `Profile: ${target.url}`
      : `No profile on file. Search LinkedIn: ${target.url}`,
  );

  const text = body.trim();
  if (text) blocks.push(`Send:\n${text}`);
  if (notes?.trim()) blocks.push(`Notes:\n${notes.trim()}`);

  return blocks.join("\n\n");
}
