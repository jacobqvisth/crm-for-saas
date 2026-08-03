"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshMonthlyReviewAction() {
  // core_app carries the users / workshops / diagnostics / feature-usage rows
  // this page is built on; google_ads and ga4 carry the acquisition side.
  await runSourceSync("core_app");
  await runSourceSync("google_ads");
  await runSourceSync("ga4");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/monthly-review");
}
