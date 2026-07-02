"use client";

import { useEffect } from "react";

type DashboardErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    console.error("Dashboard route failed", error);
  }, [error]);

  return (
    <main className="dashboard-error-page">
      <section className="dashboard-error-panel">
        <span className="dashboard-error-icon" aria-hidden="true">
          !
        </span>
        <p className="eyebrow">Dashboard error</p>
        <h1>The dashboard could not load this view.</h1>
        <p>
          A live data read failed while rendering the page. Try again now; if it
          keeps happening, the logged error digest can be matched in Vercel.
        </p>
        {error.digest ? (
          <code className="dashboard-error-digest">{error.digest}</code>
        ) : null}
        <button className="button button-primary" onClick={reset} type="button">
          Reload dashboard
        </button>
      </section>
    </main>
  );
}
