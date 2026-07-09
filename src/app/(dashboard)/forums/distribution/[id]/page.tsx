import { ThreadClient } from "@/components/forums/thread-client";

export const metadata = {
  title: "Forums · Thread",
};

export default async function ForumsThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ThreadClient recId={id} />;
}
