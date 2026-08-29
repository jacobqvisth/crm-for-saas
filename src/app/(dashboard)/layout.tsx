import { Sidebar } from "@/components/sidebar";
import { enabledFeatureKeys } from "@/lib/features";
import { SessionWatcher } from "@/components/auth/session-watcher";
import { WorkspaceProvider } from "@/lib/hooks/use-workspace";
import { WebrtcPresence } from "@/components/calls/webrtc-presence";
import { CallProvider } from "@/components/calls/call-provider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved here, in a server component, because the sidebar is a client
  // component and cannot read TENANT_SLUG. One resolution per request, handed
  // down, so nav and routing can never disagree about what is enabled.
  const enabledFeatures = enabledFeatureKeys();

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
