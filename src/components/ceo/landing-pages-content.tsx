"use client";

import { useMemo, useState } from "react";
import { formatNumber, formatPercent } from "@/lib/ceo/format";
import {
  COMPETITOR_TARGETS,
  UNMATCHED_COMPETITOR_TERMS,
  unfedCompetitors,
} from "@/lib/landing/ad-targets";
import { AD_SURFACE_MAP, buildGaps, routingFixes } from "@/lib/landing/kinds";
import type { LandingPlan } from "@/lib/landing/plan";
import {
  DOORWAY_DEFENCES,
  HONESTY_RULES,
  PROGRAMME_THESIS,
  ROLLOUT,
  WHERE_TO_BUILD,
  type InfoPoint,
} from "@/lib/landing/programme";
import { CORE_APP_CONTRACT } from "@/lib/landing/tracking";
import {
  BUILDABLE_TIERS,
  STATE_LABELS,
  TIER_LABELS,
  type LandingTier,
} from "@/lib/landing/types";

type LandingPagesContentProps = {
  plan: LandingPlan;
  /** Diagnostics the plan was computed from, for the provenance line. */
  diagnosticsRead: number;
  /** Whether the Google Ads API can actually be reached from this deployment. */
  adsApiConfigured: boolean;
};

/**
 * `formatPercent` in lib/ceo/format expects an already-scaled 0-100 number and
 * renders a 0-1 fraction as "0%". The plan carries fractions, so every share on
 * this page scales at the render boundary. Same helper, same reason, as the DTC
 * Codes and Search Terms pages.
 */
function pct(fraction: number, digits = 0) {
  return formatPercent(fraction * 100, digits);
}

function PointList({ points }: { points: InfoPoint[] }) {
  return (
    <dl className="definition-list">
      {points.map((point) => (
        <div className="definition-item" key={point.heading}>
          <dt>{point.heading}</dt>
          <dd>{point.body}</dd>
        </div>
      ))}
    </dl>
  );
}

function SummaryCard({
  value,
  label,
  hint,
}: {
  value: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="summary-card">
      <strong>{value}</strong>
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function stateTone(state: string) {
  if (state === "live_and_routed") return "badge badge-live";
  if (state === "exists_unrouted") return "badge badge-paused";
  return "badge badge-planned";
}

function rolloutTone(state: string) {
  if (state === "Built") return "badge badge-live";
  if (state === "Ready to run") return "badge badge-live";
  if (state === "Blocked externally") return "badge badge-paused";
  return "badge badge-planned";
}

const QUEUE_PAGE_SIZE = 40;

export function LandingPagesContent({
  plan,
  diagnosticsRead,
  adsApiConfigured,
}: LandingPagesContentProps) {
  const [tierFilter, setTierFilter] = useState<LandingTier | "all">("all");
  const [limit, setLimit] = useState(QUEUE_PAGE_SIZE);
  const { totals } = plan;

  const queue = useMemo(() => {
    const buildable = plan.candidates.filter((row) =>
      BUILDABLE_TIERS.includes(row.tier),
    );
    return tierFilter === "all"
      ? buildable
      : buildable.filter((row) => row.tier === tierFilter);
  }, [plan.candidates, tierFilter]);

  const visible = queue.slice(0, limit);

  return (
    <div className="section-stack">
      {/* ---- the size of the thing ------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">The programme</p>
            <h2>What a fault-code landing-page cluster actually comes to</h2>
          </div>
        </div>
        <p className="panel-description">
          Computed from the {formatNumber(diagnosticsRead)} diagnostics this
          product has run, using the same analysis the DTC Codes page shows. No
          new queries, no new tables. The counts move as the product does.
        </p>
        <div className="summary-grid columns-4">
          <SummaryCard
            value={formatNumber(totals.totalPages)}
            label="Pages the programme would build"
            hint={`${formatNumber(totals.buildable)} code pages plus ${formatNumber(totals.hubs)} hubs`}
          />
          <SummaryCard
            value={formatNumber(totals.universe)}
            label="Codes considered"
            hint={`${formatNumber(totals.seenLocally)} seen in our own diagnostics`}
          />
          <SummaryCard
            value={formatNumber(totals.excluded + totals.belowFloor)}
            label="Deliberately not built"
            hint={`${formatNumber(totals.excluded)} manufacturer-specific, ${formatNumber(totals.belowFloor)} below the floor`}
          />
          <SummaryCard
            value={pct(totals.sightingsCovered)}
            label="Of all code sightings reach a page"
            hint="The rest go to make hubs and family hubs"
          />
        </div>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Why this, and why now</p>
            <h3>The case for the programme</h3>
          </div>
        </div>
        <PointList points={PROGRAMME_THESIS} />
      </article>

      {/* ---- the ad to page map ---------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Coverage</p>
            <h2>Every ad surface that can have a landing page</h2>
          </div>
        </div>
        <p className="panel-description">
          The rule this table enforces:{" "}
          <strong>
            no ad group may point at a page more generic than the query it bids
            on
          </strong>
          . {routingFixes().length} row
          {routingFixes().length === 1 ? "" : "s"} break it with pages that
          already exist, which makes them free to fix. {buildGaps().length} rows
          break it because the page does not exist yet.
        </p>
        <div className="table-wrap">
          <table className="data-table campaign-type-table">
            <thead>
              <tr>
                <th>What they type</th>
                <th>Ad surface</th>
                <th>Page it should land on</th>
                <th>Pages</th>
                <th>Status</th>
                <th>What is true today</th>
              </tr>
            </thead>
            <tbody>
              {AD_SURFACE_MAP.map((row) => (
                <tr key={row.key}>
                  <td>
                    <strong>{row.query}</strong>
                  </td>
                  <td>{row.adSurface}</td>
                  <td>
                    <code>{row.urlPattern}</code>
                  </td>
                  <td>{row.pages}</td>
                  <td>
                    <span className={stateTone(row.state)}>
                      {STATE_LABELS[row.state]}
                    </span>
                  </td>
                  <td>{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {/* ---- competitor routing ----------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Free win</p>
            <h2>
              Fifteen comparison pages, five fed, and all five sent to the wrong
              place
            </h2>
          </div>
          <span className={adsApiConfigured ? "badge badge-live" : "badge badge-paused"}>
            {adsApiConfigured
              ? "Reconciler can run"
              : "Reconciler blocked on a token"}
          </span>
        </div>
        <p className="panel-description">
          Every path below was read from the live sitemap rather than guessed
          from the rival&apos;s name, because an ad group pointing at a 404 is
          worse than the generic page it points at today.{" "}
          {formatNumber(unfedCompetitors().length)} of these pages are published,
          indexed, and have never had a single ad pointed at them.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rival</th>
                <th>Page that exists</th>
                <th>Bid on today</th>
                <th>Where that traffic lands</th>
                <th>What should happen</th>
              </tr>
            </thead>
            <tbody>
              {COMPETITOR_TARGETS.map((target) => (
                <tr key={target.key}>
                  <td>
                    <strong>{target.name}</strong>
                  </td>
                  <td>
                    <code>{target.path}</code>
                  </td>
                  <td>
                    <span
                      className={
                        target.currentlyBid
                          ? "badge badge-paused"
                          : "badge badge-planned"
                      }
                    >
                      {target.currentlyBid ? "Yes" : "No"}
                    </span>
                  </td>
                  <td>
                    {target.currentlyBid
                      ? "The generic Small plan page"
                      : "Nowhere, no ad exists"}
                  </td>
                  <td>
                    {target.currentlyBid
                      ? "Point the existing ad group at this page."
                      : "Create an ad group for it."}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-description">
          This is a reconciler rather than a one-off script, because a script is
          only correct the first time it runs. It reads what each ad group
          actually buys, compares that against the table above, and reports the
          difference.{" "}
          <strong>
            It matches on keywords rather than on ad-group names
          </strong>
          , since the account names its groups by plan and the plan axis is
          exactly the thing that is wrong.
        </p>
        <p className="panel-description">
          Retargeting an ad group that already exists is a correction, and the
          reconciler will do it. Creating a new ad group commits budget nobody
          has agreed to, so those {formatNumber(unfedCompetitors().length)} stay
          a plan for a human to approve. A dry run still goes to Google with{" "}
          <code>validateOnly</code> set, so the plan is what Google confirms it
          would accept rather than what we think it should accept. Nothing
          writes without an explicit confirmation string.
        </p>
        {UNMATCHED_COMPETITOR_TERMS.length > 0 ? (
          <p className="panel-description">
            <strong>No page to send it to. </strong>
            The ad group also buys{" "}
            {UNMATCHED_COMPETITOR_TERMS.join(", ")}, which has no comparison
            page at all. ShopKey is Mitchell 1&apos;s other product, so it is
            either a page worth writing or a keyword worth dropping. The
            reconciler reports it rather than quietly ignoring the one thing it
            cannot fix.
          </p>
        ) : null}
        {!adsApiConfigured ? (
          <p className="panel-description">
            <strong>Blocked. </strong>
            <code>GOOGLE_ADS_CUSTOMER_ID</code> is set but{" "}
            <code>GOOGLE_ADS_DEVELOPER_TOKEN</code> is not present in any Vercel
            environment, and the client requires both. Adding the
            22-character token from the manager account&apos;s API Center is the
            only thing standing between this table and a reconciler run.
          </p>
        ) : null}
      </article>

      {/* ---- the tiers -------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Inventory</p>
            <h2>How much page each code earns</h2>
          </div>
        </div>
        <p className="panel-description">
          Eligibility is decided by whether we can say something true and
          specific about the code. Demand then orders the queue. Running those
          two tests in the other order is what turns programmatic content into a
          liability.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Pages</th>
                <th>What the page leads with</th>
                <th>How it gets reviewed</th>
              </tr>
            </thead>
            <tbody>
              {plan.batches.map((batch) => (
                <tr key={batch.tier}>
                  <td>
                    <strong>{batch.label}</strong>
                    <br />
                    <small>{TIER_LABELS[batch.tier]}</small>
                  </td>
                  <td>
                    <strong>{formatNumber(batch.pages)}</strong>
                  </td>
                  <td>{batch.template}</td>
                  <td>{batch.reviewRule}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Not built</strong>
                  <br />
                  <small>Below the floor</small>
                </td>
                <td>
                  <strong>{formatNumber(totals.belowFloor)}</strong>
                </td>
                <td>
                  One sighting, no description. Everything a page could say
                  comes from the family, which already has a page.
                </td>
                <td>Appears as a row on the family hub instead.</td>
              </tr>
              <tr>
                <td>
                  <strong>Never standalone</strong>
                  <br />
                  <small>Manufacturer-specific</small>
                </td>
                <td>
                  <strong>{formatNumber(totals.excluded)}</strong>
                </td>
                <td>
                  The same code means different things on different marques, so
                  a single page about it would be a confident wrong answer.
                </td>
                <td>Rolls up into the make hubs.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">The constraint that shapes everything</p>
            <h3>What these pages are not allowed to claim</h3>
          </div>
        </div>
        <PointList points={HONESTY_RULES} />
      </article>

      <article className="panel panel-wide campaign-alert">
        <h3>
          The objection that decides whether this is an asset or a liability
        </h3>
        <p>
          A few hundred pages that each say something real is a content cluster.
          A few hundred pages that each restate a template with one variable
          swapped is a doorway-page set, and search engines are built to catch
          exactly that shape. Five things separate the two, and all five are
          design decisions rather than intentions.
        </p>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Quality control</p>
            <h3>Why this cluster is not a doorway-page set</h3>
          </div>
        </div>
        <PointList points={DOORWAY_DEFENCES} />
      </article>

      {/* ---- the build queue -------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Build order</p>
            <h2>The queue, highest priority first</h2>
          </div>
          <div className="dashboard-range-bar">
            <button
              type="button"
              className={
                tierFilter === "all" ? "button button-primary" : "button"
              }
              onClick={() => {
                setTierFilter("all");
                setLimit(QUEUE_PAGE_SIZE);
              }}
            >
              All {formatNumber(totals.buildable)}
            </button>
            {BUILDABLE_TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                className={
                  tierFilter === tier ? "button button-primary" : "button"
                }
                onClick={() => {
                  setTierFilter(tier);
                  setLimit(QUEUE_PAGE_SIZE);
                }}
              >
                {TIER_LABELS[tier]}
              </button>
            ))}
          </div>
        </div>
        <p className="panel-description">
          Priority blends three signals: how often the code appears, how many
          separate workshops met it, and how often it arrives with no
          description at all. That last one is the closest thing we have to
          search intent, because a diagnostic submitted with nothing but a code
          is someone who has nothing but a code to search with.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>What it means</th>
                <th>Family</th>
                <th>Sessions</th>
                <th>Workshops</th>
                <th>Code only</th>
                <th>Travels with</th>
                <th>Tier</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.code}>
                  <td>
                    <strong>{row.code}</strong>
                    <br />
                    <small>{row.path}</small>
                  </td>
                  <td>
                    {row.name ?? (
                      <em>
                        Not individually documented
                        {row.subsystemLabel ? `, ${row.subsystemLabel}` : ""}
                      </em>
                    )}
                  </td>
                  <td>{row.familyLabel}</td>
                  <td>{row.sessions === 0 ? "—" : formatNumber(row.sessions)}</td>
                  <td>
                    {row.workshops === 0 ? "—" : formatNumber(row.workshops)}
                  </td>
                  <td>{row.sessions === 0 ? "—" : pct(row.codeOnlyShare)}</td>
                  <td>
                    {row.companions.length > 0 ? row.companions.join(", ") : "—"}
                  </td>
                  <td>
                    <span className="badge">{TIER_LABELS[row.tier]}</span>
                  </td>
                  <td>{formatNumber(row.priority)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {queue.length > visible.length ? (
          <p className="panel-description">
            <button
              type="button"
              className="button"
              onClick={() => setLimit((current) => current + QUEUE_PAGE_SIZE)}
            >
              Show {Math.min(QUEUE_PAGE_SIZE, queue.length - visible.length)}{" "}
              more
            </button>{" "}
            {formatNumber(queue.length - visible.length)} of{" "}
            {formatNumber(queue.length)} not shown.
          </p>
        ) : null}
      </article>

      {/* ---- hubs -------------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Hubs</p>
            <h2>The pages that hold the cluster together</h2>
          </div>
        </div>
        <p className="panel-description">
          {formatNumber(plan.families.length)} family hubs,{" "}
          {formatNumber(plan.makes.length)} make hubs and one hub per system.
          Hubs do two jobs at once: they catch the broader query, and they give
          every thin page somewhere honest to send a reader whose exact code we
          cannot document.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Family</th>
                <th>Code pages under it</th>
                <th>Sessions</th>
                <th>Strongest page</th>
              </tr>
            </thead>
            <tbody>
              {plan.families.map((family) => (
                <tr key={family.key}>
                  <td>
                    <strong>{family.label}</strong>
                  </td>
                  <td>{formatNumber(family.pages)}</td>
                  <td>{formatNumber(family.sessions)}</td>
                  <td>{family.topCode ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {/* ---- where it ships --------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">The decision this needs</p>
            <h2>Where these pages should be built</h2>
          </div>
        </div>
        <p className="panel-description">
          Both answers are defensible and they are not cheaply reversible
          against each other, which is why this is the one item on the page that
          wants a human rather than a default.
        </p>
        <PointList points={WHERE_TO_BUILD} />
      </article>

      {/* ---- measurement -------------------------------------------------- */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Measurement</p>
            <h2>What has to happen outside this repo</h2>
          </div>
        </div>
        <p className="panel-description">
          The page half of attribution is built and ships with the pages. The
          rest is owned elsewhere, so it is tracked here as an open checklist
          rather than assumed.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>System</th>
                <th>Change</th>
                <th>Why it matters</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {CORE_APP_CONTRACT.map((item) => (
                <tr key={`${item.system}-${item.change}`}>
                  <td>
                    <strong>{item.system}</strong>
                  </td>
                  <td>{item.change}</td>
                  <td>{item.why}</td>
                  <td>{item.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {/* ---- rollout ------------------------------------------------------ */}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Sequence</p>
            <h2>The rollout</h2>
          </div>
        </div>
        <p className="panel-description">
          Ordered so each step makes the next one safe. The first two cost
          almost nothing and are worth doing whatever gets decided about the
          rest.
        </p>
      </article>

      {ROLLOUT.map((step) => (
        <article className="panel panel-wide" key={step.phase}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{step.phase}</p>
              <h3>{step.title}</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={rolloutTone(step.state)}>{step.state}</span>
              <span className="badge">{step.effort} effort</span>
            </div>
          </div>
          <p className="panel-description">{step.why}</p>
          {step.blocked ? (
            <p className="panel-description">
              <strong>Constraint. </strong>
              {step.blocked}
            </p>
          ) : null}
          <ul className="tight-list">
            {step.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
