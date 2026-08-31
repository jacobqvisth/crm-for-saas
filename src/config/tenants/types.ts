// The shape of everything that differs between customers of this CRM.
//
// WHY THIS EXISTS
// ---------------
// This codebase runs for more than one company (see docs/plans/productisation/).
// Each customer gets its own deployment and its own database, but they all run
// the SAME code from `main`. Everything that differs between them has to live
// somewhere typed, reviewable and compiler-checked, rather than in a pile of
// environment variables where a missing value is a runtime surprise.
//
// A typed module in the repo also means a config change goes through review
// like any other diff, and `tsc` tells you immediately when a new field is
// added and a tenant has not filled it in.
//
// RULES FOR EDITING THIS FILE
// ---------------------------
// - Adding a required field is a breaking change for every tenant. The compiler
//   will tell you; fill each one in deliberately rather than reaching for `?`.
// - A value belongs here if a different customer would plausibly want it
//   different. A value that is genuinely universal (an API's base URL, a
//   protocol constant) does NOT belong here.
// - Secrets never belong here. This file is committed. Credentials come from
//   environment variables, one set per tenant, and are never shared between
//   tenants (ground rule R5).

import type { FeatureFlags } from "../features";

/** ISO 639-1 code, e.g. "sv", "en". */
export type LanguageCode = string;

/** Which mail backend a tenant sends and syncs through. */
export type MailProvider = "google" | "microsoft";

/**
 * The external services a tenant uses at all. A `false` here means the tenant
 * has no account with that vendor, so the feature should not merely be hidden,
 * it should not run: crons that call it are skipped and settings pages for it
 * are not shown.
 *
 * This is deliberately separate from the phase 03 feature flags. A feature flag
 * answers "should this customer see this?"; this answers "do the credentials
 * for this even exist?". Wrenchlane has all of them, which is why every value
 * below is `true` in `wrenchlane.ts`.
 */
export interface TenantIntegrations {
  /** Apify actors, used for Google Maps scraping and Reddit harvesting. */
  apify: boolean;
  /** 46elks, the SIP/telephony provider behind outbound calling. */
  elks: boolean;
  /** Deepgram, call transcription. */
  deepgram: boolean;
  /** ElevenLabs Agents, the voice agent. */
  elevenlabs: boolean;
  /** MillionVerifier, email address verification before sending. */
  millionverifier: boolean;
  /** Google Maps Places, used by Field Routes and phone enrichment. */
  googleMaps: boolean;
  /** Slack, used for alerting and bug reports. */
  slack: boolean;
  /** Stripe, the revenue source for the analytics dashboards. */
  stripe: boolean;
}

/**
 * The logos, alt text and browser title a customer sees.
 *
 * This block is REQUIRED rather than optional on purpose. Before phase 11 the
 * sidebar hardcoded `/wrenchlane-mark.png`, so any second customer would have
 * signed in and seen another company's logo above their own pipeline. An
 * optional block would have preserved exactly that failure for whoever forgot
 * to fill it in; a required one means `tsc` names them instead.
 *
 * The assets are plain files under `public/tenants/<slug>/`. There is no CDN
 * and no upload flow, because a logo changes about once a year and a deploy is
 * a perfectly good way to change one.
 */
export interface TenantBranding {
  /** Square mark, shown when the sidebar is collapsed. Path under `public/`. */
  markSrc: string;
  /** Alt text for the mark. Usually just the company name. */
  markAlt: string;
  /** Full wordmark, shown when the sidebar is expanded. Path under `public/`. */
  wordmarkSrc: string;
  /** Alt text for the wordmark. Screen readers read this, so it is a phrase. */
  wordmarkAlt: string;
  /** `<title>` for the whole app. */
  browserTitle: string;
  /** `<meta name="description">` for the whole app. */
  browserDescription: string;
}

/** Who the tenant is, in the words the product and its emails use. */
export interface TenantIdentity {
  /** Stable machine identifier. Matches the filename and TENANT_SLUG. */
  slug: string;
  /** Registered company name, for legal footers and DPA-style copy. */
  legalName: string;
  /** What the product calls itself in the UI. */
  displayName: string;
  /** One sentence, used to ground AI copy and to introduce the company. */
  productDescription: string;
  /** Where a recipient's reply-to-a-human should land. */
  supportEmail: string;
  /** Logos, alt text and browser title. Required; see TenantBranding. */
  branding: TenantBranding;
}

/** Every hostname the tenant owns or treats specially. */
export interface TenantDomains {
  /**
   * Public URL of this CRM deployment. Reads `NEXT_PUBLIC_APP_URL` at runtime
   * and falls back to this when it is unset. Tracking pixels, unsubscribe links
   * and OAuth redirects are all built from it.
   */
  appUrl: string;
  /**
   * Dedicated click/open tracking domain, kept off the app domain so tracking
   * traffic cannot hurt the app domain's reputation. Reads `TRACKING_DOMAIN`,
   * falling back to `appUrl`.
   */
  trackingDomain: string | null;
  /** Domains the tenant sends outbound mail from. */
  sendingDomains: readonly string[];
  /**
   * Email domains belonging to the tenant and its own staff. Users on these
   * domains are flagged internal and excluded from customer-facing analytics,
   * and contacts on them are never enrolled in outbound.
   */
  internalDomains: readonly string[];
  /**
   * Hostname stems that count as "this company" when scanning third-party text
   * (forum posts, Reddit) for mentions. Matched on the registrable stem, so
   * every ccTLD and subdomain is covered without listing each one.
   */
  brandHostTokens: readonly string[];
}

/** How the tenant sends mail, and how fast. */
export interface TenantMail {
  /** Which backend. Wrenchlane is Google; Animech and Spennare are Microsoft. */
  defaultProvider: MailProvider;
  /**
   * Default cap per sending mailbox per day, used when a workspace row does not
   * override it. Deliberately conservative: this is a reputation control, not a
   * throughput target.
   */
  defaultDailyLimitPerSender: number;
  /** Default minimum gap between two sends from one mailbox, in seconds. */
  defaultMinSendIntervalSeconds: number;
}

/** Language and time conventions. */
export interface TenantLocale {
  /** Language for outbound copy when a contact's own language is unknown. */
  defaultLanguage: LanguageCode;
  /** Every language a sequence is allowed to have a variant in. */
  supportedLanguages: readonly LanguageCode[];
  /**
   * IANA timezone that defines a "day" for analytics. Every dashboard range is
   * half-open [start, end) in this zone, so a range ending "today" ends at
   * local midnight rather than UTC midnight.
   */
  timezone: string;
}

/** Copy and context that grounds everything the AI writes. */
export interface TenantAi {
  /**
   * Long-form product knowledge injected into reply drafting and cold-email
   * generation. The single largest per-tenant difference in the codebase, and
   * the reason a fork would have been unmaintainable.
   */
  knowledge: string;
  /** Who the tenant sells to, in a sentence the model can reason about. */
  icpDescription: string;
  /** House style: how outbound should and should not sound. */
  toneNotes: string;
}

/**
 * Which sign-in buttons `/login` renders for this tenant.
 *
 * THIS MUST MATCH WHAT THE TENANT'S SUPABASE PROJECT HAS ENABLED.
 * ---------------------------------------------------------------
 * These booleans do not enable anything. They only decide which buttons are
 * drawn. The provider itself is switched on in that tenant's Supabase project
 * (Authentication -> Providers), which is a dashboard setting rather than code
 * and therefore cannot be verified by the compiler.
 *
 * Setting one of these true for a provider Supabase has NOT had enabled
 * produces a button that fails with "provider is not enabled" after the user
 * has already committed to clicking it. That is strictly worse than no button:
 * it looks like the product is broken rather than like the option does not
 * exist. That exact error already cost a round trip on the control plane, so it
 * is written down here rather than rediscovered.
 *
 * `email` means ADMIN-INVITED email, never open sign-up. The tenant's Supabase
 * project must have `disable_signup` on, and a person is authorised by being
 * created through the admin API with `email_confirm: true`. They then sign in
 * with a magic link or a password. An open email button on a CRM is an
 * invitation to the internet.
 */
export interface TenantAuth {
  /** Google / Google Workspace. */
  google: boolean;
  /** Microsoft Entra ID, the Supabase `azure` provider. */
  microsoft: boolean;
  /** Admin-invited email (magic link or password). Never open sign-up. */
  email: boolean;
}

/** One customer's complete configuration. */
export interface TenantConfig {
  identity: TenantIdentity;
  /**
   * Sign-in options. Deliberately NOT pulled from the control plane: a flag
   * that could be toggled remotely could lock every user out of a tenant, and
   * the value has to agree with a Supabase dashboard setting that the control
   * plane cannot see. Deploy-time truth belongs in a deploy-time file.
   */
  auth: TenantAuth;
  domains: TenantDomains;
  mail: TenantMail;
  locale: TenantLocale;
  ai: TenantAi;
  integrations: TenantIntegrations;
  /**
   * Which optional surfaces this customer sees. One boolean per key in the
   * feature registry; the type is exhaustive, so a new feature is a compile
   * error here until every tenant has an answer for it.
   *
   * Wrenchlane uses ALL_FEATURES_ENABLED rather than a hand-written list, which
   * is what makes ground rule R2 automatic.
   */
  features: FeatureFlags;
}
