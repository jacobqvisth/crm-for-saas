// Wrenchlane: the first tenant, and the baseline every other tenant is
// described against.
//
// EVERY VALUE HERE ENCODES WHAT THE CODE ALREADY DID on 2026-08-29. This file
// introduced no behaviour of its own. Where a value was hardcoded, it was moved
// here unchanged; where a value came from an environment variable, the variable
// is still read at the point of use and this file only names the fallback that
// was already in the code.
//
// That is ground rule R1 and R2: Wrenchlane is a live business, phases 01 to 07
// are behaviour preserving, and Wrenchlane's config is the baseline that new
// tenants are configured to differ FROM.

import { WRENCHLANE_KNOWLEDGE } from "@/lib/inbox/wrenchlane-knowledge";
import type { TenantConfig } from "./types";

export const wrenchlane: TenantConfig = {
  identity: {
    slug: "wrenchlane",
    // TODO(tenant-config): confirm the registered entity with Jacob. The
    // codebase never states one, so the trading name is used rather than
    // guessing at a company suffix. Nothing reads this yet.
    legalName: "Wrenchlane",
    displayName: "Wrenchlane",
    // Condensed from the first paragraph of WRENCHLANE_KNOWLEDGE.
    productDescription:
      "An AI-powered diagnostic platform for automotive workshops that analyses fault codes together with symptoms, real repair outcomes and OEM service data, then guides a technician through the repair.",
    // From src/lib/switchboard/knowledge.ts, where the voice agent already
    // tells callers this address.
    supportEmail: "support@wrenchlane.com",
  },

  domains: {
    // Matches the fallback already written into the seven route handlers that
    // build absolute URLs (calls, switchboard, slack, security scan). The live
    // deployment sets NEXT_PUBLIC_APP_URL, which still wins at runtime.
    appUrl: "https://crm-for-saas.vercel.app",
    // Wrenchlane sends click/open tracking through a dedicated domain so
    // tracking traffic cannot damage the app domain's reputation. Set via
    // TRACKING_DOMAIN in the environment; `null` here means "no compiled
    // default", which reproduces getTrackingBaseUrl()'s fall-through to
    // NEXT_PUBLIC_APP_URL when the variable is unset.
    trackingDomain: null,
    sendingDomains: ["wrenchlane.com", "wrenchlane.co"],
    // Verbatim from INTERNAL_TEST_EMAIL_DOMAINS in
    // src/lib/ceo/internal-test/auto-flag.ts. codeoc.ai is CodeOC, the dev
    // company behind Wrenchlane; bitknife.se is Hans's own domain, and
    // hans@wrenchlane.com, hans@codeoc.ai and hans@bitknife.se are one person.
    internalDomains: ["wrenchlane.com", "codeoc.ai", "bitknife.se"],
    // Verbatim from WL_HOST_TOKENS in src/lib/forums/wl-domains.ts. Matched on
    // the registrable stem, so every ccTLD and link.wrenchlane.se are covered.
    brandHostTokens: ["wrenchlane"],
  },

  mail: {
    defaultProvider: "google",
    // The literal already in src/lib/sequences/estimate-send-times.ts, used
    // when a workspace row has no daily_limit_per_sender.
    defaultDailyLimitPerSender: 80,
    // DEFAULT_MIN_SEND_INTERVAL_SECONDS in src/lib/gmail/send.ts.
    defaultMinSendIntervalSeconds: 60,
  },

  locale: {
    // FALLBACK_LANGUAGE in src/lib/sequences/language.ts. Note this is the
    // fallback for OUTBOUND copy, not a UI language: the CRM interface is
    // English regardless.
    defaultLanguage: "en",
    // The codes from SUPPORTED_LANGUAGES in src/lib/countries.ts, in the same
    // order (which roughly tracks SUPPORTED_OUTBOUND_COUNTRIES).
    supportedLanguages: ["cs", "da", "en", "et", "fi", "lv", "lt", "no", "sr", "sk", "sv"],
    // Every analytics range in the dashboards is half-open [start, end) in this
    // zone. Wrenchlane is a Swedish company selling into the Nordics, so a
    // "day" is a Stockholm day, not a UTC one.
    timezone: "Europe/Stockholm",
  },

  ai: {
    // TODO(tenant-config): phase 02 declares this field but deliberately does
    // not move the 100-line knowledge blob yet. It is re-exported from its
    // existing home so there is exactly ONE copy and no chance of the two
    // drifting. Inverting the dependency (config owns it, lib imports it) is
    // priority-2 work in the phase 02 brief and belongs in its own diff.
    knowledge: WRENCHLANE_KNOWLEDGE,
    // The "Target market / ICP" line from WRENCHLANE_KNOWLEDGE, verbatim.
    icpDescription:
      "Independent and small/mid-size automotive repair workshops (typically 1-10 mechanics). Focus on European vehicle fleets and Nordic + Baltic markets. The recipient is usually a shop owner, service advisor, or lead technician.",
    // Distilled from the three scenario tones in
    // src/app/api/ai/generate-email/route.ts, which is the only place the house
    // style is currently written down.
    toneNotes:
      "Peer-to-peer and technically credible. Lead with the business outcome or the workflow that gets easier, respect the reader's time, and show you understand a workshop's day.",
  },

  integrations: {
    apify: true,
    elks: true,
    deepgram: true,
    elevenlabs: true,
    millionverifier: true,
    googleMaps: true,
    slack: true,
    stripe: true,
  },
};
