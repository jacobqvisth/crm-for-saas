// Animech: tenant two.
//
// Written for phase 08a — a live URL and a live database. The mail half (08b)
// is deliberately absent: nothing here can send, because their Entra consent
// and a sending domain do not exist yet.
//
// WHERE THESE VALUES CAME FROM
// ----------------------------
// The company facts are from the research in `~/Documents/Any/research/`, not
// invented. Anything not evidenced is marked TODO(animech) rather than guessed,
// because a plausible-looking wrong value is worse than an obvious gap: it gets
// read once, believed, and never questioned again.
//
// NOTHING IN THIS FILE MAY REFERENCE WRENCHLANE. That is the phase 08
// done-when, and it applies to the AI knowledge blob especially — Wrenchlane's
// describes a car-diagnostics product to workshop owners, and reusing it would
// have their AI write in another company's voice about another company's
// market.

import type { TenantConfig } from "./types";

/**
 * What Animech's AI needs to know to write in their voice.
 *
 * Deliberately short. Wrenchlane's equivalent is ~100 lines accumulated over
 * months of real use; this is a starting point assembled from public material
 * and desk research, and it should be replaced with something Animech have read
 * and corrected before any of it reaches a customer.
 */
const ANIMECH_KNOWLEDGE = `
Animech AB (org.nr 556730-9132) is an Uppsala software company, founded 2007,
around 26 to 40 people. It builds interactive 3D product configurators and CPQ
(configure, price, quote) software for manufacturers of configurable products.

Customers include Volkswagen, SKF, Cytiva, Fjällräven, Elfa and Willab. Work
also reaches aerospace and defence, so expect security review questions.

Typical engagements, from published price points: a basic 3D viewer at EUR
1.5-5k, a configurator at EUR 13-22k, a catalogue rollout at EUR 18-40k, each
with EUR 200-1,500 a month ongoing. Enterprise consultative selling: a buying
committee of five to eight people and a cycle of three to nine months.

The sharpest angle is that a 3D layer can be built OVER an existing CPQ rather
than replacing it — as done for Piab on top of their Tacton system. That makes
every company already running Tacton, Configit or Elfsquad a prospect rather
than a lost deal.
`.trim();

export const animech: TenantConfig = {
  identity: {
    slug: "animech",
    // Registered entity, confirmed against the Swedish company register.
    // "Animech Technologies AB" resolves to the same org number and is a former
    // or informal name.
    legalName: "Animech AB",
    displayName: "Animech",
    productDescription:
      "Interactive 3D product configurators and CPQ software for manufacturers of configurable products, including a 3D layer that can be built over an existing CPQ rather than replacing it.",
    // it@animech.com is EVIDENCED: it receives their DMARC reports and is the
    // technical contact. It is not a customer-facing support address.
    // TODO(animech): replace with a real support mailbox before 08b turns mail
    // on, because this is where a recipient's reply to a human would land.
    supportEmail: "it@animech.com",
  },

  domains: {
    appUrl: "https://animech-crm.vercel.app",
    trackingDomain: null,
    // EMPTY ON PURPOSE, and it must stay empty until a domain is bought and
    // warmed. animech.com publishes SPF ending in `-all`, so mail sent from it
    // through anything not already in that record is REJECTED outright rather
    // than merely marked down. See 11-tenant-bring-up.md and ENTRA-APP-SETUP.md.
    sendingDomains: [],
    internalDomains: ["animech.com"],
    brandHostTokens: ["animech"],
  },

  mail: {
    // Microsoft 365, verified by MX. Nothing can send until 08b regardless.
    defaultProvider: "microsoft",
    // Carried over as generic starting values, not because Animech's sending
    // has been sized. They sell to a few hundred named accounts, not a list, so
    // these will almost certainly come down rather than up.
    defaultDailyLimitPerSender: 80,
    defaultMinSendIntervalSeconds: 60,
  },

  locale: {
    // A Swedish company selling to Volkswagen, SKF and Cytiva: the outbound
    // language is English even though the office is not. This is the fallback
    // for OUTBOUND copy; the CRM interface is English either way.
    defaultLanguage: "en",
    supportedLanguages: ["en", "sv", "de"],
    timezone: "Europe/Stockholm",
  },

  ai: {
    knowledge: ANIMECH_KNOWLEDGE,
    icpDescription:
      "Manufacturers selling a configurable physical product, where the range is large enough that a paper catalogue or a spreadsheet quote has become the bottleneck. Strongest fit where a CPQ system is already in place but has no visual layer. The reader is usually a product, marketing or sales-operations lead rather than an engineer.",
    // TODO(animech): scope with their sales lead. This is inferred from how
    // they present themselves publicly and has not been agreed with them.
    toneNotes:
      "Consultative and specific, written for a buying committee rather than a single decision maker. Lead with the commercial problem — quoting time, configuration errors, catalogue maintenance — and treat the 3D as the means, not the headline.",
  },

  // NOT ALL_FEATURES_ENABLED. Wrenchlane inherits every feature by design (R2);
  // Animech must not, or a 3D configurator company gets fault-code dashboards
  // and Reddit car-forum answering. The off-list is the one in the phase 08
  // brief, which was written from what Animech actually sell.
  //
  // Spelled out key by key rather than derived, so adding a feature to the
  // registry is a COMPILE ERROR here and someone has to decide whether Animech
  // gets it. That is the whole point.
  features: {
    // Wrenchlane's car-diagnostics content surfaces. None apply.
    dtc: false,
    videos: false,
    forums: false,
    articles: false,
    reviews: false,
    dealer_network: false,
    // Product analytics and everything downstream of it measures a freemium
    // self-serve app with a Stripe funnel. Animech sell enterprise projects.
    product_analytics: false,
    journey: false,
    funnel: false,
    activation: false,
    pricing_options: false,
    // Field visits to physical premises: for workshops, not for named
    // enterprise accounts.
    field_routes: false,
    // The autonomous voice agent answers inbound workshop calls. Not a fit.
    call_agent: false,
    // Wrenchlane-specific ops surfaces.
    domain_portfolio: false,
    mockup: false,
    roadmap: false,

    // UNRESOLVED DISAGREEMENT — read before changing these three.
    //
    // The phase 08 brief says "Expected on: everything core, plus `calling` and
    // `discovery`", and `deals` is named as Animech's core need for phase 10.
    // A concurrent session executing phase 11 section D set all three to FALSE
    // in the control plane (`updated_by: phase-11-tenant-bring-up`), taking the
    // more conservative reading: nothing on until it has been scoped with them.
    //
    // These are set to match the LIVE CONTROL PLANE, not the brief. The value
    // that matters more than either answer is that the compiled config and the
    // control plane agree: /api/config resolves from registry defaults plus
    // overrides and never reads this file, so a disagreement would surface as
    // Animech's features changing the moment it is wired.
    //
    // Nothing is lost by starting closed — core CRM (contacts, companies,
    // sequences, inbox) is not feature-gated and works regardless. Turning one
    // on later is one click and an audit row. Jacob settles which reading is
    // right; until then, closed.
    calling: false,
    // Whichever way this lands, note the caveat: the staging table,
    // review-and-promote screen and AI scoring all apply to Animech, but Google
    // Maps is the wrong SOURCE — it finds businesses by physical category,
    // which is how you find a car workshop, not "a manufacturer with a
    // configurable product". Phase 10 scopes a different connector. Hence
    // integrations.apify false below.
    discovery: false,
    // Their core need, and it does not exist yet: the Deals UI was removed in
    // PR #357 and phase 10 rebuilds it. Off until there is something to show.
    deals: false,
    // Off by default everywhere, including for Wrenchlane.
    linkedin_steps: false,
  },

  integrations: {
    // Google Maps discovery cannot work for them — see the `discovery` note.
    // Leaving this true would spend money on scrapes that cannot match.
    apify: false,
    googleMaps: false,
    // Telephony: available, but no numbers provisioned yet. 08b territory.
    elks: false,
    deepgram: false,
    elevenlabs: false,
    // No sending domain yet, so nothing to verify addresses for.
    millionverifier: false,
    // Jacob's Slack, not Animech's. Must not be pointed at Wrenchlane's
    // channels (R7).
    slack: false,
    // The revenue dashboards read Wrenchlane's Stripe. Animech do not sell
    // through Stripe at all.
    stripe: false,
  },
};
