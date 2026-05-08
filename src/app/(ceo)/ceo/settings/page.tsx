import Link from "next/link";
import { DashboardSectionContent } from "@/components/ceo/dashboard-sections";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import {
  InternalTestPatternsTable,
  InternalTestSearchForm,
  InternalTestSubTabs,
  InternalTestUserAddById,
  InternalTestUsersTable,
  InternalTestWorkshopAddById,
  InternalTestWorkshopsTable,
  type InternalTestKind,
} from "@/components/ceo/settings-internal-test";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import {
  listInternalTestPatterns,
  searchDashboardUsers,
  searchDashboardWorkshops,
} from "@/lib/ceo/internal-test/loader";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams: Promise<{
    range?: string | string[];
    tab?: string | string[];
    kind?: string | string[];
    q?: string | string[];
  }>;
};

function asString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeKind(value: string): InternalTestKind {
  if (value === "workshops" || value === "patterns" || value === "users") {
    return value;
  }
  return "users";
}

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const params = await searchParams;
  const range = params.range;
  const tab = asString(params.tab);
  const kind = normalizeKind(asString(params.kind));
  const query = asString(params.q).trim();

  const data = await getDashboardData(range);

  if (tab !== "internal") {
    return (
      <DashboardShell data={data} section="settings">
        <SettingsTopNav active="playbook" />
        <DashboardSectionContent data={data} section="settings" />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell data={data} section="settings">
      <div className="section-stack">
        <SettingsTopNav active="internal" />
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Internal-test exclusions</p>
              <h2>Manage which users, workshops, and patterns are filtered out</h2>
              <p className="panel-description">
                Anything flagged here gets excluded from the production-facing
                metrics on /ceo/new-users, /ceo/workshops, /ceo/app-usage, and
                the core_app sync. Use the user-level <em>Exempt</em> flag to
                count an individual user inside an otherwise-internal workshop
                (e.g. a real customer who happens to live in CodeOC).
              </p>
            </div>
          </div>
          <InternalTestSubTabs active={kind} query={query} />
        </section>

        {kind === "users" ? (
          <UsersPanel query={query} />
        ) : kind === "workshops" ? (
          <WorkshopsPanel query={query} />
        ) : (
          <PatternsPanel />
        )}
      </div>
    </DashboardShell>
  );
}

function SettingsTopNav({ active }: { active: "playbook" | "internal" }) {
  return (
    <nav className="settings-tab-bar" style={{ marginBottom: 16 }}>
      <Link
        href="/ceo/settings"
        className={active === "playbook" ? "active" : ""}
      >
        Playbook
      </Link>
      <Link
        href="/ceo/settings?tab=internal"
        className={active === "internal" ? "active" : ""}
      >
        Internal-test exclusions
      </Link>
    </nav>
  );
}

async function UsersPanel({ query }: { query: string }) {
  const rows = await searchDashboardUsers(query);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Users</p>
          <h2>Flag individual app users</h2>
          <p className="panel-description">
            Default sort surfaces the most-recently-flagged users. Search runs
            an ILIKE across name, internal_user_id, workshop_id, and the note.
            Use the form below to flag a user that hasn&apos;t been synced yet.
          </p>
        </div>
        <span className="badge">{rows.length} match{rows.length === 1 ? "" : "es"}</span>
      </div>
      <InternalTestSearchForm kind="users" query={query} />
      <InternalTestUsersTable rows={rows} />
      <InternalTestUserAddById />
    </section>
  );
}

async function WorkshopsPanel({ query }: { query: string }) {
  const rows = await searchDashboardWorkshops(query);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Workshops</p>
          <h2>Flag entire workshops</h2>
          <p className="panel-description">
            Flagging a workshop hides every diagnostic, chat, and member count
            sourced from it — except for users you&apos;ve marked{" "}
            <em>Exempt</em> in the Users tab.
          </p>
        </div>
        <span className="badge">{rows.length} match{rows.length === 1 ? "" : "es"}</span>
      </div>
      <InternalTestSearchForm kind="workshops" query={query} />
      <InternalTestWorkshopsTable rows={rows} />
      <InternalTestWorkshopAddById />
    </section>
  );
}

async function PatternsPanel() {
  const rows = await listInternalTestPatterns();
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Email + username patterns</p>
          <h2>Fallback matching</h2>
          <p className="panel-description">
            Patterns are checked when a row references an email or username
            without a matched user record. Stored lowercased; lookups are
            case-insensitive.
          </p>
        </div>
        <span className="badge">{rows.length} pattern{rows.length === 1 ? "" : "s"}</span>
      </div>
      <InternalTestPatternsTable rows={rows} />
    </section>
  );
}
