import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { DashboardShell } from "./dashboard-shell";
import {
  DashboardSectionContent,
  type DashboardSectionKey,
} from "./dashboard-sections";

export type DashboardRoutePageProps = {
  searchParams: Promise<{
    range?: string | string[];
    platform?: string | string[];
  }>;
};

export async function DashboardSectionPage({
  searchParams,
  section,
}: DashboardRoutePageProps & {
  section: DashboardSectionKey;
}) {
  const { range } = await searchParams;
  const data = await getDashboardData(range);

  return (
    <DashboardShell data={data} section={section}>
      <DashboardSectionContent data={data} section={section} />
    </DashboardShell>
  );
}
