import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getDomainPortfolioData } from "@/lib/ceo/data/domain-portfolio";
import { PortfolioBoard } from "./PortfolioBoard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function DomainPortfolioPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const [data, portfolio] = await Promise.all([
    getDashboardData(params.range),
    getDomainPortfolioData(),
  ]);

  return (
    <DashboardShell
      data={data}
      section="domain-portfolio"
      headerSubtext={
        <span>
          Curated European TLD recommendations + your decision tracker.
          Status updates save inline.
        </span>
      }
    >
      <PortfolioBoard data={portfolio} />
    </DashboardShell>
  );
}
