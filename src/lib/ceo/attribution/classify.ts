// First-touch channel classification for dashboard_user_attribution.
//
// Input is GA4's per-user firstUser* dimensions. Google Ads is recognised
// three ways because Pmax traffic is inconsistent about its own labels:
// medium=cpc (classic auto-tagging), a campaign name (Pmax campaigns
// sometimes surface only there), or GA4's dedicated Google Ads campaign
// dimension being set. "(cross-network)" is the campaign GA4 substitutes
// for Pmax when the name is withheld.

export const ATTRIBUTION_CHANNELS = [
  "google_ads",
  "app_store",
  "organic_search",
  "email",
  "referral",
  "direct",
  "other",
  "unknown",
] as const;

export type AttributionChannel = (typeof ATTRIBUTION_CHANNELS)[number];

export type AttributionSignals = {
  firstSource: string;
  firstMedium: string;
  firstCampaign: string;
  googleAdsCampaign: string;
};

const NOT_SET = "(not set)";

export function classifyAttribution(signals: AttributionSignals): AttributionChannel {
  const campaign = signals.firstCampaign.toLowerCase();
  if (
    signals.firstMedium === "cpc" ||
    campaign.includes("pmax") ||
    signals.firstCampaign === "(cross-network)" ||
    (signals.googleAdsCampaign !== "" && signals.googleAdsCampaign !== NOT_SET)
  ) {
    return "google_ads";
  }

  const sourceMedium = `${signals.firstSource}/${signals.firstMedium}`.toLowerCase();
  if (sourceMedium.includes("google-play") || sourceMedium.includes("apps.apple")) {
    return "app_store";
  }
  if (signals.firstMedium === "organic") return "organic_search";
  if (signals.firstMedium === "email") return "email";
  if (signals.firstMedium === "referral") return "referral";
  if (signals.firstSource === "(direct)") return "direct";
  if (signals.firstSource === NOT_SET || signals.firstSource === "(data not available)") {
    return "unknown";
  }
  return "other";
}
