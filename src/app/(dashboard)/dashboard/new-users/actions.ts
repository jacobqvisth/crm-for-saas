"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshNewUsersAction() {
  await runSourceSync("core_app");
  await runSourceSync("app_store_connect");
  await runSourceSync("ga4");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/new-users");
}
