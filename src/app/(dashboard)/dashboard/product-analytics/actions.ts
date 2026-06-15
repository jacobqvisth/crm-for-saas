"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";

export async function refreshProductAnalyticsAction() {
  // PostHog is queried live each render (cached 5 min via CEO_CACHE_OPTIONS),
  // so refreshing just means busting the cache — no source sync to run.
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/product-analytics");
}
