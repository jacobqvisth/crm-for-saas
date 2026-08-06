/**
 * One-off: enroll the in-product star raters into the Trustpilot AFS trigger
 * sequence. Goes through enrollContacts() (the same function the UI and the
 * /api/sequences/enroll route use) with an injected service client, so every
 * guard still runs: unsubscribes, bounces, duplicate enrollment, prior-outreach
 * tags, and the customer check.
 *
 * Rater list came from PostHog $autocapture MuiRating clicks joined to
 * s3://codeoc-dashboard-prod/latest/user_stats.json.gz on Cognito sub, plus two
 * raters that only appear in the #reviews Slack channel (PostHog misses anyone
 * who declined tracking).
 *
 * Deliberately includes low scorers. Trustpilot's guidelines for businesses
 * prohibit inviting only customers who had a good experience, so filtering to
 * 4-plus stars here would be review gating.
 *
 * Run: npx tsx --env-file=.env.local scripts/enroll-trustpilot-raters.ts
 */
import { createServiceClient } from "../src/lib/supabase/service";
import { enrollContacts } from "../src/lib/sequences/enrollment";

const SEQUENCE_ID = "2fb382de-bc6d-43a5-a00c-b0df134da403";
const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";
const JACOB_SENDER_ID = "fef8f54e-b990-4317-96ee-fe2258984291";

// email -> star rating, for reporting only.
const RATERS: Record<string, number> = {
  "m.safdari@pbz.se": 5,
  "messe_k@hotmail.com": 5,
  "gorgo_92@hotmail.com": 5,
  "centruldediagnozaauto@gmail.com": 5,
  "naidenvadimov@gmail.com": 5,
  "filimoncm0912@gmail.com": 5,
  "info@meyersaab.com": 5,
  "image7092@gmail.com": 5,
  "satra@minbil.se": 5,
  "tyreso@bileliten.se": 5, // Slack only
  "stuart@ccmhelp.co.uk": 5, // Slack only
  "umea89@euromaster.com": 4,
  "adriansilverbark@hotmail.com": 4,
  "niklashahne06@gmail.com": 3,
  "info@pbz.se": 3,
  "info@montanabil.se": 1,
  "aditivu@yahoo.com": 1,
  "janusasv1988@gmail.com": 1,
};

async function main() {
  const supabase = createServiceClient();
  const emails = Object.keys(RATERS);

  // Case-INSENSITIVE lookup, one query per address. A single .in() on `email`
  // is case-sensitive and silently missed three raters whose rows are stored
  // as "Image7092@gmail.com", "NIKLASHAHNE06@GMAIL.COM" and "Aditivu@yahoo.com"
  // — the addresses arrive from the S3 export with whatever casing the user
  // typed at signup. Missing contacts look identical to absent contacts, so
  // this failed quietly the first time.
  const found = new Map<string, string>();
  for (const email of emails) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, email")
      .eq("workspace_id", WORKSPACE_ID)
      .ilike("email", email)
      .limit(1);
    if (error) throw new Error(`contact lookup failed for ${email}: ${error.message}`);
    const row = data?.[0];
    if (row?.email) found.set(row.email.toLowerCase(), row.id);
  }

  const missing = emails.filter((e) => !found.has(e.toLowerCase()));
  if (missing.length) {
    console.log(`not found as contacts (${missing.length}):`, missing.join(", "));
  }

  const contactIds = [...found.values()];
  console.log(`resolved ${contactIds.length} of ${emails.length} contacts`);

  const result = await enrollContacts(
    {
      sequenceId: SEQUENCE_ID,
      contactIds,
      workspaceId: WORKSPACE_ID,
      senderAccountId: JACOB_SENDER_ID,
      // These are all existing wl-app users; without this the customer guard
      // skips every one of them.
      allowCustomers: true,
      // The first run surfaced the only two hits: messe_k@hotmail.com and
      // satra@minbil.se carry a `lemlist-csv` tag from the pre-CRM Lemlist era.
      // That guard exists to stop us re-running cold outreach on someone an old
      // tool already touched, which is not what this is: both are current
      // customers who rated us 5 stars (satra earlier today), and this is a
      // check-in from the founder. Overriding deliberately, having read the
      // reasons rather than blanket-setting it up front.
      allowAlreadySequenced: true,
    },
    supabase,
  );

  console.log("\nenrolled:", result.enrolled);
  console.log("skipped:", result.skipped);
  console.log("  already sequenced:", result.skippedAlreadySequenced);
  console.log("  customer guard:", result.skippedCustomer);
  if (result.reasons.length) {
    console.log("\nreasons:");
    for (const r of result.reasons) console.log("  -", r);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
