/**
 * One-off: bring the switchboard live for a workspace.
 *
 * Deliberately calls the SAME provisionSwitchboard() the "Provision / Sync"
 * button uses, rather than reimplementing it, so a later click from the UI
 * produces an identical configuration instead of quietly changing it.
 *
 * Run:
 *   npx tsx --conditions=react-server --env-file=.env.local \
 *     scripts/provision-switchboard.ts [--allocate-vaxel] [--allocate-callerid=<user email>]
 *
 * Idempotent: safe to re-run. Numbers are only allocated when a flag asks for it.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { allocateElksNumber, listElksNumbers } from "@/lib/calls/elks";
import { provisionSwitchboard } from "@/lib/switchboard/provision";
import { loadSwitchboardRow } from "@/lib/switchboard/settings";
import { SWITCHBOARD_DEFAULTS } from "@/lib/switchboard/types";

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0"; // "My Workspace"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://crm-for-saas.vercel.app";

function service() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function main() {
  const args = process.argv.slice(2);
  const wantVaxel = args.includes("--allocate-vaxel");
  const callerIdFor = args.find((a) => a.startsWith("--allocate-callerid="))?.split("=")[1];
  const supabase = service();

  const row = await loadSwitchboardRow(supabase, WORKSPACE_ID);
  console.log("settings row:", {
    number: row.number,
    enabled: row.enabled,
    agent: row.provider_agent_id,
  });

  // ---- 1. The växel number ------------------------------------------------
  let vaxel = row.number;
  if (!vaxel && wantVaxel) {
    // Point it somewhere harmless first; provisioning rewrites voice_start to
    // the real inbound handler below.
    const allocated = await allocateElksNumber({
      country: "se",
      name: "Wrenchlane switchboard",
      voiceStart: JSON.stringify({ hangup: "reject" }),
    });
    vaxel = allocated.number;
    console.log("allocated växel:", vaxel);
    await supabase
      .from("switchboard_settings")
      .update({ number: vaxel })
      .eq("workspace_id", WORKSPACE_ID);
  }
  if (!vaxel) {
    console.error("No växel number set. Re-run with --allocate-vaxel to buy one.");
    process.exit(1);
  }

  // ---- 2. Optional: a personal caller ID for a colleague -------------------
  if (callerIdFor) {
    const { data: users } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const user = users?.users.find((u) => u.email === callerIdFor);
    if (!user) {
      console.error(`No user with email ${callerIdFor}`);
    } else {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("call_caller_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profile?.call_caller_id) {
        console.log(`${callerIdFor} already has caller ID ${profile.call_caller_id}`);
      } else {
        const token = process.env.CALL_WEBHOOK_SECRET ?? "";
        const allocated = await allocateElksNumber({
          country: "se",
          name: `Wrenchlane ${callerIdFor}`,
          // Callbacks to a personal caller ID go to the CRM's own inbound
          // handler, which rings that number's owner.
          voiceStart: `${APP_URL}/api/calls/webhook/inbound?token=${encodeURIComponent(token)}`,
        });
        await supabase
          .from("user_profiles")
          .upsert(
            { user_id: user.id, call_caller_id: allocated.number },
            { onConflict: "user_id" },
          );
        console.log(`allocated ${allocated.number} as caller ID for ${callerIdFor}`);
      }
    }
  }

  // ---- 3. Transfer targets -------------------------------------------------
  // Seeded from the workspace's members who have a calling phone configured, so
  // nobody is added that the switchboard could never actually reach. Valdemar
  // is included without a phone on purpose: the page then shows him as "cannot
  // be rung", which is the honest state until he sets his mobile.
  const seed: Array<{ email: string; label: string; aliases: string[]; sort: number }> = [
    { email: "jacob@wrenchlane.com", label: "Jacob", aliases: ["Qvisth"], sort: 0 },
    { email: "hans@wrenchlane.com", label: "Hans", aliases: ["Markebrant"], sort: 1 },
    { email: "eklund@wrenchlane.com", label: "Valdemar", aliases: ["Eklund"], sort: 2 },
  ];
  const { data: users } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const idByEmail = new Map((users?.users ?? []).map((u) => [u.email ?? "", u.id]));

  for (const s of seed) {
    const userId = idByEmail.get(s.email);
    if (!userId) {
      console.log(`skip target ${s.label}: no user for ${s.email}`);
      continue;
    }
    const { error } = await supabase.from("switchboard_targets").upsert(
      {
        workspace_id: WORKSPACE_ID,
        user_id: userId,
        label: s.label,
        aliases: s.aliases,
        sort_order: s.sort,
        enabled: true,
      },
      { onConflict: "workspace_id,label" },
    );
    console.log(`target ${s.label}:`, error ? `FAILED ${error.message}` : "ok");
  }

  // ---- 4. Turn it on and provision ----------------------------------------
  await supabase
    .from("switchboard_settings")
    .update({ enabled: true, ...SWITCHBOARD_DEFAULTS })
    .eq("workspace_id", WORKSPACE_ID);

  const fresh = await loadSwitchboardRow(supabase, WORKSPACE_ID);
  const result = await provisionSwitchboard(supabase, fresh, APP_URL);

  console.log("\nprovision ok:", result.ok);
  for (const step of result.steps) {
    console.log(` ${step.ok ? "OK  " : "FAIL"} ${step.step}${step.detail ? ` — ${step.detail}` : ""}`);
  }

  const after = await loadSwitchboardRow(supabase, WORKSPACE_ID);
  console.log("\nfinal:", {
    number: after.number,
    enabled: after.enabled,
    agent: after.provider_agent_id,
    phoneNumberId: after.provider_phone_number_id,
    voice: after.voice_id,
    tools: after.provider_tool_ids,
  });

  const elks = await listElksNumbers();
  const vx = elks.find((n) => n.number === after.number);
  console.log("46elks inbound for växel:", vx?.voice_start ?? "(not set)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
