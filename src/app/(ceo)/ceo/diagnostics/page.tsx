import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { DiagnosticsContent } from "@/components/ceo/diagnostics-content";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getDiagnosticsDrilldownList } from "@/lib/ceo/data/diagnostics";
import {
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "@/lib/ceo/time-ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DiagnosticsPageProps = {
  searchParams: Promise<{
    range?: string | string[];
    q?: string | string[];
    status?: string | string[];
    showInternal?: string | string[];
    d?: string | string[];
  }>;
};

function asString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function asBool(value: string | string[] | undefined) {
  const next = asString(value).trim().toLowerCase();
  return next === "1" || next === "true" || next === "on";
}

export default async function DiagnosticsPage({
  searchParams,
}: DiagnosticsPageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const resolvedRange = resolveDashboardTimeRange(rangeKey);
  const rawQuery = asString(params.q).trim();
  const query = rawQuery.toLowerCase();
  const status = asString(params.status) || "all";
  const showInternal = asBool(params.showInternal);
  const selectedDiagnosticId = asString(params.d).trim() || null;

  const [data, diagnostics] = await Promise.all([
    getDashboardData(params.range),
    getDiagnosticsDrilldownList({
      range: resolvedRange,
      includeInternal: showInternal,
    }),
  ]);

  const filtered = diagnostics.filter((item) => {
    if (status !== "all" && item.status !== status) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      item.username ?? "",
      item.userName ?? "",
      item.workshopName ?? "",
      item.country ?? "",
      item.language ?? "",
      item.carMake ?? "",
      item.carModel ?? "",
      item.carYear ? String(item.carYear) : "",
      item.description ?? "",
      item.topCause?.name ?? "",
      ...item.dtcs,
      ...item.symptoms,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  return (
    <DashboardShell data={data} section="diagnostics">
      <DiagnosticsContent
        items={filtered}
        selectedDiagnosticId={selectedDiagnosticId}
        query={rawQuery}
        status={status}
        showInternal={showInternal}
        rangeKey={rangeKey}
      />
    </DashboardShell>
  );
}
