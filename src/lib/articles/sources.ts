// Loading the grounding data for the Articles studio.
//
// One read serves everything. getDiagnosticsDrilldownList() is the same loader
// the DTC Codes and Search Terms dashboards use, it is always asked for all
// history (code-frequency analysis over a 30-day slice is too thin to mean
// anything), and it is cheap at roughly 2.4k rows. Both analysers take the same
// DiagnosticListItem[], so the list is fetched once and fed to each.
//
// Do NOT reach for getDashboardData() here. Asked for all_time it pages every
// row of dashboard_metric_snapshots (161k rows) and blows the 60s function
// limit. Nothing on this page needs it.

import { getDiagnosticsDrilldownList, type DiagnosticListItem } from "@/lib/ceo/data/diagnostics";
import { analyseDtcCodes } from "@/lib/ceo/dtc/analyse";
import { analyseSearchTerms } from "@/lib/ceo/search-terms";
import { resolveDashboardTimeRange } from "@/lib/ceo/time-ranges";
import type { StatSources } from "./stat-stories";
import type { ArticleDiagnosticSnapshot } from "./types";

/** A candidate shown in the diagnostic picker. Deliberately anonymised. */
export interface DiagnosticCandidate {
  diagnosticId: string;
  car: string;
  carMake: string | null;
  carModel: string | null;
  carYear: number | null;
  mileage: number | null;
  country: string | null;
  dtcs: string[];
  symptoms: string[];
  description: string | null;
  topCauseName: string | null;
  causeCount: number;
  /** Total suggested tests across all causes: a proxy for narrative richness. */
  testCount: number;
  createdAt: string | null;
}

async function loadDiagnostics(): Promise<DiagnosticListItem[]> {
  return getDiagnosticsDrilldownList({
    range: resolveDashboardTimeRange("all_time"),
  });
}

/**
 * Candidates for the "real diagnostic" source, richest first.
 *
 * "Richest" means it can actually carry a story: a described problem, ranked
 * causes, and ideally suggested tests. A bare code with one cause makes a thin
 * case study, so those sort to the bottom.
 */
export async function loadDiagnosticCandidates(limit = 150): Promise<DiagnosticCandidate[]> {
  const items = await loadDiagnostics();

  const mapped = items
    .filter((d) => d.causes.length > 0 || Boolean(d.description))
    .map((d): DiagnosticCandidate => {
      const testCount = d.causes.reduce((sum, c) => sum + c.suggestedTests.length, 0);
      return {
        diagnosticId: d.diagnosticId,
        car: [d.carYear, d.carMake, d.carModel].filter(Boolean).join(" ") || "Unknown vehicle",
        carMake: d.carMake,
        carModel: d.carModel,
        carYear: d.carYear,
        mileage: d.mileage,
        country: d.country,
        dtcs: d.dtcs,
        symptoms: d.symptoms,
        description: d.description,
        topCauseName: d.topCause?.name ?? null,
        causeCount: d.causes.length,
        testCount,
        createdAt: d.createdAt,
      };
    });

  // Score by how much narrative material there is, then prefer recent.
  mapped.sort((a, b) => {
    const score = (c: DiagnosticCandidate) =>
      (c.description ? 3 : 0) + Math.min(c.causeCount, 5) + Math.min(c.testCount, 5) + (c.dtcs.length ? 2 : 0);
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  return mapped.slice(0, limit);
}

/** Freeze the full facts for one diagnostic, for the prompt and the snapshot. */
export async function loadDiagnosticSnapshot(
  diagnosticId: string,
): Promise<ArticleDiagnosticSnapshot | null> {
  const items = await loadDiagnostics();
  const found = items.find((d) => d.diagnosticId === diagnosticId);
  if (!found) return null;
  return {
    diagnosticId: found.diagnosticId,
    carMake: found.carMake,
    carModel: found.carModel,
    carYear: found.carYear,
    mileage: found.mileage,
    description: found.description,
    dtcs: found.dtcs,
    symptoms: found.symptoms,
    country: found.country,
    // Four is enough to show a real ranked path without bloating the prompt.
    causes: found.causes.slice(0, 4).map((c) => ({
      name: c.name,
      probability: c.probability,
      severity: c.severity,
      description: c.description,
      suggestedTests: c.suggestedTests.slice(0, 4),
    })),
    createdAt: found.createdAt,
  };
}

/** Run both analysers off one read, for the stats source. */
export async function loadStatSources(): Promise<StatSources> {
  const items = await loadDiagnostics();
  return {
    dtc: analyseDtcCodes(items),
    terms: analyseSearchTerms(items),
  };
}
