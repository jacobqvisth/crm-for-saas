// Registry of the review platforms we track on /ceo/reviews. The platform
// list lives in code (not the DB) — dashboard_review_snapshots.platform_slug
// references these slugs. Keep slugs stable: changing one orphans its
// snapshot history.
//
// integrationType describes how we *intend* to keep a platform fresh:
//   - "api":    a usable API exists; the sync cron (PR2) can pull it.
//   - "widget": no data API, but an embeddable rating badge exists; aggregate
//               numbers are entered manually until/unless a vendor API is set up.
//   - "manual": no API at all — rating + count are entered by hand.
// supportsIndividualReviews flags platforms where we can show a per-review feed
// (today only via API; manual entries can still attach notable reviews).

export type ReviewIntegrationType = "api" | "widget" | "manual";

export type ReviewPlatform = {
  slug: string;
  name: string;
  /** Public profile/listing URL for Wrenchlane. Update as profiles are claimed. */
  profileUrl: string;
  integrationType: ReviewIntegrationType;
  supportsIndividualReviews: boolean;
  /** Grouping shown on the page: global SaaS directories vs. general/regional. */
  category: "saas-directory" | "general" | "regional" | "collection";
  /** One-line note surfaced in the card's info tooltip. */
  note: string;
  /** Brand accent used for the platform chip / trend line. */
  color: string;
};

export const REVIEW_PLATFORMS: ReviewPlatform[] = [
  {
    slug: "g2",
    name: "G2",
    profileUrl: "https://www.g2.com",
    integrationType: "widget",
    supportsIndividualReviews: true,
    category: "saas-directory",
    note: "Largest B2B SaaS review directory. Full review API exists but is partner/rep-gated; aggregate rating + count via the free star-rating widget or manual entry until an API key is issued.",
    color: "#ff492c",
  },
  {
    slug: "capterra",
    name: "Capterra",
    profileUrl: "https://www.capterra.com",
    integrationType: "widget",
    supportsIndividualReviews: false,
    category: "saas-directory",
    note: "Gartner Digital Markets (now under G2 as of Feb 2026). No public reviews API — embeddable badge widget or manual entry. Shares a review catalog with Software Advice + GetApp.",
    color: "#ff9d28",
  },
  {
    slug: "software-advice",
    name: "Software Advice",
    profileUrl: "https://www.softwareadvice.com",
    integrationType: "widget",
    supportsIndividualReviews: false,
    category: "saas-directory",
    note: "Gartner Digital Markets. No public API; shares Capterra's review catalog. Badge widget or manual entry.",
    color: "#f8485e",
  },
  {
    slug: "getapp",
    name: "GetApp",
    profileUrl: "https://www.getapp.com",
    integrationType: "widget",
    supportsIndividualReviews: false,
    category: "saas-directory",
    note: "Gartner Digital Markets. No public API; shares Capterra's review catalog. Badge widget or manual entry.",
    color: "#2e3192",
  },
  {
    slug: "trustradius",
    name: "TrustRadius",
    profileUrl: "https://www.trustradius.com",
    integrationType: "widget",
    supportsIndividualReviews: true,
    category: "saas-directory",
    note: "B2B review site. API and TrustQuotes widgets are vendor-gated — arrange access with a TrustRadius rep; manual entry until then.",
    color: "#fdb515",
  },
  {
    slug: "trustpilot",
    name: "Trustpilot",
    profileUrl: "https://www.trustpilot.com",
    integrationType: "api",
    supportsIndividualReviews: true,
    category: "general",
    note: "Strong in the Nordics. Public Business Units API gives aggregate TrustScore + review count for free; individual reviews need a paid plan. Best official API of the directory sites.",
    color: "#00b67a",
  },
  {
    slug: "google-business",
    name: "Google Business Profile",
    profileUrl: "https://www.google.com/business/",
    integrationType: "api",
    supportsIndividualReviews: true,
    category: "general",
    note: "Most-used search engine. Business Profile API returns full reviews (rating, text, author, replies) for free once the profile is verified and the API is approved in GCP.",
    color: "#4285f4",
  },
  {
    slug: "trustmary",
    name: "Trustmary",
    profileUrl: "https://trustmary.com",
    integrationType: "api",
    supportsIndividualReviews: true,
    category: "collection",
    note: "Review-collection tool (also a SaaS). REST API surfaces reviews we collect through Trustmary plus imported Google/Facebook reviews — a centralisation layer, not a third-party directory.",
    color: "#5b3df5",
  },
  {
    slug: "reco",
    name: "Reco",
    profileUrl: "https://reco.se",
    integrationType: "manual",
    supportsIndividualReviews: false,
    category: "regional",
    note: "Swedish B2B recommendation/review platform — high local trust for a Swedish auto-repair CRM. No documented public API; manual entry.",
    color: "#ff6a3d",
  },
  {
    slug: "saasgenius",
    name: "SaaSGenius",
    profileUrl: "https://www.saasgenius.com",
    integrationType: "manual",
    supportsIndividualReviews: false,
    category: "saas-directory",
    note: "Pricing-focused SaaS directory. Paid listing, no public API — manual entry, low volume.",
    color: "#1f8efa",
  },
  {
    slug: "sourceforge",
    name: "SourceForge",
    profileUrl: "https://sourceforge.net",
    integrationType: "manual",
    supportsIndividualReviews: false,
    category: "saas-directory",
    note: "High-traffic B2B software directory. No dedicated reviews API — manual entry.",
    color: "#ff6600",
  },
  {
    slug: "crozdesk",
    name: "Crozdesk",
    profileUrl: "https://crozdesk.com",
    integrationType: "manual",
    supportsIndividualReviews: false,
    category: "saas-directory",
    note: "Long-tail SaaS directory. API claimed for listed vendors but under-documented — manual entry until confirmed.",
    color: "#4a90e2",
  },
  {
    slug: "product-hunt",
    name: "Product Hunt",
    profileUrl: "https://www.producthunt.com",
    integrationType: "manual",
    supportsIndividualReviews: false,
    category: "general",
    note: "Launch-moment discovery + reviews. GraphQL API exists but is non-commercial-only without permission — manual entry.",
    color: "#da552f",
  },
];

export const REVIEW_PLATFORM_SLUGS = REVIEW_PLATFORMS.map((p) => p.slug);

export function getReviewPlatform(slug: string): ReviewPlatform | undefined {
  return REVIEW_PLATFORMS.find((p) => p.slug === slug);
}

export const REVIEW_SOURCE_LABEL: Record<string, string> = {
  api: "API",
  widget: "Widget",
  manual: "Manual",
};
