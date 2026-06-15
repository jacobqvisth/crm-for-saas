// Sync runner for the CEO dashboard. All sources are scheduled hourly via
// Supabase pg_cron (see supabase/ceo-cron.sql). Cadence as of 2026-05-26:
//   ga4=H:05, google_ads=H:17, search_console=H:23, core_app=H:25,
//   customer_io=H:29, stripe=H:41, posthog=H:47, app_store=H:53.
// Each route is also manually triggerable via POST /api/ceo-sync/<source>
// with Bearer SYNC_SECRET (or CRON_SECRET) — useful for backfills and tests.
import { getRollingWindow } from "@/lib/ceo/dates";
import { applyInternalTestDomainFlag } from "@/lib/ceo/internal-test/auto-flag";
import { SOURCE_LABELS, type SourceKey } from "@/lib/ceo/sources";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { SyncSkippedError } from "./errors";
import { propagateDashboardToCrm } from "./propagate-to-crm";
import { getConnector } from "./sources";
import type { SyncRunResult } from "./types";
import {
  type SupabaseWriter,
  writeCostEntries,
  writeDiagnosticChats,
  writeDiagnostics,
  writeFeatureUsage,
  writeMotorUsage,
  writeFunnelPoints,
  writeMetricPoints,
  writeRawRows,
  writeSubscriptions,
  writeUserLogins,
  writeUsers,
  writeWorkshops,
} from "./writer";

function syncErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Unknown sync error";
}

export async function runSourceSync(
  sourceKey: SourceKey,
): Promise<SyncRunResult> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    throw new Error("Supabase service role is not configured.");
  }

  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await supabase
    .from(TABLES.syncRuns)
    .insert({
      source_key: sourceKey,
      status: "running",
      started_at: startedAt,
    })
    .select("id")
    .single();

  if (runError) {
    throw runError;
  }

  try {
    const connector = getConnector(sourceKey);
    const result = await connector.fetchMetrics(getRollingWindow(7));
    const writer = supabase as unknown as SupabaseWriter;
    const rowsWritten =
      (await writeMetricPoints(writer, result.metrics)) +
      (await writeFunnelPoints(writer, result.funnel ?? [])) +
      (await writeRawRows(writer, result.rawRows ?? [])) +
      (await writeUsers(writer, result.users ?? [])) +
      (await writeUserLogins(writer, result.userLogins ?? [])) +
      (await writeFeatureUsage(writer, result.featureUsage ?? [])) +
      (await writeWorkshops(writer, result.workshops ?? [])) +
      (await writeSubscriptions(writer, result.subscriptions ?? [])) +
      (await writeDiagnostics(writer, result.diagnostics ?? [])) +
      (await writeDiagnosticChats(writer, result.diagnosticChats ?? [])) +
      (await writeMotorUsage(writer, result.motorUsage ?? [])) +
      (await writeCostEntries(writer, result.costEntries ?? []));

    // Auto-flag users whose email domain matches INTERNAL_TEST_EMAIL_DOMAINS
    // (e.g. @wrenchlane.com) so they drop out of every metric that already
    // filters on dashboard_users.is_internal_test. Runs before the CRM
    // propagation so the flag is visible to downstream consumers in the same
    // sync. Non-fatal — auto-flag failure shouldn't fail the whole sync.
    let autoFlaggedCount: number | null = null;
    if (sourceKey === "core_app") {
      try {
        const r = await applyInternalTestDomainFlag(supabase);
        autoFlaggedCount = r.flagged;
      } catch (err) {
        autoFlaggedCount = null;
        console.error(
          "[ceo-sync] applyInternalTestDomainFlag failed",
          err,
        );
      }
    }

    // Push fresh dashboard_users / dashboard_workshops into the CRM contacts
    // and companies tables (UPDATE-only, never insert). Only meaningful for
    // the core_app source — the other connectors write to their own tables
    // and don't touch dashboard_users/dashboard_workshops.
    let propagationSummary: { contacts_updated: number; companies_updated: number } | null = null;
    if (sourceKey === "core_app") {
      try {
        const r = await propagateDashboardToCrm(supabase);
        propagationSummary = {
          contacts_updated: r.contactsUpdated,
          companies_updated: r.companiesUpdated,
        };
      } catch (err) {
        // Non-fatal: the core_app sync itself succeeded, so we still mark
        // the run a success. Propagation failure surfaces in the metadata.
        propagationSummary = {
          contacts_updated: 0,
          companies_updated: 0,
        };
        console.error("[ceo-sync] propagateDashboardToCrm failed", err);
      }
    }

    await supabase
      .from(TABLES.syncRuns)
      .update({
        status: "success",
        completed_at: new Date().toISOString(),
        rows_read: result.rowsRead,
        rows_written: rowsWritten,
        metadata: {
          ...(result.metadata ?? {}),
          ...(propagationSummary ? { crm_propagation: propagationSummary } : {}),
          ...(autoFlaggedCount !== null
            ? { internal_test_auto_flagged: autoFlaggedCount }
            : {}),
        },
      })
      .eq("id", run.id);

    await supabase.from(TABLES.sourceAccounts).upsert(
      {
        source_key: sourceKey,
        display_name: SOURCE_LABELS[sourceKey],
        status: "healthy",
        last_success_at: new Date().toISOString(),
        watermark: new Date().toISOString(),
        metadata: result.metadata ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source_key" },
    );

    return {
      sourceKey,
      status: "success",
      rowsRead: result.rowsRead,
      rowsWritten,
    };
  } catch (error) {
    const skipped = error instanceof SyncSkippedError;
    const message = syncErrorMessage(error);

    await supabase
      .from(TABLES.syncRuns)
      .update({
        status: skipped ? "skipped" : "failed",
        completed_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", run.id);

    await supabase.from(TABLES.sourceAccounts).upsert(
      {
        source_key: sourceKey,
        display_name: SOURCE_LABELS[sourceKey],
        status: skipped ? "pending" : "failing",
        metadata: { message },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source_key" },
    );

    return {
      sourceKey,
      status: skipped ? "skipped" : "failed",
      rowsRead: 0,
      rowsWritten: 0,
      message,
    };
  }
}
