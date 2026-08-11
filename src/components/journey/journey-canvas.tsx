"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpToLine, Trash2 } from "lucide-react";
import type { JourneyItem } from "@/lib/journey/types";
import { JOURNEY_COLOR_KEYS, journeyColor } from "@/lib/journey/types";

// Free-form Miro-style canvas. World coordinates are item x/y at scale 1;
// screen = world * scale + pan. Pan by dragging empty canvas (or two-finger
// scroll), zoom with ⌘/Ctrl + scroll or the toolbar buttons. Items drag with
// the pointer, resize from the bottom-right handle, and edit on double-click.

export interface CanvasView {
  panX: number;
  panY: number;
  scale: number;
}

export const MIN_SCALE = 0.08;
export const MAX_SCALE = 2.5;

interface JourneyCanvasProps {
  items: JourneyItem[];
  view: CanvasView;
  selectedId: string | null;
  onViewChange: (view: CanvasView) => void;
  onSelect: (id: string | null) => void;
  /** Local move/resize while dragging; commit=true on pointer-up / blur. */
  onItemChange: (
    id: string,
    patch: Partial<Pick<JourneyItem, "x" | "y" | "w" | "h" | "content" | "color" | "z">>,
    commit: boolean
  ) => void;
  onBringToFront: (id: string) => void;
  onDelete: (id: string) => void;
  onDropFiles: (files: File[], world: { x: number; y: number }) => void;
}

type DragState =
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
  | { kind: "move"; id: string; startX: number; startY: number; itemX: number; itemY: number; moved: boolean }
  | { kind: "resize"; id: string; startX: number; startY: number; itemW: number; itemH: number };

export function JourneyCanvas({
  items,
  view,
  selectedId,
  onViewChange,
  onSelect,
  onItemChange,
  onBringToFront,
  onDelete,
  onDropFiles,
}: JourneyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [panning, setPanning] = useState(false);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (clientX - (rect?.left ?? 0) - v.panX) / v.scale,
      y: (clientY - (rect?.top ?? 0) - v.panY) / v.scale,
    };
  };

  // Wheel: two-finger scroll pans, ⌘/Ctrl+scroll zooms around the cursor.
  // Registered manually because React's onWheel is passive (can't preventDefault).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.01);
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
        const k = scale / v.scale;
        onViewChange({
          scale,
          panX: cx - (cx - v.panX) * k,
          panY: cy - (cy - v.panY) * k,
        });
      } else {
        onViewChange({ ...v, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onViewChange]);

  // Global pointer move/up so drags keep tracking outside the container.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const v = viewRef.current;
      if (drag.kind === "pan") {
        onViewChange({
          ...v,
          panX: drag.panX + (e.clientX - drag.startX),
          panY: drag.panY + (e.clientY - drag.startY),
        });
      } else if (drag.kind === "move") {
        const dx = (e.clientX - drag.startX) / v.scale;
        const dy = (e.clientY - drag.startY) / v.scale;
        if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
        onItemChange(drag.id, { x: drag.itemX + dx, y: drag.itemY + dy }, false);
      } else {
        const dw = (e.clientX - drag.startX) / v.scale;
        const dh = (e.clientY - drag.startY) / v.scale;
        onItemChange(
          drag.id,
          { w: Math.max(40, drag.itemW + dw), h: Math.max(32, drag.itemH + dh) },
          false
        );
      }
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setPanning(false);
      if (!drag || drag.kind === "pan") return;
      const v = viewRef.current;
      if (drag.kind === "move") {
        const dx = (e.clientX - drag.startX) / v.scale;
        const dy = (e.clientY - drag.startY) / v.scale;
        onItemChange(drag.id, { x: drag.itemX + dx, y: drag.itemY + dy }, true);
      } else {
        const dw = (e.clientX - drag.startX) / v.scale;
        const dh = (e.clientY - drag.startY) / v.scale;
        onItemChange(
          drag.id,
          { w: Math.max(40, drag.itemW + dw), h: Math.max(32, drag.itemH + dh) },
          true
        );
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onItemChange, onViewChange]);

  // Delete key removes the selection (unless a text field is focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        onDelete(selectedId);
      }
      if (e.key === "Escape") onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, editingId, onDelete, onSelect]);

  const startItemDrag = (e: React.PointerEvent, item: JourneyItem) => {
    if (e.button !== 0 || editingId === item.id) return;
    e.stopPropagation();
    onSelect(item.id);
    dragRef.current = {
      kind: "move",
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      itemX: item.x,
      itemY: item.y,
      moved: false,
    };
  };

  const startResize = (e: React.PointerEvent, item: JourneyItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = {
      kind: "resize",
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      itemW: item.w,
      itemH: item.h,
    };
  };

  const frames = items.filter((it) => it.type === "frame");
  const others = items.filter((it) => it.type !== "frame");
  const selected = items.find((it) => it.id === selectedId) ?? null;

  const gridSize = 24 * view.scale;

  return (
    <div
      ref={containerRef}
      className={`relative flex-1 touch-none overflow-hidden bg-slate-50 ${
        dropActive ? "ring-2 ring-inset ring-indigo-400" : ""
      }`}
      style={{
        backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${view.panX}px ${view.panY}px`,
        cursor: panning ? "grabbing" : "default",
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        onSelect(null);
        setEditingId(null);
        setPanning(true);
        dragRef.current = {
          kind: "pan",
          startX: e.clientX,
          startY: e.clientY,
          panX: view.panX,
          panY: view.panY,
        };
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropActive(false);
        const files = Array.from(e.dataTransfer.files).filter((f) =>
          f.type.startsWith("image/")
        );
        if (files.length > 0) onDropFiles(files, toWorld(e.clientX, e.clientY));
      }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {[...frames, ...others].map((item) => (
          <CanvasItem
            key={item.id}
            item={item}
            scale={view.scale}
            selected={item.id === selectedId}
            editing={item.id === editingId}
            onPointerDown={(e) => startItemDrag(e, item)}
            onResizeStart={(e) => startResize(e, item)}
            onDoubleClick={() => {
              if (item.type !== "image") setEditingId(item.id);
            }}
            onContentCommit={(content) => {
              setEditingId(null);
              onItemChange(item.id, { content }, true);
            }}
          />
        ))}
      </div>

      {/* floating toolbar for the selection */}
      {selected && !editingId && (
        <div
          className="absolute z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-1 shadow-lg"
          style={{
            left: (selected.x + selected.w / 2) * view.scale + view.panX,
            top: Math.max(8, selected.y * view.scale + view.panY - 44),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {selected.type !== "image" && (
            <>
              {JOURNEY_COLOR_KEYS.map((key) => (
                <button
                  key={key}
                  title={key}
                  onClick={() => onItemChange(selected.id, { color: key }, true)}
                  className={`h-5 w-5 rounded-full border ${journeyColor(key).swatch} ${
                    (selected.color ?? "yellow") === key
                      ? "border-slate-700 ring-1 ring-slate-700"
                      : "border-white"
                  }`}
                />
              ))}
              <div className="mx-0.5 h-5 w-px bg-slate-200" />
            </>
          )}
          <button
            title="Bring to front"
            onClick={() => onBringToFront(selected.id)}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <ArrowUpToLine className="h-4 w-4" />
          </button>
          <button
            title="Delete"
            onClick={() => onDelete(selected.id)}
            className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

interface CanvasItemProps {
  item: JourneyItem;
  scale: number;
  selected: boolean;
  editing: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
  onContentCommit: (content: string) => void;
}

function CanvasItem({
  item,
  scale,
  selected,
  editing,
  onPointerDown,
  onResizeStart,
  onDoubleClick,
  onContentCommit,
}: CanvasItemProps) {
  const colors = journeyColor(item.color);
  const ring = selected ? "ring-2 ring-indigo-500" : "";
  const base = {
    left: item.x,
    top: item.y,
    width: item.w,
    height: item.h,
  } as const;

  const textarea = editing ? (
    <textarea
      autoFocus
      defaultValue={item.content ?? ""}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => onContentCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") e.currentTarget.blur();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute inset-0 h-full w-full resize-none bg-transparent p-3 text-sm outline-none"
      style={item.type === "label" ? { fontSize: labelFontSize(item), fontWeight: 700, padding: 4 } : undefined}
    />
  ) : null;

  if (item.type === "frame") {
    return (
      <div
        className={`absolute rounded-xl border-2 ${colors.border} ${colors.bg} bg-opacity-40 ${ring}`}
        style={{ ...base, opacity: 0.9 }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        <div className="absolute -top-8 left-0 max-w-full truncate rounded-md px-1 text-lg font-bold uppercase tracking-wide text-slate-500">
          {editing ? null : item.content || "Frame"}
        </div>
        {editing && (
          <textarea
            autoFocus
            defaultValue={item.content ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => onContentCommit(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape" || e.key === "Enter") e.currentTarget.blur();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute -top-9 left-0 h-9 w-72 resize-none rounded-md border border-slate-300 bg-white px-1 text-lg font-bold uppercase tracking-wide text-slate-600 outline-none"
          />
        )}
        {selected && <ResizeHandle onPointerDown={onResizeStart} scale={scale} />}
      </div>
    );
  }

  if (item.type === "image") {
    return (
      <div
        className={`absolute overflow-hidden rounded-lg border border-slate-200 bg-white shadow-md ${ring}`}
        style={base}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        {item.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image_url}
            alt={item.content ?? "screenshot"}
            draggable={false}
            className="h-full w-full select-none object-cover object-top"
          />
        )}
        {item.content && (
          <div className="absolute bottom-0 left-0 right-0 truncate bg-slate-900/70 px-2 py-1 text-xs text-white">
            {item.content}
          </div>
        )}
        {selected && <ResizeHandle onPointerDown={onResizeStart} scale={scale} />}
      </div>
    );
  }

  if (item.type === "label") {
    return (
      <div
        className={`absolute flex items-center rounded ${ring}`}
        style={base}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        {!editing && (
          <span
            className="w-full truncate font-bold text-slate-700"
            style={{ fontSize: labelFontSize(item) }}
          >
            {item.content || "Label"}
          </span>
        )}
        {textarea}
        {selected && <ResizeHandle onPointerDown={onResizeStart} scale={scale} />}
      </div>
    );
  }

  // note
  return (
    <div
      className={`absolute rounded-md border ${colors.border} ${colors.bg} shadow-md ${ring}`}
      style={base}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {!editing && (
        <div className="h-full w-full overflow-hidden whitespace-pre-wrap p-3 text-sm text-slate-800">
          {item.content}
        </div>
      )}
      {textarea}
      {selected && <ResizeHandle onPointerDown={onResizeStart} scale={scale} />}
    </div>
  );
}

function labelFontSize(item: JourneyItem): number {
  return Math.min(64, Math.max(14, Math.round(item.h * 0.55)));
}

function ResizeHandle({
  onPointerDown,
  scale,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  scale: number;
}) {
  const size = Math.max(10, 12 / scale);
  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute rounded-sm border border-white bg-indigo-500"
      style={{
        right: -size / 2,
        bottom: -size / 2,
        width: size,
        height: size,
        cursor: "nwse-resize",
      }}
    />
  );
}
