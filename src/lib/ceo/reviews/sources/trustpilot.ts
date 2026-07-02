// Trustpilot read connector. Uses the PUBLIC Business Units API (apikey
// header only) — no OAuth needed for aggregate rating, review count, or the
// public review feed. Docs: https://developers.trustpilot.com/business-units-api-(public)
//
// Required env: TRUSTPILOT_API_KEY
// Optional env: TRUSTPILOT_BUSINESS_UNIT_ID (skip the lookup),
//               TRUSTPILOT_DOMAIN (defaults to wrenchlane.com; used to
//               resolve the business unit id via /business-units/find).
//
// OAuth/private endpoints (customer emails, posting replies, invitations) are
// intentionally out of scope here — the dashboard only needs public read data.

import { getEnv } from "@/lib/ceo/env";
import type {
  NormalizedReview,
  ReviewSourceFetchResult,
} from "@/lib/ceo/reviews/types";

const API_BASE = "https://api.trustpilot.com/v1";
const DEFAULT_DOMAIN = "wrenchlane.com";
const REVIEW_PAGE_SIZE = 100;
const MAX_REVIEW_PAGES = 5; // cap at 500 most-recent reviews per sync

type TrustpilotProfile = {
  id?: string;
  numberOfReviews?: { total?: number };
  score?: { stars?: number; trustScore?: number };
};

type TrustpilotReview = {
  id?: string;
  stars?: number;
  title?: string;
  text?: string;
  language?: string;
  createdAt?: string;
  consumer?: { displayName?: string };
  companyReply?: { text?: string };
};

async function tpFetch<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { apikey: apiKey, Accept: "application/json" },
    // Trustpilot is an external read; never cache stale review data.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Trustpilot ${path} → ${res.status} ${res.statusText}${
        body ? `: ${body.slice(0, 200)}` : ""
      }`,
    );
  }
  return (await res.json()) as T;
}

async function resolveBusinessUnitId(apiKey: string): Promise<string> {
  const explicit = getEnv("TRUSTPILOT_BUSINESS_UNIT_ID");
  if (explicit) return explicit;

  const domain = getEnv("TRUSTPILOT_DOMAIN") ?? DEFAULT_DOMAIN;
  const found = await tpFetch<TrustpilotProfile>(
    `/business-units/find?name=${encodeURIComponent(domain)}`,
    apiKey,
  );
  if (!found.id) {
    throw new Error(
      `Could not resolve a Trustpilot business unit for "${domain}". Set TRUSTPILOT_BUSINESS_UNIT_ID.`,
    );
  }
  return found.id;
}

function mapReview(r: TrustpilotReview, unitId: string): NormalizedReview {
  return {
    externalId: r.id ?? `tp:${unitId}:${r.createdAt ?? ""}:${r.title ?? ""}`,
    rating: typeof r.stars === "number" ? r.stars : null,
    title: r.title ?? null,
    body: r.text ?? null,
    authorName: r.consumer?.displayName ?? null,
    authorCompany: null,
    reviewUrl: null,
    reviewedAt: r.createdAt ?? null,
    responseText: r.companyReply?.text ?? null,
  };
}

export async function fetchTrustpilotReviews(): Promise<ReviewSourceFetchResult> {
  const apiKey = getEnv("TRUSTPILOT_API_KEY");
  if (!apiKey) {
    return { ok: true, skipped: true, reason: "TRUSTPILOT_API_KEY not set" };
  }

  try {
    const unitId = await resolveBusinessUnitId(apiKey);

    const profile = await tpFetch<TrustpilotProfile>(
      `/business-units/${unitId}`,
      apiKey,
    );

    const reviews: NormalizedReview[] = [];
    for (let page = 1; page <= MAX_REVIEW_PAGES; page += 1) {
      const data = await tpFetch<{ reviews?: TrustpilotReview[] }>(
        `/business-units/${unitId}/reviews?perPage=${REVIEW_PAGE_SIZE}&page=${page}&orderBy=createdat.desc`,
        apiKey,
      );
      const batch = data.reviews ?? [];
      reviews.push(...batch.map((r) => mapReview(r, unitId)));
      if (batch.length < REVIEW_PAGE_SIZE) break;
    }

    const trustScore = profile.score?.trustScore;
    return {
      ok: true,
      snapshot: {
        rating: typeof profile.score?.stars === "number" ? profile.score.stars : null,
        reviewCount: profile.numberOfReviews?.total ?? reviews.length,
        note:
          typeof trustScore === "number"
            ? `TrustScore ${trustScore}`
            : null,
        reviews,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
