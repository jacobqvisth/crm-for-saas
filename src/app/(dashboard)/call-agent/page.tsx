import CallAgentClient from "./call-agent-client";

// Preview deploys lack production-scoped Supabase env vars; keep this page
// out of the prerender pass (the /calls/feedback lesson).
export const dynamic = "force-dynamic";

export default function CallAgentPage() {
  return <CallAgentClient />;
}
