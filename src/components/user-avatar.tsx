// Shared circular user avatar: shows the uploaded profile picture when present,
// otherwise a clean initials fallback. Used in the sidebar and the call worklist.

function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "")
    .split(" ")
    .map((n) => n.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return parts || "?";
}

export function UserAvatar({
  name,
  src,
  className = "h-7 w-7",
  textClassName = "text-xs",
}: {
  name?: string | null;
  src?: string | null;
  /** Tailwind size (and any extra) classes for the outer element, e.g. "h-6 w-6". */
  className?: string;
  /** Tailwind classes for the initials text. */
  textClassName?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? "User"}
        className={`${className} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <div
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-indigo-100`}
      aria-label={name ?? undefined}
    >
      <span className={`${textClassName} font-semibold text-indigo-700`}>
        {initialsOf(name)}
      </span>
    </div>
  );
}
