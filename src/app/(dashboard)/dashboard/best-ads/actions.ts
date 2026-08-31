"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { syncBestAds } from "@/lib/ceo/best-ads/sync";

export async function refreshBestAdsAction() {
  // Straight to the asset sync rather than through runSourceSync: this page
  // reads its own three tables and nothing in dashboard_metric_snapshots, so
  // running a registered source connector would refresh data it never looks at
  // and leave the asset tables exactly as stale as they were.
  //
  // A shorter window than the cron's. Update is pressed to see today's numbers,
  // and re-pulling nearly three years of daily rows to answer that would take
  // most of a minute for no gain — history does not change.
  await syncBestAds({ lookbackDays: 45 });
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/best-ads");
}
