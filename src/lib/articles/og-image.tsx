// The article hero image, rendered at publish time.
//
// WHY IT IS DRAWN RATHER THAN GENERATED
// There is no image-model credential on this project (no OpenAI, Gemini, Imagen
// or similar key exists anywhere), so a photoreal image is not available. What is
// available is `next/og`, which Next 16 bundles, so the server can draw a
// branded card with no new dependency and no external call. That is also more
// reliable than a generative image for this job: the competitor post's visual
// worked because it put the fault code on the picture, and a drawn card puts the
// real code there every time instead of hoping a model spells it correctly.
//
// If a photoreal hero is wanted later, add an image-model key and swap the body
// of renderArticleImage; the upload path and the CMS wiring stay the same.

import { ImageResponse } from "next/og";

// 3:2, because that is the aspect-ratio every blog image container on
// wrenchlane.com uses with object-fit: cover:
//   .article_blog-post-header_image      3/2  (the article hero)
//   .resources_blog-list_image           3/2  (the index cards)
//   .article-category-page_blog-list_image / ..._tags-page_...  3/2
// A 1200x630 canvas (1.905) was being cropped 21% horizontally on the hero,
// which clipped the kicker and the first character of the title.
//
// Two featured variants use 4/3 and 16/9, so content is inset far enough to
// survive those too: 4/3 trims ~5.5% off each side, 16/9 ~7.8% off top and
// bottom. The padding below clears both with room to spare.
const WIDTH = 1200;
const HEIGHT = 800;
/** Keeps text clear of the 4:3 and 16:9 crops. Decoration may fall outside. */
const SAFE_X = 92;
const SAFE_Y = 80;

// Pulled from the CRM's own palette so the cards look like Wrenchlane.
const INK = "#0B1220";
const ACCENT = "#FF6B35";
const MUTED = "#94A3B8";

export interface ArticleImageInput {
  title: string;
  /** Big monospace overlay: a fault code, or a headline statistic. */
  badge?: string | null;
  /** Small line under the badge, e.g. the vehicle. */
  context?: string | null;
  /** Category name, top-left kicker. */
  kicker?: string | null;
}

/**
 * The most eye-catching true fact we have, for the overlay. A fault code beats a
 * number, because it is what a technician recognises at a glance.
 */
export function pickBadge(opts: {
  dtcs?: string[] | null;
  title: string;
  /** Summary or opening paragraph, searched when the title carries no figure. */
  summary?: string | null;
}): { badge: string | null } {
  const code = opts.dtcs?.find((c) => /^[PBUC][0-9A-F]{4,6}$/i.test(c.trim()));
  if (code) return { badge: code.toUpperCase() };

  // Otherwise the leading figure, which for a data story is the whole point.
  //
  // Order matters, and so does the thousands case. A naive /\b\d{2,}\b/ against
  // "1,865 fault write-ups" matches "865", because the comma is a word boundary,
  // and a wrong number on a published hero image is worse than no number. So
  // grouped thousands are matched as one token before the plain case.
  const PERCENT = /\d[\d.,]*\s?%/;
  const THOUSANDS = /\b\d{1,3}(?:[.,  ]\d{3})+\b/;
  const PLAIN = /\b\d{2,}\b/g;
  // A bare year is almost never the point of the piece, and "2026" as a 84px
  // headline figure reads as a mistake.
  const isYear = (s: string) => /^(?:19|20)\d{2}$/.test(s);

  for (const text of [opts.title, opts.summary ?? ""]) {
    const percent = text.match(PERCENT);
    if (percent) return { badge: percent[0].trim() };

    const thousands = text.match(THOUSANDS);
    if (thousands) return { badge: thousands[0].trim() };

    const plain = [...text.matchAll(PLAIN)].map((m) => m[0]).find((n) => !isYear(n));
    if (plain) return { badge: plain };
  }
  return { badge: null };
}

export async function renderArticleImage(input: ArticleImageInput): Promise<Uint8Array> {
  const title = input.title.length > 110 ? `${input.title.slice(0, 107)}...` : input.title;

  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          padding: `${SAFE_Y}px ${SAFE_X}px`,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Accent rule down the left edge. Purely decorative: a 4:3 crop
            trims it, which is fine because nothing depends on it. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 12,
            background: ACCENT,
            display: "flex",
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              letterSpacing: 4,
              color: ACCENT,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            {input.kicker || "Wrenchlane"}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: title.length > 70 ? 54 : 66,
              lineHeight: 1.12,
              color: "#FFFFFF",
              fontWeight: 700,
              maxWidth: 980,
            }}
          >
            {title}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {input.badge ? (
              <div
                style={{
                  display: "flex",
                  fontSize: 84,
                  fontWeight: 700,
                  color: ACCENT,
                  fontFamily: "monospace",
                  letterSpacing: -2,
                }}
              >
                {input.badge}
              </div>
            ) : null}
            {input.context ? (
              <div style={{ display: "flex", fontSize: 26, color: MUTED }}>{input.context}</div>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              color: MUTED,
              letterSpacing: 1,
            }}
          >
            wrenchlane.com
          </div>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );

  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The hero for a release article, built around a real product screenshot.
 *
 * A release announcement already ships its own screenshots, so drawing an
 * abstract card would throw away the best image available. The screenshot cannot
 * be used raw, though: every blog image container on the site is 3:2 with
 * object-fit: cover, and the release screenshots run from 1.30 to 2.57, so one
 * would be cropped top-and-bottom and another pillarboxed. Letterboxing it onto
 * the same 1200x800 canvas the drawn cards use keeps the whole frame visible and
 * makes the release posts sit consistently next to everything else.
 */
export async function renderReleaseHero(input: {
  title: string;
  /** Publicly reachable screenshot URL; ImageResponse fetches it. */
  imageUrl: string;
  /** "3.7". Becomes the kicker. */
  version: string | null;
}): Promise<Uint8Array> {
  const title = input.title.length > 96 ? `${input.title.slice(0, 93)}...` : input.title;

  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: INK,
          padding: `${SAFE_Y - 24}px ${SAFE_X}px ${SAFE_Y - 32}px`,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 12,
            background: ACCENT,
            display: "flex",
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "flex",
              fontSize: 20,
              letterSpacing: 4,
              color: ACCENT,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            {input.version ? `Release ${input.version}` : "Product update"}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: title.length > 60 ? 40 : 48,
              lineHeight: 1.14,
              color: "#FFFFFF",
              fontWeight: 700,
              maxWidth: 1000,
            }}
          >
            {title}
          </div>
        </div>

        {/* contain, not cover: the point is to show the whole screenshot. */}
        <div
          style={{
            display: "flex",
            flex: 1,
            marginTop: 26,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={input.imageUrl}
            alt=""
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 10 }}
          />
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );

  return new Uint8Array(await response.arrayBuffer());
}
