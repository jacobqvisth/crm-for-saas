"use client";

import { useRef, useState } from "react";
import type { RoadmapItem } from "@/lib/roadmap/types";
import type { TimelineRange } from "@/lib/roadmap/scale";
import { barGeometry, parseDay, addDays, toISODate, dayDiff } from "@/lib/roadmap/scale";
import { colorClasses } from "@/lib/roadmap/colors";

type DragMode = "move" | "resize-left" | "resize-right";

interface RoadmapBarProps {
  item: RoadmapItem;
  range: TimelineRange;
  pxPerDay: number;
  /** Color token inherited from the swimlane, unless the item overrides it. */
  groupColor: string;
  selected: boolean;
  /** Commit new inclusive dates (YYYY-MM-DD) after a drag/resize. */
  onChangeDates: (id: string, startDate: string, endDate: string) => void;
  /** Click without dragging → open the detail panel. */
  onSelect: (id: string) => void;
}

const DRAG_THRESHOLD_PX = 4;

export function RoadmapBar({
  item,
  range,
  pxPerDay,
  groupColor,
  selected,
  onChangeDates,
  onSelect,
}: RoadmapBarProps) {
  const { left, width } = barGeometry(item, range, pxPerDay);
  const colors = colorClasses(item.color ?? groupColor);

  // Transient pixel offsets applied while dragging, committed on pointer up.
  const [delta, setDelta] = useState<{ dLeft: number; dWidth: number } | null>(null);
  const drag = useRef<{
    mode: DragMode;
    startX: number;
    moved: number;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const handle = (e.target as HTMLElement).dataset.handle as
      | "left"
      | "right"
      | undefined;
    const mode: DragMode = handle === "left" ? "resize-left" : handle === "right" ? "resize-right" : "move";
    drag.current = { mode, startX: e.clientX, moved: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    d.moved = Math.max(d.moved, Math.abs(dx));
    // Snap the live preview to whole days so the bar tracks the grid.
    const snapped = Math.round(dx / pxPerDay) * pxPerDay;
    if (d.mode === "move") {
      setDelta({ dLeft: snapped, dWidth: 0 });
    } else if (d.mode === "resize-left") {
      const clamped = Math.min(snapped, width - pxPerDay); // keep >= 1 day
      setDelta({ dLeft: clamped, dWidth: -clamped });
    } else {
      const clamped = Math.max(snapped, -(width - pxPerDay));
      setDelta({ dLeft: 0, dWidth: clamped });
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }

    // Treat a near-stationary press as a click → open the panel.
    if (d.moved < DRAG_THRESHOLD_PX) {
      setDelta(null);
      onSelect(item.id);
      return;
    }

    const dx = e.clientX - d.startX;
    const days = Math.round(dx / pxPerDay);
    setDelta(null);
    if (days === 0) return;

    const start = parseDay(item.start_date);
    const end = parseDay(item.end_date);

    if (d.mode === "move") {
      onChangeDates(item.id, toISODate(addDays(start, days)), toISODate(addDays(end, days)));
    } else if (d.mode === "resize-left") {
      // Clamp so start never passes end (min 1-day duration).
      const maxShift = dayDiff(start, end);
      const shift = Math.min(days, maxShift);
      onChangeDates(item.id, toISODate(addDays(start, shift)), item.end_date);
    } else {
      const minShift = -dayDiff(start, end);
      const shift = Math.max(days, minShift);
      onChangeDates(item.id, item.start_date, toISODate(addDays(end, shift)));
    }
  }

  const renderLeft = left + (delta?.dLeft ?? 0);
  const renderWidth = Math.max(width + (delta?.dWidth ?? 0), pxPerDay);

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(item.id);
        }
      }}
      style={{ left: renderLeft, width: renderWidth }}
      className={`group/bar absolute top-1.5 bottom-1.5 flex items-center rounded-md border px-2 text-xs font-medium shadow-sm select-none touch-none cursor-grab active:cursor-grabbing ${colors.bar} ${
        selected ? "ring-2 ring-indigo-500 ring-offset-1" : ""
      }`}
      title={item.title}
    >
      {/* left resize handle */}
      <span
        data-handle="left"
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l-md opacity-0 group-hover/bar:opacity-100"
      />
      <span className="truncate pointer-events-none">{item.title}</span>
      {/* right resize handle */}
      <span
        data-handle="right"
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r-md opacity-0 group-hover/bar:opacity-100"
      />
    </div>
  );
}
