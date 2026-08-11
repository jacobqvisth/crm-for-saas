"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Frame,
  ImagePlus,
  Maximize,
  Minus,
  Plus,
  StickyNote,
  Trash2,
  Type,
} from "lucide-react";
import toast from "react-hot-toast";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { JourneyBoard, JourneyBoardRow, JourneyItem, JourneyItemPatch, JourneyItemType } from "@/lib/journey/types";
import { JourneyCanvas, MAX_SCALE, MIN_SCALE, type CanvasView } from "./journey-canvas";

// /journey — a free-form Miro-like board for mapping the user journey with
// screenshots and sticky notes. All mutations autosave: moves/resizes are
// batched through a debounced PATCH, creations/deletions are immediate.

export function JourneyClient() {
  const { workspaceId } = useWorkspace();
  const [boards, setBoards] = useState<JourneyBoardRow[]>([]);
  const [board, setBoard] = useState<JourneyBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<CanvasView>({ panX: 80, panY: 80, scale: 0.55 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- debounced save queue ------------------------------------------------
  const pendingRef = useRef<Map<string, Omit<JourneyItemPatch, "id">>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSaves = useCallback(async () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (pendingRef.current.size === 0) return;
    const patches: JourneyItemPatch[] = Array.from(pendingRef.current.entries()).map(
      ([id, fields]) => ({ id, ...fields })
    );
    pendingRef.current = new Map();
    const res = await fetch("/api/journey/items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: patches }),
    });
    if (!res.ok) toast.error("Failed to save changes");
  }, []);

  const queueSave = useCallback(
    (id: string, fields: Omit<JourneyItemPatch, "id">) => {
      pendingRef.current.set(id, { ...pendingRef.current.get(id), ...fields });
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flushSaves, 600);
    },
    [flushSaves]
  );

  useEffect(() => {
    const beforeUnload = () => void flushSaves();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [flushSaves]);

  // ---- load ------------------------------------------------------------------
  const loadBoard = useCallback(async (id?: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/journey${id ? `?id=${id}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setBoards(data.boards);
      setBoard(data.board);
      setSelectedId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  // ---- item mutations ---------------------------------------------------------
  const setItemLocal = useCallback(
    (id: string, patch: Partial<JourneyItem>) => {
      setBoard((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
            }
          : prev
      );
    },
    []
  );

  const handleItemChange = useCallback(
    (
      id: string,
      patch: Partial<Pick<JourneyItem, "x" | "y" | "w" | "h" | "content" | "color" | "z">>,
      commit: boolean
    ) => {
      setItemLocal(id, patch);
      if (commit) queueSave(id, patch);
    },
    [setItemLocal, queueSave]
  );

  const viewportCenterWorld = useCallback(() => {
    // Rough center of the visible canvas (header ≈ 120px tall).
    const cx = (window.innerWidth * 0.55 - view.panX) / view.scale;
    const cy = ((window.innerHeight - 120) * 0.45 - view.panY) / view.scale;
    return { x: cx, y: cy };
  }, [view]);

  const createItem = useCallback(
    async (
      type: JourneyItemType,
      overrides: Partial<Pick<JourneyItem, "x" | "y" | "w" | "h" | "content" | "image_url" | "color">> = {}
    ) => {
      if (!board) return;
      const center = viewportCenterWorld();
      const defaults: Record<JourneyItemType, { w: number; h: number; content: string | null; color: string | null }> = {
        note: { w: 220, h: 220, content: "New note", color: "yellow" },
        label: { w: 480, h: 56, content: "Label", color: null },
        image: { w: 480, h: 320, content: null, color: null },
        frame: { w: 900, h: 1400, content: "New stage", color: "gray" },
      };
      const d = defaults[type];
      const maxZ = Math.max(0, ...board.items.map((it) => it.z));
      const body = {
        board_id: board.id,
        type,
        x: center.x - d.w / 2,
        y: center.y - d.h / 2,
        w: d.w,
        h: d.h,
        z: maxZ + 1,
        content: d.content,
        color: d.color,
        ...overrides,
      };
      const res = await fetch("/api/journey/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to add item");
        return;
      }
      setBoard((prev) =>
        prev ? { ...prev, items: [...prev.items, data.item] } : prev
      );
      setSelectedId(data.item.id);
    },
    [board, viewportCenterWorld]
  );

  const deleteItem = useCallback(
    async (id: string) => {
      setBoard((prev) =>
        prev ? { ...prev, items: prev.items.filter((it) => it.id !== id) } : prev
      );
      setSelectedId((prev) => (prev === id ? null : prev));
      const res = await fetch(`/api/journey/items?ids=${id}`, { method: "DELETE" });
      if (!res.ok) toast.error("Failed to delete");
    },
    []
  );

  const bringToFront = useCallback(
    (id: string) => {
      if (!board) return;
      const maxZ = Math.max(0, ...board.items.map((it) => it.z));
      handleItemChange(id, { z: maxZ + 1 }, true);
    },
    [board, handleItemChange]
  );

  // ---- image upload (button, drop, paste) --------------------------------------
  const uploadImages = useCallback(
    async (files: File[], world?: { x: number; y: number }) => {
      if (!board || !workspaceId) return;
      let offset = 0;
      for (const file of files) {
        const toastId = toast.loading(`Uploading ${file.name || "image"}…`);
        try {
          const formData = new FormData();
          formData.append("workspaceId", workspaceId);
          formData.append("file", file);
          const res = await fetch("/api/journey/upload", { method: "POST", body: formData });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Upload failed");

          // Natural size, scaled down to a sane card width.
          const dims = await imageDimensions(file);
          const w = Math.min(480, dims.w);
          const h = Math.round((dims.h / dims.w) * w);
          const at = world ?? viewportCenterWorld();
          await createItem("image", {
            image_url: data.url,
            x: at.x - w / 2 + offset,
            y: at.y - h / 2 + offset,
            w,
            h,
          });
          offset += 32;
          toast.success("Image added", { id: toastId });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Upload failed", { id: toastId });
        }
      }
    },
    [board, workspaceId, createItem, viewportCenterWorld]
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length > 0) {
        e.preventDefault();
        void uploadImages(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [uploadImages]);

  // ---- view helpers -------------------------------------------------------------
  const zoomBy = (factor: number) => {
    const el = document.getElementById("journey-canvas-wrap");
    const cx = (el?.clientWidth ?? window.innerWidth) / 2;
    const cy = (el?.clientHeight ?? window.innerHeight) / 2;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = scale / v.scale;
      return { scale, panX: cx - (cx - v.panX) * k, panY: cy - (cy - v.panY) * k };
    });
  };

  const fitToContent = useCallback(() => {
    if (!board || board.items.length === 0) return;
    const el = document.getElementById("journey-canvas-wrap");
    const vw = el?.clientWidth ?? window.innerWidth;
    const vh = el?.clientHeight ?? window.innerHeight - 120;
    const minX = Math.min(...board.items.map((it) => it.x));
    const minY = Math.min(...board.items.map((it) => it.y));
    const maxX = Math.max(...board.items.map((it) => it.x + it.w));
    const maxY = Math.max(...board.items.map((it) => it.y + it.h + 40));
    const pad = 60;
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min((vw - pad * 2) / (maxX - minX), (vh - pad * 2) / (maxY - minY)))
    );
    setView({
      scale,
      panX: pad + (vw - pad * 2 - (maxX - minX) * scale) / 2 - minX * scale,
      panY: pad + (vh - pad * 2 - (maxY - minY) * scale) / 2 - minY * scale,
    });
  }, [board]);

  // Fit once after the initial load.
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (!didInitialFit.current && board && board.items.length > 0) {
      didInitialFit.current = true;
      fitToContent();
    }
  }, [board, fitToContent]);

  // ---- board management -----------------------------------------------------------
  const createBoard = async () => {
    const name = window.prompt("Board name", "New board");
    if (!name) return;
    const res = await fetch("/api/journey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Failed to create board");
      return;
    }
    setBoards((prev) => [...prev, data.board]);
    setBoard(data.board);
  };

  const deleteBoard = async () => {
    if (!board) return;
    if (!window.confirm(`Delete board "${board.name}" and everything on it?`)) return;
    const res = await fetch(`/api/journey?id=${board.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete board");
      return;
    }
    await loadBoard();
  };

  const renameBoard = async () => {
    if (!board) return;
    const name = window.prompt("Board name", board.name);
    if (!name || name === board.name) return;
    const res = await fetch("/api/journey", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: board.id, name }),
    });
    if (!res.ok) {
      toast.error("Failed to rename board");
      return;
    }
    setBoard((prev) => (prev ? { ...prev, name } : prev));
    setBoards((prev) => prev.map((b) => (b.id === board.id ? { ...b, name } : b)));
  };

  // ---- render ----------------------------------------------------------------------
  return (
    <div className="flex h-screen flex-col bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <h1
          className="cursor-pointer text-lg font-semibold text-slate-900"
          title="Rename board"
          onClick={renameBoard}
        >
          {board?.name ?? "User Journey"}
        </h1>
        {boards.length > 1 && (
          <select
            value={board?.id ?? ""}
            onChange={(e) => void loadBoard(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={createBoard}
          title="New board"
          className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
        >
          <Plus className="h-4 w-4" />
        </button>
        {boards.length > 1 && (
          <button
            onClick={deleteBoard}
            title="Delete board"
            className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}

        <div className="mx-2 h-6 w-px bg-slate-200" />

        <button
          onClick={() => void createItem("note")}
          className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          <StickyNote className="h-4 w-4 text-amber-500" /> Note
        </button>
        <button
          onClick={() => void createItem("label")}
          className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          <Type className="h-4 w-4" /> Label
        </button>
        <button
          onClick={() => void createItem("frame")}
          className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          <Frame className="h-4 w-4" /> Frame
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          <ImagePlus className="h-4 w-4 text-sky-500" /> Image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length > 0) void uploadImages(files);
          }}
        />

        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 hidden text-xs text-slate-400 lg:inline">
            Drag to pan · ⌘+scroll to zoom · paste or drop screenshots
          </span>
          <button
            onClick={() => zoomBy(1 / 1.25)}
            title="Zoom out"
            className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-sm tabular-nums text-slate-600">
            {Math.round(view.scale * 100)}%
          </span>
          <button
            onClick={() => zoomBy(1.25)}
            title="Zoom in"
            className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={fitToContent}
            title="Fit to content"
            className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
          >
            <Maximize className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div id="journey-canvas-wrap" className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            Loading board…
          </div>
        ) : board ? (
          <JourneyCanvas
            items={board.items}
            view={view}
            selectedId={selectedId}
            onViewChange={setView}
            onSelect={setSelectedId}
            onItemChange={handleItemChange}
            onBringToFront={bringToFront}
            onDelete={(id) => void deleteItem(id)}
            onDropFiles={(files, world) => void uploadImages(files, world)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            No board
          </div>
        )}
      </div>
    </div>
  );
}

function imageDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth || 480, h: img.naturalHeight || 320 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ w: 480, h: 320 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
