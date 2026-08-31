// Turn a fresh, empty tenant database into a CRM somebody can sign into.
//
// WHY THIS EXISTS
// ---------------
// `00000000000000_baseline.sql` creates 101 tables and puts nothing in them. No
// workspace, no user, no templates. The first sign-in falls into the
// /auth/callback onboarding path, which creates *a* workspace named after
// whoever signed in first ("Jacob's Workspace") with whatever domain their
// address happened to have. That is not a configured tenant, and undoing it
// afterwards means editing rows by hand in production.
//
// So the workspace is created deliberately, BEFORE the first sign-in, with the
// right name and domain. The onboarding path then finds it by domain and joins
// the user to it as a member instead of inventing a new one.
//
// SAFETY
// ------
// Dry-run by default; `--apply` is required to write anything. It refuses to
// run against a database that already has a workspace, so it can never be
// pointed at a live tenant and quietly add a second one.
//
// It writes with the service-role key, which bypasses RLS. That is correct
// here: there is no user yet, so there is no session to write as.
//
// Usage:
//   node scripts/bootstrap-tenant.mjs --slug=animech --owner=someone@animech.se
//   node scripts/bootstrap-tenant.mjs --slug=animech --owner=someone@animech.se --apply
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which must be
// THAT TENANT'S. Never copy another tenant's .env.local to get them (R5).

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function loadEnvLocal() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}
const fileEnv = loadEnvLocal();
const env = (k) => process.env[k] ?? fileEnv[k];

const SLUG = arg("slug");
const OWNER = arg("owner");
const NAME_OVERRIDE = arg("name");
const DOMAIN_OVERRIDE = arg("domain");

if (!SLUG) {
  console.error(
    "Usage: node scripts/bootstrap-tenant.mjs --slug=<tenant> --owner=<email> [--apply]\n" +
      "  --slug   which tenant config to read (src/config/tenants/<slug>.ts)\n" +
      "  --owner  the first person to authorise. Created confirmed, signs in by magic link.\n" +
      "  --name   override the workspace name (defaults to the tenant's legalName)\n" +
      "  --domain override the workspace domain (defaults to the first internalDomain)\n",
  );
  process.exit(1);
}

// --- read the tenant's compiled config --------------------------------------
// Parsed out of the TypeScript rather than imported, exactly as
// seed-control-plane.mjs parses features.ts: this is a plain .mjs script and
// the config is a .ts module. Only three flat string fields are needed.
const configPath = join(ROOT, "src", "config", "tenants", `${SLUG}.ts`);
if (!existsSync(configPath)) {
  console.error(
    `No config at src/config/tenants/${SLUG}.ts.\n` +
      `Write the tenant config first: it is what decides the workspace name, the\n` +
      `domain, the branding and the sign-in providers. Bootstrapping a database\n` +
      `for a tenant the code cannot serve would produce rows nothing can read.`,
  );
  process.exit(1);
}
const configSrc = readFileSync(configPath, "utf8");

function scalar(field) {
  const m = configSrc.match(new RegExp(`${field}\\s*:\\s*"([^"]*)"`));
  return m?.[1];
}
function firstOfArray(field) {
  const m = configSrc.match(new RegExp(`${field}\\s*:\\s*\\[([^\\]]*)\\]`, "s"));
  if (!m) return undefined;
  const first = m[1].match(/"([^"]+)"/);
  return first?.[1];
}

const legalName = NAME_OVERRIDE ?? scalar("legalName");
const domain = DOMAIN_OVERRIDE ?? firstOfArray("internalDomains");

if (!legalName || !domain) {
  console.error(
    `Could not read legalName and internalDomains out of ${SLUG}.ts.\n` +
      `Pass --name and --domain explicitly.`,
  );
  process.exit(1);
}

// --- connect -----------------------------------------------------------------
const URL_ = env("NEXT_PUBLIC_SUPABASE_URL");
const KEY = env("SUPABASE_SERVICE_ROLE_KEY");
if (!URL_ || !KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(URL_, KEY, { auth: { persistSession: false } });

console.log(`Tenant   : ${SLUG}`);
console.log(`Database : ${URL_}`);
console.log(`Workspace: ${legalName}  (domain ${domain})`);
console.log(`Owner    : ${OWNER ?? "(none given, skipping user creation)"}`);
console.log(APPLY ? "\nMODE: APPLY\n" : "\nMODE: DRY RUN (pass --apply to write)\n");

// --- refuse to run twice -----------------------------------------------------
// The one mistake that would matter: pointing this at a tenant that is already
// live and adding a second workspace beside the real one. Every row in this
// schema is scoped by workspace_id, so a duplicate does not error, it just
// splits the customer's data in half silently.
{
  const { data, error } = await db.from("workspaces").select("id, name, domain");
  if (error) {
    console.error(
      "Could not read `workspaces`. Is this a tenant CRM database, and has the\n" +
        "baseline migration been applied?\n",
      error.message,
    );
    process.exit(1);
  }
  if (data.length > 0) {
    console.error(
      `REFUSING TO RUN: this database already has ${data.length} workspace(s):\n` +
        data.map((w) => `  - ${w.name} (${w.domain ?? "no domain"})`).join("\n") +
        `\n\nBootstrap is for an empty database. Adding a second workspace here would\n` +
        `split the tenant's data across two of them without erroring.`,
    );
    process.exit(1);
  }
}

const plan = [];
const note = (s) => {
  plan.push(s);
  console.log(`  ${s}`);
};

// --- 1. the workspace --------------------------------------------------------
console.log("1. Workspace");
note(`create workspace "${legalName}" with domain ${domain}`);

let workspaceId = null;
if (APPLY) {
  const { data, error } = await db
    .from("workspaces")
    .insert({ name: legalName, domain })
    .select("id")
    .single();
  if (error || !data) {
    console.error("\nFailed to create the workspace:", error?.message);
    process.exit(1);
  }
  workspaceId = data.id;
  console.log(`  -> ${workspaceId}`);
}

// --- 2. the first user -------------------------------------------------------
// Created through the admin API with email_confirm: true, which is the pattern
// section E of the phase 11 brief settled on and which the control plane
// already uses. It means sign-up can stay DISABLED on the project: a person is
// authorised by existing, not by signing up.
//
// A later Google or Microsoft sign-in for the same address LINKS to this user
// rather than being refused as a new signup. That is worth knowing before
// somebody debugs "Signups not allowed for this instance" from scratch.
console.log("\n2. Owner");
if (!OWNER) {
  note("skipped: no --owner given");
} else {
  note(`create confirmed auth user ${OWNER}`);
  note(`add them to the workspace as owner`);

  if (APPLY) {
    const { data: created, error: userErr } = await db.auth.admin.createUser({
      email: OWNER,
      email_confirm: true,
    });
    if (userErr || !created?.user) {
      console.error("\nFailed to create the owner:", userErr?.message);
      process.exit(1);
    }
    const { error: memberErr } = await db.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: created.user.id,
      role: "owner",
    });
    if (memberErr) {
      console.error("\nFailed to add the owner membership:", memberErr.message);
      process.exit(1);
    }
    console.log(`  -> ${created.user.id}`);
  }
}

// --- 3. starter content ------------------------------------------------------
// WHAT A NEW TENANT SHOULD START WITH, decided rather than inherited.
//
// Wrenchlane's own templates are about fault codes and car workshops and would
// be actively misleading in a 3D-configurator company's account, so none of
// them are copied. These three are deliberately generic: they are a working
// example of the merge-variable syntax and the shape of a 3-step outbound
// sequence, and they are written to be rewritten.
//
// The sequence is created as a DRAFT. A draft never sends, so bootstrapping a
// tenant can never start outbound at somebody. Turning it on is a human
// decision made in the UI, which is where it belongs.
const TEMPLATES = [
  {
    name: "Starter: first touch",
    subject: "{{first_name}}, quick question about {{company}}",
    body_html:
      "<p>Hi {{first_name}},</p>" +
      "<p>Replace this with one sentence on why you are writing to {{company}} " +
      "specifically. The whole template is an example: rewrite it before you " +
      "send anything.</p>" +
      "<p>Worth a short call?</p>" +
      "<p>{{sender_name}}</p>",
    variables: ["first_name", "company", "sender_name"],
  },
  {
    name: "Starter: follow-up",
    subject: "Re: {{first_name}}, quick question about {{company}}",
    body_html:
      "<p>Hi {{first_name}},</p>" +
      "<p>Adding one useful thing rather than repeating the first mail is what " +
      "makes a follow-up work. Put that thing here.</p>" +
      "<p>{{sender_name}}</p>",
    variables: ["first_name", "sender_name"],
  },
  {
    name: "Starter: last note",
    subject: "Closing the loop, {{first_name}}",
    body_html:
      "<p>Hi {{first_name}},</p>" +
      "<p>Say you will stop writing, and mean it. This is the mail that gets the " +
      "most replies, and the reason is that it is the only one that asks for " +
      "nothing.</p>" +
      "<p>{{sender_name}}</p>",
    variables: ["first_name", "sender_name"],
  },
];

console.log("\n3. Starter content");
note(`create ${TEMPLATES.length} generic email templates (none copied from another tenant)`);
note(`create one DRAFT 3-step sequence wired to them (a draft never sends)`);

if (APPLY) {
  const { data: templates, error: tErr } = await db
    .from("email_templates")
    .insert(TEMPLATES.map((t) => ({ ...t, workspace_id: workspaceId })))
    .select("id, name");
  if (tErr || !templates) {
    console.error("\nFailed to create templates:", tErr?.message);
    process.exit(1);
  }

  const { data: sequence, error: sErr } = await db
    .from("sequences")
    .insert({ workspace_id: workspaceId, name: "Starter sequence", status: "draft" })
    .select("id")
    .single();
  if (sErr || !sequence) {
    console.error("\nFailed to create the sequence:", sErr?.message);
    process.exit(1);
  }

  // Order the steps by the template order above, not by whatever order the
  // insert returned, so step 1 is reliably the first-touch mail.
  const byName = new Map(templates.map((t) => [t.name, t.id]));
  const steps = TEMPLATES.map((t, i) => ({
    sequence_id: sequence.id,
    step_order: i + 1,
    type: "email",
    delay_days: i === 0 ? 0 : 3,
    template_id: byName.get(t.name),
  }));
  const { error: stepErr } = await db.from("sequence_steps").insert(steps);
  if (stepErr) {
    console.error("\nFailed to create sequence steps:", stepErr.message);
    process.exit(1);
  }
  console.log(`  -> sequence ${sequence.id} (draft), ${steps.length} steps`);
}

// --- what a human still has to do -------------------------------------------
console.log(`\n${APPLY ? "Done." : "Dry run complete."} ${plan.length} action(s).`);
console.log(
  `
STILL MANUAL, and none of it is in this script because none of it is SQL:

  1. In this tenant's Supabase project, Authentication -> Providers:
     enable exactly the providers its tenant config's \`auth\` block claims.
     A button for a provider that is not enabled fails with "provider is not
     enabled" AFTER the user clicks it, which is worse than no button.

  2. In the same project, turn SIGN-UP OFF (disable_signup). A tenant left on
     the default is open to the internet. Authorise people by re-running this
     script's owner step, or through the Supabase admin API.

  3. Add this tenant's redirect URL to the Supabase allow-list, exactly:
       <app-url>/auth/callback
     Never with a query string appended: Supabase matches the whole string,
     and a stray parameter strands real users on localhost.

  4. Fill in the tenant's Vercel environment from .env.local.example. Generate
     a FRESH ENCRYPTION_KEY and CRON_SECRET (openssl rand -hex 32). Do not copy
     another tenant's file (R5).

  5. Decide this tenant's feature flags in the control plane. Nineteen of the
     twenty default ON, and most of them are Wrenchlane's.
`,
);
