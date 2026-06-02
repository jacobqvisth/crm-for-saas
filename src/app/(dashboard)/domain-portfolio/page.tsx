import { getDomainPortfolioData } from "@/lib/ceo/data/domain-portfolio";
import { PortfolioBoard } from "./PortfolioBoard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function DomainPortfolioPage() {
  const portfolio = await getDomainPortfolioData();

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">
          Domain Portfolio
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Curated European TLD recommendations + your decision tracker.
          Pick which ccTLDs to buy per country, mark planning / bought /
          installed, and link bought rows to Domain Health.
        </p>
      </header>

      <PortfolioBoard data={portfolio} />
    </div>
  );
}
