"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshGoogleAdsUsersAction() {
  // Attribution rows come from the ga4_attribution report; everything they
  // join against (users, workshops, subs, diagnostics) comes from core_app.
  // Forcing both keeps the page's two halves the same age.
  await runSourceSync("ga4_attribution");
  await runSourceSync("core_app");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/google-ads-users");
}
