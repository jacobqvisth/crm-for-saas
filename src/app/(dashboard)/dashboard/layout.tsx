// Scopes the legacy analytics stylesheet to the /dashboard subtree. The
// sidebar + WorkspaceProvider come from the parent (dashboard) layout; this
// nested layout only pulls in the (class-scoped) analytics CSS that the moved
// analytics pages rely on.
import "./ceo-legacy.css";

export default function DashboardSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
