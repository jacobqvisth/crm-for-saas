/**
 * Run the switchboard gap analysis against a real conversation, without waiting
 * for the cron. Useful for checking the tool schema and the prompt's judgement.
 *
 *   npx tsx --conditions=react-server --env-file=<env> \
 *     scripts/test-switchboard-analysis.ts <conversation_id>
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getConversation } from "@/lib/call-agent/elevenlabs";
import { loadWrenchlaneKnowledge } from "@/lib/inbox/load-knowledge";
import { analyzeSwitchboardCall, transcriptToText } from "@/lib/switchboard/analyze";

const WORKSPACE = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";

async function main() {
  const conversationId = process.argv[2];
  if (!conversationId) {
    console.error("usage: test-switchboard-analysis.ts <conversation_id>");
    process.exit(1);
  }

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: settings } = await supabase
    .from("switchboard_settings")
    .select("*")
    .eq("workspace_id", WORKSPACE)
    .single();

  const apiKey = process.env.ELEVENLABS_API_KEY!;
  const convo = await getConversation(apiKey, conversationId);
  const text = transcriptToText(convo.transcript);
  console.log(`transcript turns: ${convo.transcript?.length ?? 0}, ${text.length} chars\n`);

  const knowledgeMd =
    settings?.knowledge_md?.trim() ||
    (await loadWrenchlaneKnowledge(supabase, WORKSPACE)).contentMd;
  console.log(`knowledge: ${knowledgeMd.length} chars\n`);

  const result = await analyzeSwitchboardCall({ transcript: text, knowledgeMd });
  if (!result.ok) {
    console.error("analysis failed:", result.reason);
    process.exit(1);
  }

  console.log("SUMMARY:\n " + result.analysis.summary + "\n");
  console.log("COULD NOT ANSWER:");
  for (const q of result.analysis.unanswered) console.log("  - " + q);
  if (!result.analysis.unanswered.length) console.log("  (none)");
  console.log("\nSUSPECT CLAIMS:");
  for (const c of result.analysis.suspect_claims) console.log("  - " + c);
  if (!result.analysis.suspect_claims.length) console.log("  (none)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
