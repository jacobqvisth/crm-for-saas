// Spennare: tenant three.
//
// Phase 09 is the acceptance test for the whole productisation programme: it is
// meant to be the same six steps as phase 08 with a different config and
// different credentials, and NOTHING ELSE. Every moment this file needed a code
// change rather than a config value is recorded in cc-session-log.md, because
// that list is the real backlog for finishing the generalisation.
//
// WHERE THESE VALUES CAME FROM
// ----------------------------
// A research pass done on 2026-08-30, held outside this repository at
// `~/Documents/Spennare/research/` with a config draft in
// `~/Documents/Spennare/crm/tenant-config-draft.ts`. Nothing here is invented.
// Anything not evidenced is marked TODO(spennare) rather than guessed, because
// a plausible-looking wrong value is worse than an obvious gap: it gets read
// once, believed, and never questioned again.
//
// NOTHING IN THIS FILE MAY REFERENCE WRENCHLANE, and the AI knowledge blob
// especially: Wrenchlane's describes car diagnostics to workshop owners.

import type { TenantConfig } from "./types";

/**
 * What Spennare's AI needs to know to write in their voice.
 *
 * Every sentence traces to the research pass. Nothing marked [inferred] there
 * was allowed in here, because this text is what the model repeats to real
 * prospects.
 */
const SPENNARE_KNOWLEDGE = `
K G Spennare AB (org.nr 556646-7055) is a Swedish company that has designed and
manufactured portable exhibition and event products since 2003. It is based in
Nacka outside Stockholm, with a showroom at Barnhusgatan 16 in central
Stockholm, and has around 8 employees. It is family run: Johan Spennare is CEO
and Fredrik Spennare is chair.

Spennare sells exclusively through authorised resellers and distributors,
companies that buy Spennare products in order to resell them to end customers.
Spennare does not sell directly to end customers. Its products are represented
in more than 30 countries.

The product range covers roll ups, banner displays, image walls, lightboxes,
counters and podiums, outdoor products including beach flags, large format
print, promotional furniture, inflatables, brochure holders and accessories.

Spennare has won six international design awards.

Resellers get a reseller login portal, a print file submission service at
submit.spennare.com, ready made design templates and a product catalogue. To
become a reseller, a company sends its legal name, organisation number, contact
person, address and billing email to Spennare, which reviews the application.

In May 2026 Spennare announced a merger with FaberExposize, a large format print
and visual communication company based in Lidingö, part of the Dutch Faber Group
which was founded in 1933 and has production in the Netherlands, Poland and
Thailand. The merger was expected to complete at the end of 2026. Neither
company buys the other; they merge into a joint operation, initially trading
under both brands, with a new joint name planned for 2027. Combined revenue is
over 80 million SEK. The stated reason is that customers want complete
solutions, for example a beach flag with mast, base and print together rather
than hardware alone. Sales continue to run through resellers.
`.trim();

export const spennare: TenantConfig = {
  identity: {
    slug: "spennare",
    // Verified against the Swedish company register, org.nr 556646-7055.
    // TODO(spennare): the FaberExposize merger was expected to complete at the
    // end of 2026 with a new joint name planned for 2027. Revisit legalName
    // and displayName then.
    legalName: "K G Spennare AB",
    displayName: "Spennare",
    productDescription:
      "Portable exhibition and event display systems, including roll-ups, banner systems, image walls, lightboxes, counters, beach flags and event furniture, sold exclusively through authorised resellers and distributors.",
    // order@spennare.com is EVIDENCED: it is their general order address and
    // where reseller applications land today.
    // TODO(spennare): replace with a dedicated CRM reply address before mail is
    // turned on, so outbound replies do not compete with live order traffic in
    // an eight-person company's shared inbox.
    supportEmail: "order@spennare.com",

    // TODO(spennare): BOTH IMAGES ARE BLANK PLACEHOLDERS, not a design. They
    // are flat grey rectangles generated to keep the sidebar from rendering a
    // broken image. Inventing a visual identity for a real company would be
    // worse than an obvious gap, because someone would see it and assume it had
    // been approved. Replace both with Spennare's own assets before anybody
    // from Spennare signs in.
    branding: {
      markSrc: "/tenants/spennare/mark.png",
      markAlt: "Spennare",
      wordmarkSrc: "/tenants/spennare/wordmark.png",
      wordmarkAlt: "Spennare",
      browserTitle: "Spennare CRM",
      browserDescription: "Spennare's reseller and sales CRM.",
    },
  },

  // NOTHING IS ENABLED YET, and this is honest rather than cautious.
  //
  // Section E of phase 11 wants every non-Wrenchlane tenant to offer Google,
  // Microsoft and email. But a button for a provider the Supabase project has
  // not had enabled fails with "provider is not enabled" AFTER the user has
  // clicked it, which is worse than no button. Animech shipped with exactly
  // this problem and it is the reason nobody could sign in there.
  //
  // So these flip in the same change that actually enables the provider on the
  // project, and not before. `email: true` matches the default a new Supabase
  // project ships with; note that email alone is NOT a usable sign-in path
  // until the project has custom SMTP, because Supabase's shared sender only
  // delivers to members of the Supabase organisation and is capped at two
  // messages an hour. That was discovered on Animech on 2026-08-31.
  //
  // TODO(spennare): enable the `azure` provider (delegated sign-in: openid,
  // profile, email — NOT the app-only mail registration in ENTRA-APP-SETUP.md,
  // which is a different app) and set microsoft: true in the same commit.
  auth: {
    google: false,
    microsoft: false,
    email: true,
  },

  domains: {
    // TODO(spennare): set to the real deployment URL once the Vercel project
    // exists. Until then this is what the project will be called, not a URL
    // that resolves.
    appUrl: "https://spennare-crm.vercel.app",
    trackingDomain: null,
    // EMPTY ON PURPOSE and it must stay empty until a separate domain is bought
    // and warmed. spennare.com currently publishes TWO conflicting `v=spf1`
    // records, which is invalid and can make receivers return permerror, and
    // its DMARC is `p=none` with no reporting. Adding cold outbound volume to
    // that domain would be sending into a broken SPF configuration.
    sendingDomains: [],
    internalDomains: [
      "spennare.com",
      // The merger partner, already co-located at Radiovägen 3A in Lidingö.
      // Listed as internal so their staff can never be enrolled in outbound.
      // TODO(spennare): confirm once the merger completes.
      "faberexposize.se",
    ],
    brandHostTokens: ["spennare", "faberexposize"],
  },

  mail: {
    // Microsoft 365, VERIFIED BY MX on 2026-08-30:
    //   spennare.com MX 0 -> spennare-com.mail.protection.outlook.com
    // This answers the phase 09 brief's open question ("confirm their mail
    // provider before starting"). It is not a third provider, so nothing in
    // the mail layer needs new work for this tenant.
    defaultProvider: "microsoft",
    // Higher volume than Animech: recruiting resellers is a wider, lower-value
    // list across many markets, rather than a few hundred named accounts. Still
    // conservative, because the sending domain will be new and unwarmed.
    defaultDailyLimitPerSender: 60,
    defaultMinSendIntervalSeconds: 120,
  },

  locale: {
    // English is the channel language: the reseller network is international
    // even though the office is Swedish.
    defaultLanguage: "en",
    // THE SINGLE STRONGEST PRODUCT FIT FOR THIS CUSTOMER. Per-language step
    // variants pinned at enrollment, across a reseller network in more than 30
    // countries. The phase 09 brief warns specifically against copying
    // Wrenchlane's Nordic list, so this is the Nordics plus the larger European
    // display markets where their named competitors already operate.
    //
    // Note the brief says "50+ countries"; Spennare's own material says more
    // than 30, and the research pass took their number over the brief's.
    //
    // TODO(spennare): trim to the markets they will actually write copy for. A
    // language with no variant written falls back to the default, so a wide
    // list costs nothing but implies more than exists. Start narrow, grow.
    supportedLanguages: [
      "en",
      "sv",
      "no",
      "da",
      "fi",
      "de",
      "nl",
      "fr",
      "es",
      "it",
      "pl",
    ],
    timezone: "Europe/Stockholm",
  },

  ai: {
    knowledge: SPENNARE_KNOWLEDGE,
    icpDescription:
      "Companies that sell branded physical marketing materials to end customers and can resell Spennare hardware: sign makers, print shops and large-format printers, promotional product distributors, exhibition stand builders, event production companies, marketing and event agencies, and online display retailers. The strongest single signal is a company already selling portable display systems from a competing brand such as Expand, Expolinc, Ultima or Nimlok, because it already has the category, the print capability and the end-customer relationship. Spennare does not sell to end customers, so a company that only buys displays for its own use is not a fit.",
    toneNotes:
      "Warm, direct, commercial and practical. The reader runs a small or medium sign shop, print shop or agency and is busy. Lead with what they earn or what gets easier, not with product features. Keep it to four to six sentences. Write in the recipient's own language where a variant exists and never mix languages in one email. Avoid corporate marketing language, hype and exclamation marks. Never imply Spennare sells to end customers, because that is the thing their resellers most need to trust.",
  },

  // THESE MATCH THE LIVE CONTROL PLANE, NOT THE RESEARCH DRAFT.
  //
  // Read this before changing any of them. The research pass produced a draft
  // config on 2026-08-30 that turned on `calling`, `deals`, `dealer_network`,
  // `roadmap` and `mockup`. A later session executing phase 11 section D
  // decided all twenty flags in the control plane
  // (`updated_by: phase-11-tenant-bring-up`) and set every one of those five to
  // FALSE, with a recorded reason per row.
  //
  // The control plane wins, for a mechanical reason rather than a judgement
  // one: `/api/config` resolves from registry defaults plus control-plane
  // overrides and NEVER reads this file. If the two disagreed, Spennare's
  // features would silently change the moment the tenant was wired to the
  // console. The compiled config is the last-resort fallback, so it has to
  // agree with the thing that actually decides.
  //
  // The control plane's reasoning is also the better reasoning where they
  // differ: `deals` and `dealer_network` are Spennare's core need but are NOT
  // SHIPPED — the Deals UI was deleted in PR #357 and phase 10 rebuilds it — so
  // switching them on puts nav items in front of routes that 404. `calling`
  // needs 46elks telephony they have not bought. `roadmap` and `mockup` are
  // Jacob's own internal surfaces.
  //
  // Spelled out key by key rather than derived, so adding a feature to the
  // registry is a COMPILE ERROR here and someone has to decide whether Spennare
  // gets it. That is the whole point.
  features: {
    // Wrenchlane's car-diagnostics content. Meaningless in this market.
    dtc: false,
    videos: false,
    forums: false,
    reviews: false,
    // ON. The one content feature that is not car-specific: drafting works
    // immediately, and publishing needs only Spennare's own Webflow token.
    articles: true,
    // The product-analytics suite assumes a self-serve SaaS with its own signup
    // funnel plus our access to its Stripe, GA4 and PostHog. Spennare sells
    // hardware through a reseller channel.
    product_analytics: false,
    journey: false,
    funnel: false,
    activation: false,
    pricing_options: false,
    // Route-optimised driving between many small local sites. Wrong shape for
    // an international reseller network. Worth revisiting for a Nordic
    // reseller visit tour, which is a real use case, but not at launch.
    field_routes: false,
    // Needs 46elks telephony they have not bought. Turn on together with
    // integrations.elks when they do.
    calling: false,
    // A voice agent for high-volume low-value calling. Wrong for a channel
    // business, and it needs ElevenLabs credentials they do not have.
    call_agent: false,
    // ON, and the most important flag on this tenant. This is where Spennare
    // and Animech genuinely differ: Apify Google Maps discovery WORKS here.
    // Sign makers, print shops, promotional distributors and event companies
    // are all physical businesses with Maps categories, so Wrenchlane's
    // existing connector transfers with new search terms rather than needing
    // the new connector Animech needs.
    discovery: true,
    // ON. Any customer sending outbound wants its sending domains watched, and
    // Spennare's SPF is actively broken, so this is the one tenant where it
    // earns its place on day one.
    domain_portfolio: true,
    // Planned, not shipped. Spennare is the customer phase 10C is being built
    // FOR, so this is the first row to flip when it ships.
    dealer_network: false,
    // Planned, not shipped. Phase 10A. A second pipeline for the direct
    // FaberExposize side is the eventual shape.
    deals: false,
    // Jacob's own internal surfaces, not customer-facing.
    roadmap: false,
    mockup: false,
    // ON, and one of only two tenants it is on for. The registry defaults it
    // off, which is why the phase-11 bring-up wrote `false` here, but the
    // feature was built on 2026-08-31 specifically for Spennare and Animech:
    // "bygg den för spennare och animech, låt den vara optional för
    // wrenchlane".
    //
    // The bring-up's reason for `false` (useless until linkedin_url is
    // populated) was right about the data and wrong about the consequence: a
    // step with no stored profile falls back to a LinkedIn people search built
    // from the contact's name and company, and says in the task that the link
    // is a guess. Finding a named reseller contact that way is seconds of work,
    // so the step is useful before any enrichment exists.
    //
    // Nothing is sent automatically. Both step types create a TASK for a rep,
    // so this cannot put a Spennare employee's LinkedIn account at risk.
    linkedin_steps: true,
  },

  integrations: {
    // ON, unlike Animech. See the `discovery` note: the Google Maps source is
    // right for this market. Their OWN Apify account, sized for their own
    // volume, never Wrenchlane's (R5, R7).
    apify: true,
    // Only needed if field_routes is turned on later.
    googleMaps: false,
    // Telephony: not bought.
    elks: false,
    deepgram: false,
    elevenlabs: false,
    // International cold outbound across many markets, so address verification
    // is essential rather than optional. Unverified addresses silently pause
    // enrollments, which is the failure mode that left 53 contacts inert on
    // Wrenchlane with no visible error.
    millionverifier: true,
    // TODO(spennare): confirm whether they use Slack. Must never be pointed at
    // Wrenchlane's channels (R7).
    slack: false,
    // Revenue lives in Specter, their ERP, not in Stripe. They do not sell
    // through Stripe at all.
    stripe: false,
  },
};
