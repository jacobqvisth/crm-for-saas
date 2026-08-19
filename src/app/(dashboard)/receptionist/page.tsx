import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAgentSummary, type AgentSummary } from "@/lib/call-agent/elevenlabs";
import { getElksAccount, listElksNumbers } from "@/lib/calls/elks";
import { SWITCHBOARD_KNOWLEDGE } from "@/lib/switchboard/knowledge";
import { loadTargets, switchboardApiKey } from "@/lib/switchboard/settings";
import { computeStats, type CallRow, type SwitchboardStats } from "@/lib/switchboard/stats";
import { isWithinOfficeHours, type SwitchboardTarget } from "@/lib/switchboard/types";
import type { Tables } from "@/lib/database.types";
import { ReceptionistClient } from "./receptionist-client";

export const dynamic = "force-dynamic";

export interface ReceptionistData {
  settings: Tables<"switchboard_settings"> | null;
  targets: SwitchboardTarget[];
  members: Array<{ id: string; name: string; phone: string | null }>;
  calls: Array<Tables<"switchboard_calls">>;
  stats: SwitchboardStats;
  gaps: Array<{ question: string; count: number; lastSeen: string }>;
  knowledgeMd: string;
  knowledgeSource: "workspace override" | "reviewed default";
  agent: AgentSummary | null;
  openNow: boolean;
  /** Live 46elks facts, so the page reports reality rather than intent. */
  vaxelRouting: string | null;
  bridgeRouting: string | null;
  balanceLow: boolean;
  error: string | null;
}

async function loadData(): Promise<ReceptionistData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const empty = computeStats([]);

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const workspaceId = membership?.workspace_id ?? null;

  if (!workspaceId) {
    return {
      settings: null,
      targets: [],
      members: [],
      calls: [],
      stats: empty,
      gaps: [],
      knowledgeMd: SWITCHBOARD_KNOWLEDGE,
      knowledgeSource: "reviewed default",
      agent: null,
      openNow: false,
      vaxelRouting: null,
      bridgeRouting: null,
      balanceLow: false,
      error: "No workspace found for this account.",
    };
  }

  const { data: settings } = await admin
    .from("switchboard_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const targets = await loadTargets(admin, workspaceId);

  // Everyone who could be added as a transfer target.
  const { data: memberRows } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId);
  const memberIds = (memberRows ?? []).map((m) => m.user_id).filter(Boolean) as string[];
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name, call_agent_phone")
    .in("user_id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailById = new Map((usersList?.users ?? []).map((u) => [u.id, u.email ?? null]));
  const members = memberIds
    .map((id) => {
      const p = (profiles ?? []).find((x) => x.user_id === id);
      return {
        id,
        name: p?.full_name?.trim() || emailById.get(id) || "Unknown user",
        phone: p?.call_agent_phone ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Every call, capped. Stats want the whole history, the table wants the newest.
  const { data: callRows } = await admin
    .from("switchboard_calls")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(500);
  const calls = callRows ?? [];
  const stats = computeStats(calls as unknown as CallRow[]);

  // The knowledge backlog, with when it was last asked so stale entries are
  // visible as stale rather than looking like today's problem.
  const gapCounts = new Map<string, { question: string; count: number; lastSeen: string }>();
  for (const row of calls) {
    for (const q of row.unanswered ?? []) {
      const key = q.trim().toLowerCase();
      if (!key) continue;
      const existing = gapCounts.get(key);
      if (existing) {
        existing.count += 1;
        if (row.created_at > existing.lastSeen) existing.lastSeen = row.created_at;
      } else {
        gapCounts.set(key, { question: q.trim(), count: 1, lastSeen: row.created_at });
      }
    }
  }
  const gaps = [...gapCounts.values()].sort(
    (a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen),
  );

  const knowledgeMd = settings?.knowledge_md?.trim() || SWITCHBOARD_KNOWLEDGE;
  const knowledgeSource = settings?.knowledge_md?.trim()
    ? ("workspace override" as const)
    : ("reviewed default" as const);

  // Read the provider and the carrier rather than trusting our own tables: they
  // are what actually answer the phone, and any drift between them and the
  // settings row is precisely what someone opens this page to find.
  let agent: AgentSummary | null = null;
  let error: string | null = null;
  if (settings?.provider_agent_id) {
    try {
      const apiKey = await switchboardApiKey(admin, settings);
      if (apiKey) agent = await getAgentSummary(apiKey, settings.provider_agent_id);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not read the agent configuration";
    }
  }

  let vaxelRouting: string | null = null;
  let bridgeRouting: string | null = null;
  let balanceLow = false;
  try {
    const numbers = await listElksNumbers();
    const monthly = numbers.reduce((sum, n) => sum + (n.cost ?? 0), 0);
    const vaxel = numbers.find((n) => n.number === settings?.number);
    const bridge = numbers.find((n) => n.number === settings?.bridge_number);
    vaxelRouting = vaxel?.voice_start ?? null;
    bridgeRouting = bridge?.websocket_url ?? null;
    const account = await getElksAccount();
    balanceLow = account.balance < monthly;
  } catch {
    // The carrier being unreachable should not blank the whole page.
  }

  return {
    settings: settings ?? null,
    targets,
    members,
    calls,
    stats,
    gaps,
    knowledgeMd,
    knowledgeSource,
    agent,
    openNow: settings ? isWithinOfficeHours(new Date(), settings) : false,
    vaxelRouting,
    bridgeRouting,
    balanceLow,
    error,
  };
}

export default async function ReceptionistPage() {
  const data = await loadData();
  return <ReceptionistClient data={data} />;
}
