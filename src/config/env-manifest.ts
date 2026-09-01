// Every environment variable this codebase reads, what it is for, and whether a
// tenant actually needs it.
//
// WHY THIS EXISTS
// ---------------
// Standing up a customer used to mean discovering the configuration by watching
// production break, one variable at a time. That is not a figure of speech: the
// Deepgram 401 and the NEXT_PUBLIC_APP_URL incident both happened that way, and
// `.env.local.example` documented 32 of the variables the code reads.
//
// This file is the single definition. `.env.local.example` is GENERATED from it
// by `scripts/env-manifest.mts`, and the same script fails when the code reads
// something this file does not mention. A generated file cannot drift; a
// hand-maintained one already had.
//
// HOW TO USE IT WHEN STANDING UP A TENANT
// ---------------------------------------
// Start from the generated `.env.local.example` and fill in every `required`
// entry. Then, for each integration the tenant actually buys and each feature it
// is given in the control plane, fill in that group. A tenant with
// `integrations.elks: false` needs none of the ELKS_* set, and can see that at a
// glance rather than by reading route handlers.
//
// NEVER COPY ANOTHER TENANT'S FILE (ground rule R5). Every credential here is
// per customer. A copied file makes one customer authenticate AS ANOTHER against
// Stripe, GA4, Google Ads, Search Console, PostHog, App Store Connect and the S3
// export, and within an hour their sync crons fill the wrong database.
// ENCRYPTION_KEY and CRON_SECRET especially: the existing ones decrypt
// Wrenchlane's mail tokens.

/**
 * How badly the app wants this variable.
 *
 * - `required`         the app does not boot usefully without it, for any tenant
 * - `required-for-feature` needed only if that group's feature or integration is on
 * - `optional`         has a working fallback, or turns something extra on
 * - `platform`         injected by Vercel or Node. Never set it by hand
 */
export type EnvRequirement =
  | "required"
  | "required-for-feature"
  | "optional"
  | "platform";

export interface EnvVar {
  name: string;
  requirement: EnvRequirement;
  /** One line: what it is, and what breaks without it. */
  description: string;
  /** Example or default, shown in the generated file. */
  example?: string;
  /**
   * Set when the scanner cannot see the read because it goes through a constant
   * or a computed key. Without this the drift check would report the variable as
   * documented-but-unread and somebody would delete a live entry — which is
   * exactly the mistake this brief was written to stop repeating.
   */
  indirect?: boolean;
}

export interface EnvGroup {
  /** Stable id, used in the generated file's section headers. */
  id: string;
  title: string;
  /**
   * What switches this whole group on or off, in the words of the config:
   * a `TenantIntegrations` key, a feature registry key, or "core".
   */
  gate: string;
  /** Why a tenant would or would not need any of this. */
  note: string;
  vars: readonly EnvVar[];
}

export const ENV_GROUPS: readonly EnvGroup[] = [
  {
    id: "tenant",
    title: "Which customer this deployment is",
    gate: "core",
    note:
      "Selects the compiled config in src/config/tenants/. An unknown value fails " +
      "the boot on purpose rather than quietly serving one customer's domains and " +
      "copy to another.",
    vars: [
      {
        name: "TENANT_SLUG",
        requirement: "optional",
        description: "Blank means wrenchlane, which is the default tenant.",
        example: "blank | wrenchlane",
      },
    ],
  },

  {
    id: "core",
    title: "Core: the app does not work without these",
    gate: "core",
    note: "Every tenant needs all of these, and every one of them is per tenant.",
    vars: [
      {
        name: "NEXT_PUBLIC_SUPABASE_URL",
        requirement: "required",
        description: "This tenant's own Supabase project URL.",
      },
      {
        name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        requirement: "required",
        description: "Publishable key for that project. Safe in the browser.",
      },
      {
        name: "SUPABASE_SERVICE_ROLE_KEY",
        requirement: "required",
        description:
          "Bypasses RLS. Server only, never exposed, never shared between tenants.",
      },
      {
        name: "NEXT_PUBLIC_APP_URL",
        requirement: "required",
        description:
          "Public URL of this deployment. Tracking pixels, unsubscribe links and " +
          "OAuth callbacks are built from it, so a wrong value silently breaks all three.",
        example: "https://crm-for-saas.vercel.app",
      },
      {
        name: "ENCRYPTION_KEY",
        requirement: "required",
        description:
          "AES-256-GCM key for stored mail tokens. GENERATE A FRESH ONE PER TENANT " +
          "(openssl rand -hex 32): the existing one decrypts Wrenchlane's tokens.",
      },
      {
        name: "CRON_SECRET",
        requirement: "required",
        description:
          "Bearer token Vercel injects on scheduled requests. Fresh per tenant " +
          "(openssl rand -hex 32).",
      },
      {
        name: "SYNC_SECRET",
        requirement: "optional",
        description:
          "Separate secret for the data-sync and security-scan routes. Falls back " +
          "to CRON_SECRET when unset.",
      },
      {
        name: "TRACKING_DOMAIN",
        requirement: "optional",
        description:
          "Dedicated click/open tracking domain, kept off the app domain so tracking " +
          "traffic cannot hurt its reputation. Falls back to NEXT_PUBLIC_APP_URL.",
      },
    ],
  },

  {
    id: "ai",
    title: "Anthropic",
    gate: "core",
    note:
      "Reply drafting, cold-email generation, call summaries and the article studio " +
      "all run through this. It is the primary AI provider. Gemini below is the " +
      "fallback: set both and a credit or capacity failure here fails over instead " +
      "of taking every AI surface down at once.",
    vars: [
      {
        name: "ANTHROPIC_API_KEY",
        requirement: "required",
        description: "Claude API key.",
      },
    ],
  },

  {
    id: "ai-gemini",
    title: "Gemini (fallback AI provider)",
    gate: "optional",
    note:
      "Google's Generative Language API, billed to the Google account that holds the " +
      "AI credits (jacob@wrenchlane.com, project crm-for-saas-491113). An exhausted " +
      "Anthropic credit balance returns HTTP 400, not a 401 or a 429, so it does not " +
      "read as a quota problem, and because credits are org-wide it took all ~20 AI " +
      "call sites down at once (2026-07-02 and 2026-08-27). With GEMINI_API_KEY set, " +
      "src/lib/ai/provider.ts fails those requests over to Gemini. Leave it blank and " +
      "behaviour is exactly as before: Anthropic only. Verify a key with " +
      "`node scripts/test-gemini.mjs`. NOT covered by the fallback, because Gemini's " +
      "equivalents are a different contract: web-search enrichment (find-website, " +
      "find-phone) and the article generator's prompt caching.",
    vars: [
      {
        name: "GEMINI_API_KEY",
        requirement: "optional",
        description:
          "API key from https://aistudio.google.com/apikey (pick the \"CRM for SaaS\" " +
          "project so usage bills against the work account).",
      },
      {
        name: "GOOGLE_AI_API_KEY",
        requirement: "optional",
        description: "Alias for GEMINI_API_KEY, the name AI Studio copies out.",
      },
      {
        name: "AI_PRIMARY_PROVIDER",
        requirement: "optional",
        description:
          "Which provider is tried first: anthropic (default) or gemini. Flip to " +
          "gemini to spend Google credits ahead of Anthropic ones.",
      },
      {
        name: "AI_FALLBACK_DISABLED",
        requirement: "optional",
        description: "Set to 1 to attempt only the primary provider and never fail over.",
      },
      {
        name: "GEMINI_MODEL",
        requirement: "optional",
        description:
          "Gemini model for haiku-class call sites. Defaults to gemini-3.6-flash. " +
          "Note gemini-2.5-* are retired for new keys: they still appear in the " +
          "model list but every call 404s.",
      },
      {
        name: "GEMINI_MODEL_STRONG",
        requirement: "optional",
        description:
          "Gemini model for call sites that ask Anthropic for a sonnet/opus-class " +
          "model. Defaults to gemini-pro-latest, an alias rather than a pinned " +
          "version because the only concrete pro model is a preview.",
      },
    ],
  },

  {
    id: "mail-google",
    title: "Google mail (mail.defaultProvider = google)",
    gate: "mail.defaultProvider === 'google'",
    note:
      "The Gmail API OAuth client, used to send and sync mail. Separate from " +
      "Supabase Auth sign-in. A Microsoft tenant needs none of this; it needs the " +
      "Entra registration in docs/plans/productisation/ENTRA-APP-SETUP.md instead.",
    vars: [
      {
        name: "GOOGLE_CLIENT_ID",
        requirement: "required-for-feature",
        description: "OAuth client id from Google Cloud Console.",
      },
      {
        name: "GOOGLE_CLIENT_SECRET",
        requirement: "required-for-feature",
        description: "OAuth client secret.",
      },
    ],
  },

  {
    id: "control-plane",
    title: "Control plane",
    gate: "core",
    note:
      "The first two are set on TENANT deployments to pull feature flags. Leave " +
      "both blank and the tenant runs on compiled defaults, which is a supported " +
      "state. The rest are set ONLY on the control-plane deployment itself.",
    vars: [
      {
        name: "CONTROL_PLANE_URL",
        requirement: "optional",
        description: "Where this tenant pulls its flags from.",
        example: "https://jacobs-crm-control.vercel.app",
      },
      {
        name: "CONTROL_PLANE_TOKEN",
        requirement: "optional",
        description: "Token scoped to this tenant. Minted in the console, shown once.",
      },
      {
        name: "IS_CONTROL_PLANE",
        requirement: "optional",
        description:
          "Set to 1 on the control-plane deployment ONLY. Anywhere else every " +
          "/admin route 404s.",
        example: "1 on the console, blank elsewhere",
      },
      {
        name: "CONTROL_PLANE_SUPABASE_URL",
        requirement: "required-for-feature",
        description:
          "The CONTROL-PLANE project. Named differently from the tenant Supabase " +
          "variables so a copied env file cannot point the console at a customer CRM.",
      },
      {
        name: "CONTROL_PLANE_SERVICE_ROLE_KEY",
        requirement: "required-for-feature",
        description: "Service role key for the control-plane project only.",
      },
      {
        name: "CONTROL_PLANE_ADMIN_EMAILS",
        requirement: "required-for-feature",
        description:
          "Super admins, comma separated. EXACT addresses only: a leading @domain " +
          "entry is dropped, because @gmail.com would admit the entire internet.",
      },
    ],
  },

  {
    id: "millionverifier",
    title: "MillionVerifier (integrations.millionverifier)",
    gate: "integrations.millionverifier",
    note:
      "Address verification before sending. Worth knowing: unverified addresses " +
      "silently pause enrollments, so a tenant that skips this sees contacts sit " +
      "inert with no visible error.",
    vars: [
      {
        name: "MILLIONVERIFIER_API_KEY",
        requirement: "required-for-feature",
        description: "API key.",
      },
    ],
  },

  {
    id: "apify",
    title: "Apify (integrations.apify)",
    gate: "integrations.apify",
    note: "Google Maps scraping and Reddit harvesting. Needed by discovery and forums.",
    vars: [
      { name: "APIFY_TOKEN", requirement: "required-for-feature", description: "API token." },
    ],
  },

  {
    id: "elks",
    title: "46elks telephony (integrations.elks)",
    gate: "integrations.elks",
    note:
      "Outbound calling and the browser softphone. A tenant with elks: false needs " +
      "none of these ten.",
    vars: [
      { name: "ELKS_API_USERNAME", requirement: "required-for-feature", description: "API username." },
      { name: "ELKS_API_PASSWORD", requirement: "required-for-feature", description: "API password." },
      {
        name: "CALL_WEBHOOK_SECRET",
        requirement: "required-for-feature",
        description:
          "Shared secret in the call-webhook URLs. The webhooks FAIL CLOSED when " +
          "unset, to stop spoofed inbound/hangup calls. Fresh per tenant.",
      },
      {
        name: "CRM_CALL_FROM_NUMBER",
        requirement: "optional",
        description: "Fallback caller ID when no workspace setting is present.",
      },
      { name: "ELKS_WEBRTC_USERNAME", requirement: "required-for-feature", description: "SIP username for the browser softphone." },
      { name: "ELKS_WEBRTC_PASSWORD", requirement: "required-for-feature", description: "SIP password." },
      { name: "ELKS_WEBRTC_SIP_HOST", requirement: "required-for-feature", description: "SIP host." },
      { name: "ELKS_WEBRTC_WS_URI", requirement: "required-for-feature", description: "WebSocket URI for SIP over WSS." },
      { name: "ELKS_WEBRTC_NUMBER", requirement: "required-for-feature", description: "The number the softphone presents." },
      { name: "ELKS_WEBRTC_OWNER_USER_ID", requirement: "optional", description: "User whose browser the softphone rings." },
      { name: "ELKS_WEBRTC_ICE_SERVERS", requirement: "optional", description: "Override the default STUN/TURN list." },
    ],
  },

  {
    id: "deepgram",
    title: "Deepgram (integrations.deepgram)",
    gate: "integrations.deepgram",
    note: "Call transcription. A missing key surfaces as a 401 mid-call, not at boot.",
    vars: [
      { name: "DEEPGRAM_API_KEY", requirement: "required-for-feature", description: "API key." },
    ],
  },

  {
    id: "elevenlabs",
    title: "ElevenLabs (integrations.elevenlabs)",
    gate: "integrations.elevenlabs",
    note: "The voice agent behind the call agent feature.",
    vars: [
      { name: "ELEVENLABS_API_KEY", requirement: "required-for-feature", description: "API key." },
    ],
  },

  {
    id: "google-maps",
    title: "Google Maps (integrations.googleMaps)",
    gate: "integrations.googleMaps",
    note: "Field routes and phone enrichment.",
    vars: [
      {
        name: "GOOGLE_MAPS_API_KEY",
        requirement: "required-for-feature",
        description:
          "Server-side key with Routes + Geocoding + Maps JavaScript enabled. " +
          "DO NOT expose it on a NEXT_PUBLIC_ name.",
      },
      {
        name: "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY",
        requirement: "required-for-feature",
        description: "Separate browser key, HTTP-referrer restricted.",
      },
      { name: "ROUTE_DEFAULT_ORIGIN_ADDRESS", requirement: "optional", description: "Default origin for the route generator." },
      { name: "ROUTE_DEFAULT_ORIGIN_LAT", requirement: "optional", description: "Latitude of that origin." },
      { name: "ROUTE_DEFAULT_ORIGIN_LNG", requirement: "optional", description: "Longitude of that origin." },
    ],
  },

  {
    id: "slack",
    title: "Slack (integrations.slack)",
    gate: "integrations.slack",
    note:
      "Alerting and bug reports. All optional: with none set, alerts fall back to " +
      "console.error rather than failing.",
    vars: [
      { name: "SLACK_ALERT_WEBHOOK_URL", requirement: "optional", description: "Security and sync-health alerts." },
      { name: "SLACK_BOT_TOKEN", requirement: "optional", description: "Bot token, for posting as the app rather than a webhook." },
      { name: "SLACK_SIGNING_SECRET", requirement: "optional", description: "Verifies inbound Slack requests. Required if any Slack route is exposed." },
      { name: "SLACK_BUG_REPORTS_WEBHOOK_URL", requirement: "optional", description: "Where in-app bug reports go." },
      { name: "SLACK_FORUM_POSTS_WEBHOOK_URL", requirement: "optional", description: "Forum post notifications." },
      { name: "SLACK_FORUM_POSTS_CHANNEL_ID", requirement: "optional", description: "Channel id for those notifications." },
      { name: "SLACK_FORUM_TEAM_MENTIONS", requirement: "optional", description: "Who to @-mention on a forum hit." },
      { name: "SLACK_SWITCHBOARD_WEBHOOK_URL", requirement: "optional", description: "Switchboard/voice-agent notifications." },
    ],
  },

  {
    id: "stripe",
    title: "Stripe (integrations.stripe)",
    gate: "integrations.stripe",
    note:
      "Revenue for the analytics dashboards. Read-only use: Stripe is the pricing " +
      "source of truth and this app never writes to it.",
    vars: [
      { name: "STRIPE_SECRET_KEY", requirement: "required-for-feature", description: "Restricted read key is enough." },
    ],
  },

  {
    id: "product-analytics",
    title: "Product analytics (feature: product_analytics)",
    gate: "features.product_analytics",
    note:
      "The whole /dashboard suite: GA4, PostHog, Google Ads, Search Console, App " +
      "Store Connect, Customer.io and the S3 export. This is the single largest " +
      "group and it is entirely Wrenchlane-shaped today. A tenant without the " +
      "feature needs none of it.",
    vars: [
      {
        name: "CEO_ALLOWED_EMAILS",
        requirement: "optional",
        description:
          "Who may see the dashboards. Comma separated; a leading @domain matches " +
          "the domain. AN EMPTY VALUE ALLOWS EVERYONE, which is a dev convenience " +
          "and wrong in production.",
      },
      { name: "GA4_PROPERTY_ID", requirement: "required-for-feature", description: "GA4 property behind the attribution sync." },
      { name: "GOOGLE_SERVICE_ACCOUNT_JSON", requirement: "required-for-feature", description: "Service account JSON for GA4 and Search Console." },
      { name: "GOOGLE_OAUTH_CLIENT_ID", requirement: "optional", description: "Alternative to the service account, for APIs that need a user." },
      { name: "GOOGLE_OAUTH_CLIENT_SECRET", requirement: "optional", description: "Paired with the above." },
      { name: "GOOGLE_OAUTH_REFRESH_TOKEN", requirement: "optional", description: "Refresh token for that user." },
      { name: "GOOGLE_OAUTH_REDIRECT_URI", requirement: "optional", description: "Redirect URI used when minting that token." },
      { name: "GOOGLE_SEARCH_CONSOLE_SITE_URL", requirement: "optional", description: "Search Console property." },
      { name: "SEARCH_CONSOLE_SITE_URL", requirement: "optional", description: "Older name for the same thing, still read." },
      { name: "GOOGLE_ADS_CUSTOMER_ID", requirement: "required-for-feature", description: "Ads account the spend comes from." },
      { name: "GOOGLE_ADS_LOGIN_CUSTOMER_ID", requirement: "required-for-feature", description: "Manager account id." },
      { name: "GOOGLE_ADS_DEVELOPER_TOKEN", requirement: "required-for-feature", description: "Google Ads API developer token." },
      { name: "GOOGLE_DATAMANAGER_REFRESH_TOKEN", requirement: "optional", description: "For uploading offline conversions." },
      {
        name: "GOOGLE_ADS_PAID_SUBSCRIPTION_ACTION_ID",
        requirement: "optional",
        description:
          "Conversion action for paid subscriptions. Run scripts/google-datamanager-setup.mjs to get it.",
        indirect: true,
      },
      { name: "GOOGLE_ADS_CURRENCY", requirement: "optional", description: "Currency for uploaded conversions." },
      { name: "GOOGLE_ADS_GEO_TARGETS", requirement: "optional", description: "Geo target constants for keyword ideas." },
      { name: "GOOGLE_ADS_LANGUAGE_CONSTANT", requirement: "optional", description: "Language constant for keyword ideas." },
      { name: "GOOGLE_ADS_KEYWORD_IDEAS", requirement: "optional", description: "Turns the keyword-ideas call on." },
      { name: "GOOGLE_ADS_IDEA_SEED_CAP", requirement: "optional", description: "Caps how many seeds are sent per request." },
      { name: "POSTHOG_API_KEY", requirement: "required-for-feature", description: "Personal API key for HogQL queries." },
      { name: "POSTHOG_PROJECT_ID", requirement: "required-for-feature", description: "PostHog project." },
      { name: "POSTHOG_API_HOST", requirement: "optional", description: "Defaults to the EU cloud host." },
      { name: "POSTHOG_TRACKED_EVENTS", requirement: "optional", description: "Restricts which events the sync pulls." },
      { name: "CUSTOMER_IO_APP_API_KEY", requirement: "required-for-feature", description: "App API key. Reads and exports only." },
      { name: "CUSTOMER_IO_REGION", requirement: "optional", description: "us or eu." },
      { name: "CUSTOMER_IO_METRICS_ENDPOINT", requirement: "optional", description: "Override the metrics host." },
      { name: "APP_STORE_CONNECT_API_KEY", requirement: "optional", description: "App Store Connect key body." },
      { name: "APP_STORE_CONNECT_KEY_ID", requirement: "optional", description: "Key id." },
      { name: "APP_STORE_CONNECT_ISSUER_ID", requirement: "optional", description: "Issuer id." },
      { name: "APP_STORE_CONNECT_PRIVATE_KEY", requirement: "optional", description: "PEM private key." },
      { name: "APP_STORE_CONNECT_APPLE_ID", requirement: "optional", description: "Numeric app id." },
      { name: "APP_STORE_CONNECT_BUNDLE_ID", requirement: "optional", description: "Bundle identifier." },
      { name: "APP_STORE_CONNECT_ANALYTICS_REPORT_URL", requirement: "optional", description: "Pre-signed analytics report URL." },
      { name: "AWS_ACCESS_KEY_ID", requirement: "optional", description: "Reads the customer-app S3 data export." },
      { name: "AWS_SECRET_ACCESS_KEY", requirement: "optional", description: "Paired with the above." },
      { name: "AWS_REGION", requirement: "optional", description: "Region of that bucket." },
      { name: "DATA_BUCKET", requirement: "optional", description: "Bucket name for the export." },
    ],
  },

  {
    id: "reviews",
    title: "Reviews (feature: reviews)",
    gate: "features.reviews",
    note:
      "App-store and public review collection. NOT stale, despite looking it: every " +
      "one of these is read through getEnv(), which a search for `process.env.` " +
      "does not find.",
    vars: [
      { name: "TRUSTPILOT_API_KEY", requirement: "required-for-feature", description: "Trustpilot public Business Units API key." },
      { name: "TRUSTPILOT_BUSINESS_UNIT_ID", requirement: "optional", description: "Pin the business unit id to skip the lookup." },
      { name: "TRUSTPILOT_DOMAIN", requirement: "optional", description: "Domain used to resolve the business unit id." },
      {
        name: "GBP_REVIEWS_ENABLED",
        requirement: "optional",
        description:
          "Set to 1 to turn Google Business Profile sync on. Dormant until that API " +
          "access is approved; quota stays 0 until then.",
      },
      { name: "GBP_ACCOUNT_ID", requirement: "optional", description: "GBP account id." },
      { name: "GBP_LOCATION_ID", requirement: "optional", description: "GBP location id." },
    ],
  },

  {
    id: "forums",
    title: "Forums (feature: forums)",
    gate: "features.forums",
    note: "Answering car-forum and Reddit threads. Needs APIFY_TOKEN as well.",
    vars: [
      {
        name: "FORUM_CANDIDATE_SCAN_ENABLED",
        requirement: "optional",
        description:
          "Must be the string 'true' to let the candidate scan run. Off by default " +
          "because every firing costs an Apify run.",
      },
    ],
  },

  {
    id: "articles",
    title: "Articles and Webflow (feature: articles)",
    gate: "features.articles",
    note: "The content studio and its publishing target.",
    vars: [
      { name: "WEBFLOW_API_TOKEN", requirement: "required-for-feature", description: "Webflow site token." },
      { name: "WEBFLOW_SITE_ID", requirement: "required-for-feature", description: "Target site id." },
      { name: "RELEASE_MAIL_MAILBOX", requirement: "optional", description: "Mailbox the Releases tab imports from." },
      { name: "RELEASE_MAIL_QUERY", requirement: "optional", description: "Gmail query that selects release mails." },
    ],
  },

  {
    id: "dtc",
    title: "Fault codes (feature: dtc)",
    gate: "features.dtc",
    note:
      "The DTC lookup calls the customer-facing diagnostics product. This is " +
      "Wrenchlane's own API and no other tenant has one.",
    vars: [
      { name: "WRENCHLANE_DIAGNOSTICS_API_URL", requirement: "required-for-feature", description: "Base URL of the diagnostics API." },
      { name: "WRENCHLANE_DIAGNOSTICS_API_KEY", requirement: "required-for-feature", description: "API key for it." },
    ],
  },

  {
    id: "mockup",
    title: "Mockup (feature: mockup)",
    gate: "features.mockup",
    note: "An internal page that embeds a clickable prototype.",
    vars: [
      { name: "NEXT_PUBLIC_MOCKUP_URL", requirement: "optional", description: "Overrides the built-in prototype URL." },
    ],
  },

  {
    id: "testing",
    title: "End-to-end tests",
    gate: "core",
    note: "Only used by the Playwright suite. Never set in production.",
    vars: [
      { name: "TEST_USER_EMAIL", requirement: "optional", description: "Account the e2e login route signs in as." },
    ],
  },

  {
    id: "platform",
    title: "Injected by the platform",
    gate: "core",
    note:
      "Listed so the drift check knows about them. Vercel and Node set these; " +
      "setting them by hand is a mistake.",
    vars: [
      { name: "NODE_ENV", requirement: "platform", description: "development | production | test." },
      { name: "VERCEL_URL", requirement: "platform", description: "Deployment hostname Vercel injects." },
    ],
  },
] as const;

/** Flat list, for the generator and the drift check. */
export const ENV_VARS: readonly EnvVar[] = ENV_GROUPS.flatMap((g) => g.vars);

/** Every variable name the manifest knows about. */
export function manifestVarNames(): Set<string> {
  return new Set(ENV_VARS.map((v) => v.name));
}
