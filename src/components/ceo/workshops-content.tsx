import Link from "next/link";
import { compactNumber, formatCurrency, formatNumber } from "@/lib/ceo/format";
import type {
  WorkshopDetailData,
  WorkshopListItem,
  WorkshopMember,
} from "@/lib/ceo/data/workshops";
import { InfoHint } from "./source-info";
import { SOURCE_INFO, sourceInfoFromLabel } from "./source-info-data";

function formatDateTime(value: string | null) {
  if (!value) {
    return "Pending";
  }

  return new Date(value).toLocaleString();
}

function statusLabel(status: string | null) {
  return (status ?? "unknown").replace(/_/g, " ");
}

function statusClass(status: string | null) {
  switch (status) {
    case "active":
      return "success";
    case "trialing":
      return "running";
    case "paused":
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
      return "skipped";
    case "inactive":
    case "canceled":
      return "failed";
    default:
      return "skipped";
  }
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

export function WorkshopListContent({
  items,
  query,
  status,
  showInternal,
}: {
  items: WorkshopListItem[];
  query: string;
  status: string;
  showInternal: boolean;
}) {
  const live = items.filter(
    (item) => item.status === "active" || item.status === "trialing",
  ).length;
  const diagnostics30 = items.reduce(
    (sum, item) => sum + item.diagnosticsLast30Days,
    0,
  );
  const aiCost = items.reduce(
    (sum, item) => sum + item.totalDiagnosticCost + item.totalChatCost,
    0,
  );

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Workshop Drilldown</p>
            <h2>See the actual accounts behind the topline numbers.</h2>
            <p className="hero-text">
              This page stays faithful to the source hierarchy: workshop and
              user structure come from the core app export, while billing status
              is driven by Stripe.
            </p>
          </div>
          <div className="summary-grid columns-2">
            <div className="summary-card">
              <strong>{formatNumber(items.length)}</strong>
              <LabelInfo label="Visible workshops" />
              <small>Based on current filters</small>
            </div>
            <div className="summary-card">
              <strong>{formatNumber(live)}</strong>
              <LabelInfo label="Live workshops" />
              <small>Active or trialing</small>
            </div>
            <div className="summary-card">
              <strong>{compactNumber(diagnostics30)}</strong>
              <LabelInfo label="Diagnostics in 30D" />
              <small>Account activity signal</small>
            </div>
            <div className="summary-card">
              <strong>{formatCurrency(aiCost)}</strong>
              <LabelInfo label="Observed AI cost" />
              <small>Diagnostics + chat</small>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Filters</p>
            <HeadingInfo
              label="Find a company or workshop fast"
              info="Search and status filters run on the already-loaded workshop drilldown list. Search checks workshop name, country, plan, status, user names, and email domains from dashboard_workshops and dashboard_users metadata."
            />
          </div>
        </div>
        <form className="filter-form" method="get">
          <input
            aria-label="Search workshops"
            defaultValue={query}
            name="q"
            placeholder="Search by workshop, domain, username, or plan"
            type="search"
          />
          <select aria-label="Filter by status" defaultValue={status} name="status">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="at_risk">At risk</option>
            <option value="inactive">Inactive</option>
            <option value="unknown">Unknown</option>
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
            <Link className="button" href="/dashboard/workshops">
              Clear
            </Link>
          )}
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Accounts</p>
            <HeadingInfo
              label="Workshop leaderboard"
              info="Each row is assembled from dashboard_workshops, dashboard_users, dashboard_subscriptions, dashboard_diagnostics, and dashboard_diagnostic_chats. Core app identity comes from AWS/S3 exports; billing status comes from Stripe when linked."
            />
          </div>
          <span className="badge">{formatNumber(items.length)} rows</span>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <TableHeading
                    label="Workshop"
                    info="Workshop name, country, plan, and email-domain context come from dashboard_workshops plus linked dashboard_users rows."
                  />
                </th>
                <th><TableHeading label="Status" info="Billing status is primarily from Stripe. If Stripe linkage is missing, core app or enrichment metadata can expose an unknown or fallback status." /></th>
                <th><TableHeading label="Members" /></th>
                <th><TableHeading label="Plan" /></th>
                <th><TableHeading label="Last activity" /></th>
                <th><TableHeading label="Diagnostics" /></th>
                <th><TableHeading label="AI cost" /></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.workshopId}>
                  <td>
                    <div className="table-primary">
                      <span className="table-primary-name">
                        <Link href={`/dashboard/workshops/${item.workshopId}`}>
                          <strong>{item.name}</strong>
                        </Link>
                        {item.isInternal ? (
                          <span
                            className="internal-pill"
                            title="Internal-test workshop — excluded from production metrics"
                          >
                            Internal
                          </span>
                        ) : null}
                      </span>
                      <span>
                        {[
                          item.country ?? "No country",
                          item.language ?? null,
                          item.createdByAgent === true
                            ? "agent"
                            : item.createdByAgent === false
                              ? "self-serve"
                              : null,
                          item.emailDomains[0] ?? "no domain",
                        ]
                          .filter((part): part is string => Boolean(part))
                          .join(" · ")}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`status-pill ${statusClass(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </td>
                  <td>{formatNumber(item.memberCount)}</td>
                  <td>{item.planKey ?? "Unknown"}</td>
                  <td>{formatDateTime(item.lastActivityAt)}</td>
                  <td>
                    {formatNumber(item.diagnosticsCount)}
                    <br />
                    <span className="table-secondary">
                      {formatNumber(item.diagnosticsLast30Days)} in 30D
                    </span>
                  </td>
                  <td>
                    {formatCurrency(item.totalDiagnosticCost + item.totalChatCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MemberList({ members }: { members: WorkshopMember[] }) {
  return (
    <div className="bar-list">
      {members.map((member) => {
        // Prefer the human-readable name from core_app, fall back to
        // username, then internal_user_id as a last resort.
        const primaryLabel =
          member.name ?? member.username ?? member.internalUserId;
        const subParts = [
          member.name && member.username && member.username !== member.name
            ? member.username
            : null,
          member.emailDomain,
        ].filter((part): part is string => Boolean(part));
        const subLabel = subParts.join(" · ") || "no email domain";
        return (
          <div className="bar-row" key={member.internalUserId}>
            <div className="bar-row-copy">
              <span className="table-primary-name">
                <strong>{primaryLabel}</strong>
                {member.isInternal ? (
                  <span
                    className="internal-pill"
                    title="Internal-test user — excluded from production metrics"
                  >
                    Internal
                  </span>
                ) : null}
                {member.isInternalExempt ? (
                  <span
                    className="internal-pill exempt"
                    title="Exempt from the internal-workshop blanket exclusion — counted in production metrics"
                  >
                    Exempt
                  </span>
                ) : null}
              </span>
              <span>{subLabel}</span>
            </div>
            <div className="bar-row-main text-value">
              <strong>{member.role ?? "member"}</strong>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function WorkshopDetailContent({
  detail,
}: {
  detail: WorkshopDetailData;
}) {
  const { workshop } = detail;
  const totalAiCost = workshop.totalDiagnosticCost + workshop.totalChatCost;

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="hero-grid">
          <div className="hero-copy">
            <Link className="meta-pill" href="/dashboard/workshops">
              Back to workshops
            </Link>
            <p className="eyebrow">Workshop Detail</p>
            <h2 className="table-primary-name">
              <span>{workshop.name}</span>
              {workshop.isInternal ? (
                <span
                  className="internal-pill"
                  title="Internal-test workshop — excluded from production metrics"
                >
                  Internal
                </span>
              ) : null}
            </h2>
            <p className="hero-text">
              {workshop.country ?? "No country yet"} ·{" "}
              {workshop.emailDomains.join(", ") || "No email domain"} ·{" "}
              {workshop.planKey ?? "Unknown plan"}
            </p>
            <div className="hero-pill-list">
              <span className="hero-pill">
                Status: {statusLabel(workshop.status)}
              </span>
              <span className="hero-pill">
                {formatNumber(workshop.memberCount)} members
              </span>
              <span className="hero-pill">
                {formatNumber(workshop.diagnosticsCount)} diagnostics
              </span>
              <span className="hero-pill">{formatCurrency(totalAiCost)} AI cost</span>
            </div>
          </div>
          <div className="summary-grid columns-2">
            <div className="summary-card">
              <strong>{formatDateTime(workshop.lastActivityAt)}</strong>
              <LabelInfo label="Last activity" />
            </div>
            <div className="summary-card">
              <strong>{formatDateTime(workshop.lastDiagnosticAt)}</strong>
              <LabelInfo label="Last diagnostic" />
            </div>
            <div className="summary-card">
              <strong>{formatNumber(workshop.chatSessions)}</strong>
              <LabelInfo label="Chat sessions" />
            </div>
            <div className="summary-card">
              <strong>{formatNumber(workshop.diagnosticsLast30Days)}</strong>
              <LabelInfo label="Diagnostics in 30D" />
            </div>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Members</p>
              <HeadingInfo
                label="Who belongs to this workshop"
                info="Members come from dashboard_users rows where workshop_id matches this workshop. The core_app sync upserts users by internal_user_id from the AWS/S3 source export, preserving canonical created_at when the core app provides it."
              />
            </div>
            <span className="badge">{formatNumber(detail.members.length)} users</span>
          </div>
          <MemberList members={detail.members} />
        </article>

        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Billing</p>
              <HeadingInfo
                label="Stripe posture"
                info="Billing posture joins dashboard_subscriptions to this workshop by workshop_id. Stripe subscription rows are upserted by stripe_subscription_id and replace the current status, plan, periods, trial, and cancellation fields."
              />
            </div>
          </div>
          <div className="summary-grid columns-4">
            <div className="summary-card">
              <strong>{workshop.planKey ?? "Unknown"}</strong>
              <LabelInfo label="Plan" />
            </div>
            <div className="summary-card">
              <strong>{workshop.stripeCustomerEmail ?? "Pending"}</strong>
              <LabelInfo label="Billing email" />
            </div>
            <div className="summary-card">
              <strong>{workshop.stripeCustomerId ?? "Pending"}</strong>
              <LabelInfo label="Stripe customer" />
            </div>
            <div className="summary-card">
              <strong>{workshop.stripeSubscriptionId ?? "Pending"}</strong>
              <LabelInfo label="Stripe subscription" />
            </div>
          </div>

          {detail.subscriptions.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th><TableHeading label="Status" info={SOURCE_INFO.stripe} /></th>
                    <th><TableHeading label="Plan" /></th>
                    <th><TableHeading label="Current period end" info="Stripe subscription current_period_end." /></th>
                    <th><TableHeading label="Trial end" info="Stripe subscription trial_end." /></th>
                    <th><TableHeading label="Cancel at" info="Stripe subscription cancel_at when a cancellation is scheduled." /></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.subscriptions.map((subscription, index) => (
                    <tr key={`${subscription.status}-${index}`}>
                      <td>
                        <span
                          className={`status-pill ${statusClass(
                            subscription.status,
                          )}`}
                        >
                          {statusLabel(subscription.status)}
                        </span>
                      </td>
                      <td>{subscription.planKey ?? "Unknown"}</td>
                      <td>{formatDateTime(subscription.currentPeriodEnd)}</td>
                      <td>{formatDateTime(subscription.trialEnd)}</td>
                      <td>{formatDateTime(subscription.cancelAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Recent Diagnostics</p>
              <HeadingInfo
                label="Latest diagnostic sessions"
                info="Diagnostic rows come from dashboard_diagnostics. The core_app sync upserts by diagnostic_id and refreshes status, created_at, completed_at, ai_model, diag_cost, num_causes, and chat flags."
              />
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th><TableHeading label="Created" info="Diagnostic created_at from the core app export." /></th>
                  <th><TableHeading label="Status" /></th>
                  <th><TableHeading label="Model" info="AI model recorded on the diagnostic row, when available." /></th>
                  <th><TableHeading label="Cost" /></th>
                  <th><TableHeading label="Causes" info="Number of causes returned by the diagnostic engine." /></th>
                  <th><TableHeading label="Chat" info="Whether a follow-up chat is linked to this diagnostic." /></th>
                </tr>
              </thead>
              <tbody>
                {detail.recentDiagnostics.map((diagnostic) => (
                  <tr key={diagnostic.diagnosticId}>
                    <td>{formatDateTime(diagnostic.createdAt)}</td>
                    <td>
                      <span className={`status-pill ${statusClass(diagnostic.status)}`}>
                        {statusLabel(diagnostic.status)}
                      </span>
                    </td>
                    <td>{diagnostic.aiModel ?? "Unknown"}</td>
                    <td>{formatCurrency(diagnostic.diagCost)}</td>
                    <td>{formatNumber(diagnostic.numCauses)}</td>
                    <td>{diagnostic.hasChat ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Recent Chats</p>
              <HeadingInfo
                label="Follow-up conversations"
                info="Chat rows come from dashboard_diagnostic_chats. The core_app sync upserts by chat_id and records diagnostic_id, workshop_id, message_count, chat_cost, and token totals."
              />
            </div>
          </div>
          <div className="bar-list">
            {detail.recentChats.map((chat) => (
              <div className="bar-row" key={chat.chatId}>
                <div className="bar-row-copy">
                  <strong>{formatDateTime(chat.createdAt)}</strong>
                  <span>{chat.diagnosticId ?? "No diagnostic ID"}</span>
                </div>
                <div className="bar-row-main text-value">
                  <strong>
                    {formatNumber(chat.messageCount)} msgs ·{" "}
                    {formatCurrency(chat.chatCost)}
                  </strong>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
