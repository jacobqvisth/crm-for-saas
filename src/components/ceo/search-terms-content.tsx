import Link from "next/link";
import { formatNumber, formatPercent } from "@/lib/ceo/format";
import type {
  SearchTermBucket,
  SearchTermExample,
  SearchTermsAnalysis,
  TermFrequency,
} from "@/lib/ceo/search-terms";
import { InfoHint } from "./source-info";

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

/** Deep-link into the diagnostics drilldown, pre-filtered to this text. */
function diagnosticsSearchHref(term: string, rangeKey: string) {
  const params = new URLSearchParams({ q: term });
  if (rangeKey && rangeKey !== "last_30_days") {
    params.set("range", rangeKey);
  }
  return `/dashboard/diagnostics?${params.toString()}`;
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function ExampleList({ examples }: { examples: SearchTermExample[] }) {
  if (examples.length === 0) {
    return null;
  }
  return (
    <ul
      style={{
        margin: "8px 0 0",
        paddingLeft: "1rem",
        display: "grid",
        gap: "6px",
      }}
    >
      {examples.map((example) => (
        <li
          key={example.diagnosticId}
          style={{ fontSize: "0.82rem", lineHeight: 1.45 }}
        >
          <span>“{truncate(example.text, 220)}”</span>
          <span className="muted" style={{ marginLeft: "0.4rem" }}>
            — {[example.language?.toUpperCase(), example.car]
              .filter(Boolean)
              .join(" · ") || "unknown"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BucketBarList({
  buckets,
  described,
  emptyLabel,
}: {
  buckets: SearchTermBucket[];
  described: number;
  emptyLabel: string;
}) {
  const visible = buckets.filter((bucket) => bucket.count > 0);
  if (visible.length === 0) {
    return <p className="panel-description">{emptyLabel}</p>;
  }
  const maxValue = Math.max(...visible.map((bucket) => bucket.count), 1);
  return (
    <div className="bar-list">
      {visible.map((bucket) => (
        <div className="bar-row" key={bucket.key}>
          <div className="bar-row-copy">
            <strong>{bucket.label}</strong>
            <span>
              {formatPercent(bucket.count / (described || 1), 1)} of entries
            </span>
          </div>
          <div className="bar-row-main">
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${Math.max(4, (bucket.count / maxValue) * 100)}%`,
                }}
              />
            </div>
            <strong>{formatNumber(bucket.count)}</strong>
          </div>
          <p
            className="muted"
            style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.45 }}
          >
            {bucket.hint}
          </p>
          {bucket.examples.length > 0 ? (
            <details>
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Show what they wrote
              </summary>
              <ExampleList examples={bucket.examples} />
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TermTable({
  rows,
  rangeKey,
  termHeading,
}: {
  rows: TermFrequency[];
  rangeKey: string;
  termHeading: string;
}) {
  if (rows.length === 0) {
    return <p className="panel-description">Nothing repeated yet.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{termHeading}</th>
            <th>Entries</th>
            <th>Uses</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.term}>
              <td>
                <code>{row.term}</code>
              </td>
              <td>{formatNumber(row.entries)}</td>
              <td>{formatNumber(row.occurrences)}</td>
              <td>
                <Link
                  className="button button-ghost"
                  href={diagnosticsSearchHref(row.term, rangeKey)}
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

export function SearchTermsContent({
  analysis,
  rangeKey,
  showInternal,
}: {
  analysis: SearchTermsAnalysis;
  rangeKey: string;
  showInternal: boolean;
}) {
  const { totals } = analysis;
  const topComplaint = analysis.complaints[0];
  const priorWork = analysis.phrasing.find(
    (bucket) => bucket.key === "prior-work",
  );
  const testEntries =
    analysis.phrasing.find((bucket) => bucket.key === "test-entry")?.count ?? 0;

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Diagnostic Search Terms</p>
            <h2>
              What technicians actually type when they start a diagnosis.
            </h2>
            <p className="hero-text">
              Every number on this page is derived from the free-text{" "}
              <code>description</code> field of a diagnostic —{" "}
              <code>dashboard_diagnostics.metadata-&gt;&gt;&apos;description&apos;</code>
              , synced hourly from the core-app S3 export. It is the only
              free-text field the export actually fills: the sibling{" "}
              <code>symptoms</code> and <code>user_actions</code> arrays exist in
              the schema and in the app UI but arrive empty on every row, so
              there is no second source to cross-check against.
            </p>
            <p
              className="hero-text"
              style={{ marginTop: "0.5rem", fontSize: "0.8rem", opacity: 0.75 }}
            >
              Categories are keyword-matched across Swedish, English, German,
              Italian, Romanian, Polish, Slovak, Danish and Russian phrasing, and
              an entry can land in several at once — “motorlampa lyser, bilen
              tappar kraft” counts as both a warning lamp and a power loss. So
              category counts add up to more than the number of entries. Shares
              are always of entries that have text.
              {testEntries > 0 ? (
                <>
                  {" "}
                  {formatNumber(testEntries)} entries look like test/placeholder
                  text — see “How they write it” before treating small
                  differences as real.
                </>
              ) : null}
            </p>
          </div>
          <div className="summary-grid columns-2">
            <div className="summary-card">
              <strong>{formatNumber(totals.described)}</strong>
              <LabelInfo
                label="Entries with text"
                info="Diagnostics in the selected range whose description field is non-empty after trimming whitespace."
              />
              <small>
                {formatPercent(totals.coverage, 0)} of{" "}
                {formatNumber(totals.diagnostics)} diagnostics
              </small>
            </div>
            <div className="summary-card">
              <strong>{formatNumber(totals.medianChars)}</strong>
              <LabelInfo
                label="Median characters"
                info="Half of all entries are shorter than this. Average is pulled up by a small number of long case histories, so the median is the honest number for 'how much does the AI actually get to work with'."
              />
              <small>
                avg {formatNumber(totals.avgChars)} · p90{" "}
                {formatNumber(totals.p90Chars)} · max{" "}
                {formatNumber(totals.maxChars)}
              </small>
            </div>
            <div className="summary-card">
              <strong>{formatNumber(totals.avgWords)}</strong>
              <LabelInfo
                label="Average words"
                info="Word count after punctuation is stripped. Most entries are a symptom phrase, not a sentence."
              />
              <small>{formatNumber(totals.distinctTexts)} distinct texts</small>
            </div>
            <div className="summary-card">
              <strong>
                {priorWork
                  ? formatPercent(priorWork.share, 0)
                  : formatPercent(0, 0)}
              </strong>
              <LabelInfo
                label="Already tried a repair"
                info="Share of entries that name a part already replaced ('vi har bytt…', 'we replaced…'). These are the cases the workshop is stuck on, and where a wrong AI answer costs real parts money."
              />
              <small>
                {priorWork ? formatNumber(priorWork.count) : 0} entries list
                prior work
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
              label="What they are reporting"
              info="The complaint in the technician's own words, keyword-matched per language. Multi-label: one entry can appear in several rows. Open 'Show what they wrote' for real examples in each category."
            />
          </div>
          <span className="badge">
            {topComplaint
              ? `#1 ${topComplaint.label} · ${formatNumber(topComplaint.count)}`
              : "no data"}
          </span>
        </div>
        <BucketBarList
          buckets={analysis.complaints}
          described={totals.described}
          emptyLabel="No described diagnostics in this range."
        />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Top list</p>
            <HeadingInfo
              label="Which system they point at"
              info="Vehicle system named or implied in the text. Also multi-label — 'felkoder på egr och dpf, spridare bytta' counts under both emissions and fuel."
            />
          </div>
        </div>
        <BucketBarList
          buckets={analysis.systems}
          described={totals.described}
          emptyLabel="No described diagnostics in this range."
        />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Prompt quality</p>
            <HeadingInfo
              label="How they write it"
              info="Not what is broken, but how it is written up — the shape of the prompt the AI actually receives. High 'lists repairs already tried' and 'gives operating conditions' means rich input; a high share of 1-2 word entries means the model is reasoning from almost nothing."
            />
          </div>
        </div>
        <BucketBarList
          buckets={analysis.phrasing}
          described={totals.described}
          emptyLabel="No described diagnostics in this range."
        />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Prompt quality</p>
            <HeadingInfo
              label="How much they write"
              info="Mutually exclusive length bands covering every entry with text. Anything of two words or fewer counts as a keyword entry regardless of character count."
            />
          </div>
        </div>
        <div className="bar-list">
          {analysis.lengthBands.map((band) => (
            <div className="bar-row" key={band.key}>
              <div className="bar-row-copy">
                <strong>{band.label}</strong>
                <span>{formatPercent(band.share, 1)}</span>
              </div>
              <div className="bar-row-main">
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.max(
                        4,
                        (band.count /
                          Math.max(
                            ...analysis.lengthBands.map((row) => row.count),
                            1,
                          )) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
                <strong>{formatNumber(band.count)}</strong>
              </div>
              <p
                className="muted"
                style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.45 }}
              >
                {band.hint}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Verbatim</p>
            <HeadingInfo
              label="Most-repeated exact wordings"
              info="Identical text (ignoring case, extra spaces and trailing punctuation) entered on more than one diagnostic. Repeats come from two things worth telling apart: the same phrase being the standard way to describe a common fault, and one technician re-running the same case several times."
            />
          </div>
          <span className="badge">
            {formatNumber(totals.repeatedTexts)} texts used more than once
          </span>
        </div>
        {analysis.verbatims.length === 0 ? (
          <p className="panel-description">
            No text was entered twice in this range.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Wording</th>
                  <th>Times</th>
                  <th>Lang</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {analysis.verbatims.map((row) => (
                  <tr key={row.text}>
                    <td>{truncate(row.text, 160)}</td>
                    <td>{formatNumber(row.count)}</td>
                    <td>
                      <code>
                        {row.languages.length > 0
                          ? row.languages.join(", ")
                          : "—"}
                      </code>
                    </td>
                    <td>
                      <Link
                        className="button button-ghost"
                        href={diagnosticsSearchHref(
                          truncate(row.text, 60).replace("…", ""),
                          rangeKey,
                        )}
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

      <div className="content-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Vocabulary</p>
              <HeadingInfo
                label="Most common words"
                info="Single words ranked by how many separate entries they appear in, after removing stopwords in every language present, bare numbers, fault codes (they have their own card) and words that are true of every entry ('bil', 'fel', 'kund'). No stemming is applied, so Swedish definite forms count separately — 'motorlampa' and 'motorlampan' are the same complaint split across two rows, as are 'start' and 'startar'."
              />
            </div>
          </div>
          <TermTable
            rows={analysis.unigrams}
            rangeKey={rangeKey}
            termHeading="Word"
          />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Vocabulary</p>
              <HeadingInfo
                label="Most common phrases"
                info="Two-word sequences, same filtering as single words. These are closer to how a technician would actually phrase a search."
              />
            </div>
          </div>
          <TermTable
            rows={analysis.bigrams}
            rangeKey={rangeKey}
            termHeading="Phrase"
          />
        </section>
      </div>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Codes</p>
              <HeadingInfo
                label="Fault codes typed into the text"
                info="P/B/U/C codes the technician typed into the description, which is separate from the DTCs the scan itself captured. A code appearing here means they thought it mattered enough to repeat in their own words."
              />
            </div>
          </div>
          <TermTable
            rows={analysis.quotedCodes}
            rangeKey={rangeKey}
            termHeading="Code"
          />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Reach</p>
              <HeadingInfo
                label="Language mix"
                info="Workshop language from dashboard_workshops, not detected from the text. Length per language shows who writes detailed case histories and who writes two words."
              />
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Language</th>
                  <th>Entries</th>
                  <th>Share</th>
                  <th>Median chars</th>
                </tr>
              </thead>
              <tbody>
                {analysis.languages.map((row) => (
                  <tr key={row.language}>
                    <td>
                      <code>{row.language}</code>
                    </td>
                    <td>{formatNumber(row.entries)}</td>
                    <td>{formatPercent(row.share, 1)}</td>
                    <td>{formatNumber(row.medianChars)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Coverage</p>
            <HeadingInfo
              label="Are they filling the field in at all?"
              info="Per month: how many diagnostics ran and how many carried description text. A falling coverage line means the AI is increasingly working from codes alone."
            />
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Diagnostics</th>
                <th>With text</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {analysis.monthly.map((row) => (
                <tr key={row.month}>
                  <td>{row.month}</td>
                  <td>{formatNumber(row.total)}</td>
                  <td>{formatNumber(row.described)}</td>
                  <td>{formatPercent(row.coverage, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Gaps</p>
            <HeadingInfo
              label="Text no category recognised"
              info="Entries that matched none of the complaint keyword sets — the honest measure of what the top list above is missing. It splits in two: entries of two words or fewer carry no complaint to recognise at all, while the longer ones are a genuine keyword gap. The examples below are the longest unmatched entries, so they are the ones worth reading."
            />
          </div>
          <span className="badge">
            {formatNumber(analysis.uncategorised.count)} entries ·{" "}
            {formatPercent(analysis.uncategorised.share, 1)}
          </span>
        </div>
        <p className="panel-description">
          {formatNumber(analysis.uncategorisedTooShort)} of these are two words
          or fewer, so there is nothing to classify.{" "}
          {formatNumber(
            analysis.uncategorised.count - analysis.uncategorisedTooShort,
          )}{" "}
          have real content and represent a keyword gap — the longest are shown
          below.
        </p>
        {analysis.uncategorised.examples.length === 0 ? (
          <p className="panel-description">
            Every entry with more than two words matched at least one category.
          </p>
        ) : (
          <ExampleList examples={analysis.uncategorised.examples} />
        )}
      </section>

      {showInternal ? null : (
        <p className="panel-description">
          Internal and test users/workshops are excluded. Add{" "}
          <code>?showInternal=1</code> to include them.
        </p>
      )}
    </div>
  );
}
