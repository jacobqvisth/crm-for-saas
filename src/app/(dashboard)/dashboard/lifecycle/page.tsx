import {
  DashboardSectionPage,
  type DashboardRoutePageProps,
} from "@/components/ceo/dashboard-page";

export const dynamic = "force-dynamic";

export default async function LifecyclePage({
  searchParams,
}: DashboardRoutePageProps) {
  return DashboardSectionPage({
    searchParams,
    section: "lifecycle",
  });
}
