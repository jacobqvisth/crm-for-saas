import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { cioConfigured, getCampaignEmails, listCampaigns, type CioCampaignSummary } from "@/lib/activation/cio";
import { bestMatch, stateToStatus, verifiedNote, type MatchCandidate } from "@/lib/activation/cio-verify";

// GET /api/activation/cio/verify?plan_id=<uuid>
//
// Read-only reconciliation between the board's email touchpoints and the live
// Customer.io campaign list. Returns findings — the client applies fixes
// through the normal item CRUD routes so nothing is written here.

export interface VerifyFinding {
  item_id: string;
  item_title: string;
  item_status: string | null;
  verdict: "ok" | "state_mismatch" | "unlinked_match" | "linked_missing" | "no_match";
  campaign: CioCampaignSummary | null; // linked or suggested campaign
  score: number | null; // only for unlinked_match
  suggested_status: string | null;
  suggested_note: string | null;
}

export async function GET(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  if (!cioConfigured()) {
    return NextResponse.json({ error: "Customer.io is not configured" }, { status: 503 });
  }

  const planId = new URL(request.url).searchParams.get("plan_id");
  if (!planId) return NextResponse.json({ error: "plan_id required" }, { status: 400 });

  const [{ data: groups }, { data: items }, campaigns] = await Promise.all([
    supabase
      .from("activation_plan_groups")
      .select("id, name")
      .eq("plan_id", planId)
      .eq("workspace_id", workspaceId),
    supabase
      .from("activation_plan_items")
      .select("id, title, status, group_id, cio_campaign_id")
      .eq("plan_id", planId)
      .eq("workspace_id", workspaceId),
    listCampaigns().catch((e: Error) => e),
  ]);
  if (campaigns instanceof Error) {
    return NextResponse.json({ error: campaigns.message }, { status: 502 });
  }

  const emailGroupIds = new Set(
    (groups ?? []).filter((g) => /email|customer/i.test(g.name)).map((g) => g.id)
  );
  const relevant = (items ?? []).filter(
    (it) => emailGroupIds.has(it.group_id) || it.cio_campaign_id
  );

  const byId = new Map(campaigns.map((c) => [String(c.id), c]));
  const checkedAt = new Date().toISOString().slice(0, 10);
  const claimedIds = new Set<string>();
  const findings: VerifyFinding[] = [];

  for (const it of relevant) {
    if (it.cio_campaign_id) {
      const campaign = byId.get(it.cio_campaign_id) ?? null;
      if (!campaign) {
        findings.push({
          item_id: it.id,
          item_title: it.title,
          item_status: it.status,
          verdict: "linked_missing",
          campaign: null,
          score: null,
          suggested_status: null,
          suggested_note: `Checked against Customer.io on ${checkedAt}: linked campaign id ${it.cio_campaign_id} no longer exists.`,
        });
        continue;
      }
      claimedIds.add(String(campaign.id));
      const suggested = stateToStatus(campaign.state);
      findings.push({
        item_id: it.id,
        item_title: it.title,
        item_status: it.status,
        verdict: it.status === suggested ? "ok" : "state_mismatch",
        campaign,
        score: null,
        suggested_status: suggested,
        suggested_note: verifiedNote(campaign, checkedAt),
      });
    }
  }

  // Subjects of unclaimed campaigns sharpen the matching (cached ~5 min by
  // the cio helpers, so repeat checks are cheap).
  const unlinkedExists = relevant.some((it) => !it.cio_campaign_id);
  const subjectsById = new Map<string, string[]>();
  if (unlinkedExists) {
    const unclaimedAll = campaigns.filter((c) => !claimedIds.has(String(c.id)));
    await Promise.all(
      unclaimedAll.map(async (c) => {
        try {
          const { emails } = await getCampaignEmails(c.id, 3);
          subjectsById.set(
            String(c.id),
            emails.flatMap((e) => (e.subject ? [e.subject] : []))
          );
        } catch {
          subjectsById.set(String(c.id), []);
        }
      })
    );
  }

  for (const it of relevant) {
    if (it.cio_campaign_id) continue;
    const candidates: MatchCandidate[] = campaigns
      .filter((c) => !claimedIds.has(String(c.id)))
      .map((c) => ({ campaign: c, texts: subjectsById.get(String(c.id)) ?? [] }));
    const match = bestMatch(it.title, candidates);
    if (match) {
      claimedIds.add(String(match.campaign.id));
      findings.push({
        item_id: it.id,
        item_title: it.title,
        item_status: it.status,
        verdict: "unlinked_match",
        campaign: match.campaign,
        score: Math.round(match.score * 100) / 100,
        suggested_status: stateToStatus(match.campaign.state),
        suggested_note: verifiedNote(match.campaign, checkedAt),
      });
    } else {
      findings.push({
        item_id: it.id,
        item_title: it.title,
        item_status: it.status,
        verdict: "no_match",
        campaign: null,
        score: null,
        suggested_status: null,
        suggested_note: `Checked against Customer.io on ${checkedAt}: no campaign matches this touchpoint — it likely doesn't exist there (or is named very differently).`,
      });
    }
  }

  const importable = campaigns.filter((c) => !claimedIds.has(String(c.id)));

  return NextResponse.json({ findings, importable, checked_at: checkedAt });
}
