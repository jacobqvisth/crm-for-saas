"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshFreeUsersAction() {
  // Everything on this page (plans, users, diagnostics, feature counters)
  // comes from the core_app S3 export plus the Stripe fields it mirrors, so
  // core_app is the only sync worth forcing here.
  await runSourceSync("core_app");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/free-users");
}
