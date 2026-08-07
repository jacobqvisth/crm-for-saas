/**
 * Capture Wrenchlane diagnoses for DTC codes, until the Wrenchlane API lands.
 *
 * Drives app.wrenchlane.com in a real Chrome using a COPY of Jacob's profile at
 * /tmp/wl-chrome-profile. Log in once in that window and the session persists
 * across runs, so no credentials live in this repo.
 *
 * Usage:
 *   node scripts/wrenchlane-capture.mjs --limit 30
 *   node scripts/wrenchlane-capture.mjs --codes EC55A,E1937 --debug
 */
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_VEHICLE_ID = "300000015";
const APP_ENGINE = "642822";
const DIAG_URL = `https://app.wrenchlane.com/en/start/vehicle/${APP_VEHICLE_ID}/diagnostic`;
const PROFILE = path.join(os.tmpdir(), "wl-chrome-profile");
const OUT = path.join(process.cwd(), ".wrenchlane-capture");
const ENV = "/Users/jacobqvisth/crm-for-saas/.env.local";

const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const DEBUG = args.includes("--debug");
const LIMIT = Number(flag("limit", 30));
const ONLY = flag("codes");

function env(key) {
  const m = fs.readFileSync(ENV, "utf8").match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*["']?([^"'\\n]+)`, "m"));
  if (!m) throw new Error("missing " + key);
  return m[1].trim();
}
const SB = env("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const KEY = env("SUPABASE_SERVICE_ROLE_KEY");

async function rest(method, p, body, prefer) {
  const res = await fetch(`${SB}/rest/v1/${p}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : [];
}

/**
 * Pull the structured diagnosis out of the rendered page text. Shape observed
 * on app.wrenchlane.com:
 *   Analysis complete - N sources checked
 *   Possible causes / "N Cause(s) found" / Severity High|Medium|Low
 *   <cause name> <NN>%  ... Overview / Videos (n) / TSBs (n) / <overview text>
 *   Suggested tests / Common symptoms / Related systems / Related components
 */
function parseResult(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const idx = (re) => lines.findIndex((l) => re.test(l));
  const between = (startRe, stopRes) => {
    const s = idx(startRe);
    if (s === -1) return [];
    const out = [];
    for (let i = s + 1; i < lines.length; i++) {
      if (stopRes.some((r) => r.test(lines[i]))) break;
      out.push(lines[i]);
    }
    return out;
  };
  const STOPS = [
    /^Suggested tests$/i, /^Common symptoms$/i, /^Related systems$/i,
    /^Related components$/i, /^Chat about this$/i, /^This is not it$/i,
    /^Repair guide$/i, /^Privacy and cookie/i, /^Overview$/i,
  ];

  const causes = [];
  for (let i = 0; i < lines.length; i++) {
    const pct = lines[i].match(/^(\d{1,3})%$/);
    if (pct && i > 0) {
      causes.push({ name: lines[i - 1], confidence: Number(pct[1]) });
    }
  }
  const sevLine = lines.find((l) => /^(High|Medium|Low)$/i.test(l));
  const overview = between(/^Overview$/i, STOPS)
    .filter((l) => !/^Videos \(|^TSBs \(/i.test(l))
    .join(" ")
    .slice(0, 2000);

  return {
    complete: /Analysis complete/i.test(text),
    sources_checked: Number((text.match(/Analysis complete[^\d]*(\d+)\s*sources/i) || [])[1] ?? 0),
    cause_count: Number((text.match(/(\d+)\s+Causes?\s+found/i) || [])[1] ?? causes.length),
    severity: sevLine || null,
    causes,
    overview,
    suggested_tests: between(/^Suggested tests$/i, STOPS),
    common_symptoms: between(/^Common symptoms$/i, STOPS),
    related_systems: between(/^Related systems$/i, STOPS),
    related_components: between(/^Related components$/i, STOPS),
  };
}

async function pickCodes() {
  if (ONLY) return ONLY.split(",").map((s) => s.trim()).filter(Boolean);
  const veh = (await rest("GET", "dtc_manual_vehicles?select=id&limit=1"))[0];
  const done = await rest("GET", `dtc_wrenchlane_results?select=code&vehicle_id=eq.${veh.id}`);
  const seen = new Set(done.map((d) => d.code));
  // Prefer codes that carry real manual detail, they make the richer comparison.
  const rows = await rest(
    "GET",
    `dtc_manual_codes?select=code,body&vehicle_id=eq.${veh.id}&order=code.asc`
  );
  const uniq = [];
  const s = new Set();
  for (const r of rows) {
    if (s.has(r.code) || seen.has(r.code)) continue;
    s.add(r.code);
    uniq.push({ code: r.code, len: (r.body || "").length });
  }
  uniq.sort((a, b) => b.len - a.len);
  return uniq.slice(0, LIMIT).map((u) => u.code);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const veh = (await rest("GET", "dtc_manual_vehicles?select=id&limit=1"))[0];
  const codes = await pickCodes();
  console.log(`capturing ${codes.length} codes:`, codes.slice(0, 8).join(", "), codes.length > 8 ? "…" : "");

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  let ok = 0;
  let failed = 0;
  for (const [i, code] of codes.entries()) {
    try {
      await page.goto(DIAG_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1500);

      if (/log ?in|sign ?in/i.test(await page.title())) {
        throw new Error("not logged in — log in once in the open Chrome window, then re-run");
      }

      const codeInput = page.locator('input[placeholder*="P0011"]').first();
      await codeInput.waitFor({ timeout: 20000 });
      await codeInput.click();
      await codeInput.fill(code);
      await page.waitForTimeout(1200);
      // the field offers an autocomplete list; commit the token either way
      await page.keyboard.press("Enter");
      await page.waitForTimeout(600);

      const analyze = page.locator('button:has-text("Analyze")').first();
      if (await analyze.isDisabled().catch(() => false)) {
        // description is required in some states; keep it neutral so the
        // diagnosis stays code-driven and comparable to the manual entry
        const desc = page.locator('textarea[placeholder*="describe"]').first();
        if (await desc.count()) await desc.fill("Fault code read from ECU. No additional symptoms reported.");
        await page.waitForTimeout(400);
      }
      await analyze.click({ timeout: 15000 });

      // The analysis streams in. There is no reliable "Analysis complete"
      // banner on the session page, so settle on the result structure itself:
      // a causes block, at least one confidence %, and a trailing section.
      const done = (s) =>
        /Possible causes/i.test(s) &&
        /\b\d{1,3}%/.test(s) &&
        /(Related components|Suggested tests|Repair guide)/i.test(s);

      let text = "";
      let complete = false;
      for (let t = 0; t < 60; t++) {
        await page.waitForTimeout(3000);
        text = await page.innerText("body").catch(() => "");
        if (done(text)) {
          complete = true;
          await page.waitForTimeout(2500); // let the last section paint
          text = await page.innerText("body").catch(() => text);
          break;
        }
      }
      if (!complete) throw new Error("analysis did not complete in time");

      const parsed = parseResult(text);
      const html = await page.content();
      if (DEBUG && i === 0) {
        fs.writeFileSync(path.join(OUT, `result-${code}.html`), html);
        await page.screenshot({ path: path.join(OUT, `result-${code}.png`), fullPage: true });
      }

      await rest(
        "POST",
        // on_conflict is required for merge-duplicates to upsert rather than 409
        "dtc_wrenchlane_results?on_conflict=vehicle_id,code",
        [
          {
            vehicle_id: veh.id,
            code,
            app_vehicle_id: APP_VEHICLE_ID,
            app_engine_code: APP_ENGINE,
            summary: parsed.overview || text.slice(0, 2000),
            causes: parsed.causes,
            raw: { ...parsed, text, url: page.url(), captured_chars: text.length },
            capture_method: "browser",
            source_url: page.url(),
          },
        ],
        "resolution=merge-duplicates"
      );
      ok++;
      console.log(`  [${i + 1}/${codes.length}] ${code} -> ${text.length} chars`);
    } catch (e) {
      failed++;
      console.log(`  [${i + 1}/${codes.length}] ${code} -> FAILED: ${e.message.slice(0, 110)}`);
      // capture the page state so a failure is diagnosable instead of opaque
      await page.screenshot({ path: path.join(OUT, `fail-${code}.png`), fullPage: true }).catch(() => {});
      const t = await page.innerText("body").catch(() => "");
      fs.writeFileSync(path.join(OUT, `fail-${code}.txt`), `URL: ${page.url()}\n\n${t}`);
      if (/not logged in/.test(e.message)) break;
    }
  }

  console.log(`\ncaptured ${ok}, failed ${failed}`);
  // MUST close: a Chrome left running holds the profile lock and the next run
  // blocks forever waiting for it. The login persists in the profile on disk.
  await ctx.close().catch(() => {});
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
