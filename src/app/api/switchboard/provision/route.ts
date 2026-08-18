import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/call-agent/auth";
import { loadSwitchboardRow } from "@/lib/switchboard/settings";
import { provisionSwitchboard } from "@/lib/switchboard/provision";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://crm-for-saas.vercel.app"
  );
}

/**
 * POST /api/switchboard/provision — the "Provision / Sync" button.
 *
 * Idempotent: creates the receptionist agent, its tools and its knowledge doc on
 * first run, and updates them in place afterwards. Also points the 46elks
 * number's inbound action at our handler, so the whole växel is configured from
 * the CRM rather than two provider dashboards.
 */
export async function POST() {
  const gate = await requireMember();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const supabase = await createClient();
  const row = await loadSwitchboardRow(supabase, gate.workspaceId);

  if (!row.number) {
    return NextResponse.json(
      { error: "Set the switchboard number first." },
      { status: 400 },
    );
  }

  try {
    const result = await provisionSwitchboard(supabase, row, appBaseUrl());
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Provisioning failed" },
      { status: 500 },
    );
  }
}
