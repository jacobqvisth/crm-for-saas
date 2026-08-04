export const SOURCE_KEYS = [
  "core_app",
  "ga4",
  "google_ads",
  // Separate from `google_ads`, which is GA4's advertiser-cost view and carries
  // no search terms. This one is the Google Ads API itself: market keyword
  // volume plus the queries that actually triggered our ads.
  "google_ads_api",
  "search_console",
  "customer_io",
  "stripe",
  "app_store_connect",
  "posthog",
] as const;

export type SourceKey = (typeof SOURCE_KEYS)[number];

export const SOURCE_LABELS: Record<SourceKey, string> = {
  core_app: "Core App Data",
  ga4: "GA4 / Firebase",
  google_ads: "Google Ads (via GA4)",
  google_ads_api: "Google Ads API",
  search_console: "Search Console",
  customer_io: "Customer.io",
  stripe: "Stripe",
  app_store_connect: "App Store Connect",
  posthog: "PostHog",
};

export function isSourceKey(value: string): value is SourceKey {
  return SOURCE_KEYS.includes(value as SourceKey);
}
