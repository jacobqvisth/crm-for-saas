"use client";

import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import {
  GripVertical,
  RotateCcw,
  Save,
  CheckCircle2,
  Pencil,
  Circle,
  X,
  Plus,
  ExternalLink,
  Mail,
  MailX,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { VisitOutcome } from "@/lib/routes/visits-decision";

export type ReorderStop = {
  id: string;
  shop_name: string;
  shop_address: string;
  legDriveSeconds: number | null;
  isLapsed: boolean;
  visitedAt?: string | null;
  visitOutcome?: VisitOutcome | null;
  companyId?: string | null;
  discoveredShopId?: string | null;
  lastEmailedAt?: string | null;
};

type Props = {
  stops: ReorderStop[];
  saving: boolean;
  onSave: (orderedIds: string[]) => void;
  onMarkVisited?: (stopId: string) => void;
  onRemove?: (stopId: string) => void;
  onAddStop?: () => void;
  maxStops?: number;
};

const OUTCOME_PILL: Record<VisitOutcome, { label: string; cls: string }> = {
  interested: { label: "Interested", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed: { label: "Closed", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  no_answer: { label: "No answer", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  not_interested: { label: "Not interested", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  skipped: { label: "Skipped", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

function formatHM(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export default function StopsReorderList({
  stops,
  saving,
  onSave,
  onMarkVisited,
  onRemove,
  onAddStop,
  maxStops = 10,
}: Props) {
  const [order, setOrder] = useState<ReorderStop[]>(stops);

  useEffect(() => {
    setOrder(stops);
  }, [stops]);

  const dirty = order.some((s, i) => s.id !== stops[i]?.id);

  function onDragEnd(result: DropResult) {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;
    const next = Array.from(order);
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);
    setOrder(next);
  }

  function handleCancel() {
    setOrder(stops);
  }

  function handleSave() {
    onSave(order.map((s) => s.id));
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Stops</h3>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 rounded disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving…" : "Save new order"}
          </button>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="stops">
          {(droppableProvided) => (
            <ul
              ref={droppableProvided.innerRef}
              {...droppableProvided.droppableProps}
              className="divide-y divide-slate-100"
            >
              {order.map((s, idx) => {
                const isVisited = !!s.visitedAt;
                const outcome = s.visitOutcome;
                const emailed = !!s.lastEmailedAt;
                const emailedRelative = s.lastEmailedAt
                  ? formatDistanceToNow(new Date(s.lastEmailedAt), { addSuffix: true })
                  : null;
                return (
                  <Draggable key={s.id} draggableId={s.id} index={idx}>
                    {(draggableProvided, snapshot) => (
                      <li
                        ref={draggableProvided.innerRef}
                        {...draggableProvided.draggableProps}
                        className={`flex items-center gap-3 px-4 py-3 text-sm ${
                          snapshot.isDragging
                            ? "bg-indigo-50 shadow-md"
                            : isVisited
                            ? "bg-slate-50/60"
                            : "bg-white hover:bg-slate-50"
                        }`}
                      >
                        <span
                          {...draggableProvided.dragHandleProps}
                          className="cursor-grab active:cursor-grabbing touch-none text-slate-400 hover:text-slate-600 flex-shrink-0 p-1 -ml-1"
                          aria-label="Drag to reorder"
                        >
                          <GripVertical className="w-4 h-4" />
                        </span>
                        <span
                          className={`tabular-nums w-5 flex-shrink-0 font-medium ${
                            isVisited ? "text-slate-400" : "text-slate-500"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`font-medium truncate ${
                                isVisited ? "text-slate-500" : "text-slate-800"
                              }`}
                            >
                              {s.shop_name}
                            </span>
                            <span
                              className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded border ${
                                s.isLapsed
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-sky-50 text-sky-700 border-sky-200"
                              }`}
                            >
                              {s.isLapsed ? "lapsed" : "cold"}
                            </span>
                            {outcome && (
                              <span
                                className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded border ${OUTCOME_PILL[outcome].cls}`}
                              >
                                {OUTCOME_PILL[outcome].label}
                              </span>
                            )}
                            {s.companyId && (
                              <Link
                                href={`/companies/${s.companyId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:text-indigo-800 hover:underline"
                                title="Open company profile"
                                aria-label="Open company profile"
                              >
                                Profile
                                <ExternalLink className="w-3 h-3" />
                              </Link>
                            )}
                          </div>
                          <div
                            className={`text-xs truncate mt-0.5 ${
                              isVisited ? "text-slate-400" : "text-slate-500"
                            }`}
                          >
                            {s.shop_address}
                            {s.visitedAt && (
                              <span className="ml-2">
                                · visited {new Date(s.visitedAt).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`hidden md:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap flex-shrink-0 ${
                            emailed
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-slate-50 text-slate-500 border-slate-200"
                          }`}
                          title={
                            emailed
                              ? `Last emailed ${new Date(s.lastEmailedAt as string).toLocaleString()}`
                              : "No emails sent yet"
                          }
                        >
                          {emailed ? (
                            <>
                              <Mail className="w-3 h-3" />
                              Emailed {emailedRelative}
                            </>
                          ) : (
                            <>
                              <MailX className="w-3 h-3" />
                              Never emailed
                            </>
                          )}
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap flex-shrink-0 hidden sm:inline">
                          {formatHM(s.legDriveSeconds)}
                        </span>
                        {onMarkVisited && (
                          <button
                            onClick={() => onMarkVisited(s.id)}
                            className={`flex items-center gap-1 px-3 text-xs font-medium rounded-lg border min-h-[44px] flex-shrink-0 ${
                              isVisited
                                ? "border-slate-200 text-slate-600 hover:bg-slate-100"
                                : "border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
                            }`}
                            aria-label={isVisited ? "Edit visit" : "Mark visited"}
                          >
                            {isVisited ? (
                              <>
                                <Pencil className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Edit</span>
                              </>
                            ) : (
                              <>
                                <Circle className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Mark visited</span>
                                <CheckCircle2 className="w-3.5 h-3.5 sm:hidden" />
                              </>
                            )}
                          </button>
                        )}
                        {onRemove && !isVisited && (
                          <button
                            onClick={() => onRemove(s.id)}
                            className="flex items-center justify-center w-7 h-7 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded flex-shrink-0"
                            aria-label="Remove stop"
                            title="Remove stop"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </li>
                    )}
                  </Draggable>
                );
              })}
              {droppableProvided.placeholder}
              {onAddStop && (
                order.length >= maxStops ? (
                  <li className="flex items-center justify-center px-3 py-2.5 text-xs text-slate-400 bg-slate-50">
                    Max stops reached ({maxStops})
                  </li>
                ) : (
                  <li>
                    <button
                      type="button"
                      onClick={onAddStop}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs text-indigo-700 hover:bg-indigo-50 border-t border-slate-100"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add stop
                    </button>
                  </li>
                )
              )}
            </ul>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}
