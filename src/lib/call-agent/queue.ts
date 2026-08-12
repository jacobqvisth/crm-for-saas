import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { buildCallBrief } from "./brief";
import { placeAgentCall } from "./dial";
import { checkRails, dialablePhone } from "./rails";
import { consumeDailyBudget, ensureWebhookSecret } from "./settings";

type Client = SupabaseClient<Database>;
type SettingsRow = Tables<"call_agent_settings">;
type JobRow = Tables<"call_agent_jobs">;

export type DialOutcome =
  | { outcome: "dialed"; sessionId: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; reason: string };

/**
 * Take one claimed job through the rails and, if everything passes, place the
 * 46elks call that bridges the contact into the voice agent. The job moves to
 * 'calling'; the initiation webhook briefs the agent when the call lands, and
 * the post-call webhook / collector ingests the result.
 *
 * `skipRails` exists ONLY for the explicit test-call route.
 */
export async function dialJob(
  service: Client,
  settings: SettingsRow,
  job: JobRow,
  opts: { skipRails?: boolean } = {},
): Promise<DialOutcome> {
  const fail = async (status: "skipped" | "failed", reason: string): Promise<DialOutcome> => {
    await service
      .from("call_agent_jobs")
      .update({
        status,
        ...(status === "skipped" ? { skip_reason: reason } : { error: reason }),
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return status === "skipped"
      ? { outcome: "skipped", reason }
      : { outcome: "failed", reason };
  };

  const { data: contact } = await service
    .from("contacts")
    .select("id, phone, country_code, company_id, email, language")
    .eq("id", job.contact_id)
    .maybeSingle();
  if (!contact) return fail("failed", "contact not found");

  if (!opts.skipRails) {
    const rails = await checkRails(service, {
      settings,
      contact,
      campaignKey: job.campaign_key,
    });
    if (!rails.ok) return fail("skipped", rails.reason);

    if (!(await consumeDailyBudget(service, settings))) {
      // Cap reached: push the job to tomorrow instead of burning it.
      await service
        .from("call_agent_jobs")
        .update({
          status: "queued",
          scheduled_for: new Date(Date.now() + 20 * 3600_000).toISOString(),
          skip_reason: "daily cap reached, rescheduled",
        })
        .eq("id", job.id);
      return { outcome: "skipped", reason: "daily cap reached" };
    }
  }

  const phone = dialablePhone(contact.phone, contact.country_code);
  if (!phone) return fail("skipped", "no dialable phone");

  const callerId = process.env.CRM_CALL_FROM_NUMBER;
  if (!callerId) return fail("failed", "CRM_CALL_FROM_NUMBER not set");

  const brief = await buildCallBrief(service, contact.id, {
    languagesEnabled: settings.languages_enabled,
    objective: job.objective,
  });
  if ("error" in brief) return fail("failed", brief.error);

  // Session first so the webhooks have something to correlate against.
  const { data: session, error: sErr } = await service
    .from("call_sessions")
    .insert({
      workspace_id: settings.workspace_id,
      contact_id: contact.id,
      company_id: contact.company_id,
      list_id: job.list_id,
      provider: "46elks",
      direction: "outbound",
      from_number: callerId,
      to_number: phone,
      status: "dialing",
      initiated_by: "agent",
      agent_job_id: job.id,
    })
    .select("id")
    .single();
  if (sErr || !session) return fail("failed", `session insert failed: ${sErr?.message}`);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const secret = await ensureWebhookSecret(service, settings);

  try {
    const { callId } = await placeAgentCall({
      from: callerId,
      contactPhone: phone,
      hangupWebhookUrl: `${appUrl}/api/call-agent/hangup?token=${secret}&session=${session.id}`,
    });
    await service
      .from("call_sessions")
      .update({ provider_call_id: callId, status: "in_progress" })
      .eq("id", session.id);
    await service
      .from("call_agent_jobs")
      .update({
        status: "calling",
        attempts: (job.attempts ?? 0) + 1,
        started_at: new Date().toISOString(),
        call_session_id: session.id,
      })
      .eq("id", job.id);
    return { outcome: "dialed", sessionId: session.id };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "dial failed";
    await service
      .from("call_sessions")
      .update({ status: "failed", error: reason })
      .eq("id", session.id);
    return fail("failed", reason);
  }
}
