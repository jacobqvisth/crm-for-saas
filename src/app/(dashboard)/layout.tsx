import { Sidebar } from "@/components/sidebar";
import { FEATURES, type FeatureKey } from "@/config/features";
import { getTenantConfig } from "@/lib/tenant-config/resolve";
import { SessionWatcher } from "@/components/auth/session-watcher";
import { WorkspaceProvider } from "@/lib/hooks/use-workspace";
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

  return (
    <WorkspaceProvider>
      {/* Explains and recovers a session that dies while a tab is open —
          otherwise every fetch on the page starts failing with a bare 401. */}
      <SessionWatcher />
      {/* App-level call session: the live drawer + "call in progress" pill live
          here so they survive navigating between pages mid-call. */}
      <CallProvider>
        <div className="flex min-h-screen bg-slate-50">
          <Sidebar enabledFeatures={enabledFeatures} />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
        {/* Persistent WebRTC presence so callbacks can ring this browser. */}
        <WebrtcPresence />
      </CallProvider>
    </WorkspaceProvider>
  );
}
