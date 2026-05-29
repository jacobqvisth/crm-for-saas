import Link from "next/link";
import { ExternalLink, Star } from "lucide-react";

import type {
  PlatformScorecard,
  ReviewFeedItem,
  ReviewsData,
  ReviewTrendPoint,
} from "@/lib/ceo/data/reviews";
import { REVIEW_PLATFORMS, REVIEW_SOURCE_LABEL } from "@/lib/ceo/reviews/platforms";
import { formatNumber } from "@/lib/ceo/format";
import { InfoHint } from "./source-info";
import { ReviewsManualEntry } from "./reviews-manual-entry";

function formatRating(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

function formatDelta(value: number | null, digits = 0): string | null {
  if (value == null || value === 0) return null;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Stars({ rating }: { rating: number | null }) {
  const rounded = rating == null ? 0 : Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={14}
          className={
            i <= rounded ? "fill-amber-400 text-amber-400" : "text-slate-300"
          }
        />
      ))}
    </span>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  "saas-directory": "SaaS directories",
  general: "General / search",
  regional: "Regional",
  collection: "Collection tools",
};

const CATEGORY_ORDER = ["saas-directory", "general", "regional", "collection"];

function ScorecardCard({ card }: { card: PlatformScorecard }) {
  const ratingDelta = formatDelta(card.ratingDelta, 1);
  const countDelta = formatDelta(card.countDelta, 0);
  const sourceLabel = card.source
    ? REVIEW_SOURCE_LABEL[card.source] ?? card.source
    : REVIEW_SOURCE_LABEL[card.integrationType] ?? card.integrationType;

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: card.color }}
            aria-hidden
          />
          <span className="font-semibold text-slate-900">{card.name}</span>
          <InfoHint
            info={{
              title: card.name,
              body: card.note,
              logic: card.hasData
                ? `Latest snapshot from ${formatDate(card.capturedAt)} (${sourceLabel}).`
                : "No data entered yet.",
            }}
          />
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            card.source === "api"
              ? "bg-emerald-50 text-emerald-700"
              : card.source === "widget"
                ? "bg-sky-50 text-sky-700"
                : "bg-slate-100 text-slate-500"
          }`}
        >
          {sourceLabel}
        </span>
      </div>

      <div className="flex items-end gap-3">
        <strong className="text-3xl leading-none text-slate-900">
          {formatRating(card.rating)}
        </strong>
        <div className="flex flex-col gap-0.5 pb-0.5">
          <Stars rating={card.rating} />
          <span className="text-xs text-slate-500">
            {formatNumber(card.reviewCount)} review
            {card.reviewCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 text-slate-400">
          {ratingDelta ? (
            <span
              className={
                (card.ratingDelta ?? 0) > 0
                  ? "text-emerald-600"
                  : "text-rose-600"
              }
            >
              {ratingDelta} rating
            </span>
          ) : null}
          {countDelta ? (
            <span
              className={
                (card.countDelta ?? 0) > 0 ? "text-emerald-600" : "text-rose-600"
              }
            >
              {countDelta} reviews
            </span>
          ) : null}
          {!ratingDelta && !countDelta && card.hasData ? (
            <span>as of {formatDate(card.capturedAt)}</span>
          ) : null}
          {!card.hasData ? <span>awaiting first entry</span> : null}
        </span>
        <a
          href={card.profileUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
        >
          Profile <ExternalLink size={12} />
        </a>
      </div>
    </article>
  );
}

function TrendStrip({ trend }: { trend: ReviewTrendPoint[] }) {
  if (trend.length < 2) {
    return (
      <div className="empty-state">
        <strong>Trend needs at least two snapshots</strong>
        <p>
          Enter rating + count on two or more dates and the company-wide trend
          will plot here.
        </p>
      </div>
    );
  }

  const maxReviews = Math.max(...trend.map((p) => p.totalReviews), 1);
  const reviewPath = trend
    .map((p, i) => {
      const x = (i / (trend.length - 1)) * 100;
      const y = 100 - (p.totalReviews / maxReviews) * 78 - 8;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const ratingPath = trend
    .map((p, i) => {
      const x = (i / (trend.length - 1)) * 100;
      const y = 100 - (p.avgRating / 5) * 78 - 8;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const latest = trend.at(-1)!;

  return (
    <div className="trend-chart-wrap">
      <div className="trend-chart-head">
        <div>
          <strong className="heading-with-info compact">
            <span>Reviews &amp; rating over time</span>
          </strong>
          <span>
            {formatNumber(latest.totalReviews)} total reviews ·{" "}
            {latest.avgRating.toFixed(1)} avg rating
          </span>
        </div>
        <div className="chart-legend">
          <span>
            <i style={{ background: "#465fff" }} />
            Total reviews
          </span>
          <span>
            <i style={{ background: "#12b76a" }} />
            Avg rating
          </span>
        </div>
      </div>
      <div className="chart-wrap">
        <svg
          aria-label="Reviews and rating over time"
          className="line-chart"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          {[18, 36, 54, 72, 90].map((line) => (
            <line
              className="chart-grid"
              key={line}
              x1="0"
              x2="100"
              y1={line}
              y2={line}
            />
          ))}
          <path className="chart-line generic" d={reviewPath} stroke="#465fff" />
          <path
            className="chart-line generic dashed"
            d={ratingPath}
            stroke="#12b76a"
          />
        </svg>
        <div className="chart-axis">
          {trend.map((p, i) =>
            i === 0 || i === trend.length - 1 || i === Math.floor(trend.length / 2) ? (
              <span key={p.date}>{formatDate(p.date)}</span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewFeed({
  reviews,
  platformFilter,
  selectedRange,
}: {
  reviews: ReviewFeedItem[];
  platformFilter: string;
  selectedRange: string;
}) {
  const platformsWithReviews = REVIEW_PLATFORMS.filter(
    (p) => p.supportsIndividualReviews,
  );

  function tabHref(slug: string) {
    const params = new URLSearchParams();
    if (selectedRange) params.set("range", selectedRange);
    if (slug !== "all") params.set("platform", slug);
    const qs = params.toString();
    return qs ? `/ceo/reviews?${qs}` : "/ceo/reviews";
  }

  return (
    <article className="panel panel-wide">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Voice of customer</p>
          <h2 className="heading-with-info">
            <span>Recent individual reviews</span>
            <InfoHint
              info={{
                title: "Individual reviews",
                body: "Individual review text is only available for platforms with a usable API (Google Business Profile, Trustpilot, Trustmary, plus G2/TrustRadius if a vendor API is set up) or entered manually. Directory sites without an API show aggregate rating + count only.",
              }}
            />
          </h2>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Filter reviews by platform">
        <Link
          href={tabHref("all")}
          aria-current={platformFilter === "all" ? "page" : undefined}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            platformFilter === "all"
              ? "bg-indigo-600 text-white"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          All
        </Link>
        {platformsWithReviews.map((p) => (
          <Link
            key={p.slug}
            href={tabHref(p.slug)}
            aria-current={platformFilter === p.slug ? "page" : undefined}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              platformFilter === p.slug
                ? "bg-indigo-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {p.name}
          </Link>
        ))}
      </div>

      {reviews.length === 0 ? (
        <div className="empty-state">
          <strong>No individual reviews yet</strong>
          <p>
            Once the sync cron pulls Google / Trustpilot reviews — or you paste
            notable reviews via &ldquo;Add / update reviews&rdquo; — they appear
            here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {reviews.map((review) => (
            <div
              key={review.id}
              className="rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Stars rating={review.rating} />
                  <span className="text-xs font-medium text-slate-500">
                    {review.platformName}
                  </span>
                </div>
                <span className="text-xs text-slate-400">
                  {formatDate(review.reviewedAt)}
                </span>
              </div>
              {review.title ? (
                <strong className="mt-1 block text-sm text-slate-900">
                  {review.title}
                </strong>
              ) : null}
              {review.body ? (
                <p className="mt-1 text-sm text-slate-600">{review.body}</p>
              ) : null}
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-400">
                <span>
                  {[review.authorName, review.authorCompany]
                    .filter(Boolean)
                    .join(" · ") || "Anonymous"}
                </span>
                {review.reviewUrl ? (
                  <a
                    href={review.reviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
                  >
                    Source <ExternalLink size={12} />
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export function ReviewsContent({
  data,
  selectedRange,
  todayIso,
}: {
  data: ReviewsData;
  selectedRange: string;
  todayIso: string;
}) {
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABEL[category] ?? category,
    cards: data.scorecards.filter((c) => c.category === category),
  })).filter((g) => g.cards.length > 0);

  return (
    <div className="section-stack">
      {data.error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {data.error}
        </div>
      ) : null}

      <section className="kpi-grid">
        <article className="kpi-card tone-growth">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Average rating</span>
              <InfoHint
                info={{
                  title: "Average rating",
                  body: "Review-count-weighted mean of the latest rating across all platforms that have one — platforms with more reviews count more.",
                }}
              />
            </p>
            <strong>
              {data.totals.avgRating == null
                ? "—"
                : data.totals.avgRating.toFixed(2)}
            </strong>
          </div>
          <span className="metric-icon">★</span>
          <span className="kpi-card-hint">across all rated platforms</span>
        </article>
        <article className="kpi-card tone-product">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Total reviews</span>
            </p>
            <strong>{formatNumber(data.totals.totalReviews)}</strong>
          </div>
          <span className="metric-icon">∑</span>
          <span className="kpi-card-hint">summed across platforms</span>
        </article>
        <article className="kpi-card tone-neutral">
          <div className="kpi-card-main">
            <p className="label-with-info">
              <span>Platforms with data</span>
            </p>
            <strong>
              {data.totals.platformsWithData}/{data.totals.platformsTracked}
            </strong>
          </div>
          <span className="metric-icon">RV</span>
          <span className="kpi-card-hint">tracked review platforms</span>
        </article>
      </section>

      <ReviewsManualEntry
        platforms={REVIEW_PLATFORMS.map((p) => ({
          slug: p.slug,
          name: p.name,
          supportsIndividualReviews: p.supportsIndividualReviews,
        }))}
        todayIso={todayIso}
      />

      {grouped.map((group) => (
        <section key={group.category}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {group.label}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.cards.map((card) => (
              <ScorecardCard key={card.slug} card={card} />
            ))}
          </div>
        </section>
      ))}

      <section className="content-grid">
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Trend</p>
              <h2>How reviews accumulate</h2>
              <p className="panel-description">
                Company-wide total review count and weighted average rating at
                each snapshot date.
              </p>
            </div>
          </div>
          <TrendStrip trend={data.trend} />
        </article>
      </section>

      <section className="content-grid">
        <ReviewFeed
          reviews={data.recentReviews}
          platformFilter={data.platformFilter}
          selectedRange={selectedRange}
        />
      </section>
    </div>
  );
}
