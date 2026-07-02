"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshActiveUsersAction() {
  // Refresh the first-party app data (diagnostics + users) that this page
  // joins against. GA4 is read live each render, so a core_app sync is the
  // meaningful refresh here.
  await runSourceSync("core_app");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/active-users");
}
