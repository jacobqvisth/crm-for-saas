import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SHARED_FORUMS_WORKSPACE_ID } from "@/lib/forums/server";
import { getForumStats } from "@/lib/forums/stats";
import { StatsView } from "@/components/forums/stats-view";

export const metadata = {
  title: "Forums · Stats",
};

// Read-only rollup of everything the Forums feature already tracks (posts,
// distribution placements, answer posts, traction, team contributions, gap
// log). Server-rendered — no client fetch — since nothing here is interactive.
export default async function ForumsStatsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const stats = await getForumStats(supabase, SHARED_FORUMS_WORKSPACE_ID);
  return <StatsView stats={stats} />;
}
