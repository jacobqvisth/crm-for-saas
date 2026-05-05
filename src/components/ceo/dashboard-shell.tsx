import type { ReactNode } from "react";
import { logout } from "@/lib/ceo/auth-actions";
import { DEFAULT_TIME_RANGE_KEY } from "@/lib/ceo/time-ranges";
import type { DashboardData } from "@/lib/ceo/metrics/types";
import {
  DASHBOARD_SECTIONS,
  getDashboardSectionConfig,
  type DashboardSectionKey,
} from "./dashboard-sections";

type DashboardShellProps = {
  data: DashboardData;
  section: DashboardSectionKey;
  children: ReactNode;
  headerActions?: ReactNode;
  headerSubtext?: ReactNode;
};

function hrefWithRange(href: string, range: string) {
  return range === DEFAULT_TIME_RANGE_KEY ? href : `${href}?range=${range}`;
}

export function DashboardShell({
  data,
  section,
  children,
  headerActions,
  headerSubtext,
}: DashboardShellProps) {
  const page = getDashboardSectionConfig(section);

  return (
    <main className="dashboard-app">
      <aside className="app-sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">W</span>
          <div>
            <strong>WrenchLane</strong>
            <span>Growth Command Center</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Dashboard sections">
          {DASHBOARD_SECTIONS.map((item) => (
            <a
              className={`sidebar-link${item.key === section ? " active" : ""}`}
              href={hrefWithRange(item.href, data.selectedRange)}
              key={item.key}
            >
              <span className="sidebar-icon">{item.glyph}</span>
              <span className="sidebar-copy">
                <strong>{item.label}</strong>
                <small>{item.title}</small>
              </span>
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="profile-chip">
            <span>J</span>
            <div>
              <strong>Jacob Qvisth</strong>
              <small>jacob@wrenchlane.com</small>
            </div>
          </div>
          <form action={logout}>
            <button className="button button-ghost" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <h1>{page.title}</h1>
            {headerSubtext ? (
              <div className="dashboard-header-subtext">{headerSubtext}</div>
            ) : null}
          </div>
          {headerActions ? (
            <div className="dashboard-header-actions">{headerActions}</div>
          ) : null}
        </header>

        <div className="dashboard-range-bar">
          <nav className="range-tabs" aria-label="Choose time frame">
            {data.timeRangeOptions.map((option) => (
              <a
                aria-current={option.active ? "page" : undefined}
                className={`range-tab${option.active ? " active" : ""}`}
                href={hrefWithRange(page.href, option.key)}
                key={option.key}
                title={option.description}
              >
                {option.label}
              </a>
            ))}
          </nav>
        </div>

        {data.setupMode ? (
          <section className="setup-banner">
            <strong>Setup mode:</strong> add Supabase and source API environment
            variables to replace demo metrics with live WrenchLane data.
          </section>
        ) : null}

        {data.hasLimitedHistory ? (
          <section className="setup-banner history-banner">
            <strong>Limited synced history:</strong> this range has little or no
            stored data yet. The dashboard will fill in as hourly syncs accumulate
            or after a backfill is run.
          </section>
        ) : null}

        {children}
      </section>
    </main>
  );
}
