import {
  isInternalTestUserOrWorkshopWith,
  loadInternalTestSets,
} from "@/lib/ceo/internal-test/loader";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { pageAll } from "@/lib/supabase-paging";
import { TABLES } from "@/lib/ceo/tables";
import type { ResolvedDashboardRange } from "@/lib/ceo/time-ranges";

export type DiagnosticCause = {
  id: string | null;
  name: string;
  probability: number | null;
  severity: string | null;
  description: string | null;
  suggestedTests: string[];
  faultCodes: string[];
};

export type DiagnosticListItem = {
  diagnosticId: string;
  status: string | null;
  createdAt: string | null;
  completedAt: string | null;
  username: string | null;
  userName: string | null;
  userRole: string | null;
  workshopId: string | null;
  workshopName: string | null;
  country: string | null;
  language: string | null;
  isInternal: boolean;
  carMake: string | null;
  carModel: string | null;
  carYear: number | null;
  dtcs: string[];
  symptoms: string[];
  description: string | null;
  mileage: number | null;
  aiModel: string | null;
  diagCost: number;
  numCauses: number;
  hasChat: boolean;
  hasInvoice: boolean;
  topCause: DiagnosticCause | null;
  causes: DiagnosticCause[];
};

type DiagnosticRow = {
  diagnostic_id: string;
  workshop_id: string | null;
  internal_user_id: string | null;
  status: string | null;
  created_at: string | null;
  completed_at: string | null;
  ai_model: string | null;
  diag_cost: number | null;
  num_causes: number | null;
  has_chat: boolean | null;
  has_invoice: boolean | null;
  metadata: Record<string, unknown> | null;
};

type UserRow = {
  internal_user_id: string;
  workshop_id: string | null;
  name: string | null;
  metadata: Record<string, unknown> | null;
};

type WorkshopRow = {
  workshop_id: string;
  name: string | null;
  country: string | null;
  language: string | null;
  metadata: Record<string, unknown> | null;
};

function asString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapCause(raw: unknown): DiagnosticCause | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const name = asString(record.name) ?? asString(record.title);
  if (!name) {
    return null;
  }
  return {
    id: asString(record.id),
    name,
    probability: asNumber(record.probability),
    severity: asString(record.severity),
    description: asString(record.description),
    suggestedTests: asStringArray(record.suggested_tests),
    faultCodes: asStringArray(record.fault_codes),
  };
}

function mapCauses(raw: unknown): DiagnosticCause[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => mapCause(entry))
    .filter((entry): entry is DiagnosticCause => Boolean(entry));
}

function extractMileage(metadata: Record<string, unknown> | null): number | null {
  // Mileage is not part of the canonical S3 export. If a future schema adds it
  // under a known key, surface it here; otherwise the column stays blank.
  if (!metadata) return null;
  const candidates: unknown[] = [
    metadata.mileage,
    metadata.odometer,
    metadata.km,
    (metadata.vehicle as Record<string, unknown> | undefined)?.mileage,
  ];
  for (const candidate of candidates) {
    const parsed = asNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

async function fetchDiagnosticTables() {
  const sets = await loadInternalTestSets();
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return {
      diagnostics: [] as DiagnosticRow[],
      users: [] as UserRow[],
      workshops: [] as WorkshopRow[],
      sets,
    };
  }

  const [diagnosticsResult, usersResult, workshopsResult] = await Promise.all([
    pageAll<DiagnosticRow>(({ from, to }) =>
      supabase
        .from(TABLES.diagnostics)
        .select(
          "diagnostic_id, workshop_id, internal_user_id, status, created_at, completed_at, ai_model, diag_cost, num_causes, has_chat, has_invoice, metadata",
        )
        .order("created_at", { ascending: false, nullsFirst: false })
        .range(from, to),
    ),
    pageAll<UserRow>(({ from, to }) =>
      supabase
        .from(TABLES.users)
        .select("internal_user_id, workshop_id, name, metadata")
        .order("internal_user_id", { ascending: true })
        .range(from, to),
    ),
    pageAll<WorkshopRow>(({ from, to }) =>
      supabase
        .from(TABLES.workshops)
        .select("workshop_id, name, country, language, metadata")
        .order("workshop_id", { ascending: true })
        .range(from, to),
    ),
  ]);

  if (diagnosticsResult.error || usersResult.error || workshopsResult.error) {
    throw new Error("Diagnostics drilldown read failed");
  }

  return {
    diagnostics: diagnosticsResult.data,
    users: usersResult.data,
    workshops: workshopsResult.data,
    sets,
  };
}

function workshopDisplayName(workshop: WorkshopRow | undefined): string | null {
  if (!workshop) return null;
  return (
    asString(workshop.name) ??
    asString(workshop.metadata?.company_name) ??
    workshop.workshop_id
  );
}

export async function getDiagnosticsDrilldownList(options: {
  range: ResolvedDashboardRange;
  includeInternal?: boolean;
}): Promise<DiagnosticListItem[]> {
  const { range, includeInternal = false } = options;
  const { diagnostics, users, workshops, sets } = await fetchDiagnosticTables();

  const userById = new Map(users.map((user) => [user.internal_user_id, user]));
  const workshopById = new Map(
    workshops.map((workshop) => [workshop.workshop_id, workshop]),
  );

  const rangeStart = range.start ? range.start.getTime() : null;
  const rangeEnd = range.end.getTime();

  return diagnostics
    .filter((row) => {
      if (
        !includeInternal &&
        isInternalTestUserOrWorkshopWith(
          sets,
          row.internal_user_id,
          row.workshop_id,
        )
      ) {
        return false;
      }
      if (!row.created_at) {
        return rangeStart === null;
      }
      const at = new Date(row.created_at).getTime();
      if (Number.isNaN(at)) return false;
      if (rangeStart !== null && at < rangeStart) return false;
      if (at >= rangeEnd) return false;
      return true;
    })
    .map((row): DiagnosticListItem => {
      const metadata = row.metadata ?? {};
      const user = row.internal_user_id
        ? userById.get(row.internal_user_id)
        : undefined;
      const userMetadata = (user?.metadata ?? {}) as Record<string, unknown>;
      const workshopId =
        row.workshop_id ?? asString(userMetadata.workshop_id) ?? null;
      const workshop = workshopId ? workshopById.get(workshopId) : undefined;
      const causes = mapCauses(metadata.possible_causes);
      const isInternal = isInternalTestUserOrWorkshopWith(
        sets,
        row.internal_user_id,
        row.workshop_id,
      );

      return {
        diagnosticId: row.diagnostic_id,
        status: row.status,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        username: asString(userMetadata.username),
        userName: asString(user?.name),
        userRole: asString(userMetadata.user_role),
        workshopId,
        workshopName:
          workshopDisplayName(workshop) ??
          asString(userMetadata.company_name) ??
          null,
        country: asString(workshop?.country) ?? null,
        language: asString(workshop?.language) ?? null,
        isInternal,
        carMake: asString(metadata.car_make),
        carModel: asString(metadata.car_model),
        carYear: asNumber(metadata.car_year),
        dtcs: asStringArray(metadata.dtcs),
        symptoms: asStringArray(metadata.symptoms),
        description: asString(metadata.description),
        mileage: extractMileage(metadata),
        aiModel: row.ai_model,
        diagCost: Number(row.diag_cost ?? 0),
        numCauses: Number(row.num_causes ?? causes.length ?? 0),
        hasChat: Boolean(row.has_chat),
        hasInvoice: Boolean(row.has_invoice),
        topCause: causes[0] ?? null,
        causes,
      };
    })
    .sort((left, right) => {
      const a = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const b = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return b - a;
    });
}
