"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshToplistsAction() {
  // Top cars come from first-party diagnostics; GA4 (top-user engagement) is
  // read live each render, so a core_app sync is the meaningful refresh here.
  await runSourceSync("core_app");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/ceo/toplists");
}
