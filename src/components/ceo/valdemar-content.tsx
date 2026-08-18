"use client";

// Content for /dashboard/valdemar — Valdemar's personal outbound scoreboard.
// Two tabs (Calls / Emails), hand-rolled ceo-legacy.css charts like the other
// dashboard sections, and drill-downs: the shared CallDetailDrawer for call
// transcripts/recordings, a lightweight modal for per-email event timelines.

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { CallDetailDrawer } from "@/components/calls/call-now";
import { formatNumber } from "@/lib/ceo/format";
import {
  formatDurationSeconds,
  type BucketPoint,
  type ValdemarCallRow,
  type ValdemarEmailRow,
  type ValdemarKpi,
  type ValdemarStatsData,
  type ValdemarTab,
} from "@/lib/ceo/valdemar-shared";

const SERIES_COLORS = ["#465fff", "#12b76a", "#f79009", "#725cff"];

const dateTimeFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "–" : dateTimeFormatter.format(date);
}

function outcomePillClass(outcome: string | null): string {
  switch (outcome) {
    case "interested":
    case "closed":
      return "success";
    case "callback_scheduled":
    case "left_voicemail":
      return "running";
    case "not_interested":
    case "wrong_number":
      return "failed";
    default:
      return "skipped";
  }
}

function KpiGrid({ items }: { items: ValdemarKpi[] }) {
  if (items.length === 0) return null;
  return (
    <div className="summary-grid columns-4">
      {items.map((item) => (
        <div className="summary-card" key={item.label}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
          {item.hint ? <small>{item.hint}</small> : null}
        </div>
      ))}
    </div>
  );
}

function PanelHeading({
  eyebrow,
  title,
  badge,
  description,
}: {
  eyebrow: string;
  title: string;
  badge?: string;
  description?: string;
}) {
  return (
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {description ? <p className="panel-description">{description}</p> : null}
      </div>
      {badge ? <span className="badge">{badge}</span> : null}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

/** Grouped column chart on the ceo-legacy diagram classes. */
function BucketBars({
  points,
  series,
  valueFormatter = formatNumber,
}: {
  points: BucketPoint[];
  series: string[];
  valueFormatter?: (value: number) => string;
}) {
  const maxValue = Math.max(
    1,
    ...points.flatMap((point) => point.values),
  );
  if (points.length === 0 || points.every((p) => p.values.every((v) => !v))) {
    return (
      <EmptyState
        title="Nothing in this range yet"
        body="This chart fills in as activity lands in the selected window."
      />
    );
  }

  return (
    <div>
      <div className="diagram-legend">
        {series.map((label, index) => (
          <span key={label}>
            <i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />
            {label}
          </span>
        ))}
      </div>
      <div className="diagram-bars">
        {points.map((point) => (
          <div className="diagram-week" key={point.key}>
            <div
              className="diagram-pair"
              style={{
                gridTemplateColumns: `repeat(${series.length}, minmax(10px, 1fr))`,
              }}
            >
              {point.values.map((value, index) => (
                <span
                  className="diagram-bar"
                  key={`${point.key}-${series[index]}`}
                  style={
                    {
                      "--bar-height": `${Math.max(3, (value / maxValue) * 100)}%`,
                      background:
                        SERIES_COLORS[index % SERIES_COLORS.length],
                    } as CSSProperties
                  }
                >
                  <small>
                    {series[index]}: {valueFormatter(value)}
                  </small>
                </span>
              ))}
            </div>
            <span className="diagram-label">{point.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarList({
  items,
  emptyTitle,
  emptyBody,
}: {
  items: Array<{ label: string; value: number; valueLabel?: string; hint?: string }>;
  emptyTitle: string;
  emptyBody: string;
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  if (items.length === 0 || items.every((item) => !item.value)) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }
  return (
    <div className="bar-list">
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <div className="bar-row-copy">
            <strong>{item.label}</strong>
            {item.hint ? <span>{item.hint}</span> : null}
          </div>
          <div className="bar-row-main">
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${Math.max(4, (item.value / maxValue) * 100)}%` }}
              />
            </div>
            <strong>{item.valueLabel ?? formatNumber(item.value)}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function SegmentMeter({
  segments,
}: {
  segments: Array<{ label: string; value: number; colorClass: string }>;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) {
    return (
      <EmptyState
        title="No sentiment yet"
        body="AI sentiment appears once processed calls land in the range."
      />
    );
  }
  return (
    <div className="segment-meter">
      <div className="segment-track">
        {segments.map((segment) => (
          <span
            className={`segment-pill ${segment.colorClass}`}
            key={segment.label}
            style={{ width: `${Math.max(4, (segment.value / total) * 100)}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>
      <div className="segment-caption">
        {segments.map((segment) => (
          <span key={segment.label}>
            <i className={segment.colorClass} />
            {segment.label}: <strong>{segment.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function FunnelList({
  steps,
}: {
  steps: Array<{ key: string; label: string; value: number; rateFromPrevious: number | null }>;
}) {
  const maxValue = Math.max(...steps.map((step) => step.value), 1);
  return (
    <div className="funnel-list">
      {steps.map((step) => (
        <div className="funnel-row" key={step.key}>
          <div className="funnel-label">
            <strong>{step.label}</strong>
            <span>{formatNumber(step.value)}</span>
          </div>
          <div className="funnel-track">
            <div
              className="funnel-bar"
              style={{ width: `${Math.max(4, (step.value / maxValue) * 100)}%` }}
            />
          </div>
          <span className="funnel-rate">
            {step.rateFromPrevious === null
              ? "–"
              : `${step.rateFromPrevious.toFixed(step.rateFromPrevious >= 10 ? 0 : 1)}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

function Panel({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <article className={`panel${wide ? " panel-wide" : ""}`}>{children}</article>
  );
}

// ---------------------------------------------------------------------------
// Calls tab
// ---------------------------------------------------------------------------

function CallsTab({
  data,
  onOpenCall,
}: {
  data: ValdemarStatsData["calls"];
  onOpenCall: (row: ValdemarCallRow) => void;
}) {
  if (data.totalRows === 0) {
    return (
      <div className="section-stack">
        <EmptyState
          title="No calls in this range"
          body="Calls appear here the moment they are dialed from the CRM. Try a wider time range."
        />
      </div>
    );
  }

  return (
    <div className="section-stack">
      <KpiGrid items={data.kpis} />

      <section className="content-grid">
        <Panel wide>
          <PanelHeading
            eyebrow="Volume"
            title="Calls per day"
            badge={`${formatNumber(data.totalRows)} calls`}
            description="Every dial, with the connected share next to it. Stockholm days."
          />
          <BucketBars points={data.byBucket} series={data.seriesLabels} />
        </Panel>
        <Panel>
          <PanelHeading
            eyebrow="Results"
            title="Outcomes"
            description="What each logged call ended as."
          />
          <BarList
            items={data.outcomes.map((slice) => ({
              label: slice.label,
              value: slice.count,
            }))}
            emptyTitle="No outcomes logged yet"
            emptyBody="Outcomes land when a call is logged from the call drawer."
          />
        </Panel>
      </section>

      <section className="content-grid">
        <Panel wide>
          <PanelHeading
            eyebrow="Timing"
            title="Calls by hour of day"
            description="When the dials happen (Stockholm time). Connected share alongside."
          />
          <BucketBars
            points={data.byHour
              .filter((point) => point.total > 0 || (point.hour >= 7 && point.hour <= 19))
              .map((point) => ({
                key: String(point.hour),
                label: point.label,
                values: [point.total, point.connected],
              }))}
            series={["Calls", "Connected"]}
          />
        </Panel>
        <Panel>
          <PanelHeading
            eyebrow="Timing"
            title="Calls by weekday"
          />
          <BarList
            items={data.byWeekday.map((point) => ({
              label: point.label,
              value: point.total,
              hint: point.total
                ? `${point.connected} connected`
                : undefined,
            }))}
            emptyTitle="No calls yet"
            emptyBody="Weekday split appears with the first calls in range."
          />
        </Panel>
      </section>

      <section className="content-grid">
        <Panel>
          <PanelHeading
            eyebrow="Depth"
            title="Call length distribution"
            description="Calls with talk time, bucketed by duration."
          />
          <BarList
            items={data.durations.map((bucket) => ({
              label: bucket.label,
              value: bucket.count,
            }))}
            emptyTitle="No timed calls yet"
            emptyBody="Durations appear once calls connect."
          />
        </Panel>
        <Panel>
          <PanelHeading
            eyebrow="Tone"
            title="Sentiment"
            description="AI-assessed sentiment of processed calls."
          />
          <SegmentMeter
            segments={data.sentiments.map((slice) => ({
              label: slice.label,
              value: slice.count,
              colorClass: slice.colorClass,
            }))}
          />
        </Panel>
        <Panel>
          <PanelHeading
            eyebrow="Depth"
            title="Talk time per day"
          />
          <BucketBars
            points={data.talkTimeByBucket}
            series={["Talk time"]}
            valueFormatter={formatDurationSeconds}
          />
        </Panel>
      </section>

      <section className="content-grid">
        <Panel wide>
          <PanelHeading
            eyebrow="Call log"
            title="Every call in range"
            badge={
              data.totalRows > data.rows.length
                ? `Latest ${data.rows.length} of ${formatNumber(data.totalRows)}`
                : `${formatNumber(data.totalRows)} calls`
            }
            description="Open a call for the AI summary, full transcript, and recording."
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Contact</th>
                  <th>Outcome</th>
                  <th>Duration</th>
                  <th>Sentiment</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatWhen(row.at)}</td>
                    <td>
                      <div className="table-primary">
                        {row.contactId ? (
                          <Link
                            className="!text-blue-600 hover:!underline"
                            href={`/contacts/${row.contactId}`}
                          >
                            <strong>{row.contactName}</strong>
                          </Link>
                        ) : (
                          <strong>{row.contactName}</strong>
                        )}
                        <span>
                          {row.companyId && row.companyName ? (
                            <Link
                              className="!text-slate-500 hover:!underline"
                              href={`/companies/${row.companyId}`}
                            >
                              {row.companyName}
                            </Link>
                          ) : (
                            row.companyName ?? row.phone ?? "–"
                          )}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`status-pill ${outcomePillClass(row.outcome)}`}>
                        {row.outcomeLabel}
                      </span>
                    </td>
                    <td>
                      {row.durationSeconds
                        ? formatDurationSeconds(row.durationSeconds)
                        : "–"}
                    </td>
                    <td>{row.sentiment ?? "–"}</td>
                    <td>
                      {row.sessionId ? (
                        <button
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium !text-slate-700 hover:bg-slate-50"
                          onClick={() => onOpenCall(row)}
                          type="button"
                        >
                          {row.hasRecording || row.sessionStatus === "processed"
                            ? "Transcript"
                            : "Details"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Emails tab
// ---------------------------------------------------------------------------

const EVENT_LABEL: Record<string, string> = {
  open: "Opened",
  click: "Clicked a link",
  reply: "Replied",
  bounce: "Bounced",
  unsubscribe: "Unsubscribed",
};

function EmailsTab({
  data,
  onOpenEmail,
}: {
  data: ValdemarStatsData["emails"];
  onOpenEmail: (row: ValdemarEmailRow) => void;
}) {
  const hasAnything =
    data.totalRows > 0 ||
    data.statusBreakdown.some((slice) => slice.count > 0);

  if (!hasAnything) {
    return (
      <div className="section-stack">
        <EmptyState
          title="No emails in this range"
          body="Sends from Valdemar's mailboxes appear here as soon as sequences or one-off emails go out."
        />
        <AccountsPanel accounts={data.accounts} />
      </div>
    );
  }

  return (
    <div className="section-stack">
      <KpiGrid items={data.kpis} />

      <section className="content-grid">
        <Panel wide>
          <PanelHeading
            eyebrow="Volume"
            title="Sends and opens per day"
            badge={`${formatNumber(data.totalRows)} sent`}
            description="Sends by send time, open events by when they happened. Stockholm days."
          />
          <BucketBars points={data.sentOpensByBucket} series={["Sent", "Opens"]} />
        </Panel>
        <Panel>
          <PanelHeading
            eyebrow="Journey"
            title="Engagement funnel"
            description="Unique emails through each stage. Replies exclude auto-replies and out-of-office."
          />
          <FunnelList steps={data.funnel} />
        </Panel>
      </section>

      <section className="content-grid">
        <Panel wide>
          <PanelHeading
            eyebrow="Engagement"
            title="Clicks and replies per day"
          />
          <BucketBars
            points={data.clicksRepliesByBucket}
            series={["Clicks", "Replies"]}
          />
        </Panel>
        <Panel>
          <PanelHeading
            eyebrow="Pipeline"
            title="Queue status"
            description="Sent counts the range; queued and failed are the live totals."
          />
          <BarList
            items={data.statusBreakdown.map((slice) => ({
              label: slice.status,
              value: slice.count,
            }))}
            emptyTitle="Queue is empty"
            emptyBody="Scheduled and failed sends will show here."
          />
        </Panel>
      </section>

      <section className="content-grid">
        <Panel>
          <PanelHeading
            eyebrow="Timing"
            title="Sends by hour"
            description="When emails leave the mailbox (Stockholm time)."
          />
          <BucketBars
            points={data.byHour
              .filter((point) => point.sent > 0 || (point.hour >= 6 && point.hour <= 18))
              .map((point) => ({
                key: String(point.hour),
                label: point.label,
                values: [point.sent],
              }))}
            series={["Sent"]}
          />
        </Panel>
        <Panel>
          <PanelHeading
            eyebrow="Campaigns"
            title="Sequences behind the sends"
          />
          <BarList
            items={data.topSequences.map((sequence) => ({
              label: sequence.name,
              value: sequence.sent,
              hint: sequence.replies ? `${sequence.replies} replies` : undefined,
            }))}
            emptyTitle="No sequence sends yet"
            emptyBody="Sequence names appear once enrollments start sending."
          />
        </Panel>
        <AccountsPanel accounts={data.accounts} />
      </section>

      <section className="content-grid">
        <Panel wide>
          <PanelHeading
            eyebrow="Email log"
            title="Every email in range"
            badge={
              data.totalRows > data.rows.length
                ? `Latest ${data.rows.length} of ${formatNumber(data.totalRows)}`
                : `${formatNumber(data.totalRows)} emails`
            }
            description="Open an email for its full event timeline."
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Sequence</th>
                  <th>Engagement</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatWhen(row.at)}</td>
                    <td>
                      <div className="table-primary">
                        {row.contactId ? (
                          <Link
                            className="!text-blue-600 hover:!underline"
                            href={`/contacts/${row.contactId}`}
                          >
                            <strong>{row.contactName ?? row.toEmail}</strong>
                          </Link>
                        ) : (
                          <strong>{row.contactName ?? row.toEmail}</strong>
                        )}
                        <span>{row.toEmail}</span>
                      </div>
                    </td>
                    <td>{row.subject}</td>
                    <td>{row.sequenceName ?? "One-off"}</td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        {row.bounced ? (
                          <span className="status-pill failed">Bounced</span>
                        ) : null}
                        {row.replied ? (
                          <span className="status-pill success">Replied</span>
                        ) : null}
                        {row.clicked ? (
                          <span className="status-pill running">Clicked</span>
                        ) : null}
                        {row.opened && !row.replied && !row.clicked ? (
                          <span className="status-pill skipped">
                            Opened{row.openCount > 1 ? ` ×${row.openCount}` : ""}
                          </span>
                        ) : null}
                        {!row.opened && !row.bounced && !row.replied && !row.clicked
                          ? "–"
                          : null}
                      </span>
                    </td>
                    <td>
                      <button
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium !text-slate-700 hover:bg-slate-50"
                        onClick={() => onOpenEmail(row)}
                        type="button"
                      >
                        Timeline
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function AccountsPanel({
  accounts,
}: {
  accounts: ValdemarStatsData["emails"]["accounts"];
}) {
  return (
    <Panel>
      <PanelHeading
        eyebrow="Infrastructure"
        title="Sending mailboxes"
        description="Today's usage against the daily cap, plus mailbox health."
      />
      {accounts.length === 0 ? (
        <EmptyState
          title="No mailboxes connected"
          body="Connect a Gmail account for Valdemar under Settings to start sending."
        />
      ) : (
        <div className="summary-grid columns-2">
          {accounts.map((account) => (
            <div className="summary-card" key={account.email}>
              <strong>
                {account.sentToday}/{account.dailyCap || "–"}
              </strong>
              <span>{account.email}</span>
              <small>
                {account.status}
                {account.healthScore !== null
                  ? ` · health ${account.healthScore}`
                  : ""}
              </small>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function ValdemarContent({
  data,
  initialTab,
}: {
  data: ValdemarStatsData;
  initialTab: ValdemarTab;
}) {
  const [tab, setTab] = useState<ValdemarTab>(initialTab);
  const [openCall, setOpenCall] = useState<ValdemarCallRow | null>(null);
  const [openEmail, setOpenEmail] = useState<ValdemarEmailRow | null>(null);

  const switchTab = (next: ValdemarTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "calls") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", next);
    }
    window.history.replaceState(null, "", url.toString());
  };

  const drawerTarget = useMemo(
    () =>
      openCall
        ? {
            contactId: openCall.contactId ?? "",
            contactName: openCall.contactName,
            phone: openCall.phone,
            companyId: openCall.companyId,
            companyName: openCall.companyName,
          }
        : null,
    [openCall],
  );

  if (!data.identityFound) {
    return (
      <EmptyState
        title="Couldn't find Valdemar in this workspace"
        body="Expected a user profile or Gmail account matching 'valdemar'. Once he signs in with Google and connects a mailbox, this page lights up."
      />
    );
  }

  const callCount = data.calls.totalRows;
  const emailCount = data.emails.totalRows;

  return (
    <div className="section-stack">
      <div className="platform-tabs" role="tablist">
        <button
          aria-selected={tab === "calls"}
          className={`platform-tab${tab === "calls" ? " active" : ""}`}
          onClick={() => switchTab("calls")}
          role="tab"
          type="button"
        >
          Calls ({formatNumber(callCount)})
        </button>
        <button
          aria-selected={tab === "emails"}
          className={`platform-tab${tab === "emails" ? " active" : ""}`}
          onClick={() => switchTab("emails")}
          role="tab"
          type="button"
        >
          Emails ({formatNumber(emailCount)})
        </button>
        <span className="platform-tabs-info">
          {data.rangeLabel} · {data.rangeSpan} · rolling ranges include today
        </span>
      </div>

      {tab === "calls" ? (
        <CallsTab data={data.calls} onOpenCall={setOpenCall} />
      ) : (
        <EmailsTab data={data.emails} onOpenEmail={setOpenEmail} />
      )}

      {openCall?.sessionId && drawerTarget ? (
        <CallDetailDrawer
          contactHref={
            openCall.contactId ? `/contacts/${openCall.contactId}` : undefined
          }
          onClose={() => setOpenCall(null)}
          sessionId={openCall.sessionId}
          target={drawerTarget}
        />
      ) : null}

      <Modal
        maxWidth="max-w-lg"
        onClose={() => setOpenEmail(null)}
        open={openEmail !== null}
        title={openEmail?.subject ?? "Email"}
      >
        {openEmail ? (
          <div className="space-y-3 text-sm">
            <div className="text-slate-600">
              To <strong>{openEmail.contactName ?? openEmail.toEmail}</strong> (
              {openEmail.toEmail})
              {openEmail.sequenceName ? (
                <> · {openEmail.sequenceName}</>
              ) : (
                <> · one-off email</>
              )}
            </div>
            <ol className="space-y-2">
              <li className="flex items-baseline gap-2">
                <span className="w-24 shrink-0 font-mono text-xs text-slate-400">
                  {formatWhen(openEmail.at)}
                </span>
                <span>Sent</span>
              </li>
              {openEmail.events.map((event, index) => (
                <li
                  className="flex items-baseline gap-2"
                  key={`${event.type}-${event.at}-${index}`}
                >
                  <span className="w-24 shrink-0 font-mono text-xs text-slate-400">
                    {formatWhen(event.at)}
                  </span>
                  <span>
                    {EVENT_LABEL[event.type] ?? event.type}
                    {event.linkUrl ? (
                      <span className="block truncate text-xs text-slate-400">
                        {event.linkUrl}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
              {openEmail.events.length === 0 ? (
                <li className="text-slate-400">No tracking events yet.</li>
              ) : null}
            </ol>
            {openEmail.contactId ? (
              <Link
                className="inline-block !text-blue-600 hover:!underline"
                href={`/contacts/${openEmail.contactId}`}
              >
                View contact →
              </Link>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
