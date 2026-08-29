import { notFound } from "next/navigation";
import {
  isAuthFailure,
  isControlPlane,
  requireSuperAdmin,
} from "@/lib/control-plane/auth";
import {
  controlPlaneClient,
  listOverrides,
  listTenants,
  recentAudit,
  resolveEffectiveFlags,
} from "@/lib/control-plane/db";
import { AdminConsole } from "@/components/control-plane/admin-console";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // A tenant deployment must never serve this page, and it must 404 rather than
  // 403: a 403 confirms the console exists at this URL.
  if (!isControlPlane()) notFound();

  const admin = await requireSuperAdmin();
  if (isAuthFailure(admin)) {
    return (
      <main className="mx-auto max-w-lg p-10">
        <h1 className="text-lg font-semibold text-slate-900">Control plane</h1>
        <p className="mt-2 text-sm text-slate-600">{admin.error}</p>
      </main>
    );
  }

  const db = controlPlaneClient();
  if (!db) {
    return (
      <main className="mx-auto max-w-lg p-10">
        <h1 className="text-lg font-semibold text-slate-900">Control plane</h1>
        <p className="mt-2 text-sm text-slate-600">
          The control-plane database is not configured. Set
          <code className="mx-1">CONTROL_PLANE_SUPABASE_URL</code> and
          <code className="mx-1">CONTROL_PLANE_SERVICE_ROLE_KEY</code>.
        </p>
      </main>
    );
  }

  const [tenants, overrides, audit] = await Promise.all([
    listTenants(db),
    listOverrides(db),
    recentAudit(db, 40),
  ]);

  const grid = tenants.map((t) => ({
    tenant: t,
    flags: resolveEffectiveFlags(overrides, t.id),
  }));

  return <AdminConsole admin={admin.email} grid={grid} audit={audit} />;
}
