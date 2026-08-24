"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshCampaignsAction() {
  // Spend, clicks and impressions come from the google_ads source (GA4's
  // linked-Ads dimensions). The per-campaign user counts come from
  // ga4_attribution. Force both so the two halves of the page are the same age.
  await runSourceSync("google_ads");
  await runSourceSync("ga4_attribution");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/campaigns");
}
