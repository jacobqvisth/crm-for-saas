import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { WorkshopDetailContent } from "@/components/ceo/workshops-content";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getWorkshopDetail } from "@/lib/ceo/data/workshops";

export const dynamic = "force-dynamic";

type WorkshopDetailPageProps = {
  params: Promise<{ workshopId: string }>;
  searchParams: Promise<{ range?: string | string[] }>;
};

async function WorkshopDetailPanel({ workshopId }: { workshopId: string }) {
  const detail = await getWorkshopDetail(workshopId);
  if (!detail) {
    notFound();
  }
  return <WorkshopDetailContent detail={detail} />;
}

export default async function WorkshopDetailPage({
  params,
  searchParams,
}: WorkshopDetailPageProps) {
  const [{ workshopId }, { range }] = await Promise.all([params, searchParams]);
  const data = await getDashboardData(range);

  return (
    <DashboardShell data={data} section="workshops">
      <Suspense fallback={<CeoPanelSkeleton />}>
        <WorkshopDetailPanel workshopId={workshopId} />
      </Suspense>
    </DashboardShell>
  );
}
