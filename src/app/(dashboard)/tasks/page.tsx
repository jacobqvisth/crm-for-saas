"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  CheckSquare,
  Mail,
  Phone,
  Linkedin,
  Plus,
  X,
  Pencil,
  Trash2,
  AlarmClock,
} from "lucide-react";
import { format, isToday, isPast, isTomorrow } from "date-fns";
import toast from "react-hot-toast";
import { useWorkspace } from "@/lib/hooks/use-workspace";

type TaskType = "email" | "call" | "linkedin" | "generic";
type TaskPriority = "low" | "medium" | "high";
type FilterType = "all" | "due_today" | "overdue" | "upcoming" | "completed";

type Contact = {
  first_name: string | null;
  last_name: string | null;
  email: string;
  title: string | null;
  company_id: string | null;
};

type Task = {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  enrollment_id: string | null;
  type: TaskType;
  title: string;
  description: string | null;
  due_date: string | null;
  completed_at: string | null;
  snoozed_until: string | null;
  priority: TaskPriority;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  contacts: Contact | null;
};

const TYPE_ICONS: Record<TaskType, React.ReactNode> = {
  email: <Mail className="w-4 h-4 text-blue-500" />,
  call: <Phone className="w-4 h-4 text-green-500" />,
  linkedin: <Linkedin className="w-4 h-4 text-sky-600" />,
  generic: <CheckSquare className="w-4 h-4 text-slate-400" />,
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-slate-300",
};

function DueDateLabel({ due }: { due: string | null }) {
  if (!due) return null;
  const d = new Date(due);
  if (isPast(d) && !isToday(d)) {
    return <span className="text-xs text-red-500 font-medium">{format(d, "MMM d")}</span>;
  }
  if (isToday(d)) {
    return <span className="text-xs text-amber-600 font-medium">Today</span>;
  }
  if (isTomorrow(d)) {
    return <span className="text-xs text-slate-500">Tomorrow</span>;
  }
  return <span className="text-xs text-slate-400">{format(d, "MMM d")}</span>;
}

function isOverdue(task: Task): boolean {
  if (!task.due_date || task.completed_at) return false;
  const d = new Date(task.due_date);
  return isPast(d) && !isToday(d);
}

const FILTER_TABS: { key: FilterType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "due_today", label: "Due Today" },
  { key: "overdue", label: "Overdue" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
];

const EMPTY_MESSAGES: Record<FilterType, string> = {
  due_today: "Nothing due today — you're clear!",
  overdue: "No overdue tasks.",
  upcoming: "No upcoming tasks.",
  completed: "No completed tasks yet.",
  all: "No tasks yet. Add your first task above.",
};

type EditState = {
  id: string;
  title: string;
  description: string;
  due_date: string;
  priority: TaskPriority;
};

export default function TasksPage() {
  const { workspaceId } = useWorkspace();
  const [filter, setFilter] = useState<FilterType>("all");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Quick-add form state
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<TaskType>("generic");
  const [newDueDate, setNewDueDate] = useState("");
  const [newPriority, setNewPriority] = useState<TaskPriority>("medium");
  const [adding, setAdding] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?filter=${filter}`);
      if (!res.ok) throw new Error("Failed to load tasks");
      const data = await res.json() as { tasks: Task[] };
      setTasks(data.tasks);
    } catch {
      toast.error("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, filter]);

  useEffect(() => {
    if (!workspaceId) return;
    fetchTasks();
  }, [fetchTasks, workspaceId]);

  async function handleAdd() {
    if (!newTitle.trim()) { toast.error("Title is required"); return; }
    setAdding(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          type: newType,
          due_date: newDueDate || null,
          priority: newPriority,
        }),
      });
      if (!res.ok) throw new Error("Failed to create task");
      toast.success("Task created");
      setNewTitle("");
      setNewType("generic");
      setNewDueDate("");
      setNewPriority("medium");
      setShowAddForm(false);
      fetchTasks();
    } catch {
      toast.error("Failed to create task");
    } finally {
      setAdding(false);
    }
  }

  async function handleComplete(task: Task) {
    const completed_at = task.completed_at ? null : new Date().toISOString();
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed_at }),
    });
    if (!res.ok) { toast.error("Failed to update task"); return; }
    toast.success(completed_at ? "Task completed" : "Task reopened");
    fetchTasks();
  }

  async function handleSnooze(taskId: string) {
    const snoozed_until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snoozed_until }),
    });
    if (!res.ok) { toast.error("Failed to snooze task"); return; }
    toast.success("Snoozed until tomorrow");
    fetchTasks();
  }

  async function handleSaveEdit() {
    if (!editState) return;
    if (!editState.title.trim()) { toast.error("Title is required"); return; }
    const res = await fetch(`/api/tasks/${editState.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editState.title.trim(),
        description: editState.description || null,
        due_date: editState.due_date || null,
        priority: editState.priority,
      }),
    });
    if (!res.ok) { toast.error("Failed to update task"); return; }
    toast.success("Task updated");
    setEditState(null);
    fetchTasks();
  }

  async function handleDelete(taskId: string) {
    const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to delete task"); return; }
    toast.success("Task deleted");
    setDeleteConfirmId(null);
    fetchTasks();
  }

  const overdueTasks = tasks.filter(isOverdue);
  const regularTasks = tasks.filter((t) => !isOverdue(t));

  function renderTaskCard(task: Task) {
    const contactName = task.contacts
      ? [task.contacts.first_name, task.contacts.last_name].filter(Boolean).join(" ")
      : null;

    if (editState?.id === task.id) {
      return (
        <div key={task.id} className="bg-white border border-indigo-200 rounded-lg p-4 space-y-3">
          <input
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            value={editState.title}
            onChange={(e) => setEditState({ ...editState, title: e.target.value })}
            placeholder="Task title"
          />
          <textarea
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
            rows={2}
            value={editState.description}
            onChange={(e) => setEditState({ ...editState, description: e.target.value })}
            placeholder="Description (optional)"
          />
          <div className="flex gap-2">
            <input
              type="datetime-local"
              className="border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={editState.due_date}
              onChange={(e) => setEditState({ ...editState, due_date: e.target.value })}
            />
            <select
              className="border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={editState.priority}
              onChange={(e) => setEditState({ ...editState, priority: e.target.value as TaskPriority })}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSaveEdit}
              className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
            >
              Save
            </button>
            <button
              onClick={() => setEditState(null)}
              className="px-3 py-1.5 bg-slate-100 text-slate-700 text-sm rounded hover:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        key={task.id}
        className={`group flex items-start gap-3 bg-white border rounded-lg px-4 py-3 hover:shadow-sm transition-shadow ${
          isOverdue(task) ? "border-l-4 border-l-red-400 border-r-slate-200 border-t-slate-200 border-b-slate-200" : "border-slate-200"
        }`}
      >
        {/* Checkbox */}
        <button
          onClick={() => handleComplete(task)}
          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            task.completed_at
              ? "bg-green-500 border-green-500 text-white"
              : "border-slate-300 hover:border-indigo-400"
          }`}
        >
          {task.completed_at && (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority]}`} />
            {TYPE_ICONS[task.type]}
            <span className={`text-sm font-medium ${task.completed_at ? "line-through text-slate-400" : "text-slate-800"}`}>
              {task.title}
            </span>
          </div>
          {task.contacts && contactName && (
            <div className="mt-0.5">
              <Link
                href={`/contacts/${task.contact_id}`}
                className="text-xs text-indigo-600 hover:underline"
              >
                → {contactName} · {task.contacts.email}
              </Link>
            </div>
          )}
          {task.description && (
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">{task.description}</p>
          )}
        </div>

        {/* Due date + actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <DueDateLabel due={task.due_date} />
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => handleSnooze(task.id)}
              title="Snooze 1 day"
              className="p-1 text-slate-400 hover:text-amber-500 rounded"
            >
              <AlarmClock className="w-4 h-4" />
            </button>
            <button
              onClick={() =>
                setEditState({
                  id: task.id,
                  title: task.title,
                  description: task.description ?? "",
                  due_date: task.due_date
                    ? new Date(task.due_date).toISOString().slice(0, 16)
                    : "",
                  priority: task.priority,
                })
              }
              title="Edit"
              className="p-1 text-slate-400 hover:text-indigo-600 rounded"
            >
              <Pencil className="w-4 h-4" />
            </button>
            {deleteConfirmId === task.id ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDelete(task.id)}
                  className="px-2 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                >
                  Delete
                </button>
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setDeleteConfirmId(task.id)}
                title="Delete"
                className="p-1 text-slate-400 hover:text-red-500 rounded"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Tasks</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Task
        </button>
      </div>

      {/* Quick-add form */}
      {showAddForm && (
        <div className="mb-4 bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-slate-700">New task</span>
            <button
              onClick={() => setShowAddForm(false)}
              className="ml-auto text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            autoFocus
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            placeholder="Task title *"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <div className="flex flex-wrap gap-2">
            <select
              className="border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={newType}
              onChange={(e) => setNewType(e.target.value as TaskType)}
            >
              <option value="generic">Generic</option>
              <option value="email">Email</option>
              <option value="call">Call</option>
              <option value="linkedin">LinkedIn</option>
            </select>
            <input
              type="datetime-local"
              className="border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
            />
            <select
              className="border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
            >
              <option value="high">High priority</option>
              <option value="medium">Medium priority</option>
              <option value="low">Low priority</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={adding}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {adding ? "Adding..." : "Add Task"}
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-1.5 bg-slate-100 text-slate-700 text-sm rounded hover:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          className="mb-4 w-full text-left px-4 py-2.5 border border-dashed border-slate-300 rounded-lg text-sm text-slate-400 hover:text-slate-600 hover:border-slate-400 transition-colors"
        >
          + Add a task...
        </button>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200 pb-0">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-2 text-sm font-medium rounded-t transition-colors ${
              filter === tab.key
                ? "text-indigo-700 border-b-2 border-indigo-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Task list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-slate-100 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          {EMPTY_MESSAGES[filter]}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Overdue section (only on "all" or "overdue" filter) */}
          {(filter === "all" || filter === "overdue") && overdueTasks.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">
                Overdue ({overdueTasks.length})
              </p>
              <div className="space-y-2">
                {overdueTasks.map(renderTaskCard)}
              </div>
            </div>
          )}

          {/* Regular tasks */}
          {regularTasks.length > 0 && (
            <div className="space-y-2">
              {(filter === "all" || filter === "overdue") && overdueTasks.length > 0 && regularTasks.length > 0 && (
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 mt-4">
                  Other tasks
                </p>
              )}
              {regularTasks.map(renderTaskCard)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
