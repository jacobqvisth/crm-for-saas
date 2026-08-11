"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshCacLtvAction() {
  // The page reads workshop/subscription state and diagnostics from the
  // core_app export, and spend/signups from google_ads. Both are worth forcing;
  // the rest of the sources the page touches (ga4, search_console) ride along
  // with the hourly cron and are not on the critical path for the CAC math.
  await runSourceSync("core_app");
  await runSourceSync("google_ads");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/cac-ltv");
}
