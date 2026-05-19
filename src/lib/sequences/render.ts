// Lazy renderer for queued emails.
//
// Why this exists: enrollment.ts freezes `email_queue.body_html` and
// `email_queue.subject` at enrollment time, evaluating variables against the
// then-current step body / variant / template. If you later edit a step's
// `body_override` to remove an inline signature or fix a typo, queued rows
// that haven't sent yet still carry the old text — process-emails pulls
// `body_html` straight off the row and ships it.
//
// `renderQueuedEmail` re-resolves subject + body from the live sequence_step
// (and pinned variant, if any) right before sending. The frozen
// `email_queue.body_html` becomes a fallback used only when the step has been
// deleted in the meantime.
//
// The pinned variant is still respected: if a queue row has `variant_id=X`,
// we fetch THAT variant's current body — so editing variant copy on a live
// sequence propagates the same way step edits do, but the A/B assignment a
// contact got at enrollment stays stable.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { resolveVariables, ensureUnsubscribeLink } from "./variables";

type Contact = Tables<"contacts">;
type Company = Pick<Tables<"companies">, "name">;

export type RenderableQueueItem = {
  step_id: string | null;
  variant_id: string | null;
  contact_id: string;
  tracking_id: string | null;
  subject: string;
  body_html: string;
};

export type RenderedEmail = {
  subject: string;
  bodyHtml: string;
  /** True when the live step lookup succeeded and re-rendered content was used. */
  reRendered: boolean;
};

export async function renderQueuedEmail(
  supabase: SupabaseClient<Database>,
  item: RenderableQueueItem,
): Promise<RenderedEmail> {
  // 1. Load the live step. If it's gone, fall back to whatever the queue row
  //    captured at enrollment — better stale than failing to send entirely.
  if (!item.step_id) {
    return {
      subject: item.subject,
      bodyHtml: item.body_html,
      reRendered: false,
    };
  }

  const { data: step } = await supabase
    .from("sequence_steps")
    .select("id, subject_override, body_override, template_id")
    .eq("id", item.step_id)
    .maybeSingle();

  if (!step) {
    return {
      subject: item.subject,
      bodyHtml: item.body_html,
      reRendered: false,
    };
  }

  // 2. Resolve the source: pinned variant > step override > template.
  let sourceSubject = step.subject_override ?? "";
  let sourceBody = step.body_override ?? "";

  if (item.variant_id) {
    const { data: variant } = await supabase
      .from("sequence_step_variants")
      .select("subject, body_html, is_active")
      .eq("id", item.variant_id)
      .maybeSingle();
    // Honor the pin even if the variant is now inactive — the user picked
    // it for this contact at enrollment time, and the operator's choice to
    // deactivate a variant shouldn't silently rewrite emails already in
    // flight. If the variant was deleted entirely we fall back to the step.
    if (variant) {
      sourceSubject = variant.subject;
      sourceBody = variant.body_html;
    }
  }

  if (step.template_id && (!sourceSubject || !sourceBody)) {
    const { data: template } = await supabase
      .from("email_templates")
      .select("subject, body_html")
      .eq("id", step.template_id)
      .maybeSingle();
    if (template) {
      if (!sourceSubject) sourceSubject = template.subject;
      if (!sourceBody) sourceBody = template.body_html;
    }
  }

  // 3. Load the contact + company for variable resolution. Use the live
  //    contact record so any post-enrollment name / company changes flow
  //    through too.
  const { data: contact } = await supabase
    .from("contacts")
    .select("*, companies(name)")
    .eq("id", item.contact_id)
    .maybeSingle();

  if (!contact) {
    return {
      subject: item.subject,
      bodyHtml: item.body_html,
      reRendered: false,
    };
  }

  const company =
    (contact as unknown as { companies?: Company | null }).companies ?? null;
  const trackingId = item.tracking_id ?? undefined;

  // resolveVariables only reads `.name` from company; we narrowed the type
  // by selecting only that column. Matches the same `as never` cast used in
  // enrollment.ts where the embedded join returns the same narrow shape.
  const subject = resolveVariables(
    sourceSubject,
    contact as Contact,
    company as never,
    trackingId,
  );
  let bodyHtml = resolveVariables(
    sourceBody,
    contact as Contact,
    company as never,
    trackingId,
  );
  if (trackingId) {
    bodyHtml = ensureUnsubscribeLink(bodyHtml, trackingId);
  }

  return { subject, bodyHtml, reRendered: true };
}
