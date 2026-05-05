"use server";

import { revalidatePath } from "next/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshAppUsageAction() {
  await runSourceSync("core_app");
  revalidatePath("/dashboard/app-usage");
}
