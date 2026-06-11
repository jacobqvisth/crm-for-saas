import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { campaignDashboardUrl, cioConfigured, getCampaignEmails } from "@/lib/activation/cio";

// GET /api/activation/cio/campaigns/[id] → { campaign, emails, dashboard_url }
// Full email content (subject + body) of a campaign's email actions, so the
// touchpoint modal can show what we actually say in this step. Read-only.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;

  if (!cioConfigured()) {
    return NextResponse.json({ error: "Customer.io is not configured" }, { status: 503 });
  }

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
  }

  try {
    const [{ campaign, emails }, dashboardUrl] = await Promise.all([
      getCampaignEmails(campaignId),
      campaignDashboardUrl(campaignId),
    ]);
    return NextResponse.json({ campaign, emails, dashboard_url: dashboardUrl });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Customer.io request failed" },
      { status: 502 }
    );
  }
}
