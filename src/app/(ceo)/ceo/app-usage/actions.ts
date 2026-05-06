"use server";

import { revalidatePath } from "next/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshAppUsageAction() {
  await runSourceSync("core_app");
  revalidatePath("/ceo/app-usage");
}
