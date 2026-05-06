import { redirect } from "next/navigation";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";

export const dynamic = "force-dynamic";

export default async function DashboardIndex({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const range = Array.isArray(params.range) ? params.range[0] : params.range;
  const target = range
    ? `/dashboard/app-usage?range=${encodeURIComponent(range)}`
    : "/dashboard/app-usage";
  redirect(target);
}
