"use server";

import { revalidatePath } from "next/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshNewUsersAction() {
  await runSourceSync("core_app");
  await runSourceSync("app_store_connect");
  await runSourceSync("ga4");
  revalidatePath("/dashboard/new-users");
}
