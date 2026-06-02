"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Check,
  ChevronsLeftRight,
  CalendarClock,
  Trash2,
  Sparkles,
} from "lucide-react";
import toast from "react-hot-toast";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type {
  Roadmap,
  RoadmapBoard,
  RoadmapGroup,
  RoadmapItem,
  ZoomLevel,
} from "@/lib/roadmap/types";
import { PX_PER_DAY } from "@/lib/roadmap/types";
import { COLOR_TOKENS, colorClasses } from "@/lib/roadmap/colors";
import { computeRange, addDays, toISODate } from "@/lib/roadmap/scale";
import { GanttTimeline } from "./gantt-timeline";
import { ItemDetailPanel } from "./item-detail-panel";
import { UpdateSuggestionsModal, type AppliedUpdate } from "./update-suggestions-modal";
import type { SuggestionOut } from "@/app/api/roadmap/suggest-updates/route";

const ZOOMS: { key: ZoomLevel; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

export function RoadmapClient() {
  const { workspaceId } = useWorkspace();
  const [boards, setBoards] = useState<Roadmap[]>([]);
  const [board, setBoard] = useState<RoadmapBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<ZoomLevel>("week");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [scrollToTodayKey, setScrollToTodayKey] = useState(0);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionOut[]>([]);
  const [groupMenu, setGroupMenu] = useState<{
    group: RoadmapGroup;
    x: number;
    y: number;
    renaming: boolean;
    draft: string;
  } | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  const load = useCallback(
    async (boardId?: string) => {
      if (!workspaceId) return;
      setLoading(true);
      try {
        const url = boardId ? `/api/roadmap?id=${boardId}` : "/api/roadmap";
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { boards: Roadmap[]; board: RoadmapBoard };
        setBoards(data.boards);
        setBoard(data.board);
      } catch {
        toast.error("Failed to load roadmap");
      } finally {
        setLoading(false);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    if (workspaceId) load();
  }, [workspaceId, load]);

  const range = useMemo(
    () => computeRange(board?.items ?? [], today),
    [board?.items, today]
  );
  const pxPerDay = PX_PER_DAY[zoom];

  // ---- helpers -------------------------------------------------------------
  const patchItemLocal = (id: string, patch: Partial<RoadmapItem>) =>
    setBoard((b) =>
      b ? { ...b, items: b.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) } : b
    );

  async function persistItem(id: string, patch: Partial<RoadmapItem>, errMsg: string) {
    try {
      const res = await fetch(`/api/roadmap/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error(errMsg);
      load(board?.id); // resync from server on failure
    }
  }

  // ---- item ops ------------------------------------------------------------
  const changeItemDates = (id: string, startDate: string, endDate: string) => {
    patchItemLocal(id, { start_date: startDate, end_date: endDate });
    persistItem(id, { start_date: startDate, end_date: endDate }, "Couldn't move item");
  };

  const saveItem = (id: string, patch: Partial<RoadmapItem>) => {
    patchItemLocal(id, patch);
    persistItem(id, patch, "Couldn't save changes");
  };

  // ---- AI "Update": infer real progress from internal data -----------------
  async function runUpdate() {
    if (!board) return;
    setUpdateOpen(true);
    setUpdateLoading(true);
    setSuggestions([]);
    try {
      const res = await fetch("/api/roadmap/suggest-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roadmap_id: board.id }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(error);
      }
      const data = (await res.json()) as { suggestions: SuggestionOut[] };
      setSuggestions(data.suggestions);
      if (data.suggestions.length === 0) toast("No suggestions found");
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't analyze progress");
      setUpdateOpen(false);
    } finally {
      setUpdateLoading(false);
    }
  }

  async function applyUpdates(updates: AppliedUpdate[]) {
    if (updates.length === 0) {
      setUpdateOpen(false);
      return;
    }
    // Optimistic local apply.
    for (const u of updates) {
      patchItemLocal(u.id, { status: u.status, progress_note: u.progress_note });
    }
    setUpdateOpen(false);
    const results = await Promise.allSettled(
      updates.map((u) =>
        fetch(`/api/roadmap/items/${u.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: u.status, progress_note: u.progress_note }),
        }).then((r) => {
          if (!r.ok) throw new Error();
        })
      )
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      toast.error(`${failed} update${failed === 1 ? "" : "s"} failed to save`);
      load(board?.id);
    } else {
      toast.success(`Applied ${updates.length} update${updates.length === 1 ? "" : "s"}`);
    }
  }

  async function addItem(groupId: string) {
    if (!board) return;
    const start = toISODate(today);
    const end = toISODate(addDays(today, 6));
    try {
      const res = await fetch("/api/roadmap/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roadmap_id: board.id,
          group_id: groupId,
          title: "New item",
          start_date: start,
          end_date: end,
        }),
      });
      if (!res.ok) throw new Error();
      const { item } = (await res.json()) as { item: RoadmapItem };
      setBoard((b) => (b ? { ...b, items: [...b.items, item] } : b));
      setSelectedItemId(item.id);
      setDetailItemId(item.id);
    } catch {
      toast.error("Couldn't add item");
    }
  }

  async function deleteItem(id: string) {
    const prev = board;
    setBoard((b) => (b ? { ...b, items: b.items.filter((it) => it.id !== id) } : b));
    setDetailItemId(null);
    setSelectedItemId(null);
    try {
      const res = await fetch(`/api/roadmap/items/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Item deleted");
    } catch {
      toast.error("Couldn't delete item");
      setBoard(prev);
    }
  }

  // ---- group ops -----------------------------------------------------------
  async function addGroup() {
    if (!board) return;
    const color = COLOR_TOKENS[board.groups.length % COLOR_TOKENS.length];
    try {
      const res = await fetch("/api/roadmap/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roadmap_id: board.id, name: "New group", color }),
      });
      if (!res.ok) throw new Error();
      const { group } = (await res.json()) as { group: RoadmapGroup };
      setBoard((b) => (b ? { ...b, groups: [...b.groups, group] } : b));
    } catch {
      toast.error("Couldn't add group");
    }
  }

  function updateGroupLocal(id: string, patch: Partial<RoadmapGroup>) {
    setBoard((b) =>
      b ? { ...b, groups: b.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) } : b
    );
  }

  async function updateGroup(id: string, patch: Partial<RoadmapGroup>) {
    updateGroupLocal(id, patch);
    try {
      const res = await fetch(`/api/roadmap/groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't update group");
      load(board?.id);
    }
  }

  async function deleteGroup(id: string) {
    const prev = board;
    setBoard((b) =>
      b
        ? {
            ...b,
            groups: b.groups.filter((g) => g.id !== id),
            items: b.items.filter((it) => it.group_id !== id),
          }
        : b
    );
    setGroupMenu(null);
    try {
      const res = await fetch(`/api/roadmap/groups/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Group deleted");
    } catch {
      toast.error("Couldn't delete group");
      setBoard(prev);
    }
  }

  // ---- board ops -----------------------------------------------------------
  async function createBoard() {
    try {
      const res = await fetch("/api/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New roadmap" }),
      });
      if (!res.ok) throw new Error();
      const { board: nb } = (await res.json()) as { board: RoadmapBoard };
      setBoards((bs) => [...bs, nb]);
      setBoard(nb);
      setEditingTitle(true);
      setTitleDraft(nb.name);
    } catch {
      toast.error("Couldn't create board");
    }
  }

  async function renameBoard(name: string) {
    if (!board || !name.trim()) {
      setEditingTitle(false);
      return;
    }
    const trimmed = name.trim();
    setBoard((b) => (b ? { ...b, name: trimmed } : b));
    setBoards((bs) => bs.map((b) => (b.id === board.id ? { ...b, name: trimmed } : b)));
    setEditingTitle(false);
    try {
      const res = await fetch(`/api/roadmap/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't rename board");
    }
  }

  const detailItem = useMemo(
    () => board?.items.find((it) => it.id === detailItemId) ?? null,
    [board?.items, detailItemId]
  );

  // close the group menu on any outside click
  const menuRef = useRef<HTMLDivElement>(null);

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* ===== Header ===== */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Title (inline editable) */}
        {editingTitle ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") renameBoard(titleDraft);
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="rounded border border-slate-300 px-2 py-1 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              onClick={() => renameBoard(titleDraft)}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setEditingTitle(true);
              setTitleDraft(board?.name ?? "");
            }}
            className="group flex items-center gap-1.5"
          >
            <h1 className="text-lg font-semibold text-slate-900">
              {board?.name ?? "Roadmap"}
            </h1>
            <Pencil className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500" />
          </button>
        )}

        {/* Board switcher */}
        {boards.length > 0 && (
          <select
            value={board?.id ?? ""}
            onChange={(e) => load(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-300"
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
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* Zoom segmented control */}
          <div className="flex items-center rounded-lg border border-slate-200 p-0.5">
            <ChevronsLeftRight className="mx-1 h-3.5 w-3.5 text-slate-400" />
            {ZOOMS.map((z) => (
              <button
                key={z.key}
                onClick={() => setZoom(z.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  zoom === z.key
                    ? "bg-indigo-600 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setScrollToTodayKey((k) => k + 1)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            <CalendarClock className="h-3.5 w-3.5" /> Today
          </button>
          <button
            onClick={runUpdate}
            disabled={updateLoading || !board || board.groups.length === 0}
            title="Suggest progress updates from your internal data"
            className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> {updateLoading ? "Analyzing…" : "Update"}
          </button>
          <button
            onClick={addGroup}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> Add group
          </button>
        </div>
      </div>

      {/* ===== Timeline ===== */}
      {loading || !board ? (
        <div className="flex flex-1 items-center justify-center border-t border-slate-200 text-sm text-slate-400">
          {loading ? "Loading roadmap…" : "No roadmap"}
        </div>
      ) : board.groups.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 border-t border-slate-200 text-sm text-slate-500">
          <p>This roadmap is empty.</p>
          <button
            onClick={addGroup}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> Add your first group
          </button>
        </div>
      ) : (
        <GanttTimeline
          board={board}
          range={range}
          pxPerDay={pxPerDay}
          today={today}
          selectedItemId={selectedItemId}
          scrollToTodayKey={scrollToTodayKey}
          onChangeItemDates={changeItemDates}
          onSelectItem={(id) => {
            setSelectedItemId(id);
            setDetailItemId(id);
          }}
          onAddItem={addItem}
          onToggleCollapse={(g) => updateGroup(g.id, { collapsed: !g.collapsed })}
          onGroupMenu={(g, anchor) =>
            setGroupMenu({ group: g, x: anchor.x, y: anchor.y, renaming: false, draft: g.name })
          }
        />
      )}

      {/* ===== Group options popover ===== */}
      {groupMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setGroupMenu(null)} />
          <div
            ref={menuRef}
            className="fixed z-50 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
            style={{
              left: Math.min(groupMenu.x, window.innerWidth - 240),
              top: Math.min(groupMenu.y, window.innerHeight - 220),
            }}
          >
            {groupMenu.renaming ? (
              <div className="flex items-center gap-1 p-1">
                <input
                  autoFocus
                  value={groupMenu.draft}
                  onChange={(e) =>
                    setGroupMenu((m) => (m ? { ...m, draft: e.target.value } : m))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && groupMenu.draft.trim()) {
                      updateGroup(groupMenu.group.id, { name: groupMenu.draft.trim() });
                      setGroupMenu(null);
                    }
                    if (e.key === "Escape") setGroupMenu(null);
                  }}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <button
                  onClick={() => {
                    if (groupMenu.draft.trim())
                      updateGroup(groupMenu.group.id, { name: groupMenu.draft.trim() });
                    setGroupMenu(null);
                  }}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setGroupMenu((m) => (m ? { ...m, renaming: true } : m))}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <Pencil className="h-4 w-4 text-slate-400" /> Rename
              </button>
            )}
            <div className="px-2 py-1.5">
              <p className="mb-1 text-xs text-slate-400">Color</p>
              <div className="flex flex-wrap gap-1.5">
                {COLOR_TOKENS.map((token) => (
                  <button
                    key={token}
                    onClick={() => {
                      updateGroup(groupMenu.group.id, { color: token });
                      setGroupMenu((m) => (m ? { ...m, group: { ...m.group, color: token } } : m));
                    }}
                    title={token}
                    className={`h-5 w-5 rounded-full ${colorClasses(token).dot} ${
                      groupMenu.group.color === token
                        ? "ring-2 ring-indigo-500 ring-offset-1"
                        : ""
                    }`}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={() => deleteGroup(groupMenu.group.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-red-500 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" /> Delete group
            </button>
          </div>
        </>
      )}

      {/* ===== Detail panel ===== */}
      <ItemDetailPanel
        item={detailItem}
        groups={board?.groups ?? []}
        onClose={() => setDetailItemId(null)}
        onSave={saveItem}
        onDelete={deleteItem}
      />

      {/* ===== AI update suggestions ===== */}
      <UpdateSuggestionsModal
        open={updateOpen}
        loading={updateLoading}
        suggestions={suggestions}
        onClose={() => setUpdateOpen(false)}
        onApply={applyUpdates}
      />
    </div>
  );
}
