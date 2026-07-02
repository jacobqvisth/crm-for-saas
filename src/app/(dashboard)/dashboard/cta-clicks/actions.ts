"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";

export async function refreshCtaClicksAction() {
  // No background sync — the page reads live from GA4 each render. The
  // action exists so the standard UpdateButton can force a refetch by
  // busting the CEO data cache for this route.
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/cta-clicks");
}
