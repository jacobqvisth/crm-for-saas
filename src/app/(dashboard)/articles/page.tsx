import { ArticlesHub, type ArticlesView } from "@/components/articles/articles-hub";

export const metadata = {
  title: "Articles",
};

const ALLOWED: ArticlesView[] = ["studio", "library"];

// Thin shell on purpose. All data is fetched client-side through /api/articles/*
// so this page never prerenders a data read, which is what breaks preview builds
// on the sibling dashboard pages.
export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const initialView = ALLOWED.includes(view as ArticlesView)
    ? (view as ArticlesView)
    : "studio";
  return <ArticlesHub initialView={initialView} />;
}
