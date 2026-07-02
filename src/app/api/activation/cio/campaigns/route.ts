import { NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { cioConfigured, listCampaigns } from "@/lib/activation/cio";

// GET /api/activation/cio/campaigns → { available, campaigns } — read-only
// list of Customer.io campaigns for linking touchpoints.
export async function GET() {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;

  if (!cioConfigured()) {
    return NextResponse.json({ available: false, campaigns: [] });
  }

  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ available: true, campaigns });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Customer.io request failed" },
      { status: 502 }
    );
  }
}
