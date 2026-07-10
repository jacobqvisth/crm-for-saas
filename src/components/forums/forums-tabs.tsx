import Link from "next/link";

// One shared tab bar for every Forums page so navigation is identical and
// stays in sync. Each page passes the tab it's on; that one renders as the
// active (non-link) tab.
export type ForumsTab = "generator" | "distribution" | "answers" | "gaps";

const TABS: Array<{ key: ForumsTab; label: string; href: string }> = [
  { key: "generator", label: "Post generator", href: "/forums" },
  { key: "distribution", label: "Distribution", href: "/forums/distribution" },
  { key: "answers", label: "Answer posts", href: "/forums/answers" },
  { key: "gaps", label: "Gap log", href: "/forums/gaps" },
];

export function ForumsTabs({ active }: { active: ForumsTab }) {
  return (
    <div className="mt-4 flex items-center gap-1 border-b border-slate-200">
      {TABS.map((t) =>
        t.key === active ? (
          <span
            key={t.key}
            aria-current="page"
            className="border-b-2 border-orange-500 px-3 py-2 text-sm font-medium text-orange-700"
          >
            {t.label}
          </span>
        ) : (
          <Link
            key={t.key}
            href={t.href}
            className="border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            {t.label}
          </Link>
        ),
      )}
    </div>
  );
}
