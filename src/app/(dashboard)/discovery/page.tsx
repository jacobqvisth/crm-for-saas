import { Suspense } from "react";
import { DiscoveryPageClient } from "@/components/discovery/discovery-page-client";

export default function DiscoveryPage() {
  return (
    <Suspense>
      <DiscoveryPageClient />
    </Suspense>
  );
}
