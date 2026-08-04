import Link from "next/link";
import { formatNumber, formatPercent } from "@/lib/ceo/format";
import type {
  DtcAnalysis,
  DtcCodeRow,
  DtcGroupRow,
} from "@/lib/ceo/dtc/analyse";
// Read the domain list rather than hard-coding it in the copy: bitknife.se was
// added in PR #585 and a hard-coded list would already have been out of date.
import { INTERNAL_TEST_EMAIL_DOMAINS } from "@/lib/ceo/internal-test/auto-flag";
import { InfoHint } from "./source-info";

/**
 * The analysis module keeps every share as a 0-1 fraction, which is what its
 * unit tests assert and what makes the arithmetic readable. `formatPercent`
 * expects an already-scaled 0-100 number, so the conversion happens here at the
 * render boundary rather than being baked into the data.
 */
function pct(fraction: number, digits = 1) {
  return formatPercent(fraction * 100, digits);
}

function HeadingInfo({ label, info }: { label: string; info: string }) {
  return (
    <h2 className="heading-with-info">
      <span>{label}</span>
      <InfoHint info={info} />
    </h2>
  );
}

function LabelInfo({ label, info }: { label: string; info: string }) {
  return (
    <span className="label-with-info">
      <span>{label}</span>
      <InfoHint info={info} />
    </span>
  );
}

/**
 * Deep-link into the diagnostics drilldown, pre-filtered to this code.
 *
 * The drilldown's `q` filter substring-matches the raw `dtcs` strings, so a base
 * code finds both formats of the same fault (`P0299` also matches `P029900`).
 *
 * Deliberately carries no `?range=`: this page analyses all history, but the
 * diagnostics page must not be handed `range=all_time` — that makes it ask
 * getDashboardData for every metric snapshot ever synced and time out. Links
 * therefore open the drilldown in its own default window, which shows fewer rows
 * than the count next to the code.
 */
function diagnosticsHref(term: string) {
  return `/dashboard/diagnostics?${new URLSearchParams({ q: term }).toString()}`;
}

function CodeLink({ code }: { code: string }) {
  return (
    <Link
      href={diagnosticsHref(code)}
      style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}
    >
      {code}
    </Link>
  );
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function scopeBadge(scope: "generic" | "manufacturer") {
  return scope === "generic" ? "generic" : "make-specific";
}

/** Generic horizontal bar list for any of the grouping axes. */
function GroupBarList({
  rows,
  emptyLabel,
  unit = "of coded sessions",
}: {
  rows: DtcGroupRow[];
  emptyLabel: string;
  unit?: string;
}) {
  if (rows.length === 0) {
    return <p className="panel-description">{emptyLabel}</p>;
  }
  const max = Math.max(...rows.map((row) => row.entries), 1);
  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div className="bar-row" key={row.key}>
          <div className="bar-row-copy">
            <strong>{row.label}</strong>
            <span>
              {pct(row.share, 1)} {unit}
            </span>
          </div>
          <div className="bar-row-main">
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${Math.max(4, (row.entries / max) * 100)}%` }}
              />
            </div>
            <strong>{formatNumber(row.entries)}</strong>
          </div>
          <p
            className="muted"
            style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.45 }}
          >
            {row.distinctCodes} distinct code
            {row.distinctCodes === 1 ? "" : "s"}
            {row.topCode ? (
              <>
                {" · most common "}
                <code>{row.topCode}</code>
                {row.topCodeName ? ` (${row.topCodeName})` : ""}
              </>
            ) : null}
            {row.hint ? ` — ${row.hint}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

function CodeTable({
  rows,
  limit,
  emptyLabel,
}: {
  rows: DtcCodeRow[];
  limit: number;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="panel-description">{emptyLabel}</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Code</th>
            <th>What it means</th>
            <th>Family</th>
            <th>Sessions</th>
            <th>Share</th>
            <th>Workshops</th>
            <th>No text</th>
            <th>Chat</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((row, index) => (
            <tr key={row.base}>
              <td className="toplist-rank">{index + 1}</td>
              <td>
                <div className="table-primary">
                  <strong style={{ fontFamily: "var(--font-mono)" }}>
                    {row.base}
                  </strong>
                  {row.rawVariants.length > 1 ? (
                    <span title={row.rawVariants.join(", ")}>
                      {row.rawVariants.length} written forms
                    </span>
                  ) : null}
                </div>
              </td>
              <td style={{ maxWidth: "22rem" }}>
                {row.name ? (
                  row.name
                ) : (
                  <span className="muted">
                    {row.scope === "manufacturer"
                      ? "manufacturer-specific — meaning depends on the make"
                      : "not in the code dictionary yet"}
                  </span>
                )}
              </td>
              <td className="table-secondary">{row.familyLabel}</td>
              <td>{formatNumber(row.entries)}</td>
              <td>{pct(row.share, 1)}</td>
              <td>{formatNumber(row.distinctWorkshops)}</td>
              <td>{pct(row.codeOnlyShare, 0)}</td>
              <td>{pct(row.chatRate, 0)}</td>
              <td>
                <Link
                  className="button button-ghost"
                  href={diagnosticsHref(row.base)}
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DtcCodesContent({
  analysis,
  showInternal,
}: {
  analysis: DtcAnalysis;
  showInternal: boolean;
}) {
  const { totals } = analysis;
  const topCode = analysis.topCodes[0];
  const topFamily = analysis.families[0];
  const topPair = analysis.pairs[0];
  const bareFtb = analysis.ftbs.find((row) => row.ftb === "00");
  const unclassifiedOccurrences = analysis.unclassified.reduce(
    (sum, row) => sum + row.entries,
    0,
  );

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">DTC Codes</p>
            <h2>Which fault codes workshops bring to the AI.</h2>
            <p className="hero-text">
              Everything here comes from the fault-code field of a diagnostic —{" "}
              <code>
                dashboard_diagnostics.metadata-&gt;&apos;dtcs&apos;
              </code>
              , synced hourly from the core-app S3 export. Internal accounts are
              excluded: anyone on an internal email domain (
              {INTERNAL_TEST_EMAIL_DOMAINS.map((domain, index) => (
                <span key={domain}>
                  {index > 0 ? ", " : ""}
                  <code>@{domain}</code>
                </span>
              ))}
              ) is flagged on <code>dashboard_users.is_internal_test</code> and
              dropped before any number on this page is computed, along with
              workshops flagged the same way and any address matching a pattern
              in dashboard settings.
              {showInternal ? (
                <>
                  {" "}
                  <strong>
                    Internal accounts are currently being shown.
                  </strong>{" "}
                  Remove <code>?showInternal=1</code> from the URL for customer-only
                  figures.
                </>
              ) : null}
            </p>
            <p className="hero-text" style={{ marginTop: "0.5rem" }}>
              Codes are counted on their <strong>base code</strong> — the
              5-character SAE code with any trailing failure type byte removed.
              This matters more than it sounds: scan tools report the same fault
              as both <code>P0299</code> and <code>P029900</code>, and without
              collapsing them the top list splits one fault across two rows and
              understates it by up to 60%. A code that appears twice in one
              session under different failure type bytes counts once.
            </p>
            <p
              className="hero-text"
              style={{ marginTop: "0.5rem", fontSize: "0.8rem", opacity: 0.75 }}
            >
              No time-range filter: the page always reads all synced history,
              because code-frequency analysis over a 30-day slice is too thin to
              be useful. The country filter does apply. “Open” links jump to the
              diagnostics drilldown, which uses its own default window and so
              lists fewer rows than the counts here.{" "}
              {pct(totals.namedShare, 0)} of code instances have a
              description from the {formatNumber(totals.dictionarySize)}-entry
              generic dictionary; the rest are manufacturer-specific codes whose
              meaning depends on the make, and are deliberately left unnamed
              rather than guessed at.
            </p>
          </div>
          <div className="summary-grid columns-2">
            <div className="summary-card">
              <strong>{formatNumber(totals.withCodes)}</strong>
              <LabelInfo
                label="Sessions with a code"
                info="Diagnostics where at least one entry in the fault-code field parsed as a readable code. The rest describe the problem in words only — either the fault throws no code, or the car has not been read yet."
              />
              <small>
                {pct(totals.coverage, 0)} of{" "}
                {formatNumber(totals.diagnostics)} diagnostics
              </small>
            </div>
            <div className="summary-card">
              <strong>{formatNumber(totals.distinctBaseCodes)}</strong>
              <LabelInfo
                label="Distinct codes"
                info="Unique base codes seen at least once. A long tail: most appear once or twice, which is why the top list matters more than the count."
              />
              <small>
                {formatNumber(totals.codeOccurrences)} code instances ·{" "}
                {pct(totals.genericShare, 0)} generic
              </small>
            </div>
            <div className="summary-card">
              <strong>{totals.avgCodesPerEntry.toFixed(2)}</strong>
              <LabelInfo
                label="Codes per session"
                info="Average across sessions that carry at least one code. Above 1 because a real fault usually sets several codes at once — reading them as a set is the thing a lookup table cannot do."
              />
              <small>
                {pct(totals.multiCodeShare, 0)} carry more than one (
                {formatNumber(totals.multiCodeEntries)} sessions)
              </small>
            </div>
            <div className="summary-card">
              <strong>{pct(totals.codeOnlyShare, 0)}</strong>
              <LabelInfo
                label="Code and nothing else"
                info="Sessions that give the AI a fault code with no description at all. This is the hardest possible input: no symptom, no context, no history — just a number. It is also the clearest product signal on this page."
              />
              <small>
                {formatNumber(totals.codeOnlyEntries)} sessions with no
                description
              </small>
            </div>
            <div className="summary-card">
              <strong>{pct(totals.ftbShare, 0)}</strong>
              <LabelInfo
                label="Carry a failure type byte"
                info="Share of code instances that arrived with a 2-hex-digit failure mode appended, the way UDS / ISO 14229 scan tools report. That byte says whether the fault is a short, an open, an implausible signal or a stuck actuator — real diagnostic information most tools throw away."
              />
              <small>
                {formatNumber(totals.withFtb)} of{" "}
                {formatNumber(totals.codeOccurrences)} instances
              </small>
            </div>
            <div className="summary-card">
              <strong>
                {topCode ? topCode.base : "—"}
              </strong>
              <LabelInfo
                label="Most common code"
                info="The single most frequently entered fault code across all synced history, after collapsing the written variants of the same fault."
              />
              <small>
                {topCode
                  ? `${topCode.name ?? topCode.familyLabel} · ${formatNumber(
                      topCode.entries,
                    )} sessions`
                  : "no codes yet"}
              </small>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Top list</p>
            <HeadingInfo
              label="Most entered fault codes"
              info="Ranked by the number of distinct diagnostic sessions the code appeared in. 'Workshops' is how many different workshops entered it — a code seen at many workshops is a fleet-wide problem, one seen at a single workshop is that shop's speciality. 'No text' is the share of those sessions that gave no description alongside the code, and 'Chat' the share that opened a follow-up conversation."
            />
          </div>
          <span className="badge">
            {topCode
              ? `#1 ${topCode.base} · ${formatNumber(topCode.entries)} sessions`
              : "no data"}
          </span>
        </div>
        <p className="panel-description">
          “{scopeBadge("generic")}” codes are defined identically on every
          vehicle by SAE J2012 and carry a portable description.
          “{scopeBadge("manufacturer")}” codes (second character 1 or 3) mean
          different things on different makes, so no description is shown for
          them — check the make column and the manufacturer&apos;s own
          documentation.
        </p>
        <CodeTable
          rows={analysis.topCodes}
          limit={60}
          emptyLabel="No fault codes in this selection."
        />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Combinations</p>
            <HeadingInfo
              label="Codes that arrive together"
              info="Pairs of codes stored in the same diagnostic session. 'Together' is how many sessions had both. 'Lift' is how much more often that happens than independent chance would predict — 1.0 means no relationship, and the large values here are real: these codes almost never appear apart. 'When one, other' is the share of the rarer code's sessions that also contained the other, which is the number to trust when the counts are small."
            />
          </div>
          {topPair ? (
            <span className="badge">
              {topPair.a} + {topPair.b} · {formatNumber(topPair.together)}×
            </span>
          ) : null}
        </div>
        <p className="panel-description">
          This is the analysis a code-lookup table cannot do. Four adjacent
          injector codes together point at one harness rather than four dead
          injectors; a low-voltage code arriving with a fistful of network codes
          is one starved battery rather than a bus fault; a general misfire plus a
          single cylinder code names the cylinder that is dragging the engine.
          Only pairs seen in at least three sessions are listed.
        </p>
        {analysis.pairs.length === 0 ? (
          <p className="panel-description">
            No code pair has been seen three times yet.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>What they are</th>
                  <th>Together</th>
                  <th>Each alone</th>
                  <th>Lift</th>
                  <th>When one, other</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {analysis.pairs.slice(0, 30).map((pair) => (
                  <tr key={`${pair.a}-${pair.b}`}>
                    <td>
                      <div className="table-primary">
                        <strong style={{ fontFamily: "var(--font-mono)" }}>
                          {pair.a} + {pair.b}
                        </strong>
                        {pair.sameFamily ? (
                          <span>same family</span>
                        ) : (
                          <span>across systems</span>
                        )}
                      </div>
                    </td>
                    <td style={{ maxWidth: "24rem", fontSize: "0.82rem" }}>
                      {[pair.aName, pair.bName].every((name) => !name) ? (
                        <span className="muted">
                          both manufacturer-specific
                        </span>
                      ) : (
                        <>
                          {pair.aName ?? `${pair.a} (make-specific)`}
                          {" + "}
                          {pair.bName ?? `${pair.b} (make-specific)`}
                        </>
                      )}
                    </td>
                    <td>{formatNumber(pair.together)}</td>
                    <td className="table-secondary">
                      {formatNumber(pair.aTotal)} / {formatNumber(pair.bTotal)}
                    </td>
                    <td>{pair.lift.toFixed(0)}×</td>
                    <td>{pct(pair.confidence, 0)}</td>
                    <td>
                      <Link
                        className="button button-ghost"
                        href={diagnosticsHref(pair.a)}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Combinations</p>
            <HeadingInfo
              label="Exact code sets that repeat"
              info="The complete set of codes stored in a session, where that same set turned up more than once. A repeating fingerprint is either a known failure pattern on a particular model, or one workshop working through a batch of the same job."
            />
          </div>
        </div>
        {analysis.sets.length === 0 ? (
          <p className="panel-description">
            No multi-code set has repeated yet.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Times</th>
                  <th>Code set</th>
                  <th>Systems involved</th>
                  <th>Most common make</th>
                </tr>
              </thead>
              <tbody>
                {analysis.sets.slice(0, 20).map((set) => (
                  <tr key={set.codes.join("-")}>
                    <td>
                      <strong>{formatNumber(set.count)}×</strong>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>
                      {set.codes.map((code, index) => (
                        <span key={code}>
                          {index > 0 ? " + " : ""}
                          <CodeLink code={code} />
                        </span>
                      ))}
                    </td>
                    <td className="table-secondary" style={{ fontSize: "0.8rem" }}>
                      {set.familyLabels.join(" · ")}
                    </td>
                    <td>{set.topMake ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Top list</p>
            <HeadingInfo
              label="What is actually breaking"
              info="Codes rolled up into repair-shop families by their position in the SAE numbering. Single-label: every code belongs to exactly one family, so the shares add up. This is the view that answers 'what work are our customers doing' rather than 'which numbers do they type'."
            />
          </div>
          {topFamily ? (
            <span className="badge">
              #1 {topFamily.label} · {pct(topFamily.share, 0)}
            </span>
          ) : null}
        </div>
        <GroupBarList
          rows={analysis.families}
          emptyLabel="No fault codes in this selection."
        />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Failure mode</p>
            <HeadingInfo
              label="How the fault is failing"
              info="The failure type byte appended to a code by UDS scan tools, grouped by its high nibble as the standard defines. This is the most under-used field in the whole dataset: it distinguishes a wiring fault from a failing sensor from a stuck actuator on the same code, which changes the repair completely."
            />
          </div>
          {bareFtb ? (
            <span className="badge">
              {pct(bareFtb.share, 0)} carry no sub-type
            </span>
          ) : null}
        </div>
        <p className="panel-description">
          Only{" "}
          {pct(totals.ftbShare, 0)} of code instances carry this byte at
          all, and just over half of those are <code>00</code> — “no sub-type
          information”, which tells you nothing. The remainder is where the value
          is: a <code>P0087</code> with a circuit byte is a wiring job, the same
          code with a mechanical byte is a pump.
        </p>
        <GroupBarList
          rows={analysis.ftbFamilies}
          emptyLabel="No failure type bytes in this selection."
          unit="of bytes seen"
        />
        {analysis.ftbs.length > 0 ? (
          <div className="table-wrap" style={{ marginTop: "1rem" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Byte</th>
                  <th>Meaning</th>
                  <th>Group</th>
                  <th>Instances</th>
                  <th>Share</th>
                  <th>Most common on</th>
                </tr>
              </thead>
              <tbody>
                {analysis.ftbs.slice(0, 25).map((row) => (
                  <tr key={row.ftb}>
                    <td>
                      <code>{row.ftb}</code>
                    </td>
                    <td>
                      {row.name ?? (
                        <span className="muted">
                          manufacturer-defined — no portable meaning
                        </span>
                      )}
                    </td>
                    <td className="table-secondary">{row.familyLabel}</td>
                    <td>{formatNumber(row.occurrences)}</td>
                    <td>{pct(row.share, 1)}</td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>
                      {row.topCode ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Structure</p>
            <HeadingInfo
              label="Systems, scope and subsystems"
              info="The three structural axes a code carries in its own numbering: which vehicle domain it belongs to, whether the standard defines it or the manufacturer does, and which subsystem the standard assigns the third character to."
            />
          </div>
        </div>
        <div className="content-grid">
          <div>
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              Vehicle domain
            </h3>
            <GroupBarList
              rows={analysis.systems}
              emptyLabel="No codes in this selection."
            />
          </div>
          <div>
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              Standardised or make-specific
            </h3>
            <GroupBarList
              rows={analysis.scopes}
              emptyLabel="No codes in this selection."
            />
          </div>
        </div>
        {analysis.subsystems.length > 0 ? (
          <div style={{ marginTop: "1.25rem" }}>
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              Powertrain subsystem, per SAE J2012
            </h3>
            <GroupBarList
              rows={analysis.subsystems}
              emptyLabel="No powertrain codes in this selection."
            />
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Input shape</p>
            <HeadingInfo
              label="How many codes they give the AI"
              info="Sessions grouped by how many codes they carry, with how often each band also wrote a description, opened a follow-up chat, and how many causes the AI returned. Read the 'wrote text' column against the 'one code' row: that is the share of the simplest possible input where the AI gets a bare number and nothing else."
            />
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Codes in session</th>
                <th>Sessions</th>
                <th>Share</th>
                <th>Also wrote text</th>
                <th>Opened chat</th>
                <th>Avg causes returned</th>
              </tr>
            </thead>
            <tbody>
              {analysis.countBands.map((band) => (
                <tr key={band.key}>
                  <td>
                    <div className="table-primary">
                      <strong>{band.label}</strong>
                      {band.hint ? (
                        <span style={{ maxWidth: "26rem" }}>{band.hint}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>{formatNumber(band.entries)}</td>
                  <td>{pct(band.share, 1)}</td>
                  <td>{pct(band.withTextShare, 0)}</td>
                  <td>{pct(band.chatRate, 0)}</td>
                  <td>{band.avgCauses.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Vehicles</p>
            <HeadingInfo
              label="Codes by make"
              info="Which brands generate the codes, and how. Make names are collapsed across the inconsistent casing the app captures, so VOLVO and Volvo are one row. The 'with failure byte' column is the interesting one: it tracks the scan tool and protocol generation rather than the vehicle's reliability."
            />
          </div>
        </div>
        <p className="panel-description">
          The failure-byte share varies enormously by brand, and it is a property
          of how the car is read rather than of the car. Brands read over UDS send
          the extra byte, older protocols do not — so a low share means those
          sessions arrive with less diagnostic detail attached, through no fault of
          the workshop.
        </p>
        {analysis.makes.length === 0 ? (
          <p className="panel-description">
            No make has enough coded sessions to list yet.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Make</th>
                  <th>Coded sessions</th>
                  <th>Codes</th>
                  <th>Avg per session</th>
                  <th>With failure byte</th>
                  <th>Most common code</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {analysis.makes.slice(0, 25).map((row) => (
                  <tr key={row.make}>
                    <td>
                      <strong>{row.make}</strong>
                    </td>
                    <td>{formatNumber(row.entries)}</td>
                    <td>{formatNumber(row.codeOccurrences)}</td>
                    <td>{row.avgCodesPerEntry.toFixed(2)}</td>
                    <td>{pct(row.ftbShare, 0)}</td>
                    <td>
                      {row.topCode ? (
                        <div className="table-primary">
                          <strong style={{ fontFamily: "var(--font-mono)" }}>
                            {row.topCode}
                          </strong>
                          <span style={{ maxWidth: "18rem" }}>
                            {row.topCodeName ??
                              "manufacturer-specific"}{" "}
                            · {formatNumber(row.topCodeEntries)}×
                          </span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Link
                        className="button button-ghost"
                        href={diagnosticsHref(row.make)}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Movement</p>
            <HeadingInfo
              label={`Rising and fading codes, last ${analysis.trendWindowDays} days`}
              info="The most recent window compared against the window before it, anchored on the newest synced diagnostic rather than the wall clock — so a lagging sync shows as a shifted window instead of a fake collapse in volume. 'New' means the code had never been seen before this window."
            />
          </div>
        </div>
        <div className="content-grid">
          <div>
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Rising</h3>
            {analysis.rising.length === 0 ? (
              <p className="panel-description">
                No code has gained ground in this window.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Now</th>
                      <th>Before</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.rising.slice(0, 12).map((row) => (
                      <tr key={row.base}>
                        <td>
                          <div className="table-primary">
                            <strong>
                              <CodeLink code={row.base} />
                            </strong>
                            <span style={{ maxWidth: "16rem" }}>
                              {row.name ?? row.familyLabel}
                              {row.isNew ? " · new" : ""}
                            </span>
                          </div>
                        </td>
                        <td>{formatNumber(row.recent)}</td>
                        <td>{formatNumber(row.prior)}</td>
                        <td className="tone-growth">+{formatNumber(row.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Fading</h3>
            {analysis.fading.length === 0 ? (
              <p className="panel-description">
                No code has dropped off in this window.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Now</th>
                      <th>Before</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.fading.slice(0, 12).map((row) => (
                      <tr key={row.base}>
                        <td>
                          <div className="table-primary">
                            <strong>
                              <CodeLink code={row.base} />
                            </strong>
                            <span style={{ maxWidth: "16rem" }}>
                              {row.name ?? row.familyLabel}
                            </span>
                          </div>
                        </td>
                        <td>{formatNumber(row.recent)}</td>
                        <td>{formatNumber(row.prior)}</td>
                        <td className="tone-warning">
                          {formatNumber(row.delta)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Reach</p>
            <HeadingInfo
              label="Everyone's problem, or one workshop's"
              info="The same count can mean two very different things. A code entered by fifteen different workshops is a fleet-wide fault worth writing content about. A code entered fifteen times by one workshop is that shop's own fleet or a batch job, and should not drive a product decision. Only codes with at least four sessions are listed."
            />
          </div>
        </div>
        <div className="content-grid">
          <div>
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              Seen at the most workshops
            </h3>
            {analysis.widestSpread.length === 0 ? (
              <p className="panel-description">Not enough repeat codes yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Workshops</th>
                      <th>Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.widestSpread.slice(0, 12).map((row) => (
                      <tr key={row.base}>
                        <td>
                          <div className="table-primary">
                            <strong>
                              <CodeLink code={row.base} />
                            </strong>
                            <span style={{ maxWidth: "16rem" }}>
                              {row.name ?? "manufacturer-specific"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <strong>{formatNumber(row.distinctWorkshops)}</strong>
                        </td>
                        <td>{formatNumber(row.entries)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              Concentrated in one workshop
            </h3>
            {analysis.mostConcentrated.length === 0 ? (
              <p className="panel-description">
                No repeat code is concentrated in a single workshop.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Sessions</th>
                      <th>From one shop</th>
                      <th>Workshop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.mostConcentrated.slice(0, 12).map((row) => (
                      <tr key={row.base}>
                        <td>
                          <strong>
                            <CodeLink code={row.base} />
                          </strong>
                        </td>
                        <td>{formatNumber(row.entries)}</td>
                        <td>{pct(row.topWorkshopShare, 0)}</td>
                        <td className="table-secondary">
                          {row.topWorkshopName
                            ? truncate(row.topWorkshopName, 28)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Difficulty</p>
            <HeadingInfo
              label="Codes that need a follow-up conversation"
              info="Ranked by the share of sessions that went on to open a chat with the AI after the first answer. A high rate means the initial ranked causes did not settle it — either the fault is genuinely ambiguous, or the answer needs work. Limited to codes with at least five sessions so a single chat cannot top the list."
            />
          </div>
        </div>
        <p className="panel-description">
          Chat rate is the closest thing in this data to “the first answer was not
          enough”. Codes at the top of this list are the best candidates for
          better content, a targeted prompt, or a guided test procedure.
        </p>
        <CodeTable
          rows={analysis.hardestCodes}
          limit={15}
          emptyLabel="No code has five sessions yet."
        />
      </section>

      {analysis.countries.length > 1 ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Markets</p>
              <HeadingInfo
                label="Codes by country"
                info="Country comes from the workshop record, not from the vehicle. Useful for spotting whether a market's fault mix differs — a market dominated by diesel after-treatment codes needs different content from one dominated by petrol misfires."
              />
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Country</th>
                  <th>Coded sessions</th>
                  <th>Codes</th>
                  <th>Most common code</th>
                  <th>Biggest family</th>
                </tr>
              </thead>
              <tbody>
                {analysis.countries.slice(0, 20).map((row) => (
                  <tr key={row.country}>
                    <td>
                      <strong>{row.country}</strong>
                    </td>
                    <td>{formatNumber(row.entries)}</td>
                    <td>{formatNumber(row.codeOccurrences)}</td>
                    <td>
                      {row.topCode ? (
                        <div className="table-primary">
                          <strong style={{ fontFamily: "var(--font-mono)" }}>
                            {row.topCode}
                          </strong>
                          <span style={{ maxWidth: "18rem" }}>
                            {row.topCodeName ?? "manufacturer-specific"}
                          </span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="table-secondary">
                      {row.topFamilyLabel ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Over time</p>
            <HeadingInfo
              label="Code coverage by month"
              info="How many diagnostics each month carried codes at all, and how many codes they averaged. Coverage moving is a behaviour change worth understanding: it means workshops are reading cars before asking, or have stopped."
            />
          </div>
          <span className="badge">
            {totals.earliestDiagnosticAt?.slice(0, 10) ?? "—"} →{" "}
            {totals.latestDiagnosticAt?.slice(0, 10) ?? "—"}
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Diagnostics</th>
                <th>With codes</th>
                <th>Coverage</th>
                <th>Code instances</th>
                <th>Avg codes per coded session</th>
              </tr>
            </thead>
            <tbody>
              {analysis.monthly.map((point) => (
                <tr key={point.month}>
                  <td>
                    <strong>{point.month}</strong>
                  </td>
                  <td>{formatNumber(point.diagnostics)}</td>
                  <td>{formatNumber(point.withCodes)}</td>
                  <td>{pct(point.coverage, 0)}</td>
                  <td>{formatNumber(point.codeOccurrences)}</td>
                  <td>{point.avgCodesPerCodedEntry.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Data quality</p>
            <HeadingInfo
              label="What arrives malformed"
              info="The fault-code field is free text, so it collects typos and pasted junk. Everything listed here is repaired or excluded before the numbers above are computed — this panel exists so the repairs are visible rather than silent, and because most of these are things the app could catch at the keyboard."
            />
          </div>
          <span className="badge">
            {formatNumber(totals.unparseableOccurrences)} unreadable of{" "}
            {formatNumber(totals.rawEntries)}
          </span>
        </div>
        <p className="panel-description">
          {formatNumber(totals.rawEntries)} strings were entered in total;{" "}
          {formatNumber(totals.codeOccurrences)} resolved to a countable SAE code.{" "}
          {formatNumber(totals.manufacturerCodeOccurrences)} are valid
          manufacturer-native codes with no SAE equivalent, and{" "}
          {formatNumber(totals.unparseableOccurrences)} could not be read at all.{" "}
          {formatNumber(totals.noSaeCodeEntries)} sessions typed something into
          the field but ended up contributing no code to any chart above.
        </p>
        {analysis.defects.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Problem</th>
                  <th>Instances</th>
                  <th>Examples</th>
                </tr>
              </thead>
              <tbody>
                {analysis.defects.map((row) => (
                  <tr key={row.defect}>
                    <td>
                      <div className="table-primary">
                        <strong>{row.label}</strong>
                        <span style={{ maxWidth: "30rem" }}>{row.hint}</span>
                      </div>
                    </td>
                    <td>{formatNumber(row.occurrences)}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>
                      {row.examples
                        .slice(0, 5)
                        .map((example) =>
                          example.raw === example.normalized
                            ? example.raw
                            : `${example.raw} → ${example.normalized}`,
                        )
                        .join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="panel-description">
            Every entered string was well formed.
          </p>
        )}

        <div className="content-grid" style={{ marginTop: "1.25rem" }}>
          <div>
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              Manufacturer-native codes
            </h3>
            <p
              className="muted"
              style={{ margin: "0 0 0.5rem", fontSize: "0.8rem" }}
            >
              Valid fault codes in a manufacturer&apos;s own scheme rather than
              SAE — raw hex with no letter prefix (mostly BMW and Mercedes), or
              lettered schemes like Renault&apos;s <code>DF</code> codes. They
              cannot be mapped to an SAE code, so they are reported here instead of
              being forced into one.
            </p>
            {analysis.manufacturerHex.length === 0 ? (
              <p className="panel-description">None in this selection.</p>
            ) : (
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", lineHeight: 1.7 }}>
                {analysis.manufacturerHex.slice(0, 30).map((row) => (
                  <span key={row.raw}>
                    {row.raw}
                    {row.count > 1 ? `×${row.count}` : ""}
                    {row.makes.length > 0 ? ` (${row.makes.join("/")})` : ""}
                    {"  "}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div>
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              Not readable as a code
            </h3>
            <p
              className="muted"
              style={{ margin: "0 0 0.5rem", fontSize: "0.8rem" }}
            >
              Strings that start like a fault code but are not one — wrong length,
              a non-hex character, or a second character outside the 0-3 the
              standard allows. Each of these is a session where the AI got less
              than the technician thought they gave it.
            </p>
            {analysis.unparseable.length === 0 ? (
              <p className="panel-description">None in this selection.</p>
            ) : (
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", lineHeight: 1.7 }}>
                {analysis.unparseable.slice(0, 30).map((row) => (
                  <span key={row.raw}>
                    {row.raw}
                    {row.count > 1 ? `×${row.count}` : ""}
                    {"  "}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Coverage gap</p>
            <HeadingInfo
              label="Standardised codes with no family yet"
              info="Generic codes that the family rules do not claim. These are the real gap: unlike manufacturer-specific codes, these have one fixed meaning and could be classified and named. This panel is the intended way to grow the family list and the dictionary."
            />
          </div>
          <span className="badge">
            {formatNumber(unclassifiedOccurrences)} instances ·{" "}
            {formatNumber(analysis.unclassified.length)} codes
          </span>
        </div>
        {analysis.unclassified.length === 0 ? (
          <p className="panel-description">
            Every code in this selection is classified.
          </p>
        ) : (
          <CodeTable
            rows={analysis.unclassified}
            limit={20}
            emptyLabel="Every code is classified."
          />
        )}
      </section>
    </div>
  );
}
