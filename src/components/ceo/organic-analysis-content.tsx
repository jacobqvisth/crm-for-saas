import { compactNumber, formatNumber, formatPercent } from "@/lib/ceo/format";
import type {
  OrganicAnalysisData,
  OrganicAnalysisTotals,
  OrganicFinding,
  OrganicFindingSeverity,
  OrganicHostSeries,
} from "@/lib/ceo/data/organic-analysis";

type Props = { data: OrganicAnalysisData };

const SEVERITY_LABEL: Record<OrganicFindingSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Context",
  good: "Positive",
};

// Reuses the existing status-pill palette so this page looks native rather
// than introducing a second colour language for severity.
const SEVERITY_PILL: Record<OrganicFindingSeverity, string> = {
  critical: "status-pill failed",
  warning: "status-pill running",
  info: "status-pill skipped",
  good: "status-pill success",
};

function shortHost(host: string) {
  return host.replace(/^www\./, "");
}

function shortPage(page: string) {
  const trimmed = page.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed;
}

function deltaLabel(current: number, previous: number | undefined) {
  if (previous === undefined || previous <= 0) return null;
  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(0)}% vs previous period`;
}

function Sparkline({
  points,
  height = 44,
}: {
  points: { date: string; impressions: number }[];
  height?: number;
}) {
  if (points.length < 2) return null;

  const max = Math.max(...points.map((point) => point.impressions), 1);
  const width = 240;
  const step = width / (points.length - 1);
  const path = points
    .map((point, index) => {
      const x = index * step;
      const y = height - (point.impressions / max) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="organic-spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Impressions trend, peak ${Math.round(max)} per day`}
    >
      <path d={`${path} L${width},${height} L0,${height} Z`} className="organic-spark-fill" />
      <path d={path} className="organic-spark-line" />
    </svg>
  );
}

function KpiRow({
  totals,
  previous,
}: {
  totals: OrganicAnalysisTotals;
  previous: OrganicAnalysisTotals | null;
}) {
  const cards = [
    {
      label: "Clicks",
      value: formatNumber(totals.clicks),
      hint: deltaLabel(totals.clicks, previous?.clicks) ?? "No prior period",
      tone: "tone-growth",
    },
    {
      label: "Impressions",
      value: compactNumber(totals.impressions),
      hint: deltaLabel(totals.impressions, previous?.impressions) ?? "No prior period",
      tone: "tone-neutral",
    },
    {
      label: "CTR",
      value: formatPercent(totals.ctr, 2),
      hint:
        previous && previous.ctr > 0
          ? `was ${formatPercent(previous.ctr, 2)}`
          : "Clicks divided by impressions",
      tone: totals.ctr < 1 ? "tone-warning" : "tone-growth",
    },
    {
      label: "Avg. position",
      value: totals.position ? totals.position.toFixed(1) : "0.0",
      hint:
        previous && previous.position > 0
          ? `was ${previous.position.toFixed(1)}`
          : "Impression-weighted",
      tone: totals.position > 10 ? "tone-warning" : "tone-growth",
    },
  ];

  return (
    <section className="kpi-grid">
      {cards.map((card) => (
        <article className={`kpi-card ${card.tone}`} key={card.label}>
          <div className="kpi-card-main">
            <p>{card.label}</p>
            <strong>{card.value}</strong>
          </div>
          <p className="kpi-card-hint">{card.hint}</p>
        </article>
      ))}
    </section>
  );
}

function FindingsPanel({ findings }: { findings: OrganicFinding[] }) {
  return (
    <article className="panel panel-wide">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Diagnosis</p>
          <h2>What is actually happening</h2>
          <p className="panel-description">
            Generated from the Search Console data in range. Ordered by severity, not by
            the order the checks run.
          </p>
        </div>
        <span className="badge">{findings.length} findings</span>
      </div>

      {findings.length === 0 ? (
        <div className="empty-state">
          <strong>Nothing stands out</strong>
          <span>
            No step changes, ranking collapses, or coverage losses were detected in this
            range. Widen the range to 90 days if you expect to see a trend.
          </span>
        </div>
      ) : (
        <ul className="organic-findings">
          {findings.map((finding) => (
            <li key={finding.title} className="organic-finding">
              <div className="organic-finding-head">
                <span className={SEVERITY_PILL[finding.severity]}>
                  {SEVERITY_LABEL[finding.severity]}
                </span>
                <strong>{finding.title}</strong>
              </div>
              <p>{finding.detail}</p>
              {finding.action ? (
                <p className="organic-finding-action">{finding.action}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function HostPanel({ hosts }: { hosts: OrganicHostSeries[] }) {
  return (
    <article className="panel panel-wide">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Hostname split</p>
          <h2>Which property is moving</h2>
          <p className="panel-description">
            Totals hide subdomain behaviour. A collapse on one host and growth on another
            can net out to a flat line, so they are separated here.
          </p>
        </div>
      </div>

      {hosts.length === 0 ? (
        <div className="empty-state">
          <strong>No page-level data</strong>
          <span>Search Console page rows have not synced for this range yet.</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Host</th>
                <th>Trend</th>
                <th>Impressions</th>
                <th>Clicks</th>
                <th>CTR</th>
                <th>Share</th>
                <th>Start / end per day</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((host) => (
                <tr key={host.host}>
                  <td className="table-primary">
                    <span className="table-primary-name">{shortHost(host.host)}</span>
                  </td>
                  <td style={{ width: "13rem" }}>
                    <Sparkline points={host.points} />
                  </td>
                  <td>{compactNumber(host.impressions)}</td>
                  <td>{formatNumber(host.clicks)}</td>
                  <td>{formatPercent(host.ctr, 2)}</td>
                  <td>{formatPercent(host.share, 0)}</td>
                  <td>
                    {Math.round(host.startRate).toLocaleString("en-US")} to{" "}
                    {Math.round(host.endRate).toLocaleString("en-US")}
                    {host.changePct !== null ? (
                      <small className="table-secondary">
                        {" "}
                        ({host.changePct >= 0 ? "+" : ""}
                        {host.changePct.toFixed(0)}%)
                      </small>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function QueryTable({
  rows,
  emptyTitle,
  emptyBody,
}: {
  rows: { query: string; impressions: number; clicks: number; position: number }[];
  emptyTitle: string;
  emptyBody: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <strong>{emptyTitle}</strong>
        <span>{emptyBody}</span>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Query</th>
            <th>Impressions</th>
            <th>Clicks</th>
            <th>Position</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.query}>
              <td className="table-primary">
                <span className="table-primary-name">{row.query}</span>
              </td>
              <td>{formatNumber(row.impressions)}</td>
              <td>{formatNumber(row.clicks)}</td>
              <td>{row.position.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OrganicAnalysisContent({ data }: Props) {
  if (data.error) {
    return (
      <div className="section-stack">
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Organic Analysis</p>
              <h2>Could not load Search Console analysis</h2>
            </div>
          </div>
          <div className="empty-state">
            <strong>Query failed</strong>
            <span>{data.error}</span>
          </div>
        </article>
      </div>
    );
  }

  const maxMonthlyPages = Math.max(
    1,
    ...data.monthlyByHost.map((row) => row.pages),
  );

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Organic Analysis</p>
            <h2>Search performance — {data.rangeLabel}</h2>
            <p className="panel-description">{data.rangeSpan}</p>
          </div>
          <span className="badge">Search Console</span>
        </div>
        <KpiRow totals={data.totals} previous={data.previousTotals} />
      </article>

      <FindingsPanel findings={data.findings} />

      <HostPanel hosts={data.hosts} />

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SERP depth</p>
              <h2>Where impressions rank</h2>
              <p className="panel-description">
                Impressions below position 10 rarely convert. This is usually the whole
                explanation for a low sitewide CTR.
              </p>
            </div>
          </div>
          {data.buckets.length === 0 ? (
            <div className="empty-state">
              <strong>No query rows</strong>
              <span>Position data needs query-level Search Console rows.</span>
            </div>
          ) : (
            <div className="bar-list">
              {data.buckets.map((bucket) => {
                const max = Math.max(
                  1,
                  ...data.buckets.map((item) => item.impressions),
                );
                return (
                  <div className="bar-row" key={bucket.bucket}>
                    <div className="bar-row-copy">
                      <strong>Position {bucket.bucket}</strong>
                      <span>
                        {formatPercent(bucket.share, 0)} of impressions ·{" "}
                        {formatPercent(bucket.ctr, 2)} CTR
                      </span>
                    </div>
                    <div className="bar-row-main">
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{
                            width: `${Math.max(4, (bucket.impressions / max) * 100)}%`,
                          }}
                        />
                      </div>
                      <strong>
                        {compactNumber(bucket.impressions)}
                        <small> · {formatNumber(bucket.clicks)} clicks</small>
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Brand pull</p>
              <h2>Branded vs non-branded</h2>
              <p className="panel-description">
                Branded clicks are demand you already earned. Only the non-branded line
                represents new discovery.
              </p>
            </div>
          </div>
          {data.branded.length === 0 ? (
            <div className="empty-state">
              <strong>No query rows</strong>
              <span>The branded split needs query-level rows in range.</span>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Branded</th>
                    <th>Non-branded</th>
                    <th>Brand share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.branded.map((row) => {
                    const total = row.brandedClicks + row.nonbrandedClicks;
                    const share = total > 0 ? (row.brandedClicks / total) * 100 : 0;
                    return (
                      <tr key={row.month}>
                        <td className="table-primary">
                          <span className="table-primary-name">{row.month}</span>
                        </td>
                        <td>
                          {formatNumber(row.brandedClicks)}
                          <small className="table-secondary">
                            {" "}
                            / {compactNumber(row.brandedImpressions)} impr
                          </small>
                        </td>
                        <td>
                          {formatNumber(row.nonbrandedClicks)}
                          <small className="table-secondary">
                            {" "}
                            / {compactNumber(row.nonbrandedImpressions)} impr
                          </small>
                        </td>
                        <td>{formatPercent(share, 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Content velocity</p>
            <h2>Pages earning impressions per month</h2>
            <p className="panel-description">
              The count of distinct URLs with any impressions. A shrinking count means
              ranking coverage is being lost even when total impressions look steady.
            </p>
          </div>
        </div>
        {data.monthlyByHost.length === 0 ? (
          <div className="empty-state">
            <strong>No page rows</strong>
            <span>Page-level Search Console rows have not synced for this range.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Host</th>
                  <th>Pages with impressions</th>
                  <th>Impressions</th>
                  <th>Clicks</th>
                </tr>
              </thead>
              <tbody>
                {data.monthlyByHost.map((row) => (
                  <tr key={`${row.month}-${row.host}`}>
                    <td className="table-primary">
                      <span className="table-primary-name">{row.month}</span>
                    </td>
                    <td>{shortHost(row.host)}</td>
                    <td>
                      <div className="bar-row-main">
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${Math.max(4, (row.pages / maxMonthlyPages) * 100)}%`,
                            }}
                          />
                        </div>
                        <strong>{formatNumber(row.pages)}</strong>
                      </div>
                    </td>
                    <td>{compactNumber(row.impressions)}</td>
                    <td>{formatNumber(row.clicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Upside</p>
              <h2>Queries just off page 1</h2>
              <p className="panel-description">
                Ranking 11 to 20 with real volume. The cheapest clicks available, because
                the ranking work is already most of the way done.
              </p>
            </div>
          </div>
          <QueryTable
            rows={data.pageTwo}
            emptyTitle="No page-2 queries"
            emptyBody="Nothing in range ranks 11 to 20 with at least 50 impressions."
          />
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Dead weight</p>
              <h2>Impressions with zero clicks</h2>
              <p className="panel-description">
                Queries you are visible for that nobody clicks. Usually definitional
                questions answered directly in the results page.
              </p>
            </div>
          </div>
          <QueryTable
            rows={data.zeroClick}
            emptyTitle="No zero-click queries"
            emptyBody="Every query with 50+ impressions earned at least one click."
          />
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Geography</p>
              <h2>Volume vs intent by country</h2>
              <p className="panel-description">
                High impressions at low CTR means the traffic is landing outside the
                markets that care.
              </p>
            </div>
          </div>
          {data.countries.length === 0 ? (
            <div className="empty-state">
              <strong>No country rows</strong>
              <span>Country-level rows have not synced for this range.</span>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Country</th>
                    <th>Impressions</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.countries.map((row) => (
                    <tr key={row.country}>
                      <td className="table-primary">
                        <span className="table-primary-name">{row.country}</span>
                      </td>
                      <td>{compactNumber(row.impressions)}</td>
                      <td>{formatNumber(row.clicks)}</td>
                      <td>{formatPercent(row.ctr, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Pages</p>
              <h2>Top pages by impressions</h2>
              <p className="panel-description">
                Sorted by reach rather than clicks so the high-impression low-CTR pages
                stay visible.
              </p>
            </div>
          </div>
          {data.topPages.length === 0 ? (
            <div className="empty-state">
              <strong>No page rows</strong>
              <span>Page-level rows have not synced for this range.</span>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Impressions</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                    <th>Position</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topPages.map((row) => (
                    <tr key={row.page}>
                      <td className="table-primary">
                        <span className="table-primary-name">{shortPage(row.page)}</span>
                      </td>
                      <td>{compactNumber(row.impressions)}</td>
                      <td>{formatNumber(row.clicks)}</td>
                      <td>{formatPercent(row.ctr, 2)}</td>
                      <td>{row.position.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
