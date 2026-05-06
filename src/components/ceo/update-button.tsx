"use client";

import { useFormStatus } from "react-dom";

type UpdateButtonProps = {
  label?: string;
  pendingLabel?: string;
};

export function UpdateButton({
  label = "Update",
  pendingLabel = "Updating…",
}: UpdateButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`update-button${pending ? " is-pending" : ""}`}
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
