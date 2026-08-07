/**
 * Generate a LEMON-vs-Wrenchlane comparison for every captured code.
 *
 * Mirrors src/lib/dtc-lookup/compare.ts, but runs standalone with the service
 * role so it can backfill without a browser session.
 *
 *   node scripts/backfill-dtc-comparisons.mjs [--limit N] [--force]
 */
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";

const ENV = "/Users/jacobqvisth/crm-for-saas/.env.local";
const MODEL = "claude-sonnet-5";
const args = process.argv.slice(2);
const LIMIT = Number((args[args.indexOf("--limit") + 1] ?? 100));
const FORCE = args.includes("--force");

function env(k) {
  const m = fs.readFileSync(ENV, "utf8").match(new RegExp(`^\\s*(?:export\\s+)?${k}\\s*=\\s*["']?([^"'\\n]+)`, "m"));
  if (!m) throw new Error("missing " + k);
  return m[1].trim();
}
const SB = env("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const anthropic = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });

async function rest(method, p, body) {
  const res = await fetch(`${SB}/rest/v1/${p}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : [];
}

const TOOL = {
  name: "record_comparison",
  description: "Record how the Wrenchlane diagnosis compares to the factory manual entry.",
  input_schema: {
    type: "object",
    properties: {
      agreement: { type: "string", enum: ["strong", "partial", "conflict"] },
      score: { type: "number" },
      headline: { type: "string" },
      shared: { type: "array", items: { type: "string" } },
      only_lemon: { type: "array", items: { type: "string" } },
      only_wrenchlane: { type: "array", items: { type: "string" } },
      risk_notes: { type: "array", items: { type: "string" } },
    },
    required: ["agreement", "score", "headline", "shared", "only_lemon", "only_wrenchlane", "risk_notes"],
  },
};

async function judge({ code, vehicle, lemonText, wlText, causes }) {
  const causeList = causes.map((c) => `- ${c.name ?? "unnamed"}${c.confidence != null ? ` (${c.confidence}%)` : ""}`).join("\n");
  const prompt = `You are auditing an AI car-diagnosis product against the factory service manual.

VEHICLE: ${vehicle}
FAULT CODE: ${code}

=== FACTORY MANUAL (Mercedes, via LEMON). This is the reference. ===
${lemonText.slice(0, 6000)}

=== WRENCHLANE AI DIAGNOSIS ===
Ranked causes:
${causeList || "(none returned)"}

Full result:
${wlText.slice(0, 6000)}

Judge how well the Wrenchlane diagnosis matches the manual.

Rules:
- The manual defines what the code MEANS. If Wrenchlane names a different subsystem, that is a conflict however confident it sounds.
- A CAN communication timeout naming a specific control unit is NOT the same as an internal fault of that control unit. Say so if it conflates them.
- If the manual explicitly warns a component is not at fault and Wrenchlane names it, that belongs in risk_notes.
- Be concrete. Name the control units and components.
- Never use an em dash or en dash. Use a comma or a full stop instead.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content: prompt }],
  });
  const b = res.content.find((c) => c.type === "tool_use");
  if (!b) throw new Error("no tool_use");
  return b.input;
}

async function main() {
  const veh = (await rest("GET", "dtc_manual_vehicles?select=id,make,model,year,engine&limit=1"))[0];
  const vehicle = `${veh.year} ${veh.make} ${veh.model} ${veh.engine ?? ""}`.trim();

  const wls = await rest("GET", `dtc_wrenchlane_results?select=id,code,summary,causes,raw&vehicle_id=eq.${veh.id}&order=code.asc`);
  const done = FORCE ? [] : await rest("GET", `dtc_comparisons?select=code&vehicle_id=eq.${veh.id}`);
  const seen = new Set(done.map((d) => d.code));
  const todo = wls.filter((w) => !seen.has(w.code)).slice(0, LIMIT);
  console.log(`${wls.length} captured, ${todo.length} to judge`);

  let ok = 0, fail = 0;
  for (const [i, w] of todo.entries()) {
    try {
      const manual = await rest("GET", `dtc_manual_codes?select=id,body&vehicle_id=eq.${veh.id}&code=eq.${encodeURIComponent(w.code)}&order=page_id.asc`);
      const lemonText = manual.map((m) => m.body ?? "").join("\n\n").trim();
      if (!lemonText) { console.log(`  ${w.code} -> no manual entry, skipped`); continue; }

      const v = await judge({
        code: w.code, vehicle, lemonText,
        wlText: typeof w.raw?.text === "string" ? w.raw.text : (w.summary ?? ""),
        causes: Array.isArray(w.causes) ? w.causes : [],
      });

      await rest("POST", "dtc_comparisons", [{
        vehicle_id: veh.id, code: w.code,
        lemon_code_id: manual[0]?.id ?? null,
        wrenchlane_result_id: w.id,
        agreement: v.agreement,
        // the model answers 0-100 or 0-1 depending on the run; scale before rounding
        score: (() => {
          const n = Number.isFinite(v.score) ? v.score : 0;
          return Math.max(0, Math.min(100, Math.round(n > 0 && n <= 1 ? n * 100 : n)));
        })(),
        verdict: {
          headline: v.headline, shared: v.shared, only_lemon: v.only_lemon,
          only_wrenchlane: v.only_wrenchlane, risk_notes: v.risk_notes,
        },
        model: MODEL,
      }]);
      ok++;
      console.log(`  [${i + 1}/${todo.length}] ${w.code} -> ${v.agreement} ${v.score}`);
    } catch (e) {
      fail++;
      console.log(`  [${i + 1}/${todo.length}] ${w.code} -> FAILED ${String(e.message).slice(0, 90)}`);
    }
  }
  console.log(`\njudged ${ok}, failed ${fail}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
