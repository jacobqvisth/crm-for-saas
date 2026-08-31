import type { Metadata } from "next";
import { Toaster } from "react-hot-toast";
import { getTenant } from "@/config/tenants";
import "./globals.css";

// The tab title and meta description, per tenant.
//
// `metadata` was a static object with "CRM for SaaS" written into it, so every
// customer would have shared one title. It is a plain function now because
// getTenant() reads TENANT_SLUG, which is a deploy-time value.
//
// For Wrenchlane this resolves to exactly the two strings that were here
// before — see the note on `branding` in src/config/tenants/wrenchlane.ts for
// why its title is still "CRM for SaaS" rather than "Wrenchlane".
export function generateMetadata(): Metadata {
  const { branding } = getTenant().identity;
  return {
    title: branding.browserTitle,
    description: branding.browserDescription,
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: "#fff",
              color: "#0f172a",
              border: "1px solid #e2e8f0",
            },
          }}
        />
      </body>
    </html>
  );
}
