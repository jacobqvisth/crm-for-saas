import { addUtcDays, startOfUtcDay, toIsoDate } from "@/lib/ceo/dates";
import { hasSupabaseConfig } from "@/lib/ceo/env";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { pageAll } from "@/lib/ceo/supabase-paging";
import { TABLES } from "@/lib/ceo/tables";

type UserRow = {
  internal_user_id: string | null;
  workshop_id: string | null;
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
};

type WorkshopRow = {
  workshop_id: string;
  name: string | null;
};

type DiagnosticRow = {
  diagnostic_id: string;
  internal_user_id: string | null;
  workshop_id: string | null;
  status: string | null;
  created_at: string | null;
  diag_cost: number | string | null;
  has_chat: boolean | null;
};

type ChatRow = {
  chat_id: string;
  chat_cost: number | string | null;
};

export type PilotStatsKpi = {
  totalUsers: number;
  totalWorkshops: number;
  totalDiagnostics: number;
  totalAiCost: number;
  activeUsers7d: number;
  activeUsers30d: number;
  chatAdoptionRate: number;
  blendedCostPerDiagnostic: number;
};

export type PilotStatsDailyPoint = {
  date: string;
  count: number;
};

export type PilotStatsBarItem = {
  label: string;
  value: number;
};

export type PilotStatsStatusSlice = {
  status: string;
  count: number;
};

export type PilotStatsData = {
  generatedAt: string;
  available: boolean;
  lastSyncedAt: string | null;
  kpi: PilotStatsKpi;
  diagnosticsLast30Days: PilotStatsDailyPoint[];
  topWorkshops: PilotStatsBarItem[];
  diagnosticsByStatus: PilotStatsStatusSlice[];
  usersByRole: PilotStatsBarItem[];
};

function emptyData(): PilotStatsData {
  return {
    generatedAt: new Date().toISOString(),
    available: false,
    lastSyncedAt: null,
    kpi: {
      totalUsers: 0,
      totalWorkshops: 0,
      totalDiagnostics: 0,
      totalAiCost: 0,
      activeUsers7d: 0,
      activeUsers30d: 0,
      chatAdoptionRate: 0,
      blendedCostPerDiagnostic: 0,
    },
    diagnosticsLast30Days: [],
    topWorkshops: [],
    diagnosticsByStatus: [],
    usersByRole: [],
  };
}

function readUserRole(metadata: Record<string, unknown> | null): string {
  const role = metadata?.user_role;
  if (typeof role === "string" && role.trim()) {
    return role.trim();
  }
  return "unknown";
}

function buildLast30DaysSeries(rows: DiagnosticRow[]): PilotStatsDailyPoint[] {
  const today = startOfUtcDay(new Date());
  const start = addUtcDays(today, -29);
  const buckets = new Map<string, number>();
  for (let offset = 0; offset < 30; offset += 1) {
    buckets.set(toIsoDate(addUtcDays(start, offset)), 0);
  }

  for (const row of rows) {
    if (!row.created_at) continue;
    const created = new Date(row.created_at);
    if (Number.isNaN(created.getTime())) continue;
    if (created < start) continue;
    const key = toIsoDate(startOfUtcDay(created));
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({ date, count }));
}

function buildTopWorkshops(
  diagnostics: DiagnosticRow[],
  workshops: Map<string, string>,
): PilotStatsBarItem[] {
  const counts = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    const workshopId = diagnostic.workshop_id;
    if (!workshopId) continue;
    counts.set(workshopId, (counts.get(workshopId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([workshopId, count]) => ({
      label: workshops.get(workshopId) ?? workshopId,
      value: count,
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 10);
}

function buildStatusSlices(rows: DiagnosticRow[]): PilotStatsStatusSlice[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = row.status?.trim() || "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count);
}

function buildRoleBars(users: UserRow[]): PilotStatsBarItem[] {
  const counts = new Map<string, number>();
  for (const user of users) {
    const role = readUserRole(user.metadata);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([role, value]) => ({ label: role, value }))
    .sort((left, right) => right.value - left.value);
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function getPilotStatsData(): Promise<PilotStatsData> {
  if (!hasSupabaseConfig()) {
    return emptyData();
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return emptyData();
  }

  const [
    usersResult,
    workshopsResult,
    diagnosticsResult,
    chatsResult,
    freshnessResult,
  ] = await Promise.all([
    pageAll<UserRow>(({ from, to }) =>
      supabase
        .from(TABLES.users)
        .select("internal_user_id, workshop_id, last_seen_at, metadata")
        .order("internal_user_id", { ascending: true })
        .range(from, to),
    ),
    pageAll<WorkshopRow>(({ from, to }) =>
      supabase
        .from(TABLES.workshops)
        .select("workshop_id, name")
        .order("workshop_id", { ascending: true })
        .range(from, to),
    ),
    pageAll<DiagnosticRow>(({ from, to }) =>
      supabase
        .from(TABLES.diagnostics)
        .select(
          "diagnostic_id, internal_user_id, workshop_id, status, created_at, diag_cost, has_chat",
        )
        .order("diagnostic_id", { ascending: true })
        .range(from, to),
    ),
    pageAll<ChatRow>(({ from, to }) =>
      supabase
        .from(TABLES.diagnosticChats)
        .select("chat_id, chat_cost")
        .order("chat_id", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from(TABLES.rawMetricRows)
      .select("collected_at")
      .eq("source_key", "core_app")
      .like("external_id", "user_stats:%")
      .order("collected_at", { ascending: false })
      .limit(1),
  ]);

  if (
    usersResult.error ||
    workshopsResult.error ||
    diagnosticsResult.error ||
    chatsResult.error
  ) {
    return emptyData();
  }

  const users = usersResult.data;
  const workshopsList = workshopsResult.data;
  const diagnostics = diagnosticsResult.data;
  const chats = chatsResult.data;

  const workshopNames = new Map<string, string>();
  for (const workshop of workshopsList) {
    if (workshop.workshop_id) {
      workshopNames.set(workshop.workshop_id, workshop.name ?? workshop.workshop_id);
    }
  }

  const totalUsers = users.length;
  const workshopIds = new Set<string>();
  for (const user of users) {
    if (user.workshop_id) workshopIds.add(user.workshop_id);
  }
  const totalWorkshops = workshopIds.size;

  const totalDiagnostics = diagnostics.length;
  const totalDiagCost = diagnostics.reduce(
    (sum, row) => sum + toNumber(row.diag_cost),
    0,
  );
  const totalChatCost = chats.reduce(
    (sum, row) => sum + toNumber(row.chat_cost),
    0,
  );
  const totalAiCost = totalDiagCost + totalChatCost;

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  let activeUsers7d = 0;
  let activeUsers30d = 0;
  for (const user of users) {
    if (!user.last_seen_at) continue;
    const seen = new Date(user.last_seen_at).getTime();
    if (Number.isNaN(seen)) continue;
    if (seen > sevenDaysAgo) activeUsers7d += 1;
    if (seen > thirtyDaysAgo) activeUsers30d += 1;
  }

  const diagnosticsWithChat = diagnostics.filter((row) => row.has_chat).length;
  const chatAdoptionRate = totalDiagnostics
    ? diagnosticsWithChat / totalDiagnostics
    : 0;
  const blendedCostPerDiagnostic = totalDiagnostics
    ? totalAiCost / totalDiagnostics
    : 0;

  const lastSyncedAt =
    (freshnessResult.data?.[0]?.collected_at as string | undefined) ?? null;

  return {
    generatedAt: new Date().toISOString(),
    available: true,
    lastSyncedAt,
    kpi: {
      totalUsers,
      totalWorkshops,
      totalDiagnostics,
      totalAiCost,
      activeUsers7d,
      activeUsers30d,
      chatAdoptionRate,
      blendedCostPerDiagnostic,
    },
    diagnosticsLast30Days: buildLast30DaysSeries(diagnostics),
    topWorkshops: buildTopWorkshops(diagnostics, workshopNames),
    diagnosticsByStatus: buildStatusSlices(diagnostics),
    usersByRole: buildRoleBars(users),
  };
}
