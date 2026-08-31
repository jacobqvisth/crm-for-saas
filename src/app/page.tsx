import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/config/tenants";
import { resolveHomeRoute } from "@/config/home-route";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Not "/dashboard": that route belongs to the `product_analytics` feature,
    // which some tenants do not have, and sending them there lands them on a
    // 404 the moment they sign in. Wrenchlane has it, so this still resolves
    // to "/dashboard" there. See src/config/home-route.ts.
    const tenant = getTenant();
    redirect(resolveHomeRoute((key) => tenant.features[key]));
  } else {
    redirect("/login");
  }
}
