// Ops script: prove the Gemini connection works end to end, before trusting it
// as the CRM's fallback provider.
//
// WHY THIS EXISTS
// ---------------
// A Gemini API key can be present and still not serve a request, in ways that
// look like different problems from inside the app:
//   - the Generative Language API is not enabled on the key's Google project
//     (403 SERVICE_DISABLED, which reads like a permissions bug)
//   - the key is restricted to other APIs or to other referrers
//   - the model is retired: gemini-2.5-flash and gemini-2.5-pro still appear in
//     ListModels but every generateContent call 404s for a new key, so the
//     model list is NOT proof a model works
//   - the thinking level is unsupported for that model (400), which differs per
//     model with no way to ask in advance
//   - the request works but comes back with EMPTY text, because the model spent
//     the whole output budget on thinking
//
// So this checks four things in order and reports which one broke: the key is
// readable, the API answers, a real completion comes back with text, and the
// schema-constrained (JSON) path works too. That last one is what the call
// summary and switchboard analysis features depend on.
//
// Usage:
//   node scripts/test-gemini.mjs
//   node scripts/test-gemini.mjs --model gemini-pro-latest
//   node scripts/test-gemini.mjs --list        (just enumerate reachable models)
//
// The key is read from ~/crm-for-saas/.env.local (GEMINI_API_KEY), falling back
// to the ambient environment so it also works in CI.

import { readFileSync } from "node:fs";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const args = process.argv.slice(2);
const LIST_ONLY = args.includes("--list");
const modelIdx = args.indexOf("--model");
const MODEL = modelIdx !== -1 ? args[modelIdx + 1] : "gemini-3.6-flash";

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_AI_API_KEY) return process.env.GOOGLE_AI_API_KEY;

  try {
    const envText = readFileSync(`${process.env.HOME}/crm-for-saas/.env.local`, "utf8");
    for (const line of envText.split("\n")) {
      if (line.startsWith("GEMINI_API_KEY=") || line.startsWith("GOOGLE_AI_API_KEY=")) {
        const i = line.indexOf("=");
        return line.slice(i + 1).replace(/^"|"$/g, "").trim();
      }
    }
  } catch {
    // No .env.local here (CI); the ambient check above already ran.
  }
  return null;
}

const apiKey = loadKey();
if (!apiKey) {
  console.error("FAIL (step 1/4: key): no GEMINI_API_KEY in the environment or in ~/crm-for-saas/.env.local");
  console.error("");
  console.error("Get one at https://aistudio.google.com/apikey signed in as jacob@wrenchlane.com,");
  console.error("then add it to ~/crm-for-saas/.env.local and to the Vercel project env.");
  process.exit(1);
}
console.log(`OK   (step 1/4: key)    found, ${apiKey.length} chars, ends ...${apiKey.slice(-4)}`);

// --- step 2: can the key reach the API at all? ------------------------------

const listRes = await fetch(`${API_BASE}/models?pageSize=200`, {
  headers: { "x-goog-api-key": apiKey },
});
const listBody = await listRes.text();

if (!listRes.ok) {
  console.error(`FAIL (step 2/4: reach) HTTP ${listRes.status}`);
  console.error(listBody.slice(0, 800));
  console.error("");
  if (listBody.includes("SERVICE_DISABLED") || listBody.includes("has not been used")) {
    console.error("The Generative Language API is not enabled on this key's Google Cloud project.");
    console.error("Enable it at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com");
    console.error("while signed in as the account that owns the key, then retry.");
  } else if (listRes.status === 400 || listRes.status === 403) {
    console.error("The key was rejected. Check it is not restricted to other APIs or HTTP referrers.");
  }
  process.exit(1);
}

const models = (JSON.parse(listBody).models ?? [])
  .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
  .map((m) => (m.name ?? "").replace(/^models\//, ""));

console.log(`OK   (step 2/4: reach)  ${models.length} models support generateContent`);

if (LIST_ONLY) {
  for (const m of models) console.log(`  ${m}`);
  process.exit(0);
}

if (!models.includes(MODEL)) {
  console.log(`WARN                   "${MODEL}" is not in the reachable list. Closest matches:`);
  for (const m of models.filter((m) => m.startsWith("gemini-3")).slice(0, 12)) {
    console.log(`  ${m}`);
  }
  console.log("                       Continuing anyway, the list endpoint is not always exhaustive.");
}

// --- step 3: a real completion, with text in it -----------------------------

/**
 * Same request shape and same thinking-level ladder as src/lib/ai/gemini.ts, so
 * a pass here means the app's own client will work on this model too.
 */
async function generate({ system, user, maxOutputTokens, responseSchema }) {
  const legacy = /^gemini-[12]\./.test(MODEL);
  const ladder = legacy
    ? [{ thinkingBudget: 0 }, null]
    : [{ thinkingLevel: "minimal" }, { thinkingLevel: "low" }, null];

  let last = null;
  for (const thinkingConfig of ladder) {
    const res = await fetch(`${API_BASE}/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: user }] }],
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          maxOutputTokens,
          ...(thinkingConfig ? { thinkingConfig } : {}),
          ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {}),
        },
      }),
    });

    const raw = await res.text();
    last = { ok: res.ok, status: res.status, raw, thinkingConfig };

    // Step down only for an unsupported thinking level; report anything else.
    const unsupportedLevel =
      res.status === 400 && /thinking level/i.test(raw) && /not supported/i.test(raw);
    if (!unsupportedLevel) return last;
  }
  return last;
}

const textRun = await generate({
  system: "You are terse. Answer in exactly one short sentence.",
  user: "In one sentence, what does a car's OBD-II port do?",
  maxOutputTokens: 200,
});

if (!textRun.ok) {
  console.error(`FAIL (step 3/4: text)  HTTP ${textRun.status}`);
  console.error(textRun.raw.slice(0, 800));
  process.exit(1);
}

const textParsed = JSON.parse(textRun.raw);
const answer = (textParsed.candidates?.[0]?.content?.parts ?? [])
  .map((p) => p.text ?? "")
  .join("")
  .trim();
const finish = textParsed.candidates?.[0]?.finishReason;

if (!answer) {
  console.error(`FAIL (step 3/4: text)  200 OK but no text (finishReason=${finish})`);
  console.error("If finishReason is MAX_TOKENS, the output budget went to thinking tokens.");
  process.exit(1);
}

const usage = textParsed.usageMetadata ?? {};
const level = textRun.thinkingConfig
  ? JSON.stringify(textRun.thinkingConfig)
  : "no thinking config";
console.log(
  `OK   (step 3/4: text)   ${MODEL} replied, ${usage.promptTokenCount ?? "?"} in / ` +
    `${usage.candidatesTokenCount ?? "?"} out / ${usage.thoughtsTokenCount ?? 0} thinking (${level})`,
);
console.log(`                       "${answer.slice(0, 120)}"`);

// --- step 4: the schema-constrained path -----------------------------------

// Mirrors what toGeminiSchema() produces from an Anthropic tool's input_schema:
// uppercase types, no additionalProperties, no $schema.
const jsonRun = await generate({
  system: "Classify the sentiment of the message.",
  user: "The workshop said the new diagnostic flow saved them two hours on a tricky Volvo.",
  maxOutputTokens: 400,
  responseSchema: {
    type: "OBJECT",
    properties: {
      sentiment: { type: "STRING", enum: ["positive", "neutral", "negative"] },
      reason: { type: "STRING", description: "One short clause." },
    },
    required: ["sentiment", "reason"],
  },
});

if (!jsonRun.ok) {
  console.error(`FAIL (step 4/4: json)  HTTP ${jsonRun.status}`);
  console.error(jsonRun.raw.slice(0, 800));
  console.error("");
  console.error("A 400 here usually means the schema carried a keyword Gemini rejects.");
  process.exit(1);
}

const jsonText = (JSON.parse(jsonRun.raw).candidates?.[0]?.content?.parts ?? [])
  .map((p) => p.text ?? "")
  .join("")
  .trim();

let structured;
try {
  structured = JSON.parse(jsonText);
} catch {
  console.error("FAIL (step 4/4: json)  reply was not parseable JSON:");
  console.error(jsonText.slice(0, 400));
  process.exit(1);
}

if (!structured.sentiment) {
  console.error("FAIL (step 4/4: json)  reply parsed but did not honour the schema:");
  console.error(JSON.stringify(structured));
  process.exit(1);
}

console.log(`OK   (step 4/4: json)   schema honoured: ${JSON.stringify(structured)}`);
console.log("");
console.log(`PASS. Gemini is reachable on ${MODEL} for both the text and JSON paths.`);
console.log("Set GEMINI_API_KEY in the Vercel project env to arm the fallback in production.");
