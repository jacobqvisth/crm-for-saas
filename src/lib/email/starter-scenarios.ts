/**
 * Built-in "starter scenarios" for the one-off compose-email modal.
 *
 * These are curated, always-available drafts that pre-fill the subject + body
 * so a rep can pick a lifecycle situation ("just signed up", "gone quiet", …)
 * and either send as-is or hit "Personalize with AI" to tailor it. They live in
 * code (not the email_templates table) so every workspace gets the same
 * curated set without seeding, and they render above the workspace's own saved
 * templates in the dropdown.
 *
 * Bodies use the same {{variable}} merge tokens as templates/sequences
 * (see src/lib/sequences/variables.ts). Keep them short, plain-text-friendly,
 * and written in English — the modal translates on send when a non-English
 * language is chosen.
 */

export type StarterScenario = {
  /** Stable id; the modal prefixes the <option> value with "scenario:". */
  id: string;
  /** Label shown in the dropdown. */
  label: string;
  subject: string;
  /** Simple HTML (paragraphs) so it drops straight into the rich editor. */
  bodyHtml: string;
};

const p = (...lines: string[]) => lines.map((l) => `<p>${l}</p>`).join("");

export const STARTER_SCENARIOS: StarterScenario[] = [
  {
    id: "just-signed-up",
    label: "Just signed up — welcome & check-in",
    subject: "Welcome to Wrenchlane, {{first_name}}",
    bodyHtml: p(
      "Hi{{first_name_optional}},",
      "Thanks for signing up for Wrenchlane — great to have {{company_name}} on board.",
      "The fastest way to see the value is to run your first diagnosis: plug in a car, pull the fault codes, and let Wrenchlane walk you through the likely root cause. Most shops get there in a couple of minutes.",
      "If anything's unclear or you'd like a quick walkthrough, just reply here — happy to help you get set up.",
    ),
  },
  {
    id: "first-week-checkin",
    label: "First week — how's it going?",
    subject: "How are the first diagnoses going, {{first_name}}?",
    bodyHtml: p(
      "Hi{{first_name_optional}},",
      "You've had Wrenchlane for a few days now — how's it going so far?",
      "I wanted to check you've been able to run a fault-code scan and get a clear read on the root cause. That first diagnosis is usually the moment it clicks.",
      "If you hit any snags or have questions about a specific vehicle, reply here and I'll jump in.",
    ),
  },
  {
    id: "few-weeks-in",
    label: "Signed up a few weeks ago — see how they're doing",
    subject: "Checking in — how's Wrenchlane working for {{company_name}}?",
    bodyHtml: p(
      "Hi{{first_name_optional}},",
      "It's been a few weeks since {{company_name}} started with Wrenchlane, so I wanted to check in.",
      "How's it fitting into your workflow? Is it saving your team time on the trickier multi-DTC jobs, or is there something that isn't quite landing yet?",
      "Genuinely keen to hear — good or bad. A quick reply helps us make it more useful for shops like yours.",
    ),
  },
  {
    id: "gone-quiet",
    label: "Gone quiet — gentle re-engagement",
    subject: "Still here if you need us, {{first_name}}",
    bodyHtml: p(
      "Hi{{first_name_optional}},",
      "I noticed things have gone a bit quiet on Wrenchlane lately, so I wanted to reach out.",
      "If something got in the way — a workflow that didn't fit, a car it struggled with, or you just got busy — I'd love to know. Often it's a small thing we can sort quickly.",
      "Want me to jump on a quick call and help you get more out of it?",
    ),
  },
  {
    id: "power-user-feedback",
    label: "Active user — ask for feedback / review",
    subject: "Quick favour, {{first_name}}?",
    bodyHtml: p(
      "Hi{{first_name_optional}},",
      "You and the team at {{company_name}} have been getting good use out of Wrenchlane — thank you for that.",
      "Two quick things: first, is there anything you wish it did that it doesn't yet? Your feedback goes straight into what we build next.",
      "And second — if it's been useful, a short review would mean a lot and helps other independent shops find us. Happy to send the link if you're up for it.",
    ),
  },
  {
    id: "trial-ending",
    label: "Trial ending soon — nudge",
    subject: "Your Wrenchlane trial is wrapping up",
    bodyHtml: p(
      "Hi{{first_name_optional}},",
      "Your Wrenchlane trial is coming to an end, so I wanted to make sure you've had a fair chance to put it through its paces.",
      "If it's been pulling its weight on diagnostics, staying on is simple and I can walk you through the options for {{company_name}}.",
      "And if you're on the fence, tell me what's holding you back — I'd rather help you decide than have the trial just lapse.",
    ),
  },
];
