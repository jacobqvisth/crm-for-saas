"use client";

import { useState, useTransition } from "react";
import type { AuditRow, EffectiveFlag, TenantRow } from "@/lib/control-plane/db";
import {
  clearTenantFeature,
  rotateTenantToken,
  setTenantFeature,
  updateTenant,
} from "@/app/(control-plane)/admin/actions";

type Cell = { tenant: TenantRow; flags: EffectiveFlag[] };

// The console: tenants down the side, features across, a toggle at each
// intersection.
//
// Three design rules from the phase 04 brief are load-bearing here:
//
//   1. A cell shows the EFFECTIVE value and visibly distinguishes an explicit
//      override from an inherited default. Silent inheritance is how a feature
//      gets taken away from a paying customer by accident.
//   2. Turning a feature OFF asks for a note; turning one on does not. Off is
//      the destructive direction.
//   3. Nothing here claims to change code. Release channel is a record of which
//      branch a deployment builds; promotion is a git push.

export function AdminConsole({
  admin,
  grid,
  audit,
}: {
  admin: string;
  grid: Cell[];
  audit: AuditRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<{ slug: string; token: string } | null>(null);

  const features = grid[0]?.flags ?? [];

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
    });
  }

  function toggle(cell: Cell, flag: EffectiveFlag) {
    if (flag.enabled) {
      // Off is destructive: require a reason before removing a surface the
      // customer may be using.
      const note = window.prompt(
        `Turn "${flag.name}" OFF for ${cell.tenant.display_name}.\n\nWhy? (required)`,
      );
      if (note === null) return;
      if (!note.trim()) {
        setError("A note is required when turning a feature off.");
        return;
      }
      run(() =>
        setTenantFeature({
          tenantId: cell.tenant.id,
          featureKey: flag.key,
          enabled: false,
          note,
        }),
      );
    } else {
      run(() =>
        setTenantFeature({ tenantId: cell.tenant.id, featureKey: flag.key, enabled: true }),
      );
    }
  }

  return (
    <main className="mx-auto max-w-[1400px] p-8">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Control plane</h1>
          <p className="mt-1 text-sm text-slate-600">
            Feature access across every tenant. Changes take effect on each tenant&apos;s next
            config pull, within about five minutes. This is a pull, not a push.
          </p>
        </div>
        <span className="text-xs text-slate-500">signed in as {admin}</span>
      </header>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {freshToken && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="font-medium">
            New config token for {freshToken.slug}. It is shown once and never stored.
          </div>
          <code className="mt-1 block break-all font-mono text-xs">{freshToken.token}</code>
          <button
            className="mt-2 text-xs underline"
            onClick={() => setFreshToken(null)}
            type="button"
          >
            I have saved it
          </button>
        </div>
      )}

      {grid.length === 0 ? (
        <p className="text-sm text-slate-600">
          No tenants yet. Seed the control-plane database with{" "}
          <code>node scripts/seed-control-plane.mjs --apply</code>.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium text-slate-700">
                  Feature
                </th>
                {grid.map((c) => (
                  <th key={c.tenant.id} className="px-3 py-2 text-left font-medium text-slate-700">
                    <div>{c.tenant.display_name}</div>
                    <div className="font-normal text-xs text-slate-500">
                      {c.tenant.status} · {c.tenant.release_channel}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.key} className="border-b border-slate-100 last:border-0">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 align-top">
                    <div className="font-medium text-slate-900">{f.name}</div>
                    <div className="text-xs text-slate-500">{f.description}</div>
                  </td>
                  {grid.map((c) => {
                    const flag = c.flags.find((x) => x.key === f.key)!;
                    return (
                      <td key={c.tenant.id} className="px-3 py-2 align-top">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => toggle(c, flag)}
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            flag.enabled
                              ? "bg-emerald-100 text-emerald-900"
                              : "bg-slate-200 text-slate-700"
                          } ${flag.source === "override" ? "ring-1 ring-slate-900" : ""}`}
                          title={
                            flag.source === "override"
                              ? `Explicitly set by ${flag.updatedBy} — ${flag.note ?? "no note"}`
                              : `Inheriting the default (${flag.defaultEnabled ? "on" : "off"})`
                          }
                        >
                          {flag.enabled ? "on" : "off"}
                        </button>
                        {/* The distinction the brief insists on: a ringed chip
                            was chosen for this tenant, a plain one is following
                            the registry default and will move if it moves. */}
                        <div className="mt-1 text-[10px] text-slate-500">
                          {flag.source === "override" ? "set" : "inherited"}
                        </div>
                        {flag.source === "override" && (
                          <button
                            type="button"
                            disabled={pending}
                            className="mt-1 text-[10px] underline text-slate-500"
                            onClick={() =>
                              run(() =>
                                clearTenantFeature({
                                  tenantId: c.tenant.id,
                                  featureKey: flag.key,
                                }),
                              )
                            }
                          >
                            inherit
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Tenants</h2>
          <div className="space-y-3">
            {grid.map((c) => (
              <div key={c.tenant.id} className="rounded border border-slate-200 bg-white p-3">
                <div className="flex items-baseline justify-between">
                  <div className="font-medium text-slate-900">{c.tenant.display_name}</div>
                  <code className="text-xs text-slate-500">{c.tenant.slug}</code>
                </div>
                <dl className="mt-2 space-y-1 text-xs text-slate-600">
                  <div>app: {c.tenant.app_url ?? "not set"}</div>
                  <div>supabase ref: {c.tenant.supabase_project_ref ?? "not set"}</div>
                  {/* Displayed, never actioned. Promotion is a git push. */}
                  <div>channel: {c.tenant.release_channel} (promote with git, not here)</div>
                </dl>
                <div className="mt-2 flex gap-3 text-xs">
                  <button
                    type="button"
                    disabled={pending}
                    className="underline"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await rotateTenantToken({ tenantId: c.tenant.id });
                        if (res.ok) setFreshToken({ slug: c.tenant.slug, token: res.token });
                        else setError(res.error);
                      })
                    }
                  >
                    rotate config token
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className="underline"
                    onClick={() =>
                      run(() =>
                        updateTenant({
                          tenantId: c.tenant.id,
                          status: c.tenant.status === "active" ? "suspended" : "active",
                        }),
                      )
                    }
                  >
                    {c.tenant.status === "active" ? "suspend" : "activate"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Audit</h2>
          <div className="rounded border border-slate-200 bg-white">
            {audit.length === 0 ? (
              <p className="p-3 text-xs text-slate-500">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-xs">
                {audit.map((a) => (
                  <li key={a.id} className="px-3 py-2">
                    <span className="font-mono text-slate-500">
                      {new Date(a.at).toISOString().slice(0, 16).replace("T", " ")}
                    </span>{" "}
                    <span className="font-medium text-slate-900">{a.action}</span>{" "}
                    <span className="text-slate-600">by {a.actor}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
