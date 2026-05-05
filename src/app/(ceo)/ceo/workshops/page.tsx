import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { WorkshopListContent } from "@/components/ceo/workshops-content";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getWorkshopDrilldownList } from "@/lib/ceo/data/workshops";

export const dynamic = "force-dynamic";

type WorkshopsPageProps = {
  searchParams: Promise<{
    range?: string | string[];
    q?: string | string[];
    status?: string | string[];
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

export default async function WorkshopsDashboardPage({
  searchParams,
}: WorkshopsPageProps) {
  const params = await searchParams;
  const range = params.range;
  const rawQuery = asString(params.q).trim();
  const query = rawQuery.toLowerCase();
  const status = asString(params.status) || "all";
  const [data, workshops] = await Promise.all([
    getDashboardData(range),
    getWorkshopDrilldownList(),
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
    <DashboardShell data={data} section="workshops">
      <WorkshopListContent items={filtered} query={rawQuery} status={status} />
    </DashboardShell>
  );
}
