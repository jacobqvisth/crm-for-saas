import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/call-agent/auth";
import { normalizePhone } from "@/lib/calls/phone";
import {
  encryptProviderApiKey,
  loadSwitchboardRow,
  loadTargets,
  switchboardApiKey,
  toClientSettings,
} from "@/lib/switchboard/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireMember();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const supabase = await createClient();
  const row = await loadSwitchboardRow(supabase, gate.workspaceId);
  const key = await switchboardApiKey(supabase, row);
  const targets = await loadTargets(supabase, gate.workspaceId);

  return NextResponse.json({
    settings: toClientSettings(row, Boolean(key)),
    targets,
  });
}

const Body = z.object({
  enabled: z.boolean().optional(),
  number: z.string().nullish(),
  persona_name: z.string().min(1).max(40).optional(),
  voice_id: z.string().nullish(),
  greeting_note: z.string().max(2000).nullish(),
  languages_enabled: z.array(z.enum(["sv", "en"])).min(1).optional(),
  answer_questions: z.boolean().optional(),
  take_messages: z.boolean().optional(),
  book_callbacks: z.boolean().optional(),
  open_hour: z.number().int().min(0).max(23).optional(),
  close_hour: z.number().int().min(1).max(24).optional(),
  open_days: z.array(z.number().int().min(1).max(7)).optional(),
  ring_seconds: z.number().int().min(5).max(120).optional(),
  voicemail_enabled: z.boolean().optional(),
  max_call_seconds: z.number().int().min(60).max(1800).optional(),
  api_key: z.string().min(10).optional(),
});

export async function PUT(request: NextRequest) {
  const gate = await requireMember();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { api_key, number, ...rest } = parsed.data;

  const supabase = await createClient();
  await loadSwitchboardRow(supabase, gate.workspaceId); // ensure the row exists

  const update: Record<string, unknown> = { ...rest };

  if (number !== undefined) {
    if (number === null || number === "") {
      update.number = null;
    } else {
      const e164 = normalizePhone(number);
      if (!e164) {
        return NextResponse.json({ error: "That is not a valid phone number" }, { status: 400 });
      }
      // A +4600… number is a virtual SIP endpoint and cannot be dialled from the
      // public phone network, so it can never serve as the published växel.
      if (e164.startsWith("+4600")) {
        return NextResponse.json(
          {
            error:
              "That is a virtual 46elks number and cannot be called from a normal phone. " +
              "Use a mobile number (+4670 / +46766).",
          },
          { status: 400 },
        );
      }
      update.number = e164;
    }
  }

  if (api_key) update.provider_api_key_encrypted = encryptProviderApiKey(api_key);

  if (
    update.open_hour !== undefined &&
    update.close_hour !== undefined &&
    Number(update.close_hour) <= Number(update.open_hour)
  ) {
    return NextResponse.json(
      { error: "Closing hour must be after the opening hour" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("switchboard_settings")
    .update(update)
    .eq("workspace_id", gate.workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = await loadSwitchboardRow(supabase, gate.workspaceId);
  const key = await switchboardApiKey(supabase, row);
  return NextResponse.json({ settings: toClientSettings(row, Boolean(key)) });
}
