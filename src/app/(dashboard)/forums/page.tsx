import { ForumsHub, type HubView } from "@/components/forums/forums-hub";

export const metadata = {
  title: "Forums · Posts",
};

const ALLOWED: HubView[] = ["all", "topics", "diagnostics"];

// The unified Posts board. ?view= deep-links a starting tab (e.g. the old
// /forums/distribution route redirects here with ?view=topics).
export default async function ForumsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const initialView = ALLOWED.includes(view as HubView) ? (view as HubView) : "topics";
  return <ForumsHub initialView={initialView} />;
}
