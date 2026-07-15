import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SHARED_FORUMS_WORKSPACE_ID } from "@/lib/forums/server";
import { getForumStats } from "@/lib/forums/stats";
import { getTractionStats, getTeamStats, getReachStats } from "@/lib/forums/stats-detail";
import { StatsShell, normalizeStatsView } from "@/components/forums/stats-shell";
import { OverviewBody } from "@/components/forums/stats-view";
import { TractionView } from "@/components/forums/stats-traction-view";
import { TeamView } from "@/components/forums/stats-team-view";
import { ReachView } from "@/components/forums/stats-reach-view";

export const metadata = {
  title: "Forums · Stats",
};

const SUBTITLE: Record<string, string> = {
  overview: "Everything the team has posted, and how it's doing — across posts, placements, answers and the gap log.",
  traction: "What's landing — top posts, engagement by subreddit, and whether mentioning Wrenchlane costs upvotes.",
  team: "Who's doing the work — posts, answers and comments by each member of the roster.",
  reach: "Wrenchlane's footprint on Reddit — estimated reach, brand mentions and sentiment.",
};

// Read-only rollup of everything the Forums feature tracks. Split into
// Overview / Traction / Team / Reach sub-views via ?view=; each is server-
// rendered and only loads the data its view needs.
export default async function ForumsStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const view = normalizeStatsView((await searchParams).view);
  const ws = SHARED_FORUMS_WORKSPACE_ID;

  let body: React.ReactNode;
  if (view === "traction") {
    body = <TractionView data={await getTractionStats(supabase, ws)} />;
  } else if (view === "team") {
    body = <TeamView data={await getTeamStats(supabase, ws)} />;
  } else if (view === "reach") {
    body = <ReachView data={await getReachStats(supabase, ws)} />;
  } else {
    body = <OverviewBody stats={await getForumStats(supabase, ws)} />;
  }

  return (
    <StatsShell view={view} subtitle={SUBTITLE[view]}>
      {body}
    </StatsShell>
  );
}
