import { Sidebar } from "@/components/sidebar";
import { WorkspaceProvider } from "@/lib/hooks/use-workspace";
import { WebrtcPresence } from "@/components/calls/webrtc-presence";
import { CallProvider } from "@/components/calls/call-provider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      {/* App-level call session: the live drawer + "call in progress" pill live
          here so they survive navigating between pages mid-call. */}
      <CallProvider>
        <div className="flex min-h-screen bg-slate-50">
          <Sidebar />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
        {/* Persistent WebRTC presence so callbacks can ring this browser. */}
        <WebrtcPresence />
      </CallProvider>
    </WorkspaceProvider>
  );
}
