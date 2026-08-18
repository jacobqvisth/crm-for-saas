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
    country?: string | string[];
    /** `YYYY-MM`, used by /dashboard/monthly-review's month picker. */
    month?: string | string[];
    /** Sub-view within a page, used by /dashboard/valdemar's Calls/Emails tabs. */
    tab?: string | string[];
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
