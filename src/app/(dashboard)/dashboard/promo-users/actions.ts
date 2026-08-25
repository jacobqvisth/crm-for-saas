"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { runSourceSync } from "@/lib/ceo/sync/runner";

export async function refreshPromoUsersAction() {
  // The promo grants themselves come from Stripe (coupons, promotion codes and
  // the invoice-level discount history), so Stripe is the sync worth forcing.
  // The outreach columns read the CRM tables live and the product columns come
  // from the core_app export, which its own pages refresh.
  await runSourceSync("stripe");
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/promo-users");
}
