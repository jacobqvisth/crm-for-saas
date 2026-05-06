"use server";

import { revalidatePath } from "next/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshPilotStatsAction() {
  await runSourceSync("core_app");
  revalidatePath("/dashboard/pilot-stats");
}
