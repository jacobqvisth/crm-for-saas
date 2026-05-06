import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { WorkshopDetailContent } from "@/components/ceo/workshops-content";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getWorkshopDetail } from "@/lib/ceo/data/workshops";

export const dynamic = "force-dynamic";

type WorkshopDetailPageProps = {
  params: Promise<{ workshopId: string }>;
  searchParams: Promise<{ range?: string | string[] }>;
};

export default async function WorkshopDetailPage({
  params,
  searchParams,
}: WorkshopDetailPageProps) {
  const [{ workshopId }, { range }] = await Promise.all([params, searchParams]);
  const [data, detail] = await Promise.all([
    getDashboardData(range),
    getWorkshopDetail(workshopId),
  ]);

  if (!detail) {
    notFound();
  }

  return (
    <DashboardShell data={data} section="workshops">
      <WorkshopDetailContent detail={detail} />
    </DashboardShell>
  );
}
