import type { ReactNode } from "react";
import type {
  InternalTestUserRecord,
  InternalTestWorkshopRecord,
} from "@/lib/ceo/internal-test/loader";

type InternalTestExclusionsPanelProps = {
  users: InternalTestUserRecord[];
  workshops: InternalTestWorkshopRecord[];
  // Per-page explanation of exactly which numbers the exclusion applies to.
  // Defaults to the GA4-aggregate caveat used by the Usage page.
  description?: ReactNode;
};

const DEFAULT_DESCRIPTION = (
  <>
    <strong>Diagnoses made</strong> excludes internal/test users (manual list +
    anyone signed up with an <code>@wrenchlane.com</code> email, auto-flagged at
    every core_app sync) and every user inside an internal/test workshop.{" "}
    <strong>
      GA4 unique users, sessions, page views, pages/session, and events
    </strong>{" "}
    still include internal traffic — GA4 has no way to map its pseudonymous
    counters back to the internal-test list because the product app does not
    send a user_id (or an <code>is_internal_test</code> user_property) to
    GA4/Firebase. Once the app starts emitting either, we can add a GA4{" "}
    <code>dimensionFilter</code> here. Manage the list at{" "}
    <a href="/dashboard/settings">/dashboard/settings</a>.
  </>
);

// Shared "what's filtered out of these numbers" panel. Lists the internal/test
// workshops and users that are excluded from a page's figures, behind a
// collapsible. Used by Usage, Top Lists, and any other page that filters
// internal traffic.
export function InternalTestExclusionsPanel({
  users,
  workshops,
  description = DEFAULT_DESCRIPTION,
}: InternalTestExclusionsPanelProps) {
  return (
    <section className="panel exclusion-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Internal-test exclusions</p>
          <h2>What&apos;s filtered out of these numbers</h2>
        </div>
        <span className="badge">
          {workshops.length} workshops · {users.length} users
        </span>
      </div>
      <p className="panel-description">{description}</p>
      <details className="exclusion-details">
        <summary>Show excluded workshops and users</summary>
        <div className="exclusion-grid">
          <div className="exclusion-column">
            <h3>Workshops</h3>
            <ul className="exclusion-list">
              {workshops.map((workshop) => (
                <li key={workshop.workshopId}>
                  <strong>{workshop.name ?? workshop.workshopId}</strong>
                  {workshop.internalTestNote ? (
                    <span className="exclusion-meta">
                      {workshop.internalTestNote}
                    </span>
                  ) : null}
                  <code>{workshop.workshopId}</code>
                </li>
              ))}
            </ul>
          </div>
          <div className="exclusion-column">
            <h3>Users</h3>
            <ul className="exclusion-list">
              {users
                .filter((user) => user.isInternalTest)
                .map((user) => (
                  <li key={user.internalUserId}>
                    <strong>
                      {user.internalTestNote ?? user.internalUserId}
                    </strong>
                    <code>{user.internalUserId}</code>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
