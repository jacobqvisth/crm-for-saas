export const SOURCE_KEYS = [
  "core_app",
  "ga4",
  "google_ads",
  "search_console",
  "customer_io",
  "stripe",
  "app_store_connect",
] as const;

export type SourceKey = (typeof SOURCE_KEYS)[number];

export const SOURCE_LABELS: Record<SourceKey, string> = {
  core_app: "Core App Data",
  ga4: "GA4 / Firebase",
  google_ads: "Google Ads",
  search_console: "Search Console",
  customer_io: "Customer.io",
  stripe: "Stripe",
  app_store_connect: "App Store Connect",
};

export function isSourceKey(value: string): value is SourceKey {
  return SOURCE_KEYS.includes(value as SourceKey);
}
