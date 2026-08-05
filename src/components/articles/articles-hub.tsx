"use client";

import { useState } from "react";
import { Newspaper, PenLine, Library, Globe } from "lucide-react";
import { StudioClient } from "./studio-client";
import { LibraryClient } from "./library-client";

export type ArticlesView = "studio" | "library" | "published";

const VIEWS: Array<{ key: ArticlesView; label: string; icon: typeof PenLine; hint: string }> = [
  { key: "studio", label: "Studio", icon: PenLine, hint: "Write something new" },
  { key: "library", label: "Library", icon: Library, hint: "Drafts and everything not yet live" },
  { key: "published", label: "Published", icon: Globe, hint: "Live on wrenchlane.com or posted elsewhere" },
];

export function ArticlesHub({ initialView = "studio" }: { initialView?: ArticlesView }) {
  const [view, setView] = useState<ArticlesView>(initialView);
  // Bumped after a successful generate so the Library refetches when opened.
  const [libraryKey, setLibraryKey] = useState(0);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-2 flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <Newspaper className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Articles</h1>
          <p className="text-sm text-slate-500">
            Turn real diagnostics and our own platform data into posts and articles you can copy
            straight out. Every number is traceable back to where it came from.
          </p>
        </div>
      </div>

      <div className="mt-5 inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = view === v.key;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              title={v.hint}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {v.label}
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {view === "studio" ? (
          <StudioClient onSaved={() => setLibraryKey((k) => k + 1)} />
        ) : (
          <LibraryClient key={`${view}-${libraryKey}`} published={view === "published"} />
        )}
      </div>
    </div>
  );
}
