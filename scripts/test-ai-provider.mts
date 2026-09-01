// Ops script: end-to-end check of src/lib/ai/provider.ts against a live Gemini
// key, exercising all three entry points plus the model-tier routing.
//
// WHY THIS EXISTS, separately from scripts/test-gemini.mjs
// -------------------------------------------------------
// test-gemini.mjs talks to the REST API directly, so it tells you whether the
// key and the model work. This one drives OUR code, so it tells you whether the
// provider layer works: the schema conversion (Anthropic JSON Schema and Zod
// both have keywords Gemini rejects), the Zod re-validation, the thinking-level
// ladder, and the sonnet-to-pro tier mapping. Those are the parts that break
// when provider.ts is edited, and a unit test cannot catch a schema keyword the
// real API rejects.
//
// Gemini is forced as primary with fallback off, so no Anthropic credit is
// spent and a failure cannot be masked by Anthropic quietly serving the call.
//
// Usage:
//   npx tsx scripts/test-ai-provider.mts
//
// Reads GEMINI_API_KEY from the environment. To use the value in .env.local:
//   GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' .env.local | cut -d= -f2-) \
//     npx tsx scripts/test-ai-provider.mts

import { z } from "zod";
import {
  aiProviderStatus,
  generateJson,
  generateStructured,
  generateText,
} from "../src/lib/ai/provider.ts";

process.env.AI_PRIMARY_PROVIDER = "gemini";
process.env.AI_FALLBACK_DISABLED = "1"; // prove Gemini alone can serve

console.log("status:", JSON.stringify(aiProviderStatus()));

// 1. plain text
const text = await generateText({
  label: "e2e/text",
  system: "You are terse. One sentence, no markdown.",
  user: "What does a P0300 fault code mean?",
  maxTokens: 300,
});
console.log("\n[1] generateText:", text.ok ? `${text.provider}/${text.model}` : "FAILED");
console.log("   ", text.ok ? text.text.slice(0, 140) : text.reason);

// 2. generateJson, the forced-tool path used by call summaries and switchboard
const json = await generateJson<{ outcome: string; confidence: string }>(
  {
    label: "e2e/json",
    system: "Classify the outcome of this sales call transcript.",
    user: "Agent: Hi, is this a good time? Contact: Actually we just signed with someone else last week.",
    maxTokens: 400,
  },
  {
    name: "record_call_analysis",
    description: "Record the outcome.",
    input_schema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          enum: ["interested", "not_interested", "callback", "no_answer"],
          description: "The call outcome.",
        },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["outcome", "confidence"],
      additionalProperties: false,
    },
  },
);
console.log("\n[2] generateJson:", json.ok ? `${json.provider}/${json.model}` : "FAILED");
console.log("   ", json.ok ? JSON.stringify(json.data) : json.reason);

// 3. generateStructured, the Zod path used by the article pipeline
const schema = z.object({
  title: z.string().describe("The Swedish headline."),
  slug: z.string().describe("Lowercase words joined by hyphens."),
  summary: z.string().describe("One or two sentences."),
});
const structured = await generateStructured(
  {
    label: "e2e/structured",
    system: "You translate release notes into Swedish. Return the requested fields.",
    user: "Title: Faster diagnostics for EV drivetrains\nSummary: The new flow cuts diagnosis time on high-voltage faults.",
    maxTokens: 800,
  },
  schema,
);
console.log("\n[3] generateStructured:", structured.ok ? `${structured.provider}/${structured.model}` : "FAILED");
console.log("   ", structured.ok ? JSON.stringify(structured.data) : structured.reason);

// 4. sonnet-class routing should reach the strong model
const strong = await generateText({
  label: "e2e/strong",
  anthropicModel: "claude-sonnet-4-6",
  user: "Reply with the single word: STRONG",
  maxTokens: 200,
});
console.log("\n[4] sonnet-class routing:", strong.ok ? `${strong.provider}/${strong.model}` : "FAILED");
console.log("   ", strong.ok ? strong.text.slice(0, 60) : strong.reason);

// 5. the actual production shape: Anthropic primary, Gemini as the fallback.
// A deliberately invalid Anthropic key stands in for the outage, since the real
// failure (an exhausted credit balance) cannot be induced on demand.
process.env.AI_PRIMARY_PROVIDER = "anthropic";
process.env.AI_FALLBACK_DISABLED = "";
process.env.ANTHROPIC_API_KEY = "sk-ant-deliberately-invalid-for-this-test";

const failover = await generateText({
  label: "e2e/failover",
  system: "You are terse.",
  user: "Reply with the single word: FAILOVER",
  maxTokens: 200,
});
const failedOver = failover.ok && failover.provider === "gemini";
console.log(
  `\n[5] anthropic -> gemini failover:`,
  failover.ok ? `served by ${failover.provider}/${failover.model}` : `FAILED ${failover.reason}`,
);
if (!failedOver) console.log("    expected the Gemini fallback to serve this");

const allOk = text.ok && json.ok && structured.ok && strong.ok && failedOver;
console.log(
  `\n${allOk ? "PASS" : "FAIL"}: three entry points, tier routing, and Anthropic-to-Gemini failover`,
);
process.exit(allOk ? 0 : 1);
