"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Check,
  ChevronsLeftRight,
  Trash2,
  Zap,
  LogIn,
  MoreHorizontal,
  Route,
} from "lucide-react";
import toast from "react-hot-toast";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type {
  ActivationPlan,
  ActivationBoard,
  ActivationGroup,
  ActivationItem,
  ActivationScenario,
  ZoomLevel,
} from "@/lib/activation/types";
import { PX_PER_DAY, ITEM_STATUSES } from "@/lib/activation/types";
import { computeRange } from "@/lib/activation/scale";
import { statusStyle } from "@/lib/activation/status";
import { COLOR_TOKENS, colorClasses } from "@/lib/roadmap/colors";
import { ActivationCanvas } from "./activation-canvas";
import { ActivationItemModal } from "./activation-item-modal";

const ZOOMS: { key: ZoomLevel; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

export function ActivationClient() {
  const { workspaceId } = useWorkspace();
  const [boards, setBoards] = useState<ActivationPlan[]>([]);
  const [board, setBoard] = useState<ActivationBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<ZoomLevel>("day");
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [scrollToStartKey, setScrollToStartKey] = useState(0);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const [groupMenu, setGroupMenu] = useState<{
    group: ActivationGroup;
    x: number;
    y: number;
    renaming: boolean;
    draft: string;
  } | null>(null);

  const [scenarioMenu, setScenarioMenu] = useState<{
    scenario: ActivationScenario;
    x: number;
    y: number;
    nameDraft: string;
    descDraft: string;
  } | null>(null);

  const load = useCallback(
    async (boardId?: string) => {
      if (!workspaceId) return;
      setLoading(true);
      try {
        const url = boardId ? `/api/activation?id=${boardId}` : "/api/activation";
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { boards: ActivationPlan[]; board: ActivationBoard };
        setBoards(data.boards);
        setBoard(data.board);
        setActiveScenarioId(null);
      } catch {
        toast.error("Failed to load activation plan");
      } finally {
        setLoading(false);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    if (workspaceId) load();
  }, [workspaceId, load]);

  // ---- scenario filtering ----------------------------------------------------
  const activeScenario = useMemo(
    () => board?.scenarios.find((s) => s.id === activeScenarioId) ?? null,
    [board?.scenarios, activeScenarioId]
  );

  /** Board narrowed to the active scenario: only member items, only non-empty lanes. */
  const visibleBoard: ActivationBoard | null = useMemo(() => {
    if (!board) return null;
    if (!activeScenario) return board;
    const items = board.items.filter((it) => (it.scenario_ids ?? []).includes(activeScenario.id));
    const usedGroupIds = new Set(items.map((it) => it.group_id));
    return { ...board, items, groups: board.groups.filter((g) => usedGroupIds.has(g.id)) };
  }, [board, activeScenario]);

  /** Journey step numbers (1-based, day order) for the active scenario. */
  const stepNumbers = useMemo(() => {
    if (!activeScenario || !visibleBoard) return undefined;
    const ordered = [...visibleBoard.items].sort(
      (a, b) => a.day_start - b.day_start || a.day_end - b.day_end || a.sort_order - b.sort_order
    );
    return new Map(ordered.map((it, i) => [it.id, i + 1]));
  }, [activeScenario, visibleBoard]);

  const range = useMemo(() => computeRange(visibleBoard?.items ?? []), [visibleBoard?.items]);
  const pxPerDay = PX_PER_DAY[zoom];

  // ---- helpers -------------------------------------------------------------
  const patchItemLocal = (id: string, patch: Partial<ActivationItem>) =>
    setBoard((b) =>
      b ? { ...b, items: b.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) } : b
    );

  async function persistItem(id: string, patch: Partial<ActivationItem>, errMsg: string) {
    try {
      const res = await fetch(`/api/activation/items/${id}`, {
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
  const saveItem = (id: string, patch: Partial<ActivationItem>) => {
    patchItemLocal(id, patch);
    persistItem(id, patch, "Couldn't save changes");
  };

  async function addItem(groupId: string) {
    if (!board) return;
    try {
      const res = await fetch("/api/activation/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: board.id,
          group_id: groupId,
          title: "New touchpoint",
          day_start: 0,
          day_end: 0,
          status: "Idea",
          // A touchpoint created while a journey is open belongs to it,
          // otherwise it would be filtered out the moment it's created.
          scenario_ids: activeScenarioId ? [activeScenarioId] : [],
        }),
      });
      if (!res.ok) throw new Error();
      const { item } = (await res.json()) as { item: ActivationItem };
      setBoard((b) => (b ? { ...b, items: [...b.items, item] } : b));
      setDetailItemId(item.id);
    } catch {
      toast.error("Couldn't add touchpoint");
    }
  }

  async function deleteItem(id: string) {
    const prev = board;
    setBoard((b) => (b ? { ...b, items: b.items.filter((it) => it.id !== id) } : b));
    setDetailItemId(null);
    try {
      const res = await fetch(`/api/activation/items/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Touchpoint deleted");
    } catch {
      toast.error("Couldn't delete touchpoint");
      setBoard(prev);
    }
  }

  // ---- group ops -----------------------------------------------------------
  async function addGroup() {
    if (!board) return;
    const color = COLOR_TOKENS[board.groups.length % COLOR_TOKENS.length];
    try {
      const res = await fetch("/api/activation/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: board.id, name: "New channel", color }),
      });
      if (!res.ok) throw new Error();
      const { group } = (await res.json()) as { group: ActivationGroup };
      setBoard((b) => (b ? { ...b, groups: [...b.groups, group] } : b));
    } catch {
      toast.error("Couldn't add channel");
    }
  }

  function updateGroupLocal(id: string, patch: Partial<ActivationGroup>) {
    setBoard((b) =>
      b ? { ...b, groups: b.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) } : b
    );
  }

  async function updateGroup(id: string, patch: Partial<ActivationGroup>) {
    updateGroupLocal(id, patch);
    try {
      const res = await fetch(`/api/activation/groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't update channel");
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
      const res = await fetch(`/api/activation/groups/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Channel deleted");
    } catch {
      toast.error("Couldn't delete channel");
      setBoard(prev);
    }
  }

  // ---- scenario ops ----------------------------------------------------------
  async function addScenario() {
    if (!board) return;
    const color = COLOR_TOKENS[board.scenarios.length % COLOR_TOKENS.length];
    try {
      const res = await fetch("/api/activation/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: board.id, name: "New scenario", color }),
      });
      if (!res.ok) throw new Error();
      const { scenario } = (await res.json()) as { scenario: ActivationScenario };
      setBoard((b) => (b ? { ...b, scenarios: [...b.scenarios, scenario] } : b));
      setActiveScenarioId(scenario.id);
      setScenarioMenu({
        scenario,
        x: window.innerWidth / 2 - 140,
        y: 140,
        nameDraft: scenario.name,
        descDraft: "",
      });
    } catch {
      toast.error("Couldn't add scenario");
    }
  }

  async function updateScenario(id: string, patch: Partial<ActivationScenario>) {
    setBoard((b) =>
      b
        ? { ...b, scenarios: b.scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
        : b
    );
    try {
      const res = await fetch(`/api/activation/scenarios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't update scenario");
      load(board?.id);
    }
  }

  async function deleteScenario(id: string) {
    const prev = board;
    setBoard((b) =>
      b
        ? {
            ...b,
            scenarios: b.scenarios.filter((s) => s.id !== id),
            items: b.items.map((it) => ({
              ...it,
              scenario_ids: (it.scenario_ids ?? []).filter((sid) => sid !== id),
            })),
          }
        : b
    );
    if (activeScenarioId === id) setActiveScenarioId(null);
    setScenarioMenu(null);
    try {
      const res = await fetch(`/api/activation/scenarios/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Scenario deleted");
    } catch {
      toast.error("Couldn't delete scenario");
      setBoard(prev);
    }
  }

  // ---- board ops -----------------------------------------------------------
  async function createBoard() {
    try {
      const res = await fetch("/api/activation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New plan" }),
      });
      if (!res.ok) throw new Error();
      const { board: nb } = (await res.json()) as { board: ActivationBoard };
      setBoards((bs) => [...bs, nb]);
      setBoard(nb);
      setActiveScenarioId(null);
      setEditingTitle(true);
      setTitleDraft(nb.name);
    } catch {
      toast.error("Couldn't create plan");
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
      const res = await fetch(`/api/activation/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't rename plan");
    }
  }

  const detailItem = useMemo(
    () => board?.items.find((it) => it.id === detailItemId) ?? null,
    [board?.items, detailItemId]
  );

  // close popover menus on any outside click
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
              {board?.name ?? "Activation Plan"}
            </h1>
            <Pencil className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500" />
          </button>
        )}

        {/* Board switcher */}
        {boards.length > 1 && (
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

        {/* Status legend */}
        <div className="ml-2 hidden items-center gap-3 xl:flex">
          {ITEM_STATUSES.map((s) => {
            const st = statusStyle(s);
            if (!st) return null;
            return (
              <span key={s} className="flex items-center gap-1 text-xs text-slate-500">
                <span className={`h-2 w-2 rounded-full ${st.dot}`} /> {s}
              </span>
            );
          })}
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Zap className="h-3 w-3" /> event-triggered
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
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
            onClick={() => setScrollToStartKey((k) => k + 1)}
            title="Scroll back to the signup day"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            <LogIn className="h-3.5 w-3.5" /> Day 0
          </button>
          <button
            onClick={() => board && board.groups.length > 0 && addItem(board.groups[0].id)}
            disabled={!board || board.groups.length === 0}
            title="Create a new touchpoint"
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> New touchpoint
          </button>
        </div>
      </div>

      {/* ===== Scenario simulation bar ===== */}
      {board && (
        <div className="flex flex-col gap-1 border-t border-slate-100 px-4 py-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            <Route className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <button
              onClick={() => setActiveScenarioId(null)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                activeScenarioId === null
                  ? "bg-slate-800 text-white"
                  : "border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              All touchpoints
            </button>
            {board.scenarios.map((sc) => {
              const active = activeScenarioId === sc.id;
              const colors = colorClasses(sc.color);
              return (
                <span key={sc.id} className="flex shrink-0 items-center">
                  <button
                    onClick={() => setActiveScenarioId(active ? null : sc.id)}
                    title={sc.description ?? sc.name}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                      active
                        ? "bg-indigo-600 text-white"
                        : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
                    {sc.name}
                  </button>
                  {active && (
                    <button
                      onClick={(e) =>
                        setScenarioMenu({
                          scenario: sc,
                          x: e.clientX,
                          y: e.clientY,
                          nameDraft: sc.name,
                          descDraft: sc.description ?? "",
                        })
                      }
                      title="Scenario options"
                      className="ml-0.5 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              );
            })}
            <button
              onClick={addScenario}
              className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50"
            >
              <Plus className="h-3 w-3" /> Scenario
            </button>

            {/* channels legend (click a chip to rename/recolor/delete) */}
            <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-4">
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Channels
              </span>
              {board.groups.map((g) => (
                <button
                  key={g.id}
                  onClick={(e) =>
                    setGroupMenu({ group: g, x: e.clientX, y: e.clientY, renaming: false, draft: g.name })
                  }
                  title={`${g.name} — click to edit`}
                  className="flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  <span className={`h-2 w-2 rounded-full ${colorClasses(g.color).dot}`} />
                  {g.name}
                </button>
              ))}
              <button
                onClick={addGroup}
                title="Add channel"
                className="rounded-full border border-dashed border-slate-300 p-0.5 text-slate-400 hover:bg-slate-50"
              >
                <Plus className="h-3 w-3" />
              </button>
            </span>
          </div>
          {activeScenario?.description && (
            <p className="pl-6 text-xs text-slate-500">
              {activeScenario.description}
              {stepNumbers && (
                <span className="ml-1 text-slate-400">
                  · {stepNumbers.size} step{stepNumbers.size === 1 ? "" : "s"}, numbered in day
                  order
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* ===== Board body ===== */}
      {loading || !board || !visibleBoard ? (
        <div className="flex flex-1 items-center justify-center border-t border-slate-200 text-sm text-slate-400">
          {loading ? "Loading activation plan…" : "No plan"}
        </div>
      ) : board.groups.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 border-t border-slate-200 text-sm text-slate-500">
          <p>This plan is empty.</p>
          <button
            onClick={addGroup}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> Add your first channel
          </button>
        </div>
      ) : visibleBoard.items.length === 0 && activeScenario ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 border-t border-slate-200 text-sm text-slate-500">
          <p>No touchpoints in “{activeScenario.name}” yet.</p>
          <p className="text-xs text-slate-400">
            Open a touchpoint and tick this scenario under “Scenarios”, or add a new touchpoint
            while this scenario is selected.
          </p>
        </div>
      ) : (
        <ActivationCanvas
          board={visibleBoard}
          range={range}
          pxPerDay={pxPerDay}
          scrollToStartKey={scrollToStartKey}
          stepNumbers={stepNumbers}
          onSelectItem={setDetailItemId}
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
              <Trash2 className="h-4 w-4" /> Delete channel
            </button>
          </div>
        </>
      )}

      {/* ===== Scenario options popover ===== */}
      {scenarioMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setScenarioMenu(null)} />
          <div
            className="fixed z-50 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-xl"
            style={{
              left: Math.min(scenarioMenu.x, window.innerWidth - 300),
              top: Math.min(scenarioMenu.y + 8, window.innerHeight - 320),
            }}
          >
            <label className="mb-1 block text-xs font-medium text-slate-500">Name</label>
            <input
              autoFocus
              value={scenarioMenu.nameDraft}
              onChange={(e) =>
                setScenarioMenu((m) => (m ? { ...m, nameDraft: e.target.value } : m))
              }
              className="mb-2 w-full rounded border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <label className="mb-1 block text-xs font-medium text-slate-500">Description</label>
            <textarea
              rows={3}
              value={scenarioMenu.descDraft}
              onChange={(e) =>
                setScenarioMenu((m) => (m ? { ...m, descDraft: e.target.value } : m))
              }
              placeholder="What happens to the user in this journey…"
              className="mb-2 w-full resize-none rounded border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <p className="mb-1 text-xs text-slate-400">Color</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {COLOR_TOKENS.map((token) => (
                <button
                  key={token}
                  onClick={() => {
                    updateScenario(scenarioMenu.scenario.id, { color: token });
                    setScenarioMenu((m) =>
                      m ? { ...m, scenario: { ...m.scenario, color: token } } : m
                    );
                  }}
                  title={token}
                  className={`h-5 w-5 rounded-full ${colorClasses(token).dot} ${
                    scenarioMenu.scenario.color === token
                      ? "ring-2 ring-indigo-500 ring-offset-1"
                      : ""
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 pt-2">
              <button
                onClick={() => {
                  if (scenarioMenu.nameDraft.trim()) {
                    updateScenario(scenarioMenu.scenario.id, {
                      name: scenarioMenu.nameDraft.trim(),
                      description: scenarioMenu.descDraft.trim() || null,
                    });
                  }
                  setScenarioMenu(null);
                }}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Save
              </button>
              <button
                onClick={() => deleteScenario(scenarioMenu.scenario.id)}
                className="ml-auto flex items-center gap-1 rounded px-2 py-1.5 text-xs text-red-500 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          </div>
        </>
      )}

      {/* ===== Detail modal ===== */}
      <ActivationItemModal
        item={detailItem}
        groups={board?.groups ?? []}
        scenarios={board?.scenarios ?? []}
        onClose={() => setDetailItemId(null)}
        onSave={saveItem}
        onDelete={deleteItem}
      />
    </div>
  );
}
