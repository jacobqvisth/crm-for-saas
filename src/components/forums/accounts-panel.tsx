"use client";

import { useState } from "react";
import { Users, ChevronDown, ChevronRight, Plus, Trash2, Loader2, Check, Pencil } from "lucide-react";
import type { RedditAccount } from "@/lib/forums/accounts";

// The team's Reddit account roster. Posts are assigned to these accounts and
// posted manually; this panel is where the handles + "established subs" live.
export function AccountsPanel({
  accounts,
  onChange,
}: {
  accounts: RedditAccount[];
  onChange: (accounts: RedditAccount[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const pending = accounts.filter((a) => !a.username).length;

  async function addAccount(owner: string) {
    if (!owner.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/forums/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_label: owner.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        onChange([...accounts, data.account as RedditAccount].sort((a, b) =>
          a.owner_label.localeCompare(b.owner_label),
        ));
        setAdding(false);
      }
    } finally {
      setBusy(false);
    }
  }

  function replaceAccount(updated: RedditAccount) {
    onChange(accounts.map((a) => (a.id === updated.id ? updated : a)));
  }

  function removeAccount(id: string) {
    onChange(accounts.filter((a) => a.id !== id));
  }

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
        <Users className="h-4 w-4 text-orange-600" />
        <span className="text-sm font-medium text-slate-800">Reddit accounts</span>
        <span className="text-xs text-slate-400">
          {accounts.length} account{accounts.length === 1 ? "" : "s"}
          {pending > 0 && ` · ${pending} need a username`}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4">
          <p className="mb-3 text-xs text-slate-500">
            The team posts manually from these accounts. Add each person&apos;s
            Reddit handle and the subreddits they&apos;re established in —
            established accounts clear the spam filters that silently remove
            posts from brand-new ones.
          </p>
          <div className="space-y-2">
            {accounts.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                onSaved={replaceAccount}
                onRemoved={() => removeAccount(a.id)}
              />
            ))}
          </div>

          {adding ? (
            <AddAccountForm busy={busy} onAdd={addAccount} onCancel={() => setAdding(false)} />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="mt-3 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add account
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function AddAccountForm({
  busy,
  onAdd,
  onCancel,
}: {
  busy: boolean;
  onAdd: (owner: string) => void;
  onCancel: () => void;
}) {
  const [owner, setOwner] = useState("");
  return (
    <div className="mt-3 flex gap-2">
      <input
        autoFocus
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onAdd(owner)}
        placeholder="Team member name (e.g. Erik)"
        className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
      />
      <button
        onClick={() => onAdd(owner)}
        disabled={busy || !owner.trim()}
        className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
      </button>
      <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
        Cancel
      </button>
    </div>
  );
}

function AccountRow({
  account,
  onSaved,
  onRemoved,
}: {
  account: RedditAccount;
  onSaved: (a: RedditAccount) => void;
  onRemoved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState(account.username ?? "");
  const [subs, setSubs] = useState(account.subreddits.join(", "));
  const [slackId, setSlackId] = useState(account.slack_user_id ?? "");
  const [notes, setNotes] = useState(account.notes ?? "");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/forums/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        onSaved(data.account as RedditAccount);
        return true;
      }
    } finally {
      setBusy(false);
    }
    return false;
  }

  async function save() {
    const ok = await patch({
      username: username.trim() || null,
      subreddits: subs
        .split(",")
        .map((s) => s.trim().replace(/^r\//i, ""))
        .filter(Boolean),
      slack_user_id: slackId.trim() || null,
      notes: notes.trim() || null,
    });
    if (ok) setEditing(false);
  }

  async function remove() {
    if (!window.confirm(`Remove ${account.owner_label}'s account from the roster?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/forums/accounts/${account.id}`, { method: "DELETE" });
      if (res.ok) onRemoved();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-700">{account.owner_label}</div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-[11px] text-slate-500">
            Reddit username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Minimum-Ad7044"
              className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
          </label>
          <label className="text-[11px] text-slate-500">
            Established subreddits (comma-separated)
            <input
              value={subs}
              onChange={(e) => setSubs(e.target.value)}
              placeholder="MechanicAdvice, AutoRepair"
              className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
          </label>
        </div>
        <label className="mt-2 block text-[11px] text-slate-500">
          Slack member ID (for @-mentions in #forum-posts — optional)
          <input
            value={slackId}
            onChange={(e) => setSlackId(e.target.value)}
            placeholder="e.g. U0123ABCD"
            className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
        </label>
        <label className="mt-2 block text-[11px] text-slate-500">
          Notes
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
        </label>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
          </button>
          <button onClick={() => setEditing(false)} className="rounded-md px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-xs">
      <button
        onClick={() => patch({ active: !account.active })}
        title={account.active ? "Active — click to disable" : "Inactive — click to enable"}
        className={`h-2 w-2 flex-shrink-0 rounded-full ${account.active ? "bg-green-500" : "bg-slate-300"}`}
      />
      <span className="font-medium text-slate-800">{account.owner_label}</span>
      {account.username ? (
        <span className="text-slate-500">u/{account.username}</span>
      ) : (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
          no username yet
        </span>
      )}
      {account.subreddits.length > 0 && (
        <span className="truncate text-slate-400">{account.subreddits.map((s) => `r/${s}`).join(", ")}</span>
      )}
      <button
        onClick={() => setEditing(true)}
        className="ml-auto inline-flex items-center gap-1 text-slate-400 hover:text-slate-700"
      >
        <Pencil className="h-3 w-3" /> Edit
      </button>
    </div>
  );
}
