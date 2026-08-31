"use client";

import { useMemo, useState } from "react";
import { formatNumber, formatPercent } from "@/lib/ceo/format";
import type { BestAdsData, BestAdsWindow } from "@/lib/ceo/data/best-ads";
import type { ScoredAsset, RankMode } from "@/lib/ceo/best-ads/ranking";
import {
  MIN_CLICKS_FOR_CVR,
  MIN_IMPRESSIONS_FOR_RANKING,
  rankBy,
} from "@/lib/ceo/best-ads/ranking";
import {
  BEST_ADS_TABS,
  type AssetPlacement,
  type BestAdsTab,
  type BestAdsWindowKey,
  type ThemeSummary,
} from "@/lib/ceo/best-ads/types";

type BestAdsContentProps = {
  data: BestAdsData;
  initialTab: BestAdsTab;
};

const RANK_MODES: { key: RankMode; label: string; hint: string }[] = [
  { key: "score", label: "Best overall", hint: "Click lift x signup lift" },
  { key: "ctr", label: "Best at earning clicks", hint: "Click lift only" },
  { key: "conversions", label: "Best at earning signups", hint: "Signup lift only" },
  { key: "volume", label: "Most shown", hint: "Raw impressions" },
];

/**
 * Field types rendered as prose, in the order a person thinks about them.
 * Anything not listed still appears — it is appended — so a new Google field
 * type shows up rather than vanishing.
 */
const TEXT_FIELD_ORDER = ["HEADLINE", "LONG_HEADLINE", "DESCRIPTION", "BUSINESS_NAME"];

const FIELD_LABELS: Record<string, string> = {
  HEADLINE: "Headlines",
  LONG_HEADLINE: "Long headlines",
  DESCRIPTION: "Descriptions",
  BUSINESS_NAME: "Business name",
  SITELINK: "Sitelinks",
  CALLOUT: "Callouts",
  LOGO: "Logo",
  BUSINESS_LOGO: "Business logo",
  MARKETING_IMAGE: "Landscape image",
  SQUARE_MARKETING_IMAGE: "Square image",
  PORTRAIT_MARKETING_IMAGE: "Portrait image",
  TALL_PORTRAIT_MARKETING_IMAGE: "Tall portrait image",
  AD_IMAGE: "Ad image",
  YOUTUBE_VIDEO: "Video",
  LANDING_PAGE_PREVIEW: "Landing page preview",
};

function fieldLabel(fieldType: string): string {
  return FIELD_LABELS[fieldType] ?? fieldType.replaceAll("_", " ").toLowerCase();
}

function pct(rate: number, digits = 2): string {
  return formatPercent(rate * 100, digits);
}

function lift(value: number): string {
  return `${value.toFixed(2)}x`;
}

/**
 * Tone for a lift badge. The thresholds are deliberately wide: after shrinkage
 * a 1.1x is noise on most assets, and colouring it green would make the page
 * look like it had found twenty winners when it had found three.
 */
function liftTone(value: number): string {
  if (value >= 1.3) return "lift-badge lift-strong";
  if (value >= 1.05) return "lift-badge lift-good";
  if (value >= 0.8) return "lift-badge lift-flat";
  return "lift-badge lift-weak";
}

function LiftBadge({ value, title }: { value: number; title: string }) {
  return (
    <span className={liftTone(value)} title={title}>
      {lift(value)}
    </span>
  );
}

function assetLabel(asset: ScoredAsset): string {
  if (asset.text) return asset.text;
  if (asset.youtubeVideoTitle) return asset.youtubeVideoTitle;
  if (asset.name) return asset.name;
  if (asset.imageWidth && asset.imageHeight) {
    return `Image ${asset.imageWidth}x${asset.imageHeight}`;
  }
  return `Asset ${asset.assetId}`;
}

// ---------------------------------------------------------------- text table

function TextAssetTable({
  assets,
  mode,
  emptyMessage = "Nothing in this window met the threshold.",
}: {
  assets: ScoredAsset[];
  mode: RankMode;
  emptyMessage?: string;
}) {
  const ranked = useMemo(() => rankBy(assets, mode), [assets, mode]);

  if (ranked.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <div className="table-wrap">
      <table className="data-table best-ads-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Copy</th>
            <th style={{ textAlign: "right" }}>Shown</th>
            <th style={{ textAlign: "right" }}>CTR</th>
            <th style={{ textAlign: "right" }}>vs avg</th>
            <th style={{ textAlign: "right" }}>Signups</th>
            <th style={{ textAlign: "right" }}>Signup rate</th>
            <th style={{ textAlign: "right" }}>vs avg</th>
            <th>Ran in</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((asset, index) => (
            <tr key={`${asset.assetId}-${asset.fieldType}`}>
              <td className="toplist-rank">{index + 1}</td>
              <td>
                <span className="table-primary-name">{assetLabel(asset)}</span>
                {asset.clicksWithoutConversions ? (
                  <small className="best-ads-flag">
                    {formatNumber(asset.clicks)} clicks, zero signups
                  </small>
                ) : null}
              </td>
              <td style={{ textAlign: "right" }}>{formatNumber(asset.impressions)}</td>
              <td style={{ textAlign: "right" }}>{pct(asset.ctr)}</td>
              <td style={{ textAlign: "right" }}>
                <LiftBadge
                  value={asset.ctrLift}
                  title={`${lift(asset.ctrLift)} the average ${fieldLabel(asset.fieldType).toLowerCase()} click-through rate`}
                />
              </td>
              <td style={{ textAlign: "right" }}>
                {asset.conversions > 0 ? asset.conversions.toFixed(1) : "—"}
              </td>
              <td style={{ textAlign: "right" }}>
                {asset.clicks >= MIN_CLICKS_FOR_CVR ? pct(asset.cvr, 1) : "—"}
              </td>
              <td style={{ textAlign: "right" }}>
                {asset.clicks >= MIN_CLICKS_FOR_CVR ? (
                  <LiftBadge
                    value={asset.cvrLift}
                    title={`${lift(asset.cvrLift)} the average signup rate for this field type`}
                  />
                ) : (
                  <span className="muted">too few clicks</span>
                )}
              </td>
              <td className="best-ads-campaigns">
                {asset.campaignNames.slice(0, 2).join(", ")}
                {asset.campaignNames.length > 2
                  ? ` +${asset.campaignNames.length - 2}`
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------------- creative card

function CreativeCard({ asset, rank }: { asset: ScoredAsset; rank: number }) {
  const thumbnail = asset.imageUrl
    ? asset.imageUrl
    : asset.youtubeVideoId
      ? `https://i.ytimg.com/vi/${asset.youtubeVideoId}/hqdefault.jpg`
      : null;

  return (
    <article className="creative-card">
      <div className="creative-card-media">
        {thumbnail ? (
          // A plain img, not next/image: these are Google CDN URLs on hosts the
          // image optimiser is not configured for, and adding two remote
          // patterns to next.config to re-encode pictures that are already
          // small and already cached would buy nothing.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt={assetLabel(asset)} loading="lazy" />
        ) : (
          <div className="creative-card-placeholder">No preview</div>
        )}
        <span className="creative-card-rank">#{rank}</span>
        {asset.kind === "video" ? (
          <span className="creative-card-kind">Video</span>
        ) : null}
      </div>
      <div className="creative-card-body">
        <p className="creative-card-title">
          {asset.youtubeVideoTitle ?? fieldLabel(asset.fieldType)}
        </p>
        <p className="creative-card-meta">
          {fieldLabel(asset.fieldType)}
          {asset.imageWidth && asset.imageHeight
            ? ` · ${asset.imageWidth}x${asset.imageHeight}`
            : ""}
        </p>
        <dl className="creative-card-stats">
          <div>
            <dt>Shown</dt>
            <dd>{formatNumber(asset.impressions)}</dd>
          </div>
          <div>
            <dt>CTR</dt>
            <dd>{pct(asset.ctr)}</dd>
          </div>
          <div>
            <dt>vs avg</dt>
            <dd>
              <LiftBadge value={asset.ctrLift} title="Click-through lift for this format" />
            </dd>
          </div>
          <div>
            <dt>Signups</dt>
            <dd>{asset.conversions > 0 ? asset.conversions.toFixed(1) : "—"}</dd>
          </div>
        </dl>
        {asset.youtubeVideoId ? (
          <a
            className="creative-card-link"
            href={`https://www.youtube.com/watch?v=${asset.youtubeVideoId}`}
            target="_blank"
            rel="noreferrer"
          >
            Watch on YouTube
          </a>
        ) : asset.imageUrl ? (
          <a
            className="creative-card-link"
            href={asset.imageUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open full size
          </a>
        ) : null}
      </div>
    </article>
  );
}

// -------------------------------------------------------------------- tabs

function CopyTab({ window: win, mode }: { window: BestAdsWindow; mode: RankMode }) {
  const byField = useMemo(() => {
    const groups = new Map<string, ScoredAsset[]>();
    for (const asset of win.assets) {
      if (asset.kind !== "text") continue;
      if (asset.surface !== "ad_group_ad") continue;
      if (!asset.hasEnoughVolume) continue;
      const list = groups.get(asset.fieldType) ?? [];
      list.push(asset);
      groups.set(asset.fieldType, list);
    }
    const ordered = [...groups.entries()].sort((a, b) => {
      const ai = TEXT_FIELD_ORDER.indexOf(a[0]);
      const bi = TEXT_FIELD_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    return ordered;
  }, [win.assets]);

  if (byField.length === 0) {
    return (
      <article className="panel panel-wide">
        <p className="empty-state">
          No text asset in {win.label.toLowerCase()} cleared{" "}
          {formatNumber(MIN_IMPRESSIONS_FOR_RANKING)} impressions. Try a wider window.
        </p>
      </article>
    );
  }

  return (
    <div className="section-stack">
      {byField.map(([fieldType, assets]) => (
        <article className="panel panel-wide" key={fieldType}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{win.label}</p>
              <h3>{fieldLabel(fieldType)}</h3>
            </div>
            <span className="meta-pill">{assets.length} ranked</span>
          </div>
          <p className="panel-description">
            Ranked against the average {fieldLabel(fieldType).toLowerCase()} in this
            account, not against each other in the abstract. &ldquo;vs avg&rdquo; of 1.50x
            means half again the click-through of a typical one.
          </p>
          <TextAssetTable
            assets={assets}
            mode={mode}
            emptyMessage={`No ${fieldLabel(fieldType).toLowerCase()} cleared ${formatNumber(MIN_IMPRESSIONS_FOR_RANKING)} impressions in this window.`}
          />
        </article>
      ))}
    </div>
  );
}

function VisualTab({
  window: win,
  unmeasured,
}: {
  window: BestAdsWindow;
  unmeasured: AssetPlacement[];
}) {
  // `ad_group_ad` only, and that restriction is load-bearing. A logo attached to
  // a campaign rather than to an ad is reported with the WHOLE campaign's
  // impressions and clicks, so the Performance Max logo books 89,804
  // impressions at an 11% click-through and would sit at the top of this grid
  // as the account's best image. It is not an image result at all; it is the
  // campaign's result wearing an image's name. Those rows live under Sitelinks
  // & callouts, where the counting is explained.
  const images = useMemo(
    () =>
      rankBy(
        win.assets.filter(
          (asset) =>
            asset.kind === "image" &&
            asset.surface === "ad_group_ad" &&
            asset.impressions >= 300,
        ),
        "ctr",
      ),
    [win.assets],
  );

  const videos = useMemo(
    () =>
      rankBy(
        win.assets.filter(
          (asset) => asset.kind === "video" && asset.surface === "ad_group_ad",
        ),
        "ctr",
      ),
    [win.assets],
  );

  const unmeasuredVisuals = unmeasured.filter(
    (asset) => asset.kind === "image" || asset.kind === "video",
  );

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{win.label}</p>
            <h3>Images, best click-through first</h3>
          </div>
          <span className="meta-pill">{images.length} measured</span>
        </div>
        <p className="panel-description">
          Every image here comes from Demand Gen, the only surface in this account
          that reports per-image numbers. Compare within a format: portrait images
          sit in feeds and run naturally higher than landscape, so the lift against
          the format average is the honest column, not the raw CTR.
        </p>
        {images.length === 0 ? (
          <p className="empty-state">No image cleared 300 impressions in this window.</p>
        ) : (
          <div className="creative-grid">
            {images.map((asset, index) => (
              <CreativeCard
                key={`${asset.assetId}-${asset.fieldType}`}
                asset={asset}
                rank={index + 1}
              />
            ))}
          </div>
        )}
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{win.label}</p>
            <h3>Video</h3>
          </div>
          <span className="meta-pill">{videos.length} measured</span>
        </div>
        {videos.length === 0 ? (
          <p className="empty-state">No video served in this window.</p>
        ) : (
          <div className="creative-grid">
            {videos.map((asset, index) => (
              <CreativeCard
                key={`${asset.assetId}-${asset.fieldType}`}
                asset={asset}
                rank={index + 1}
              />
            ))}
          </div>
        )}
      </article>

      {unmeasuredVisuals.length > 0 ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Inventory, not performance</p>
              <h3>Performance Max creatives, no data available</h3>
            </div>
            <span className="meta-pill">{unmeasuredVisuals.length} assets</span>
          </div>
          <p className="panel-description">
            These are live in Performance Max asset groups, and Performance Max is
            where most of the account&apos;s money goes. Google Ads API v25 exposes no
            per-asset metrics and no performance label for{" "}
            <code>asset_group_asset</code> — checked against this account, not
            assumed from the docs — so nothing here can be ranked. To see how they
            are doing, open the asset group in the Google Ads UI, which computes
            Best / Good / Low labels that the API does not expose. They are listed
            so the page does not imply they are absent.
          </p>
          <div className="creative-grid creative-grid-muted">
            {unmeasuredVisuals.map((asset) => {
              const thumbnail = asset.imageUrl
                ? asset.imageUrl
                : asset.youtubeVideoId
                  ? `https://i.ytimg.com/vi/${asset.youtubeVideoId}/hqdefault.jpg`
                  : null;
              return (
                <article
                  className="creative-card"
                  key={`${asset.assetId}-${asset.fieldType}`}
                >
                  <div className="creative-card-media">
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbnail}
                        alt={asset.name ?? asset.fieldType}
                        loading="lazy"
                      />
                    ) : (
                      <div className="creative-card-placeholder">No preview</div>
                    )}
                  </div>
                  <div className="creative-card-body">
                    <p className="creative-card-title">
                      {asset.youtubeVideoTitle ?? fieldLabel(asset.fieldType)}
                    </p>
                    <p className="creative-card-meta">
                      {asset.campaignName ?? "—"}
                      {asset.imageWidth && asset.imageHeight
                        ? ` · ${asset.imageWidth}x${asset.imageHeight}`
                        : ""}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </article>
      ) : null}
    </div>
  );
}

function ExtensionsTab({ window: win, mode }: { window: BestAdsWindow; mode: RankMode }) {
  // A floor of 100 rather than the ranked-list threshold of 500: sitelinks
  // accumulate impressions far more slowly than headlines, so 500 would empty
  // the table, while a sitelink seen six times and clicked twice is a 33%
  // click-through that means nothing and should not be on screen at all.
  const extensions = useMemo(
    () =>
      win.assets.filter(
        (asset) => asset.surface === "campaign_asset" && asset.impressions >= 100,
      ),
    [win.assets],
  );

  const byField = useMemo(() => {
    const groups = new Map<string, ScoredAsset[]>();
    for (const asset of extensions) {
      const list = groups.get(asset.fieldType) ?? [];
      list.push(asset);
      groups.set(asset.fieldType, list);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [extensions]);

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{win.label}</p>
            <h3>Sitelinks, callouts and account-level assets</h3>
          </div>
        </div>
        <p className="panel-description">
          These are counted differently from headlines and are kept apart for that
          reason. A sitelink&apos;s clicks are genuinely its own — someone clicked
          that link — while a logo or business name attached to a campaign inherits
          the whole campaign&apos;s numbers and says nothing about the logo. Read the
          sitelink and callout rows; treat the rest as presence, not performance.
        </p>
      </article>

      {byField.length === 0 ? (
        <article className="panel panel-wide">
          <p className="empty-state">No campaign-level asset served in this window.</p>
        </article>
      ) : (
        byField.map(([fieldType, assets]) => (
          <article className="panel panel-wide" key={fieldType}>
            <div className="panel-heading">
              <div>
                <h3>{fieldLabel(fieldType)}</h3>
              </div>
              <span className="meta-pill">{assets.length}</span>
            </div>
            <TextAssetTable assets={assets} mode={mode} />
          </article>
        ))
      )}
    </div>
  );
}

function ThemeTable({ themes }: { themes: ThemeSummary[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table best-ads-table">
        <thead>
          <tr>
            <th>Angle</th>
            <th style={{ textAlign: "right" }}>Assets</th>
            <th style={{ textAlign: "right" }}>Shown</th>
            <th style={{ textAlign: "right" }}>CTR</th>
            <th style={{ textAlign: "right" }}>vs avg</th>
            <th style={{ textAlign: "right" }}>Signup rate</th>
            <th style={{ textAlign: "right" }}>vs avg</th>
          </tr>
        </thead>
        <tbody>
          {themes.map((theme) => (
            <tr key={theme.key}>
              <td>
                <span className="table-primary-name">{theme.label}</span>
                <small className="table-secondary">{theme.description}</small>
                {theme.examples.length > 0 ? (
                  <small className="best-ads-example">
                    Best: &ldquo;{theme.examples[0].text}&rdquo; ({pct(theme.examples[0].ctr)})
                  </small>
                ) : null}
              </td>
              <td style={{ textAlign: "right" }}>{theme.assets}</td>
              <td style={{ textAlign: "right" }}>{formatNumber(theme.impressions)}</td>
              <td style={{ textAlign: "right" }}>{pct(theme.ctr)}</td>
              <td style={{ textAlign: "right" }}>
                <LiftBadge value={theme.ctrIndex} title="Click-through vs all copy" />
              </td>
              <td style={{ textAlign: "right" }}>{pct(theme.cvr, 2)}</td>
              <td style={{ textAlign: "right" }}>
                <LiftBadge value={theme.cvrIndex} title="Signup rate vs all copy" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlaybookTab({ window: win }: { window: BestAdsWindow }) {
  const themes = win.themes;

  // The whole point of the page: which angles earn a signup, which merely earn
  // a click, and which do neither. Thresholds are generous because these are
  // pooled over dozens of assets, where a 1.2x is a real difference rather than
  // the noise it would be on a single one.
  const write = themes.filter((t) => t.cvrIndex >= 1.3 && t.ctrIndex >= 0.9);
  const clickbait = themes.filter((t) => t.ctrIndex >= 1.2 && t.cvrIndex < 0.7);
  const quiet = themes.filter((t) => t.ctrIndex < 0.8 && t.cvrIndex >= 1.3);

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{win.label}</p>
            <h2>What to write more of</h2>
          </div>
        </div>
        <p className="panel-description">
          Every angle below is measured across all of its assets pooled together,
          against the average for all ad copy in the window (
          {pct(win.copyBaseline.ctr)} click-through, {pct(win.copyBaseline.cvr, 2)}{" "}
          signup rate over {formatNumber(win.copyBaseline.impressions)} impressions).
          One winning headline is an accident. An angle winning across a dozen is a
          brief.
        </p>

        {write.length > 0 ? (
          <div className="playbook-callout playbook-do">
            <h4>More of this</h4>
            <p>
              {write.map((t) => t.label).join(", ")} — {write.length === 1 ? "this angle" : "these angles"}{" "}
              convert{write.length === 1 ? "s" : ""} above average without giving up
              clicks.
            </p>
          </div>
        ) : null}

        {clickbait.length > 0 ? (
          <div className="playbook-callout playbook-caution">
            <h4>Buys clicks, not customers</h4>
            <p>
              {clickbait.map((t) => t.label).join(", ")} pull{clickbait.length === 1 ? "s" : ""}{" "}
              well above average click-through and well below average signup rate.
              Traffic bought this way is expensive and does not arrive intending to
              sign up. Keep it out of anything paying by the click unless the
              landing page is built to catch it.
            </p>
          </div>
        ) : null}

        {quiet.length > 0 ? (
          <div className="playbook-callout playbook-note">
            <h4>Few clicks, but the right ones</h4>
            <p>
              {quiet.map((t) => t.label).join(", ")} lose{quiet.length === 1 ? "s" : ""}{" "}
              on click-through and win on signups. Cutting {quiet.length === 1 ? "it" : "them"}{" "}
              for a low CTR would remove the copy that qualifies the reader before
              the click, which is the cheapest filter there is.
            </p>
          </div>
        ) : null}

        {themes.length === 0 ? (
          <p className="empty-state">
            Not enough copy served in this window to read an angle. Try All time.
          </p>
        ) : (
          <ThemeTable themes={themes} />
        )}
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h3>Proven lines, ready to reuse</h3>
          </div>
        </div>
        <p className="panel-description">
          The individual assets that beat the average on both counts, in this
          window. These are the safest starting points for a new ad group: they
          have already earned the click and the signup somewhere in this account.
        </p>
        <TextAssetTable
          assets={win.assets.filter(
            (asset) =>
              asset.kind === "text" &&
              asset.surface === "ad_group_ad" &&
              asset.hasEnoughVolume &&
              asset.ctrLift >= 1.05 &&
              asset.cvrLift >= 1.2,
          )}
          mode="score"
          emptyMessage="No line in this window beat the average on both clicks and signups. Try a wider window."
        />
      </article>
    </div>
  );
}

function MethodTab({ window: win }: { window: BestAdsWindow }) {
  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Read this before quoting a number</p>
            <h2>How &ldquo;best&rdquo; is decided</h2>
          </div>
        </div>

        <h4>Asset clicks do not add up, and that is not a bug</h4>
        <p className="panel-description">
          Google credits every asset that served in an impression with that
          impression and its click. Three headlines in one responsive search ad
          each book the same click. So the clicks on this page sum to far more than
          the campaigns actually bought — on <code>us-codes+make</code>, 51,411
          asset-clicks against 13,505 real ones. An asset&apos;s <em>rate</em> is
          meaningful; its total is not a budget. Nothing here is ever summed across
          assets and presented as spend or traffic.
        </p>

        <h4>Small samples are pulled toward the average, on purpose</h4>
        <p className="panel-description">
          An asset with 8 impressions and 1 click has a 12.5% click-through rate and
          means nothing. Every rate on this page is mixed with the average for its
          own field type, weighted by how much evidence there is: 800 pseudo-
          impressions for click-through, 40 pseudo-clicks for signup rate. An asset
          with no evidence scores exactly average and sits in the middle of the
          list, which is where it belongs. Long-running assets barely move.
        </p>

        <h4>Formats are compared to their own kind</h4>
        <p className="panel-description">
          Portrait images run about 4.6% click-through and video about 1.4%, because
          of where they sit, not because of what they say. Ranking them in one pool
          would sort by format. So every asset is scored against the pooled rate for
          its own field type and the published figure is a lift: 1.90x means
          &ldquo;nearly twice the average headline&rdquo;, which is comparable across
          formats in a way a raw percentage is not.
        </p>

        <h4>Clicks are not the goal</h4>
        <p className="panel-description">
          Click lift and signup lift are computed separately and shown side by side,
          and &ldquo;Best overall&rdquo; multiplies them. An asset has to earn the
          click and the signup to lead the list. This matters here more than in most
          accounts: one paused campaign bought 13,505 clicks and converted exactly
          none of them, and a CTR-only ranking would have recommended writing more
          of precisely that copy.
        </p>

        <h4>What this page cannot see</h4>
        <ul className="tight-list">
          <li>
            <strong>Performance Max assets.</strong> API v25 exposes no metrics and
            no performance label on <code>asset_group_asset</code>. Those creatives
            are listed as inventory under Images &amp; video with no numbers. The
            Google Ads UI does show Best / Good / Low for them.
          </li>
          <li>
            <strong>Google&apos;s own performance labels.</strong> Present on the API
            but every asset in this account reads <code>NOT_APPLICABLE</code> or{" "}
            <code>PENDING</code>, so the ranking here is computed from metrics
            rather than taken from Google.
          </li>
          <li>
            <strong>Which landing page converted.</strong> No table in the schema
            records a landing page or gclid against a signup, so an asset&apos;s
            signups are Google&apos;s conversion count, not one traced through to a
            paying customer.
          </li>
          <li>
            <strong>Assets that never served.</strong> The window shown is{" "}
            {win.start} to {win.end}. An asset with no impressions in it does not
            appear, which is not the same as it not existing.
          </li>
        </ul>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h3>Field-type baselines in this window</h3>
          </div>
        </div>
        <p className="panel-description">
          The averages every lift on the page is measured against.
        </p>
        <div className="table-wrap">
          <table className="data-table best-ads-table">
            <thead>
              <tr>
                <th>Field type</th>
                <th>Report</th>
                <th style={{ textAlign: "right" }}>Assets</th>
                <th style={{ textAlign: "right" }}>Impressions</th>
                <th style={{ textAlign: "right" }}>CTR</th>
                <th style={{ textAlign: "right" }}>Signup rate</th>
              </tr>
            </thead>
            <tbody>
              {win.baselines.map((baseline) => (
                <tr key={`${baseline.surface}-${baseline.fieldType}`}>
                  <td>{fieldLabel(baseline.fieldType)}</td>
                  <td className="muted">
                    {baseline.surface === "ad_group_ad" ? "per-ad" : "campaign-level"}
                  </td>
                  <td style={{ textAlign: "right" }}>{baseline.assets}</td>
                  <td style={{ textAlign: "right" }}>
                    {formatNumber(baseline.impressions)}
                  </td>
                  <td style={{ textAlign: "right" }}>{pct(baseline.ctr)}</td>
                  <td style={{ textAlign: "right" }}>{pct(baseline.cvr, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

// ------------------------------------------------------------------ shell

export function BestAdsContent({ data, initialTab }: BestAdsContentProps) {
  const [tab, setTab] = useState<BestAdsTab>(initialTab);
  const [windowKey, setWindowKey] = useState<BestAdsWindowKey>("all");
  const [mode, setMode] = useState<RankMode>("score");

  const active = data.windows.find((w) => w.key === windowKey) ?? data.windows[0];

  if (!data.configured || data.emptyReason || !active) {
    return (
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <h2>Nothing to show yet</h2>
          </div>
        </div>
        <p className="panel-description">
          {data.emptyReason ??
            "Asset performance has not been synced yet."}
        </p>
        <p className="panel-description">
          The sync runs daily. To fill it now, call{" "}
          <code>/api/cron/sync-google-ads-assets</code> with the sync secret.
        </p>
      </article>
    );
  }

  const measured = active.assets.length;
  const text = active.assets.filter((a) => a.kind === "text").length;
  const visual = active.assets.filter(
    (a) => a.kind === "image" || a.kind === "video",
  ).length;

  return (
    <div className="section-stack">
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Google Ads · asset level</p>
            <h2>Best performing ads</h2>
          </div>
        </div>
        <p className="panel-description">
          Every headline, description, image, video and sitelink in the account,
          ranked by how much better it did than a typical asset of its own kind.
          Built to answer one question: what should the next batch of creative look
          like. Read <strong>How this is scored</strong> before quoting a figure —
          asset metrics are not additive, and the copy that wins clicks here is not
          the copy that wins signups.
        </p>

        <div className="summary-grid columns-4">
          <div className="summary-card">
            <strong>{formatNumber(measured)}</strong>
            <span>Measured assets</span>
            <small>in {active.label.toLowerCase()}</small>
          </div>
          <div className="summary-card">
            <strong>{formatNumber(text)}</strong>
            <span>Text assets</span>
            <small>headlines and descriptions</small>
          </div>
          <div className="summary-card">
            <strong>{formatNumber(visual)}</strong>
            <span>Images and video</span>
            <small>{data.unmeasured.length} more with no data</small>
          </div>
          <div className="summary-card">
            <strong>{pct(active.copyBaseline.ctr)}</strong>
            <span>Average copy CTR</span>
            <small>the bar every lift is measured against</small>
          </div>
        </div>

        <div className="range-tabs" role="group" aria-label="Date range">
          {data.windows.map((w) => (
            <button
              key={w.key}
              type="button"
              className={w.key === windowKey ? "range-tab is-active" : "range-tab"}
              onClick={() => setWindowKey(w.key)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </article>

      <nav className="campaign-tabs" aria-label="Best performing ads">
        {BEST_ADS_TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={tab === entry.key ? "campaign-tab is-active" : "campaign-tab"}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "text" || tab === "extensions" ? (
        <div className="range-tabs" role="group" aria-label="Rank by">
          {RANK_MODES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              title={entry.hint}
              className={entry.key === mode ? "range-tab is-active" : "range-tab"}
              onClick={() => setMode(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "text" ? <CopyTab window={active} mode={mode} /> : null}
      {tab === "visual" ? (
        <VisualTab window={active} unmeasured={data.unmeasured} />
      ) : null}
      {tab === "extensions" ? <ExtensionsTab window={active} mode={mode} /> : null}
      {tab === "playbook" ? <PlaybookTab window={active} /> : null}
      {tab === "method" ? <MethodTab window={active} /> : null}
    </div>
  );
}
