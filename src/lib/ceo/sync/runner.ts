import { getRollingWindow } from "@/lib/ceo/dates";
import { SOURCE_LABELS, type SourceKey } from "@/lib/ceo/sources";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { SyncSkippedError } from "./errors";
import { getConnector } from "./sources";
import type { SyncRunResult } from "./types";
import {
  type SupabaseWriter,
  writeCostEntries,
  writeDiagnosticChats,
  writeDiagnostics,
  writeMotorUsage,
  writeFunnelPoints,
  writeMetricPoints,
  writeRawRows,
  writeSubscriptions,
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
      (await writeWorkshops(writer, result.workshops ?? [])) +
      (await writeSubscriptions(writer, result.subscriptions ?? [])) +
      (await writeDiagnostics(writer, result.diagnostics ?? [])) +
      (await writeDiagnosticChats(writer, result.diagnosticChats ?? [])) +
      (await writeMotorUsage(writer, result.motorUsage ?? [])) +
      (await writeCostEntries(writer, result.costEntries ?? []));

    await supabase
      .from(TABLES.syncRuns)
      .update({
        status: "success",
        completed_at: new Date().toISOString(),
        rows_read: result.rowsRead,
        rows_written: rowsWritten,
        metadata: result.metadata ?? {},
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
