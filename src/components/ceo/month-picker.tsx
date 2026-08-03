import Link from "next/link";
import type { MonthOption } from "@/lib/ceo/data/monthly-review";

type Props = {
  options: MonthOption[];
  selected: string;
  /** Preserved so switching month doesn't silently drop an active country filter. */
  country: string | null;
};

/**
 * Month selector for the monthly review.
 *
 * Only completed months are offered. The whole point of this page is a
 * like-for-like month comparison, and a month in progress is not comparable to
 * a finished one, which is the mistake that made 12 days of July 2026 read as
 * if it were the whole month.
 *
 * Plain links rather than a client-side select so the page stays a server
 * component and each month is a shareable, bookmarkable URL.
 */
export function MonthPicker({ options, selected, country }: Props) {
  const href = (month: string) => {
    const params = new URLSearchParams({ month });
    if (country) params.set("country", country);
    return `/dashboard/monthly-review?${params.toString()}`;
  };

  return (
    <nav className="month-picker" aria-label="Select month">
      {options.map((option) => {
        const isSelected = option.key === selected;
        return (
          <Link
            key={option.key}
            href={href(option.key)}
            className={
              isSelected ? "month-picker-item is-selected" : "month-picker-item"
            }
            aria-current={isSelected ? "page" : undefined}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
