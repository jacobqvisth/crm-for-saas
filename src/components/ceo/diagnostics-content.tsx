import Link from "next/link";
import { compactNumber, formatCurrency, formatNumber } from "@/lib/ceo/format";
import type {
  DiagnosticCause,
  DiagnosticListItem,
} from "@/lib/ceo/data/diagnostics";
import { InfoHint } from "./source-info";
import { sourceInfoFromLabel } from "./source-info-data";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "completed", label: "Completed" },
  { value: "ongoing", label: "Ongoing" },
  { value: "failed", label: "Failed" },
  { value: "deleted", label: "Deleted" },
];

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function statusClass(status: string | null) {
  switch (status) {
    case "completed":
      return "success";
    case "ongoing":
      return "running";
    case "failed":
      return "failed";
    case "deleted":
      return "skipped";
    default:
      return "skipped";
  }
}

function severityClass(severity: string | null) {
  switch ((severity ?? "").toLowerCase()) {
    case "high":
      return "failed";
    case "medium":
      return "running";
    case "low":
      return "success";
    default:
      return "skipped";
  }
}

function probabilityLabel(value: number | null) {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

function carLabel(item: DiagnosticListItem) {
  const parts = [item.carMake, item.carModel, item.carYear ? String(item.carYear) : null].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" ") : "—";
}

function truncate(value: string | null, max = 80) {
  if (!value) return "—";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function LabelInfo({ label }: { label: string }) {
  return (
    <span className="label-with-info">
      <span>{label}</span>
      <InfoHint info={sourceInfoFromLabel(label)} />
    </span>
  );
}

function TableHeading({ label, info }: { label: string; info?: string }) {
  return (
    <span className="table-heading-info">
      <span>{label}</span>
      <InfoHint info={info ?? sourceInfoFromLabel(label)} />
    </span>
  );
}

function HeadingInfo({ label, info }: { label: string; info?: string }) {
  return (
    <h2 className="heading-with-info">
      <span>{label}</span>
      <InfoHint info={info ?? sourceInfoFromLabel(label)} />
    </h2>
  );
}

function buildHref(
  params: Record<string, string | null | undefined>,
  current: Record<string, string>,
) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  const query = next.toString();
  return query ? `/dashboard/diagnostics?${query}` : "/dashboard/diagnostics";
}

export function DiagnosticsContent({
  items,
  selectedDiagnosticId,
  query,
  status,
  showInternal,
  rangeKey,
}: {
  items: DiagnosticListItem[];
  selectedDiagnosticId: string | null;
  query: string;
  status: string;
  showInternal: boolean;
  rangeKey: string;
}) {
  const currentParams: Record<string, string> = {};
  if (query) currentParams.q = query;
  if (status && status !== "all") currentParams.status = status;
  if (showInternal) currentParams.showInternal = "1";
  if (rangeKey && rangeKey !== "last_30_days") currentParams.range = rangeKey;

  const completed = items.filter((item) => item.status === "completed").length;
  const ongoing = items.filter((item) => item.status === "ongoing").length;
  const totalCost = items.reduce((sum, item) => sum + item.diagCost, 0);
  const selectedDiagnostic = selectedDiagnosticId
    ? items.find((item) => item.diagnosticId === selectedDiagnosticId) ?? null
    : null;

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Diagnostics Drilldown</p>
            <h2>Every diagnostic session that ran in the selected window.</h2>
            <p className="hero-text">
              Per-diagnostic view: who ran it, which workshop, the vehicle, the
              DTC fault codes, the description, and the full ranked list of AI
              causes — including severity, suggested tests, and matching fault
              codes for each cause. Source: <code>dashboard_diagnostics</code>{" "}
              joined to <code>dashboard_users</code> +{" "}
              <code>dashboard_workshops</code>, synced hourly from the core app
              S3 export.
            </p>
            <p className="hero-text" style={{ marginTop: "0.5rem", fontSize: "0.8rem", opacity: 0.75 }}>
              Note: mileage is not present in the current S3 export. The column
              shows “—” until the upstream schema starts emitting an odometer
              field.
            </p>
          </div>
          <div className="summary-grid columns-2">
            <div className="summary-card">
              <strong>{formatNumber(items.length)}</strong>
              <LabelInfo label="Diagnostics in range" />
              <small>Based on current filters</small>
            </div>
            <div className="summary-card">
              <strong>{formatNumber(completed)}</strong>
              <LabelInfo label="Completed" />
              <small>{formatNumber(ongoing)} ongoing</small>
            </div>
            <div className="summary-card">
              <strong>{compactNumber(items.reduce((sum, item) => sum + item.numCauses, 0))}</strong>
              <LabelInfo label="AI causes generated" />
              <small>Sum across all diagnostics</small>
            </div>
            <div className="summary-card">
              <strong>{formatCurrency(totalCost)}</strong>
              <LabelInfo label="AI diagnostic cost" />
              <small>Sum of diag_cost in range</small>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Filters</p>
            <HeadingInfo
              label="Search and slice the list"
              info="Search runs across username, workshop, country, car make/model, DTC code, and description. Status uses the canonical core-app diagnostic status."
            />
          </div>
        </div>
        <form className="filter-form" method="get">
          {rangeKey && rangeKey !== "last_30_days" ? (
            <input type="hidden" name="range" value={rangeKey} />
          ) : null}
          <input
            aria-label="Search diagnostics"
            defaultValue={query}
            name="q"
            placeholder="Search by username, workshop, car, DTC, or description"
            type="search"
          />
          <select aria-label="Filter by status" defaultValue={status} name="status">
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="filter-toggle">
            <input
              type="checkbox"
              name="showInternal"
              value="1"
              defaultChecked={showInternal}
            />
            <span>Show internal</span>
          </label>
          <button className="button button-primary" type="submit">
            Apply
          </button>
          {(query || status !== "all" || showInternal) && (
            <Link
              className="button"
              href={
                rangeKey && rangeKey !== "last_30_days"
                  ? `/dashboard/diagnostics?range=${rangeKey}`
                  : "/dashboard/diagnostics"
              }
            >
              Clear
            </Link>
          )}
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Sessions</p>
            <HeadingInfo
              label="Diagnostics leaderboard"
              info="One row per diagnostic. Top cause shows the highest-probability AI hypothesis; click ‘View causes’ to see the full ranked list with severity, suggested tests, and matching DTCs."
            />
          </div>
          <span className="badge">{formatNumber(items.length)} rows</span>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th><TableHeading label="When" /></th>
                <th><TableHeading label="User" info="Username from dashboard_users.metadata.username. Email is hashed for privacy in the warehouse." /></th>
                <th><TableHeading label="Workshop" /></th>
                <th><TableHeading label="Car" info="Make, model, and year from dashboard_diagnostics.metadata. Mileage is not present in the current S3 export." /></th>
                <th><TableHeading label="DTCs" info="Diagnostic Trouble Codes the user entered for this diagnostic session." /></th>
                <th><TableHeading label="Symptoms" /></th>
                <th><TableHeading label="Description" /></th>
                <th><TableHeading label="Top cause" info="The highest-probability AI cause. Click ‘View causes’ to see all ranked causes with full descriptions, severity, and suggested tests." /></th>
                <th><TableHeading label="Status" /></th>
                <th><TableHeading label="Cost" info="diag_cost in USD — input + output tokens billed for this diagnostic session." /></th>
                <th><span className="table-heading-info"><span>Causes</span></span></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <div className="empty-state">
                      <strong>No diagnostics in this window</strong>
                      <p>
                        Try a wider time range, clear filters, or toggle “Show
                        internal” to include test workshops.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.diagnosticId}>
                    <td>
                      <div className="table-primary">
                        <strong>{formatDateTime(item.createdAt)}</strong>
                        <span className="table-secondary">
                          {item.aiModel ?? "no model"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="table-primary">
                        <span className="table-primary-name">
                          <strong>{item.username ?? item.userName ?? "—"}</strong>
                          {item.isInternal ? (
                            <span
                              className="internal-pill"
                              title="Internal-test user/workshop — hidden by default"
                            >
                              Internal
                            </span>
                          ) : null}
                        </span>
                        <span className="table-secondary">
                          {item.userRole ?? "user"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="table-primary">
                        {item.workshopId ? (
                          <Link href={`/dashboard/workshops/${item.workshopId}`}>
                            <strong>{item.workshopName ?? "—"}</strong>
                          </Link>
                        ) : (
                          <strong>{item.workshopName ?? "—"}</strong>
                        )}
                        <span className="table-secondary">
                          {[item.country, item.language]
                            .filter((part): part is string => Boolean(part))
                            .join(" · ") || "—"}
                        </span>
                      </div>
                    </td>
                    <td>{carLabel(item)}</td>
                    <td>{item.dtcs.length > 0 ? item.dtcs.join(", ") : "—"}</td>
                    <td>{item.symptoms.length > 0 ? item.symptoms.join(", ") : "—"}</td>
                    <td title={item.description ?? undefined}>
                      {truncate(item.description, 60)}
                    </td>
                    <td>
                      {item.topCause ? (
                        <div className="table-primary">
                          <strong>{truncate(item.topCause.name, 40)}</strong>
                          <span className="table-secondary">
                            {probabilityLabel(item.topCause.probability)}
                            {item.topCause.severity
                              ? ` · ${item.topCause.severity}`
                              : ""}
                          </span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className={`status-pill ${statusClass(item.status)}`}>
                        {item.status ?? "unknown"}
                      </span>
                    </td>
                    <td>{formatCurrency(item.diagCost)}</td>
                    <td>
                      <Link
                        className="button"
                        href={buildHref(
                          { d: item.diagnosticId },
                          currentParams,
                        )}
                      >
                        View causes ({item.causes.length})
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedDiagnostic ? (
        <DiagnosticDetailPanel
          item={selectedDiagnostic}
          closeHref={buildHref({ d: null }, currentParams)}
        />
      ) : null}
    </div>
  );
}

function DiagnosticDetailPanel({
  item,
  closeHref,
}: {
  item: DiagnosticListItem;
  closeHref: string;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Diagnostic Detail</p>
          <h2>
            {carLabel(item)} · {formatDateTime(item.createdAt)}
          </h2>
          <p className="panel-description">
            {item.username ?? item.userName ?? "Unknown user"} ·{" "}
            {item.workshopName ?? "Unknown workshop"} ·{" "}
            {item.country ?? "no country"}
          </p>
        </div>
        <Link className="button" href={closeHref}>
          Close
        </Link>
      </div>

      <div className="summary-grid columns-4">
        <div className="summary-card">
          <strong>{item.dtcs.length > 0 ? item.dtcs.join(", ") : "—"}</strong>
          <LabelInfo label="DTC codes" />
        </div>
        <div className="summary-card">
          <strong>{item.symptoms.length > 0 ? item.symptoms.join(", ") : "—"}</strong>
          <LabelInfo label="Symptoms" />
        </div>
        <div className="summary-card">
          <strong>{item.mileage ? `${formatNumber(item.mileage)} km` : "—"}</strong>
          <LabelInfo label="Mileage" />
          <small>Not in current S3 export</small>
        </div>
        <div className="summary-card">
          <strong>{formatCurrency(item.diagCost)}</strong>
          <LabelInfo label="AI cost" />
          <small>{item.aiModel ?? "no model"}</small>
        </div>
      </div>

      {item.description ? (
        <div className="insight-list" style={{ marginTop: "1rem" }}>
          <p>
            <strong>User description:</strong> {item.description}
          </p>
        </div>
      ) : null}

      <div className="panel-heading" style={{ marginTop: "1.5rem" }}>
        <div>
          <p className="eyebrow">AI Ranked Causes</p>
          <h2>{item.causes.length} possible cause{item.causes.length === 1 ? "" : "s"}</h2>
        </div>
      </div>

      {item.causes.length === 0 ? (
        <div className="empty-state">
          <strong>No causes generated yet</strong>
          <p>
            This diagnostic has no <code>possible_causes</code> populated. It is
            likely still ongoing or failed before analysis completed.
          </p>
        </div>
      ) : (
        <div className="bar-list">
          {item.causes.map((cause, index) => (
            <CauseCard key={`${cause.id ?? index}-${cause.name}`} cause={cause} index={index} />
          ))}
        </div>
      )}
    </section>
  );
}

function CauseCard({
  cause,
  index,
}: {
  cause: DiagnosticCause;
  index: number;
}) {
  return (
    <article
      className="summary-card"
      style={{ alignItems: "stretch", textAlign: "left" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <strong>
          #{index + 1} {cause.name}
        </strong>
        <span className={`status-pill ${severityClass(cause.severity)}`}>
          {cause.severity ?? "unknown"} · {probabilityLabel(cause.probability)}
        </span>
        {cause.faultCodes.length > 0 ? (
          <span className="meta-pill">DTCs: {cause.faultCodes.join(", ")}</span>
        ) : null}
      </div>
      {cause.description ? (
        <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", lineHeight: 1.5 }}>
          {cause.description}
        </p>
      ) : null}
      {cause.suggestedTests.length > 0 ? (
        <div style={{ marginTop: "0.5rem" }}>
          <span className="table-secondary">Suggested tests:</span>
          <ul style={{ marginTop: "0.25rem", paddingLeft: "1.25rem" }}>
            {cause.suggestedTests.map((test) => (
              <li key={test} style={{ fontSize: "0.85rem" }}>
                {test}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
