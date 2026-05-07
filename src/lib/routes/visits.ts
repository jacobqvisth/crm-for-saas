import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/database.types";
import { promoteDiscoveredShop } from "@/lib/discovery/promote";
import { enrollContacts } from "@/lib/sequences/enrollment";
import {
  AUTO_ENROLL_DEFAULT,
  FOLLOW_UP_REQUIRED_DEFAULT,
  OUTCOME_LABEL,
  VISIT_OUTCOMES,
  decideEnrollment,
  readFieldVisitsSettings,
  type EnrollmentSkipReason,
  type FieldVisitsSettings,
  type VisitOutcome,
} from "./visits-decision";

export {
  AUTO_ENROLL_DEFAULT,
  FOLLOW_UP_REQUIRED_DEFAULT,
  OUTCOME_LABEL,
  VISIT_OUTCOMES,
  decideEnrollment,
  readFieldVisitsSettings,
};
export type { EnrollmentSkipReason, FieldVisitsSettings, VisitOutcome };

type Client = SupabaseClient<Database>;

export interface LogVisitParams {
  routeStopId: string;
  outcome: VisitOutcome;
  notes?: string | null;
  followUpRequiredOverride?: boolean;
  enrollOverride?: boolean;
  visitedAt?: string;
  userId: string;
  supabase: Client;
}

export interface LogVisitResult {
  routeStop: Tables<"route_stops">;
  activityId: string;
  promotedCompanyId?: string;
  enrollmentId?: string;
  enrollmentSkipReason?: EnrollmentSkipReason;
  enrollmentSkipDetail?: string;
}

export async function logVisit(params: LogVisitParams): Promise<LogVisitResult> {
  const {
    routeStopId,
    outcome,
    notes,
    followUpRequiredOverride,
    enrollOverride,
    visitedAt,
    userId,
    supabase,
  } = params;

  if (!VISIT_OUTCOMES.includes(outcome)) {
    throw new Error(`logVisit: invalid outcome '${outcome}'`);
  }

  const { data: stop, error: stopErr } = await supabase
    .from("route_stops")
    .select(
      "id, route_id, workspace_id, company_id, discovered_shop_id, shop_name, daily_routes!inner(workspace_id, status)",
    )
    .eq("id", routeStopId)
    .maybeSingle();

  if (stopErr) throw new Error(`logVisit: load stop: ${stopErr.message}`);
  if (!stop) throw new Error(`logVisit: stop ${routeStopId} not found`);

  const workspaceId = stop.workspace_id;

  let promotedCompanyId: string | undefined;
  let effectiveCompanyId = stop.company_id;

  const shouldPromote =
    (outcome === "interested" || outcome === "closed") &&
    stop.discovered_shop_id != null &&
    !effectiveCompanyId;

  if (shouldPromote && stop.discovered_shop_id) {
    const promoted = await promoteDiscoveredShop(stop.discovered_shop_id, {
      workspaceId,
      supabase,
    });
    promotedCompanyId = promoted.companyId;
    effectiveCompanyId = promoted.companyId;

    const { error: linkErr } = await supabase
      .from("route_stops")
      .update({ company_id: promoted.companyId })
      .eq("id", routeStopId);
    if (linkErr) throw new Error(`logVisit: link stop to company: ${linkErr.message}`);
  }

  const visited_at = visitedAt ?? new Date().toISOString();
  const follow_up_required = followUpRequiredOverride ?? FOLLOW_UP_REQUIRED_DEFAULT[outcome];

  const { data: updatedStop, error: updateErr } = await supabase
    .from("route_stops")
    .update({
      visited_at,
      visit_outcome: outcome,
      visit_notes: notes ?? null,
      follow_up_required,
    })
    .eq("id", routeStopId)
    .select("*")
    .single();

  if (updateErr || !updatedStop) {
    throw new Error(`logVisit: update stop: ${updateErr?.message ?? "no row"}`);
  }

  const activityMetadata: Record<string, Json> = {
    routeId: stop.route_id,
    stopId: routeStopId,
    outcome,
  };
  if (!effectiveCompanyId && stop.discovered_shop_id) {
    activityMetadata.discoveredShopId = stop.discovered_shop_id;
  }
  if (promotedCompanyId) {
    activityMetadata.promotedFromShopId = stop.discovered_shop_id;
  }

  const { data: activity, error: activityErr } = await supabase
    .from("activities")
    .insert({
      workspace_id: workspaceId,
      type: "field_visit",
      subject: `Field visit: ${OUTCOME_LABEL[outcome]} — ${stop.shop_name}`,
      body: notes ?? null,
      company_id: effectiveCompanyId,
      user_id: userId,
      metadata: activityMetadata,
    })
    .select("id")
    .single();

  if (activityErr || !activity) {
    throw new Error(`logVisit: insert activity: ${activityErr?.message ?? "no row"}`);
  }

  if (outcome === "not_interested" && effectiveCompanyId) {
    const { error: dncErr } = await supabase
      .from("companies")
      .update({ do_not_contact: true })
      .eq("id", effectiveCompanyId)
      .eq("workspace_id", workspaceId);
    if (dncErr) throw new Error(`logVisit: set do_not_contact: ${dncErr.message}`);
  }

  let companySkipAutoFollowup = false;
  if (effectiveCompanyId) {
    const { data: companyRow } = await supabase
      .from("companies")
      .select("skip_auto_followup")
      .eq("id", effectiveCompanyId)
      .maybeSingle();
    companySkipAutoFollowup = companyRow?.skip_auto_followup === true;
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .maybeSingle();
  const fv = readFieldVisitsSettings(workspace?.settings);
  const workspaceAutoEnabled = fv.auto_followup_enabled !== false;
  const sequenceId = fv.sequence_by_outcome?.[outcome] ?? null;

  const decision = decideEnrollment({
    outcome,
    enrollOverride,
    companyId: effectiveCompanyId,
    companySkipAutoFollowup,
    workspaceAutoEnabled,
    sequenceId,
  });

  if (!decision.enroll) {
    return {
      routeStop: updatedStop,
      activityId: activity.id,
      promotedCompanyId,
      enrollmentSkipReason: decision.reason,
    };
  }

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, is_primary, created_at")
    .eq("workspace_id", workspaceId)
    .eq("company_id", effectiveCompanyId!)
    .eq("status", "active")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  const primaryContactId = contacts && contacts.length > 0 ? contacts[0].id : null;

  if (!primaryContactId) {
    return {
      routeStop: updatedStop,
      activityId: activity.id,
      promotedCompanyId,
      enrollmentSkipReason: "no_contact",
    };
  }

  const enrollResult = await enrollContacts({
    sequenceId: decision.sequenceId,
    contactIds: [primaryContactId],
    workspaceId,
  });

  if (enrollResult.enrolled === 0) {
    return {
      routeStop: updatedStop,
      activityId: activity.id,
      promotedCompanyId,
      enrollmentSkipReason: "enroll_failed",
      enrollmentSkipDetail: enrollResult.reasons[0] ?? "unknown",
    };
  }

  const { data: enrollmentRow } = await supabase
    .from("sequence_enrollments")
    .select("id")
    .eq("sequence_id", decision.sequenceId)
    .eq("contact_id", primaryContactId)
    .order("enrolled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    routeStop: updatedStop,
    activityId: activity.id,
    promotedCompanyId,
    enrollmentId: enrollmentRow?.id,
  };
}
