import { getDiagnosticsDrilldownList } from "@/lib/ceo/data/diagnostics";
import { resolveDashboardTimeRange } from "@/lib/ceo/time-ranges";
import type { ForumScenario } from "./types";

// Fetch real diagnostic scenarios to seed forum posts from. Reuses the existing
// CEO diagnostics drilldown loader (dashboard_diagnostics + users + workshops),
// then keeps only rows with enough narrative to write a believable post — i.e.
// an owner description OR at least one probable cause. Internal/test workshops
// are excluded by the loader's default.
export async function getForumScenarios(limit = 120): Promise<ForumScenario[]> {
  const range = resolveDashboardTimeRange("all_time");
  const items = await getDiagnosticsDrilldownList({ range });

  return items
    .filter((d) => Boolean(d.description) || d.causes.length > 0)
    .slice(0, limit)
    .map(
      (d): ForumScenario => ({
        diagnosticId: d.diagnosticId,
        carMake: d.carMake,
        carModel: d.carModel,
        carYear: d.carYear,
        mileage: d.mileage,
        description: d.description,
        dtcs: d.dtcs,
        symptoms: d.symptoms,
        country: d.country,
        topCauseName: d.topCause?.name ?? null,
        topCauseSeverity: d.topCause?.severity ?? null,
        causes: d.causes.slice(0, 4).map((c) => ({
          name: c.name,
          probability: c.probability,
          severity: c.severity,
          description: c.description,
        })),
        createdAt: d.createdAt,
      }),
    );
}
