"use client";

import { useMemo } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { format } from "date-fns";
import type { RoadmapBoard, RoadmapGroup, RoadmapItem } from "@/lib/roadmap/types";
import { ITEM_STATUSES } from "@/lib/roadmap/types";
import { colorClasses, statusStyle } from "@/lib/roadmap/colors";
import { parseDay } from "@/lib/roadmap/scale";

// Columns are the item statuses. Items with no/unknown status fall into the
// first column ("Not started") and get an explicit status once dragged.
// "Blocked" is intentionally not a board column — blocked items fold into
// "Not started" here (Blocked is still selectable in the detail panel).
const COLUMNS = (ITEM_STATUSES as readonly string[]).filter((s) => s !== "Blocked");
const DEFAULT_COLUMN = ITEM_STATUSES[0]; // "Not started"

interface RoadmapKanbanProps {
  board: RoadmapBoard;
  /** Drag a card to another column → persist the new status. */
  onChangeStatus: (id: string, status: string) => void;
  onSelectItem: (id: string) => void;
}

function columnOf(item: RoadmapItem): string {
  return item.status && COLUMNS.includes(item.status) ? item.status : DEFAULT_COLUMN;
}

function dateRange(item: RoadmapItem): string {
  try {
    return `${format(parseDay(item.start_date), "MMM d")} – ${format(parseDay(item.end_date), "MMM d")}`;
  } catch {
    return "";
  }
}

export function RoadmapKanban({ board, onChangeStatus, onSelectItem }: RoadmapKanbanProps) {
  const groupById = useMemo(
    () => new Map<string, RoadmapGroup>(board.groups.map((g) => [g.id, g])),
    [board.groups]
  );

  const byColumn = useMemo(() => {
    const map: Record<string, RoadmapItem[]> = {};
    for (const c of COLUMNS) map[c] = [];
    for (const it of board.items) map[columnOf(it)].push(it);
    return map;
  }, [board.items]);

  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return; // ignore in-column reorder
    onChangeStatus(draggableId, destination.droppableId);
  }

  return (
    <div className="flex-1 overflow-x-auto border-t border-slate-200 bg-slate-50 p-4">
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex h-full gap-4">
          {COLUMNS.map((col) => {
            const items = byColumn[col] ?? [];
            const s = statusStyle(col);
            return (
              <div
                key={col}
                className="flex w-96 shrink-0 flex-col rounded-xl border border-slate-200 bg-white"
              >
                <div className="flex items-center gap-2 border-b border-slate-200 p-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s?.dot ?? "bg-slate-300"}`} />
                  <h3 className="truncate text-sm font-semibold text-slate-900">{col}</h3>
                  <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-400">
                    {items.length}
                  </span>
                </div>

                <Droppable droppableId={col}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`min-h-[120px] flex-1 space-y-2 overflow-y-auto p-2 transition-colors ${
                        snapshot.isDraggingOver ? "bg-indigo-50/50" : ""
                      }`}
                    >
                      {items.map((item, index) => {
                        const group = groupById.get(item.group_id);
                        const colors = colorClasses(item.color ?? group?.color);
                        return (
                          <Draggable key={item.id} draggableId={item.id} index={index}>
                            {(p, snap) => (
                              <div
                                ref={p.innerRef}
                                {...p.draggableProps}
                                {...p.dragHandleProps}
                                onClick={() => onSelectItem(item.id)}
                                className={`cursor-pointer overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow hover:shadow ${
                                  snap.isDragging ? "border-indigo-300 shadow-lg" : "border-slate-200"
                                }`}
                              >
                                <div className="flex">
                                  <span className={`w-1 shrink-0 ${colors.dot}`} />
                                  <div className="min-w-0 flex-1 p-2.5">
                                    <p className="text-sm font-medium text-slate-800">{item.title}</p>
                                    {group && (
                                      <div className="mt-1 flex items-center gap-1.5">
                                        <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                                        <span className="text-xs text-slate-500">{group.name}</span>
                                      </div>
                                    )}
                                    <p className="mt-1 text-[11px] text-slate-400">{dateRange(item)}</p>
                                    {item.progress_note && (
                                      <p className="mt-1.5 line-clamp-2 text-[11px] text-slate-500">
                                        {item.progress_note}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
