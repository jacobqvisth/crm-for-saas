"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";
import { syncPayingCustomers } from "@/lib/ceo/paying-customers/sync";

export async function refreshPayingCustomersAction() {
  // Two sources, because the page's whole point is comparing them. Stripe
  // decides who has actually been charged; the Google Ads pull decides what
  // Google believes happened. Refreshing only one would redraw half the
  // comparison and leave the other half stale, which is worse than stale.
  //
  // A short Google window: Update is pressed to see recent movement, and
  // re-pulling a year of daily conversion rows to answer that is wasted work.
  await Promise.all([
    runSourceSync("stripe"),
    syncPayingCustomers({ lookbackDays: 45 }),
  ]);
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/paying-customers");
}
