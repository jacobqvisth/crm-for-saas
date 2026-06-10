"use client";

import { useEffect, useMemo, useRef } from "react";
import { ChevronDown, ChevronRight, Plus, MoreHorizontal } from "lucide-react";
import type { ActivationBoard, ActivationGroup, ActivationItem } from "@/lib/activation/types";
import type { OffsetRange } from "@/lib/activation/scale";
import { weekTicks, dayTicks, totalWidth } from "@/lib/activation/scale";
import { colorClasses } from "@/lib/roadmap/colors";
import { ActivationBar } from "./activation-bar";

export const LEFT_WIDTH = 264;
export const ROW_H = 40;
export const GROUP_H = 40;
export const HEADER_H = 56;

interface ActivationTimelineProps {
  board: ActivationBoard;
  range: OffsetRange;
  pxPerDay: number;
  selectedItemId: string | null;
  scrollToStartKey: number;
  onChangeItemDays: (id: string, dayStart: number, dayEnd: number) => void;
  onSelectItem: (id: string) => void;
  onAddItem: (groupId: string) => void;
  onToggleCollapse: (group: ActivationGroup) => void;
  onGroupMenu: (group: ActivationGroup, anchor: { x: number; y: number }) => void;
}

type Row =
  | { kind: "group"; group: ActivationGroup }
  | { kind: "item"; group: ActivationGroup; item: ActivationItem };

export function ActivationTimeline({
  board,
  range,
  pxPerDay,
  selectedItemId,
  scrollToStartKey,
  onChangeItemDays,
  onSelectItem,
  onAddItem,
  onToggleCollapse,
  onGroupMenu,
}: ActivationTimelineProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);

  const width = totalWidth(range, pxPerDay);
  const weeks = useMemo(() => weekTicks(range, pxPerDay), [range, pxPerDay]);
  const days = useMemo(() => dayTicks(range, pxPerDay), [range, pxPerDay]);

  const itemsByGroup = useMemo(() => {
    const map = new Map<string, ActivationItem[]>();
    for (const it of board.items) {
      const arr = map.get(it.group_id) ?? [];
      arr.push(it);
      map.set(it.group_id, arr);
    }
    return map;
  }, [board.items]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const group of board.groups) {
      out.push({ kind: "group", group });
      if (!group.collapsed) {
        for (const item of itemsByGroup.get(group.id) ?? []) {
          out.push({ kind: "item", group, item });
        }
      }
    }
    return out;
  }, [board.groups, itemsByGroup]);

  const bodyHeight = rows.reduce(
    (acc, r) => acc + (r.kind === "group" ? GROUP_H : ROW_H),
    0
  );

  // Keep the header (horizontal) and left column (vertical) synced with the body scroll.
  function onBodyScroll() {
    const body = bodyRef.current;
    if (!body) return;
    if (headerRef.current) headerRef.current.scrollLeft = body.scrollLeft;
    if (leftRef.current) leftRef.current.scrollTop = body.scrollTop;
  }

  // Scroll back to day 0 on mount and when the "Day 0" button is pressed.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollLeft = 0;
    onBodyScroll();
  }, [scrollToStartKey]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden border-t border-slate-200 bg-white">
      {/* ===== Scale header ===== */}
      <div className="flex shrink-0" style={{ height: HEADER_H }}>
        <div
          className="shrink-0 border-r border-b border-slate-200 bg-slate-50"
          style={{ width: LEFT_WIDTH }}
        />
        <div ref={headerRef} className="flex-1 overflow-hidden border-b border-slate-200">
          <div className="relative h-full bg-slate-50" style={{ width }}>
            {/* week band */}
            {weeks.map((w, i) => (
              <div
                key={`w-${i}`}
                className="absolute top-0 flex h-7 items-center border-l border-slate-200 px-2 text-xs font-semibold text-slate-600"
                style={{ left: w.x }}
              >
                {w.label}
              </div>
            ))}
            {/* day ticks */}
            {days.map((d, i) => (
              <div
                key={`d-${i}`}
                className="absolute bottom-1 text-[10px] text-slate-400"
                style={{ left: d.x + 2 }}
              >
                {d.label}
              </div>
            ))}
            {/* signup marker label */}
            <div className="absolute top-0 z-10 rounded-b bg-indigo-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
              Signup
            </div>
          </div>
        </div>
      </div>

      {/* ===== Body ===== */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left label column */}
        <div
          ref={leftRef}
          className="shrink-0 overflow-hidden border-r border-slate-200 bg-white"
          style={{ width: LEFT_WIDTH }}
        >
          <div style={{ height: bodyHeight }}>
            {rows.map((row) => {
              if (row.kind === "group") {
                const colors = colorClasses(row.group.color);
                return (
                  <div
                    key={`gl-${row.group.id}`}
                    className="group/grp flex items-center gap-1.5 border-b border-slate-100 bg-slate-50/60 px-2"
                    style={{ height: GROUP_H }}
                  >
                    <button
                      onClick={() => onToggleCollapse(row.group)}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                    >
                      {row.group.collapsed ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colors.dot}`} />
                    <span className="truncate text-sm font-semibold text-slate-700">
                      {row.group.name}
                    </span>
                    <div className="ml-auto flex items-center opacity-0 group-hover/grp:opacity-100">
                      <button
                        onClick={() => onAddItem(row.group.id)}
                        title="Add touchpoint"
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) =>
                          onGroupMenu(row.group, { x: e.clientX, y: e.clientY })
                        }
                        title="Channel options"
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <button
                  key={`il-${row.item.id}`}
                  onClick={() => onSelectItem(row.item.id)}
                  className={`flex w-full items-center border-b border-slate-100 px-2 pl-8 text-left text-xs text-slate-600 hover:bg-slate-50 ${
                    selectedItemId === row.item.id ? "bg-indigo-50" : ""
                  }`}
                  style={{ height: ROW_H }}
                >
                  <span className="truncate">{row.item.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable timeline */}
        <div
          ref={bodyRef}
          onScroll={onBodyScroll}
          className="flex-1 overflow-auto"
        >
          <div className="relative" style={{ width, height: bodyHeight }}>
            {/* gridline + signup layer */}
            <div className="pointer-events-none absolute inset-0">
              {weeks.map((w, i) => (
                <div
                  key={`g-${i}`}
                  className="absolute top-0 bottom-0 border-l border-slate-100"
                  style={{ left: w.x }}
                />
              ))}
              <div className="absolute top-0 bottom-0 left-0 border-l-2 border-dashed border-indigo-400" />
            </div>

            {/* rows */}
            {(() => {
              let y = 0;
              return rows.map((row) => {
                const h = row.kind === "group" ? GROUP_H : ROW_H;
                const top = y;
                y += h;
                if (row.kind === "group") {
                  return (
                    <div
                      key={`gr-${row.group.id}`}
                      className="absolute left-0 right-0 border-b border-slate-100 bg-slate-50/40"
                      style={{ top, height: h }}
                    />
                  );
                }
                return (
                  <div
                    key={`ir-${row.item.id}`}
                    className="absolute left-0 border-b border-slate-100"
                    style={{ top, height: h, width }}
                  >
                    <ActivationBar
                      item={row.item}
                      pxPerDay={pxPerDay}
                      groupColor={row.group.color}
                      selected={selectedItemId === row.item.id}
                      onChangeDays={onChangeItemDays}
                      onSelect={onSelectItem}
                    />
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
