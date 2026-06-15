"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshPlanStatsAction() {
  // Plan membership (workshops), logins and feature counters all come from the
  // core_app S3 export, so that's the only sync worth forcing here.
  await runSourceSync("core_app");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/plan-stats");
}
