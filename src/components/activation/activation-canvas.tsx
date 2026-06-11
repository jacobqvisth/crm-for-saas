"use client";

import { useEffect, useMemo, useRef } from "react";
import { Zap } from "lucide-react";
import type { ActivationBoard, ActivationItem } from "@/lib/activation/types";
import type { OffsetRange } from "@/lib/activation/scale";
import { weekTicks, dayTicks, totalWidth, xForDay } from "@/lib/activation/scale";
import { colorClasses } from "@/lib/roadmap/colors";
import { statusStyle } from "@/lib/activation/status";

// Miro-style timeline: one central axis (days since signup). Point touchpoints
// (day_start == day_end) float as cards above/below the axis, connected by a
// stem to a dot on their day. Multi-day touchpoints render as phase bands in a
// strip under the axis. Nothing is draggable — the canvas is a read-first
// overview; editing happens in the centered modal.

const CARD_W = 192;
const CARD_H = 66;
const CARD_GAP = 16;
const LEVEL_H = CARD_H + 14; // one stacking level per side
const BASE_STEM = 30; // axis → nearest card edge
const AXIS_LABELS_H = 46; // week + day labels under the axis line
const BAND_H = 28;
const BAND_GAP = 8;

interface PlacedPoint {
  item: ActivationItem;
  x: number; // day position on the axis (stem + dot)
  cardLeft: number; // clamped card left edge
  side: "above" | "below";
  level: number; // 1 = closest to the axis
}

interface PlacedSpan {
  item: ActivationItem;
  left: number;
  width: number;
  row: number;
  /** True when the span runs past the visible range and was cut off. */
  clipped: boolean;
}

interface ActivationCanvasProps {
  board: ActivationBoard;
  range: OffsetRange;
  pxPerDay: number;
  scrollToStartKey: number;
  /** When a scenario is active: item id → 1-based journey step number. */
  stepNumbers?: Map<string, number>;
  onSelectItem: (id: string) => void;
}

/** Greedy interval packing: lowest level whose last card doesn't overlap. */
function packLevels(
  points: { x: number }[],
  width: number,
  gap: number
): number[] {
  const levelEnds: number[] = [];
  return points.map((p) => {
    const left = p.x - width / 2;
    let level = levelEnds.findIndex((end) => end + gap <= left);
    if (level === -1) {
      level = levelEnds.length;
      levelEnds.push(p.x + width / 2);
    } else {
      levelEnds[level] = p.x + width / 2;
    }
    return level + 1;
  });
}

export function ActivationCanvas({
  board,
  range,
  pxPerDay,
  scrollToStartKey,
  stepNumbers,
  onSelectItem,
}: ActivationCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const width = totalWidth(range, pxPerDay);
  const weeks = useMemo(() => weekTicks(range, pxPerDay), [range, pxPerDay]);
  const days = useMemo(() => dayTicks(range, pxPerDay), [range, pxPerDay]);

  const groupById = useMemo(() => new Map(board.groups.map((g) => [g.id, g])), [board.groups]);

  // ---- placement ------------------------------------------------------------
  const { placedPoints, placedSpans, maxAbove, maxBelow, bandRows } = useMemo(() => {
    const points = board.items
      .filter((it) => it.day_start === it.day_end)
      .sort((a, b) => a.day_start - b.day_start || a.sort_order - b.sort_order);
    const spans = board.items
      .filter((it) => it.day_start !== it.day_end)
      .sort((a, b) => a.day_start - b.day_start || b.day_end - a.day_end);

    // Alternate cards above/below the axis, then pack each side into levels.
    const above: { item: ActivationItem; x: number }[] = [];
    const below: { item: ActivationItem; x: number }[] = [];
    points.forEach((item, i) => {
      const x = xForDay(item.day_start, pxPerDay) + pxPerDay / 2;
      (i % 2 === 0 ? above : below).push({ item, x });
    });
    const aboveLevels = packLevels(above, CARD_W, CARD_GAP);
    const belowLevels = packLevels(below, CARD_W, CARD_GAP);

    const place = (
      arr: { item: ActivationItem; x: number }[],
      levels: number[],
      side: "above" | "below"
    ): PlacedPoint[] =>
      arr.map((p, i) => ({
        item: p.item,
        x: p.x,
        cardLeft: Math.min(Math.max(p.x - CARD_W / 2, 4), width - CARD_W - 4),
        side,
        level: levels[i],
      }));

    // Pack spans into rows for the bottom strip.
    const rowEnds: number[] = [];
    const placedSpans: PlacedSpan[] = spans.map((item) => {
      const left = xForDay(item.day_start, pxPerDay);
      // Clip at the visible range so a long background span doesn't stretch
      // the axis; a "continues" marker is rendered on clipped bands.
      const visibleEnd = Math.min(item.day_end, range.end);
      const w = Math.max((visibleEnd - item.day_start + 1) * pxPerDay, pxPerDay);
      let row = rowEnds.findIndex((end) => end + 8 <= left);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(left + w);
      } else {
        rowEnds[row] = left + w;
      }
      return { item, left, width: w, row, clipped: item.day_end > range.end };
    });

    return {
      placedPoints: [...place(above, aboveLevels, "above"), ...place(below, belowLevels, "below")],
      placedSpans,
      maxAbove: Math.max(0, ...aboveLevels),
      maxBelow: Math.max(0, ...belowLevels),
      bandRows: rowEnds.length,
    };
  }, [board.items, pxPerDay, width, range.end]);

  const axisY = 16 + (maxAbove > 0 ? BASE_STEM + maxAbove * LEVEL_H : 24);
  const belowZoneH = maxBelow > 0 ? maxBelow * LEVEL_H + 12 : 8;
  const bandsTop = axisY + AXIS_LABELS_H + belowZoneH;
  const bandsH = bandRows > 0 ? bandRows * (BAND_H + BAND_GAP) + 8 : 0;
  const height = bandsTop + bandsH + 24;

  // Scroll back to day 0 on mount and when the "Day 0" button is pressed.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = 0;
  }, [scrollToStartKey]);

  const cardTop = (p: PlacedPoint) =>
    p.side === "above"
      ? axisY - BASE_STEM - (p.level - 1) * LEVEL_H - CARD_H
      : axisY + AXIS_LABELS_H + (p.level - 1) * LEVEL_H;

  const stemTop = (p: PlacedPoint) => (p.side === "above" ? cardTop(p) + CARD_H : axisY);
  const stemHeight = (p: PlacedPoint) =>
    p.side === "above" ? axisY - cardTop(p) - CARD_H : cardTop(p) - axisY;

  function dayLabel(item: ActivationItem): string {
    return item.day_start === item.day_end
      ? `Day ${item.day_start}`
      : `Day ${item.day_start}–${item.day_end}`;
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto border-t border-slate-200 bg-white">
      <div className="relative" style={{ width, height }}>
        {/* week gridlines */}
        <div className="pointer-events-none absolute inset-0">
          {weeks.map((w, i) => (
            <div
              key={`g-${i}`}
              className="absolute top-0 bottom-0 border-l border-slate-100"
              style={{ left: w.x }}
            />
          ))}
        </div>

        {/* axis line */}
        <div
          className="absolute left-0 right-0 h-0.5 bg-slate-300"
          style={{ top: axisY }}
        />
        {/* signup origin */}
        <div
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-indigo-600 shadow"
          style={{ left: 1, top: axisY + 1 }}
        />

        {/* axis labels: week band + day ticks */}
        {weeks.map((w, i) => (
          <div
            key={`wl-${i}`}
            className="absolute text-xs font-semibold text-slate-600"
            style={{ left: w.x + 6, top: axisY + 8 }}
          >
            {w.label}
          </div>
        ))}
        {days.map((d, i) => (
          <div key={`dl-${i}`}>
            <div
              className="absolute h-1.5 w-px bg-slate-300"
              style={{ left: d.x, top: axisY + 2 }}
            />
            <div
              className={`absolute text-[10px] ${
                d.label === "Day 0" ? "font-semibold text-indigo-600" : "text-slate-400"
              }`}
              style={{ left: d.x + 3, top: axisY + 26 }}
            >
              {d.label === "Day 0" ? "Day 0 · Signup" : d.label}
            </div>
          </div>
        ))}

        {/* stems + dots */}
        {placedPoints.map((p) => {
          const group = groupById.get(p.item.group_id);
          const colors = colorClasses(p.item.color ?? group?.color);
          return (
            <div key={`s-${p.item.id}`} className="pointer-events-none">
              <div
                className="absolute w-px bg-slate-300"
                style={{ left: p.x, top: stemTop(p), height: Math.max(stemHeight(p), 0) }}
              />
              <div
                className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm ${colors.dot}`}
                style={{ left: p.x, top: axisY + 1 }}
              />
            </div>
          );
        })}

        {/* point cards */}
        {placedPoints.map((p) => {
          const group = groupById.get(p.item.group_id);
          const colors = colorClasses(p.item.color ?? group?.color);
          const status = statusStyle(p.item.status);
          const step = stepNumbers?.get(p.item.id);
          const isEvent = p.item.trigger_type === "event";
          return (
            <button
              key={`c-${p.item.id}`}
              onClick={() => onSelectItem(p.item.id)}
              title={p.item.title}
              className={`absolute flex flex-col justify-center rounded-lg border px-2.5 py-1.5 text-left shadow-sm transition-shadow hover:shadow-md ${colors.bar} ${
                isEvent ? "border-dashed" : ""
              }`}
              style={{ left: p.cardLeft, top: cardTop(p), width: CARD_W, height: CARD_H }}
            >
              <span className="flex items-center gap-1.5">
                {step !== undefined && (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white">
                    {step}
                  </span>
                )}
                {status && (
                  <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} title={status.label} />
                )}
                {isEvent && <Zap className="h-3 w-3 shrink-0 opacity-70" />}
                <span className="truncate text-xs font-medium">{p.item.title}</span>
              </span>
              <span className="mt-0.5 truncate pl-0.5 text-[10px] opacity-70">
                {dayLabel(p.item)}
                {group ? ` · ${group.name}` : ""}
              </span>
            </button>
          );
        })}

        {/* span bands (phases strip under the axis) */}
        {placedSpans.map((s) => {
          const group = groupById.get(s.item.group_id);
          const colors = colorClasses(s.item.color ?? group?.color);
          const status = statusStyle(s.item.status);
          const step = stepNumbers?.get(s.item.id);
          const isEvent = s.item.trigger_type === "event";
          return (
            <button
              key={`b-${s.item.id}`}
              onClick={() => onSelectItem(s.item.id)}
              title={`${s.item.title} (${dayLabel(s.item)})`}
              className={`absolute flex items-center gap-1.5 rounded-md border px-2 text-left shadow-sm transition-shadow hover:shadow-md ${colors.bar} ${
                isEvent ? "border-dashed" : ""
              }`}
              style={{
                left: s.left,
                top: bandsTop + s.row * (BAND_H + BAND_GAP),
                width: s.width,
                height: BAND_H,
              }}
            >
              {step !== undefined && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white">
                  {step}
                </span>
              )}
              {status && (
                <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} title={status.label} />
              )}
              {isEvent && <Zap className="h-3 w-3 shrink-0 opacity-70" />}
              <span className="truncate text-[11px] font-medium">{s.item.title}</span>
              {s.clipped && (
                <span className="ml-auto shrink-0 pl-1 text-[10px] font-semibold opacity-70">
                  → day {s.item.day_end}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
