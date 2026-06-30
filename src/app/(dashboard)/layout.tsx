import { Sidebar } from "@/components/sidebar";
import { WorkspaceProvider } from "@/lib/hooks/use-workspace";
import { WebrtcPresence } from "@/components/calls/webrtc-presence";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
      {/* Persistent WebRTC presence so callbacks can ring this browser. */}
      <WebrtcPresence />
    </WorkspaceProvider>
  );
}
