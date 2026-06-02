"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshAppUsageAction() {
  await runSourceSync("core_app");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/ceo/app-usage");
}
