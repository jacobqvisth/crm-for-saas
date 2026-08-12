import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMember } from "@/lib/call-agent/auth";
import { loadCallAgentRow, providerApiKey } from "@/lib/call-agent/settings";
import { listVoices } from "@/lib/call-agent/elevenlabs";

export const dynamic = "force-dynamic";

/** GET /api/call-agent/voices — provider voices for the settings picker. */
export async function GET() {
  const auth = await requireMember();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const row = await loadCallAgentRow(service, auth.workspaceId);
  const apiKey = providerApiKey(row);
  if (!apiKey) return NextResponse.json({ error: "No API key configured" }, { status: 400 });

  try {
    const voices = await listVoices(apiKey);
    return NextResponse.json({
      voices: voices.map((v) => ({
        voice_id: v.voice_id,
        name: v.name,
        labels: v.labels ?? {},
        preview_url: v.preview_url ?? null,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "voices fetch failed" },
      { status: 502 },
    );
  }
}
