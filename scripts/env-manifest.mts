// Keep `.env.local.example` honest against the code.
//
// WHY THIS EXISTS
// ---------------
// `.env.local.example` was maintained by hand and had drifted badly: the code
// read far more variables than it documented, and several entries looked stale
// but were not. Standing a tenant up against that means discovering the
// configuration by watching production break.
//
// So the file is GENERATED from `src/config/env-manifest.ts`, and this script
// also fails when the two disagree with the code. A generated file cannot drift.
//
// Usage:
//   npx tsx scripts/env-manifest.mts            # dry run: report drift, write nothing
//   npx tsx scripts/env-manifest.mts --check    # same, but exit 1 on drift (CI)
//   npx tsx scripts/env-manifest.mts --write    # regenerate .env.local.example
//
// WHAT THE SCANNER CAN AND CANNOT SEE
// -----------------------------------
// It finds `process.env.NAME`, `process.env["NAME"]`, and `getEnv("NAME")` /
// `getRequiredEnv("NAME")`. It CANNOT resolve `process.env[SOME_CONSTANT]`, so
// those are reported separately and the manifest marks them `indirect: true`.
//
// That distinction is the whole reason this script exists in this shape. The
// phase 11 brief measured the codebase with a `process.env.` search alone,
// concluded that nine documented variables were never read, and recommended
// deleting them. All nine are read through `getEnv()`. Deleting them would have
// removed live documentation for working configuration.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_GROUPS, ENV_VARS, type EnvVar } from "../src/config/env-manifest.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const TARGET = join(ROOT, ".env.local.example");

const WRITE = process.argv.includes("--write");
const CHECK = process.argv.includes("--check");

// --- scan --------------------------------------------------------------------

const CODE_EXT = /\.(ts|tsx|mts|mjs|js|jsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (CODE_EXT.test(entry)) out.push(p);
  }
  return out;
}

/** name -> the files that read it, so a drift report can point somewhere. */
const found = new Map<string, Set<string>>();
/** `process.env[CONSTANT]` sites the scanner cannot resolve. */
const unresolved: string[] = [];

const DIRECT = /process\.env\.([A-Z][A-Z0-9_]*)/g;
const BRACKET_LITERAL = /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g;
const HELPER = /\b(?:getEnv|getRequiredEnv)\(\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\)/g;
// Only SCREAMING_CASE identifiers. A lowercase one (`process.env[name]`) is a
// generic accessor such as getEnv() itself, not a read of one named variable,
// and reporting those buries the single case that actually matters.
const BRACKET_ANY = /process\.env\[\s*([A-Z][A-Z0-9_]*)\s*\]/g;

for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  for (const re of [DIRECT, BRACKET_LITERAL, HELPER]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!found.has(m[1])) found.set(m[1], new Set());
      found.get(m[1])!.add(rel);
    }
  }
  BRACKET_ANY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BRACKET_ANY.exec(text))) {
    unresolved.push(`${rel}: process.env[${m[1]}]`);
  }
}

// --- compare -----------------------------------------------------------------

const manifest = new Map<string, EnvVar>(ENV_VARS.map((v) => [v.name, v]));

const undocumented = [...found.keys()].filter((n) => !manifest.has(n)).sort();
const unread = ENV_VARS.filter((v) => !v.indirect && !found.has(v.name))
  .map((v) => v.name)
  .sort();

const duplicates = ENV_VARS.map((v) => v.name).filter(
  (n, i, a) => a.indexOf(n) !== i,
);

console.log(`Scanned ${walk(SRC).length} files under src/`);
console.log(`  read by the code : ${found.size}`);
console.log(`  in the manifest  : ${ENV_VARS.length}`);
console.log(
  `  indirect entries : ${ENV_VARS.filter((v) => v.indirect).length} ` +
    `(reached through a constant; the scanner cannot see them)`,
);

if (unresolved.length) {
  console.log(
    `\n${unresolved.length} computed read(s) the scanner cannot resolve. Each one\n` +
      `must correspond to a manifest entry marked indirect: true.`,
  );
  for (const u of unresolved) console.log(`  ${u}`);
}

let bad = false;

if (duplicates.length) {
  bad = true;
  console.error(`\nDUPLICATE manifest entries: ${duplicates.join(", ")}`);
}

if (undocumented.length) {
  bad = true;
  console.error(
    `\nDRIFT: ${undocumented.length} variable(s) read by the code but absent from\n` +
      `src/config/env-manifest.ts. A tenant cannot be configured from a file that\n` +
      `does not mention them. Add them to the manifest:\n`,
  );
  for (const n of undocumented) {
    const where = [...(found.get(n) ?? [])].slice(0, 3).join(", ");
    console.error(`  ${n}  (${where})`);
  }
}

if (unread.length) {
  bad = true;
  console.error(
    `\nDRIFT: ${unread.length} manifest entry/entries that nothing reads. Either the\n` +
      `code dropped them, or the read is indirect and the entry needs\n` +
      `indirect: true. Do NOT simply delete them without checking getEnv() call\n` +
      `sites — that mistake is why this script exists:\n`,
  );
  for (const n of unread) console.error(`  ${n}`);
}

// --- generate ----------------------------------------------------------------

const REQUIREMENT_LABEL: Record<string, string> = {
  required: "REQUIRED",
  "required-for-feature": "required for this group",
  optional: "optional",
  platform: "injected by the platform, do not set",
};

function wrap(text: string, width: number, prefix: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? line + " " + w : w;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => prefix + l).join("\n");
}

function render(): string {
  const out: string[] = [];
  out.push("# GENERATED FILE - DO NOT EDIT BY HAND.");
  out.push("#");
  out.push("# Source of truth: src/config/env-manifest.ts");
  out.push("# Regenerate:      npx tsx scripts/env-manifest.mts --write");
  out.push("#");
  out.push("# CI runs `--check`, which fails when the code reads a variable this file");
  out.push("# does not mention. Editing this file by hand is therefore pointless: the");
  out.push("# next regeneration overwrites it.");
  out.push("#");
  out.push("# STANDING UP A NEW TENANT");
  out.push("# ------------------------");
  out.push("# Fill in every REQUIRED entry, then the groups for the integrations and");
  out.push("# features that tenant actually has. A tenant with integrations.elks =");
  out.push("# false needs none of the 46elks group.");
  out.push("#");
  out.push("# NEVER copy another tenant's .env.local (ground rule R5). Every credential");
  out.push("# here is per customer, and a copied file makes one customer authenticate as");
  out.push("# another against Stripe, GA4, Google Ads, PostHog and the S3 export.");
  out.push("# Generate a FRESH ENCRYPTION_KEY and CRON_SECRET per tenant: the existing");
  out.push("# ones decrypt Wrenchlane's mail tokens.");
  out.push("");

  const counts = { required: 0, "required-for-feature": 0, optional: 0, platform: 0 };
  for (const v of ENV_VARS) counts[v.requirement]++;
  out.push(
    `# ${ENV_VARS.length} variables: ${counts.required} required, ` +
      `${counts["required-for-feature"]} required for a group, ` +
      `${counts.optional} optional, ${counts.platform} platform-injected.`,
  );
  out.push("");

  for (const g of ENV_GROUPS) {
    out.push(
      "# " + "=".repeat(74),
    );
    out.push(`# ${g.title}`);
    out.push(`# gate: ${g.gate}`);
    out.push("# " + "=".repeat(74));
    out.push(wrap(g.note, 74, "# "));
    out.push("");
    for (const v of g.vars) {
      out.push(wrap(`${v.description}`, 74, "# "));
      const tags = [REQUIREMENT_LABEL[v.requirement]];
      if (v.indirect) tags.push("read through a constant");
      out.push(`# [${tags.join("; ")}]`);
      out.push(`${v.name}=${v.example ? "" : ""}`);
      if (v.example) {
        // Keep the example as a comment rather than a value: a real value here
        // would be copied into production by someone in a hurry.
        out[out.length - 1] = `${v.name}=            # ${v.example}`;
      }
      out.push("");
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

const rendered = render();
const current = (() => {
  try {
    return readFileSync(TARGET, "utf8");
  } catch {
    return "";
  }
})();

if (WRITE) {
  writeFileSync(TARGET, rendered);
  console.log(`\nWrote ${relative(ROOT, TARGET)} (${rendered.length} bytes).`);
} else if (rendered !== current) {
  console.log(
    `\n${relative(ROOT, TARGET)} is out of date. Run with --write to regenerate.`,
  );
  if (CHECK) bad = true;
}

if (bad) {
  console.error("\nenv-manifest: FAILED");
  process.exit(1);
}
console.log("\nenv-manifest: ok");
