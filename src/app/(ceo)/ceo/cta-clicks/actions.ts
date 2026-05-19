"use server";

import { revalidatePath } from "next/cache";

export async function refreshCtaClicksAction() {
  // No background sync — the page reads live from GA4 each render. The
  // action exists so the standard UpdateButton can force a refetch by
  // invalidating Next's cache for this route.
  revalidatePath("/ceo/cta-clicks");
}
