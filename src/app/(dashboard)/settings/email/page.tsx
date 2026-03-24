import { Suspense } from "react";
import { EmailSettingsClient } from "@/components/settings/email-settings-client";

export default function EmailSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 max-w-4xl mx-auto">
          <div className="h-8 w-48 animate-pulse rounded bg-slate-100 mb-4" />
          <div className="h-4 w-96 animate-pulse rounded bg-slate-100" />
        </div>
      }
    >
      <EmailSettingsClient />
    </Suspense>
  );
}
