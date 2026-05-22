#!/usr/bin/env node
/**
 * One-off backfill of contacts.attributed_to_* for existing wl-app contacts.
 *
 * For every contact with source='wl-app' AND wl_user_id IS NOT NULL where
 * attributed_to_send_id IS NULL, find their most recent successful send in
 * email_queue (joining via enrollment for sequence_id) and stamp it.
 *
 * Also covers the company-match case: for wl-app contacts whose company
 * had a non-wl-app contact with prior sends, attribute via the prior
 * contact's most recent send.
 *
 * Usage:
 *   node scripts/backfill-wl-attribution.mjs [--dry-run] [--limit=N]
 *
 * Safe to re-run — only touches rows where attributed_to_send_id IS NULL.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] ?? "true");
}
const DRY_RUN = args.get("dry-run") === "true";
const LIMIT = args.has("limit") ? Number(args.get("limit")) : Infinity;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";

async function fetchSelfAttribution(contactId, signupAt) {
  if (!signupAt) return null; // refuse to attribute without a signup-time proxy
  const { data } = await supabase
    .from("email_queue")
    .select("id, enrollment_id, sent_at")
    .eq("contact_id", contactId)
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .lt("sent_at", signupAt)
    .order("sent_at", { ascending: false })
    .limit(1);
  const send = data?.[0];
  if (!send) return null;
  let sequenceId = null;
  if (send.enrollment_id) {
    const { data: enr } = await supabase
      .from("sequence_enrollments")
      .select("sequence_id")
      .eq("id", send.enrollment_id)
      .maybeSingle();
    sequenceId = enr?.sequence_id ?? null;
  }
  return { sendId: send.id, sequenceId, sentAt: send.sent_at, via: "self_email_merge" };
}

async function fetchCompanyAttribution(companyId, selfContactId, signupAt) {
  if (!signupAt) return null;
  const { data: siblings } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("company_id", companyId)
    .neq("id", selfContactId)
    .is("wl_user_id", null);
  const siblingIds = (siblings ?? []).map((c) => c.id);
  if (siblingIds.length === 0) return null;

  const { data: sends } = await supabase
    .from("email_queue")
    .select("id, enrollment_id, sent_at, contact_id")
    .in("contact_id", siblingIds)
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .lt("sent_at", signupAt)
    .order("sent_at", { ascending: false })
    .limit(1);
  const send = sends?.[0];
  if (!send) return null;
  let sequenceId = null;
  if (send.enrollment_id) {
    const { data: enr } = await supabase
      .from("sequence_enrollments")
      .select("sequence_id")
      .eq("id", send.enrollment_id)
      .maybeSingle();
    sequenceId = enr?.sequence_id ?? null;
  }
  return { sendId: send.id, sequenceId, sentAt: send.sent_at, via: "company_match" };
}

async function run() {
  console.log(`[backfill-wl-attribution] dry_run=${DRY_RUN} limit=${LIMIT}`);
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select(
      "id, email, company_id, created_at, last_login_at, diagnostics_first_at",
    )
    .eq("workspace_id", WORKSPACE_ID)
    .eq("source", "wl-app")
    .not("wl_user_id", "is", null)
    .is("attributed_to_send_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const eligible = (contacts ?? []).slice(0, LIMIT);
  console.log(`[backfill-wl-attribution] candidates=${eligible.length}`);

  let stampedSelf = 0;
  let stampedCompany = 0;
  let stampedNone = 0;

  for (const c of eligible) {
    // signup_at proxy: earliest known wl-app signal. Skip contacts we
    // can't bound — without a signup time we can't tell if a send
    // happened before or after the user signed up.
    const signupAt = c.last_login_at ?? c.diagnostics_first_at ?? null;
    let attr = await fetchSelfAttribution(c.id, signupAt);
    if (!attr && c.company_id) {
      attr = await fetchCompanyAttribution(c.company_id, c.id, signupAt);
    }
    if (!attr) {
      stampedNone++;
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `[would-stamp] contact=${c.id} email=${c.email} via=${attr.via} send=${attr.sendId} seq=${attr.sequenceId ?? "—"}`,
      );
    } else {
      const { error: upErr } = await supabase
        .from("contacts")
        .update({
          attributed_to_send_id: attr.sendId,
          attributed_to_sequence_id: attr.sequenceId,
          attributed_via: attr.via,
          attributed_at: attr.sentAt,
        })
        .eq("id", c.id);
      if (upErr) {
        console.error(`[error] contact=${c.id} ${upErr.message}`);
        continue;
      }
    }
    if (attr.via === "self_email_merge") stampedSelf++;
    else stampedCompany++;
  }

  console.log(
    `[backfill-wl-attribution] done. self=${stampedSelf} company=${stampedCompany} none=${stampedNone}`,
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
