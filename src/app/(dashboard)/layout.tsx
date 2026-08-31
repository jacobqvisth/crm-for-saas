import { Sidebar } from "@/components/sidebar";
import { FEATURES, type FeatureKey } from "@/config/features";
import { getTenantConfig } from "@/lib/tenant-config/resolve";
// Branding comes from the COMPILED config, not the resolved one. Logos are
// files in this deployment, so a control-plane pull could not change them
// without a deploy anyway, and a remote value that pointed at a missing asset
// would break the sidebar of a live tenant for the length of a cache TTL.
import { getTenant } from "@/config/tenants";
import { SessionWatcher } from "@/components/auth/session-watcher";
import { WorkspaceProvider } from "@/lib/hooks/use-workspace";
import { FeaturesProvider } from "@/lib/hooks/use-features";
import { TenantBrandProvider } from "@/lib/hooks/use-tenant-brand";
import { WebrtcPresence } from "@/components/calls/webrtc-presence";
import { CallProvider } from "@/components/calls/call-provider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved here, in a server component, because the sidebar is a client
  // component and cannot read TENANT_SLUG. One resolution per request, handed
  // down, so nav and routing can never disagree about what is enabled.
  //
  // Since phase 05 this goes through the full live/cache/compiled ladder, so a
  // toggle in the admin console removes the nav item within one TTL instead of
  // at the next deploy. getTenantConfig() is request-memoized, so rendering a
  // page with forty components resolves once. It cannot throw: an unreachable
  // control plane falls back to the cache, and then to the compiled defaults.
  const cfg = await getTenantConfig();
  const enabledFeatures = FEATURES.filter((f) => cfg.features[f.key] === true).map(
    (f) => f.key as FeatureKey,
  );

  // Identity is compiled, not resolved. See the import comment above.
  const { identity } = getTenant();

  return (
    <WorkspaceProvider>
      {/* The same resolution the sidebar gets, handed to client components that
          need to hide a control rather than a whole page — the sequence
          builder's LinkedIn steps are the first. Presentation only: the server
          gates these features again wherever they do work. */}
      <FeaturesProvider enabledFeatures={enabledFeatures}>
        {/* The tenant's own name, for copy and placeholders inside client
            components. Resolved here because TENANT_SLUG does not exist in the
            browser, where getTenant() would silently return Wrenchlane. */}
        <TenantBrandProvider
          brand={{
            displayName: identity.displayName,
            legalName: identity.legalName,
            supportEmail: identity.supportEmail,
          }}
        >
          {/* Explains and recovers a session that dies while a tab is open —
              otherwise every fetch on the page starts failing with a bare 401. */}
          <SessionWatcher />
          {/* App-level call session: the live drawer + "call in progress" pill live
              here so they survive navigating between pages mid-call. */}
          <CallProvider>
            <div className="flex min-h-screen bg-slate-50">
              <Sidebar
                enabledFeatures={enabledFeatures}
                branding={identity.branding}
              />
              <main className="flex-1 overflow-auto">{children}</main>
            </div>
            {/* Persistent WebRTC presence so callbacks can ring this browser. */}
            <WebrtcPresence />
          </CallProvider>
        </TenantBrandProvider>
      </FeaturesProvider>
    </WorkspaceProvider>
  );
}
