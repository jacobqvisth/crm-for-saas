import { Suspense } from "react";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { WorkshopListContent } from "@/components/ceo/workshops-content";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getWorkshopDrilldownList } from "@/lib/ceo/data/workshops";

export const dynamic = "force-dynamic";

type WorkshopsPageProps = {
  searchParams: Promise<{
    range?: string | string[];
    q?: string | string[];
    status?: string | string[];
    showInternal?: string | string[];
  }>;
};

function asString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function matchesStatus(status: string | null, filter: string) {
  if (!filter || filter === "all") {
    return true;
  }

  if (filter === "at_risk") {
    return ["paused", "past_due", "unpaid", "incomplete", "incomplete_expired"].includes(
      status ?? "",
    );
  }

  if (filter === "inactive") {
    return ["inactive", "canceled"].includes(status ?? "");
  }

  return (status ?? "unknown") === filter;
}

function asBool(value: string | string[] | undefined) {
  const next = asString(value).trim().toLowerCase();
  return next === "1" || next === "true" || next === "on";
}

async function WorkshopsPanel({
  rawQuery,
  status,
  showInternal,
}: {
  rawQuery: string;
  status: string;
  showInternal: boolean;
}) {
  const query = rawQuery.toLowerCase();
  const workshops = await getWorkshopDrilldownList({
    includeInternal: showInternal,
  });

  const filtered = workshops.filter((item) => {
    const haystack = [
      item.name,
      item.country ?? "",
      item.language ?? "",
      item.planKey ?? "",
      item.status ?? "",
      item.createdByAgent ? "agent" : item.createdByAgent === false ? "self_serve" : "",
      ...item.emailDomains,
      ...item.usernames,
    ]
      .join(" ")
      .toLowerCase();

    return (!query || haystack.includes(query)) && matchesStatus(item.status, status);
  });

  return (
    <WorkshopListContent
      items={filtered}
      query={rawQuery}
      status={status}
      showInternal={showInternal}
    />
  );
}

export default async function WorkshopsDashboardPage({
  searchParams,
}: WorkshopsPageProps) {
  const params = await searchParams;
  const rawQuery = asString(params.q).trim();
  const status = asString(params.status) || "all";
  const showInternal = asBool(params.showInternal);
  const data = await getDashboardData(params.range);

  return (
    <DashboardShell data={data} section="workshops">
      <Suspense fallback={<CeoPanelSkeleton />}>
        <WorkshopsPanel
          rawQuery={rawQuery}
          status={status}
          showInternal={showInternal}
        />
      </Suspense>
    </DashboardShell>
  );
}
