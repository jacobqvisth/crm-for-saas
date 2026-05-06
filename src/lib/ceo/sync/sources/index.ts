import { type SourceKey } from "@/lib/ceo/sources";
import type { SourceConnector } from "../types";
import { appStoreConnectConnector } from "./app-store-connect";
import { coreAppConnector } from "./core-app";
import { customerIoConnector } from "./customer-io";
import { ga4Connector } from "./ga4";
import { googleAdsConnector } from "./google-ads";
import { searchConsoleConnector } from "./search-console";
import { stripeConnector } from "./stripe";

const CONNECTORS: Record<SourceKey, SourceConnector> = {
  core_app: coreAppConnector,
  ga4: ga4Connector,
  google_ads: googleAdsConnector,
  search_console: searchConsoleConnector,
  customer_io: customerIoConnector,
  stripe: stripeConnector,
  app_store_connect: appStoreConnectConnector,
};

export function getConnector(sourceKey: SourceKey): SourceConnector {
  return CONNECTORS[sourceKey];
}
