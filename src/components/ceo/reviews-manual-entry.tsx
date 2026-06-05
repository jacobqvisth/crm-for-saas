"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import {
  addIndividualReviewAction,
  addReviewSnapshotAction,
  type ReviewActionResult,
} from "@/app/(dashboard)/dashboard/reviews/actions";

type PlatformOption = {
  slug: string;
  name: string;
  supportsIndividualReviews: boolean;
};

const SOURCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "widget", label: "Widget" },
  { value: "api", label: "API" },
];

function SubmitButton({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button
      className={`update-button${pending ? " is-pending" : ""}`}
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function ReviewsManualEntry({
  platforms,
  todayIso,
}: {
  platforms: PlatformOption[];
  todayIso: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"snapshot" | "review">("snapshot");

  const snapshotForm = useRef<HTMLFormElement>(null);
  const reviewForm = useRef<HTMLFormElement>(null);

  const [snapState, snapAction, snapPending] = useActionState<
    ReviewActionResult | undefined,
    FormData
  >(addReviewSnapshotAction, undefined);
  const [revState, revAction, revPending] = useActionState<
    ReviewActionResult | undefined,
    FormData
  >(addIndividualReviewAction, undefined);

  useEffect(() => {
    if (!snapState) return;
    if (snapState.ok) {
      toast.success("Snapshot saved.");
      snapshotForm.current?.reset();
    } else if (snapState.error) {
      toast.error(snapState.error);
    }
  }, [snapState]);

  useEffect(() => {
    if (!revState) return;
    if (revState.ok) {
      toast.success("Review added.");
      reviewForm.current?.reset();
    } else if (revState.error) {
      toast.error(revState.error);
    }
  }, [revState]);

  const reviewPlatforms = platforms.filter((p) => p.supportsIndividualReviews);

  if (!open) {
    return (
      <button
        type="button"
        className="update-button"
        onClick={() => setOpen(true)}
      >
        + Add / update reviews
      </button>
    );
  }

  return (
    <section className="panel" style={{ marginTop: 4 }}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Manual entry</p>
          <h2>Add or update review data</h2>
          <p className="panel-description">
            Most review sites have no API — enter aggregate rating + count here.
            Re-entering a platform for the same date overwrites that day&rsquo;s
            snapshot.
          </p>
        </div>
        <button
          type="button"
          className="update-button"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>

      <div
        className="mb-4 flex flex-wrap gap-1"
        role="tablist"
        aria-label="Entry type"
      >
        {(["snapshot", "review"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === key
                ? "bg-indigo-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {key === "snapshot" ? "Rating + count" : "Individual review"}
          </button>
        ))}
      </div>

      {tab === "snapshot" ? (
        <form
          ref={snapshotForm}
          action={snapAction}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Platform
            <select
              name="platformSlug"
              required
              defaultValue={platforms[0]?.slug}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            >
              {platforms.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Rating (0–5)
            <input
              name="rating"
              type="number"
              step="0.1"
              min="0"
              max="5"
              placeholder="4.7"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Review count
            <input
              name="reviewCount"
              type="number"
              min="0"
              defaultValue={0}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            As of date
            <input
              name="capturedAt"
              type="date"
              required
              defaultValue={todayIso}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Source
            <select
              name="source"
              defaultValue="manual"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Note (optional)
            <input
              name="note"
              type="text"
              placeholder="e.g. quarterly check"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <SubmitButton pending={snapPending} label="Save snapshot" />
          </div>
        </form>
      ) : (
        <form
          ref={reviewForm}
          action={revAction}
          className="grid gap-3 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Platform
            <select
              name="platformSlug"
              required
              defaultValue={reviewPlatforms[0]?.slug ?? platforms[0]?.slug}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            >
              {platforms.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Rating (0–5)
            <input
              name="rating"
              type="number"
              step="0.1"
              min="0"
              max="5"
              placeholder="5"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600 sm:col-span-2">
            Title (optional)
            <input
              name="title"
              type="text"
              placeholder="Best diagnostic tool for our shop"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600 sm:col-span-2">
            Review text
            <textarea
              name="body"
              required
              rows={3}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Author name (optional)
            <input
              name="authorName"
              type="text"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Author company (optional)
            <input
              name="authorCompany"
              type="text"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Review URL (optional)
            <input
              name="reviewUrl"
              type="url"
              placeholder="https://…"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Review date (optional)
            <input
              name="reviewedAt"
              type="date"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <div className="sm:col-span-2">
            <SubmitButton pending={revPending} label="Add review" />
          </div>
        </form>
      )}
    </section>
  );
}
