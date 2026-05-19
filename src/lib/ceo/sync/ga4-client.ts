import { google } from "googleapis";
import { getEnv } from "@/lib/ceo/env";
import { createGoogleAuth } from "@/lib/ceo/sync/google-auth";

export type Ga4Row = {
  dimensionValues?: { value?: string | null }[];
  metricValues?: { value?: string | null }[];
};

export async function runGa4Report(
  requestBody: Record<string, unknown>,
): Promise<Ga4Row[]> {
  const propertyId = getEnv("GA4_PROPERTY_ID")!;
  const auth = await createGoogleAuth([
    "https://www.googleapis.com/auth/analytics.readonly",
  ]);
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });
  const response = await analyticsData.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody,
  });

  return (response.data.rows ?? []) as Ga4Row[];
}
