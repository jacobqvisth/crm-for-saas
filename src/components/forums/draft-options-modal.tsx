"use client";

// "How should this draft be written" asked per post, at the moment you click
// Draft reply (Jacob 2026-08-04). Answer-posts used to carry one always-visible
// panel at the top of the page whose settings applied to every draft on the
// page; the choice really belongs to the individual post you're answering, so
// the same shared GenerationOptions panel now opens in a modal per click.
// The caller keeps the last-used options and passes them back in as `initial`,
// so picking the same style twice in a row stays one click.

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { GenerationOptions } from "./generation-options";
import type { ForumGenerationOptions } from "@/lib/forums/generation-options";

export function DraftOptionsModal({
  open,
  onClose,
  onConfirm,
  initial,
  postTitle,
  confirmLabel = "Draft reply",
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  // Fired with the options the user picked for this one draft.
  onConfirm: (options: ForumGenerationOptions) => void;
  initial: ForumGenerationOptions;
  // The question being answered, so it's obvious which post this applies to.
  postTitle?: string | null;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const [options, setOptions] = useState<ForumGenerationOptions>(initial);

  // Re-seed every time the modal opens so each post starts from the last-used
  // style rather than whatever was left over from a previous post's edits.
  useEffect(() => {
    if (open) setOptions(initial);
    // `initial` is only read at open time on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Draft options" maxWidth="max-w-2xl">
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        {postTitle && (
          <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Answering
            </p>
            <p className="mt-0.5 line-clamp-2 text-sm font-medium text-slate-700">{postTitle}</p>
          </div>
        )}
        <GenerationOptions value={options} onChange={setOptions} />
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(options)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
