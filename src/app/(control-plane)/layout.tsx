// The control-plane console has no CRM chrome: no sidebar, no workspace
// provider, no call session. It is a different application that happens to
// share a codebase, so that the console and the tenant apps can never drift
// apart on what a feature key means.

export default function ControlPlaneLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
