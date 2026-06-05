import Link from "next/link";
import {
  addPatternAction,
  removePatternAction,
  setUserExemptAction,
  setUserInternalAction,
  setWorkshopInternalAction,
} from "@/app/(dashboard)/dashboard/settings/actions";
import type {
  InternalTestPatternRecord,
  SettingsUserSearchRow,
  SettingsWorkshopSearchRow,
} from "@/lib/ceo/internal-test/loader";

export type InternalTestKind = "users" | "workshops" | "patterns";

const SUB_TABS: Array<{ key: InternalTestKind; label: string }> = [
  { key: "users", label: "Users" },
  { key: "workshops", label: "Workshops" },
  { key: "patterns", label: "Email / username patterns" },
];

function tabHref(kind: InternalTestKind, query: string) {
  const params = new URLSearchParams();
  params.set("tab", "internal");
  params.set("kind", kind);
  if (query) params.set("q", query);
  return `/dashboard/settings?${params.toString()}`;
}

function statusLabel(row: SettingsUserSearchRow) {
  if (row.isInternalTestExempt && row.isInternalTest) {
    return "Internal + Exempt";
  }
  if (row.isInternalTestExempt) return "Exempt";
  if (row.isInternalTest) return "Internal";
  return "External";
}

function formatDateTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function InternalTestSubTabs({
  active,
  query,
}: {
  active: InternalTestKind;
  query: string;
}) {
  return (
    <nav className="settings-tab-bar">
      {SUB_TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tabHref(tab.key, query)}
          className={tab.key === active ? "active" : ""}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function InternalTestSearchForm({
  kind,
  query,
}: {
  kind: InternalTestKind;
  query: string;
}) {
  return (
    <form className="filter-form" method="get">
      <input type="hidden" name="tab" value="internal" />
      <input type="hidden" name="kind" value={kind} />
      <input
        aria-label={`Search ${kind}`}
        defaultValue={query}
        name="q"
        placeholder={
          kind === "users"
            ? "Search by name, internal_user_id, workshop_id, or note"
            : kind === "workshops"
              ? "Search by name, workshop_id, country, or note"
              : "Search not used here"
        }
        type="search"
        disabled={kind === "patterns"}
      />
      <button className="button button-primary" type="submit">
        Search
      </button>
      {query && (
        <Link className="button" href={tabHref(kind, "")}>
          Clear
        </Link>
      )}
    </form>
  );
}

export function InternalTestUsersTable({
  rows,
}: {
  rows: SettingsUserSearchRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="settings-empty-row">
        No users matched. Search by name, ID, or workshop ID — or use the form
        below to flag a user by their AWS Cognito sub.
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Workshop</th>
            <th>Status</th>
            <th>Note</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.internalUserId}>
              <td>
                <div className="table-primary">
                  <strong>
                    {row.name ?? row.username ?? row.internalUserId}
                  </strong>
                  <span>
                    <code>{row.internalUserId}</code>
                    {row.emailDomain ? ` · ${row.emailDomain}` : ""}
                  </span>
                </div>
              </td>
              <td>
                {row.workshopId ? <code>{row.workshopId}</code> : "—"}
              </td>
              <td>
                <span
                  className={`internal-pill${row.isInternalTestExempt ? " exempt" : ""}`}
                >
                  {statusLabel(row)}
                </span>
              </td>
              <td>{row.internalTestNote ?? "—"}</td>
              <td>
                <div className="settings-row-actions">
                  <form
                    action={setUserInternalAction}
                    className="settings-inline-form"
                  >
                    <input
                      type="hidden"
                      name="userId"
                      value={row.internalUserId}
                    />
                    <input
                      type="hidden"
                      name="isInternal"
                      value={row.isInternalTest ? "false" : "true"}
                    />
                    <input
                      type="hidden"
                      name="note"
                      value={row.internalTestNote ?? ""}
                    />
                    <button
                      className={`button ${row.isInternalTest ? "button-danger" : "button-primary"}`}
                      type="submit"
                    >
                      {row.isInternalTest ? "Remove internal" : "Mark internal"}
                    </button>
                  </form>
                  <form
                    action={setUserExemptAction}
                    className="settings-inline-form"
                  >
                    <input
                      type="hidden"
                      name="userId"
                      value={row.internalUserId}
                    />
                    <input
                      type="hidden"
                      name="isExempt"
                      value={row.isInternalTestExempt ? "false" : "true"}
                    />
                    <input
                      type="hidden"
                      name="note"
                      value={row.internalTestNote ?? ""}
                    />
                    <button
                      className={`button ${row.isInternalTestExempt ? "button-danger" : "button-ghost"}`}
                      type="submit"
                    >
                      {row.isInternalTestExempt
                        ? "Remove exempt"
                        : "Mark exempt"}
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InternalTestWorkshopsTable({
  rows,
}: {
  rows: SettingsWorkshopSearchRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="settings-empty-row">
        No workshops matched. Search by name, ID, country, or note — or use the
        form below to flag a workshop by its UUID.
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Workshop</th>
            <th>Country</th>
            <th>Status</th>
            <th>Note</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.workshopId}>
              <td>
                <div className="table-primary">
                  <strong>{row.name ?? row.workshopId}</strong>
                  <span>
                    <code>{row.workshopId}</code>
                  </span>
                </div>
              </td>
              <td>{row.country ?? "—"}</td>
              <td>
                <span
                  className={`internal-pill${row.isInternalTest ? "" : " exempt"}`}
                >
                  {row.isInternalTest ? "Internal" : "External"}
                </span>
              </td>
              <td>{row.internalTestNote ?? "—"}</td>
              <td>
                <form
                  action={setWorkshopInternalAction}
                  className="settings-inline-form"
                >
                  <input
                    type="hidden"
                    name="workshopId"
                    value={row.workshopId}
                  />
                  <input
                    type="hidden"
                    name="isInternal"
                    value={row.isInternalTest ? "false" : "true"}
                  />
                  <input
                    type="hidden"
                    name="note"
                    value={row.internalTestNote ?? ""}
                  />
                  <button
                    className={`button ${row.isInternalTest ? "button-danger" : "button-primary"}`}
                    type="submit"
                  >
                    {row.isInternalTest ? "Remove internal" : "Mark internal"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InternalTestUserAddById() {
  return (
    <form action={setUserInternalAction} className="settings-add-form">
      <span>Add by user ID</span>
      <input
        aria-label="internal_user_id"
        name="userId"
        placeholder="AWS Cognito sub (UUID-like)"
        required
      />
      <input
        aria-label="Note"
        name="note"
        placeholder="Optional note (label, reason)"
      />
      <input type="hidden" name="isInternal" value="true" />
      <button className="button button-primary" type="submit">
        Mark internal
      </button>
    </form>
  );
}

export function InternalTestWorkshopAddById() {
  return (
    <form action={setWorkshopInternalAction} className="settings-add-form">
      <span>Add by workshop ID</span>
      <input
        aria-label="workshop_id"
        name="workshopId"
        placeholder="Workshop UUID"
        required
      />
      <input
        aria-label="Note"
        name="note"
        placeholder="Optional note (label, reason)"
      />
      <input type="hidden" name="isInternal" value="true" />
      <button className="button button-primary" type="submit">
        Mark internal
      </button>
    </form>
  );
}

export function InternalTestPatternsTable({
  rows,
}: {
  rows: InternalTestPatternRecord[];
}) {
  return (
    <>
      <form action={addPatternAction} className="settings-add-form">
        <select aria-label="Pattern kind" name="kind" defaultValue="email">
          <option value="email">email</option>
          <option value="username">username</option>
        </select>
        <input
          aria-label="Pattern value"
          name="value"
          placeholder="hans@codeoc.ai or hans_m"
          required
        />
        <input
          aria-label="Note"
          name="note"
          placeholder="Optional note"
        />
        <button className="button button-primary" type="submit">
          Add pattern
        </button>
      </form>
      {rows.length === 0 ? (
        <div className="settings-empty-row">
          No patterns yet. Patterns are a fallback for rows that don&apos;t
          match a known internal user or workshop ID.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Value</th>
                <th>Note</th>
                <th>Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.kind}</td>
                  <td>
                    <code>{row.value}</code>
                  </td>
                  <td>{row.note ?? "—"}</td>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>
                    <form
                      action={removePatternAction}
                      className="settings-inline-form"
                    >
                      <input type="hidden" name="id" value={row.id} />
                      <button className="button button-danger" type="submit">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
