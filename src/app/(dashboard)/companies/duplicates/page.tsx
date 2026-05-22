import { Suspense } from "react";
import { DuplicatesPageClient } from "@/components/companies/duplicates-page-client";

export const dynamic = "force-dynamic";

export default function CompaniesDuplicatesPage() {
  return (
    <Suspense>
      <DuplicatesPageClient />
    </Suspense>
  );
}
