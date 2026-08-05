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

const WIDTH = 1200;
const HEIGHT = 630;

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
  // Percentages first, then any number of two digits or more; a single digit is
  // rarely the headline and reads oddly at 84px.
  const PERCENT = /\b\d[\d.,]*\s?%/;
  const BIG_NUMBER = /\b\d{2,}[\d.,]*\b/;
  for (const text of [opts.title, opts.summary ?? ""]) {
    const hit = text.match(PERCENT) ?? text.match(BIG_NUMBER);
    if (hit) return { badge: hit[0].trim() };
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
          padding: "64px 72px",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Accent rule down the left edge. */}
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
