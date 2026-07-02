import {
  DashboardSectionPage,
  type DashboardRoutePageProps,
} from "@/components/ceo/dashboard-page";

export const dynamic = "force-dynamic";

export default function OrganicSearchDashboardPage({
  searchParams,
}: DashboardRoutePageProps) {
  return DashboardSectionPage({ searchParams, section: "organic-search" });
}
