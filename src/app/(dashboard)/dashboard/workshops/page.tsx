import { Suspense } from "react";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { InternalTestExclusionsPanel } from "@/components/ceo/internal-test-exclusions";
import { WorkshopListContent } from "@/components/ceo/workshops-content";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getWorkshopDrilldownList } from "@/lib/ceo/data/workshops";
import {
  listInternalTestUsers,
  listInternalTestWorkshops,
} from "@/lib/ceo/internal-test/loader";

export const dynamic = "force-dynamic";

const WORKSHOPS_EXCLUSION_DESCRIPTION = (
  <>
    This list excludes internal/test workshops (manual list) along with their
    users and diagnostics, plus any user signed up with an{" "}
    <code>@wrenchlane.com</code> email (auto-flagged at every core_app sync).
    Toggle <strong>Show internal</strong> above to include them. Manage the list
    at <a href="/dashboard/settings">/dashboard/settings</a>.
  </>
);

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
  const [workshops, internalTestUsers, internalTestWorkshops] =
    await Promise.all([
      getWorkshopDrilldownList({ includeInternal: showInternal }),
      listInternalTestUsers(),
      listInternalTestWorkshops(),
    ]);

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
    <div className="section-stack">
      <WorkshopListContent
        items={filtered}
        query={rawQuery}
        status={status}
        showInternal={showInternal}
      />
      {showInternal ? null : (
        <InternalTestExclusionsPanel
          users={internalTestUsers}
          workshops={internalTestWorkshops}
          description={WORKSHOPS_EXCLUSION_DESCRIPTION}
        />
      )}
    </div>
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
