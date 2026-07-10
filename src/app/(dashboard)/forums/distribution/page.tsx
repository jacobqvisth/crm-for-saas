import { redirect } from "next/navigation";

// Distribution merged into the unified Posts board. Keep this route as a
// permanent deep-link into the "Topic campaigns" view.
export default function ForumsDistributionPage() {
  redirect("/forums?view=topics");
}
