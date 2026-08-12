import { FunnelContent } from "@/components/funnel/funnel-content";
import { getFunnelData } from "@/lib/ceo/data/funnel";

export const metadata = {
  title: "Funnel",
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Top-level funnel view: where signups come from, where paying customers come
// from, and what pushed them to pay (activation emails, paywalls, our own
// outreach). Follows the /reviews pattern: no DashboardShell, one loader.
export default async function FunnelPage() {
  const data = await getFunnelData();

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Funnel</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every channel that brings workshops in, the stages they move through,
          and the touches that turn them into paying customers.
        </p>
      </header>

      <FunnelContent data={data} />
    </div>
  );
}
