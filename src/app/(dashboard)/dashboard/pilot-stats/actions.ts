"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshPilotStatsAction() {
  await runSourceSync("core_app");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/pilot-stats");
}
