import { headers } from "next/headers";
import { tenantForHost } from "@/lib/tenants";
import LoginForm from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [headerList, params] = await Promise.all([headers(), searchParams]);
  // Resolve the tenant from the request host so the logged-out screen shows
  // only that brand — a WrenchLane user never sees that another company also
  // uses the platform.
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const tenant = tenantForHost(host);

  return (
    <LoginForm
      brandName={tenant.name}
      accent={tenant.accent}
      initial={tenant.initial}
      tagline={tenant.tagline}
      error={params?.error}
    />
  );
}
