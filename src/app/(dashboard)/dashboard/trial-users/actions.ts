"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshTrialUsersAction() {
  // The trials themselves are Stripe subscriptions: the trial window, the
  // status and the ever_paid / first_paid_at flags all come from that sync, and
  // it is also what writes metadata.trial_start, which turns every estimated
  // trial window on this page into an exact one. The outreach columns read the
  // CRM tables live and the product columns come from the core_app export,
  // which its own pages refresh.
  await runSourceSync("stripe");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/trial-users");
}
