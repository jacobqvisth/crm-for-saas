/**
 * The handoff from a landing page to signup, and the two columns that make the
 * whole programme measurable.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Today nothing records which page delivered a signup. There is no landing-page
 * column and no gclid column on any table, GA4 has no firstUserLandingPage
 * dimension to fall back on, and Google's own asset-group report is not a fair
 * comparison because Google decides who sees which asset group. So the honest
 * answer to "which page brought this customer in" is that we do not know, and
 * that stays true no matter how many pages we build.
 *
 * Building hundreds of pages without fixing this first would mean building
 * hundreds of pages we cannot rank, cannot prune and cannot learn from.
 *
 * THE FIX, AND WHY IT LIVES HERE
 *
 * The capture has two halves and we own one of them outright. The landing page
 * knows its own slug at render time and can read the click id off its own URL,
 * so it can put both into the signup link. That half is implemented in this
 * file and ships with the pages themselves.
 *
 * The other half is one change in the core app: read these parameters at signup
 * and persist them on the user row. That is specified in CORE_APP_CONTRACT
 * below rather than assumed, because app.wrenchlane.com is a different codebase.
 * Until it lands the parameters travel and are dropped, which costs nothing and
 * means the day it lands, attribution starts working without touching a page.
 */

import { codeSlug } from "./slugs";

export const SIGNUP_ORIGIN = "https://app.wrenchlane.com";

/**
 * Parameter names, fixed in one place.
 *
 * Short and prefixed. `lp` and `wl_kind` will end up in URLs a technician may
 * see and in warehouse columns someone will read in two years, and both
 * audiences are served by names that do not collide with the utm_* set Google
 * and GA4 already write.
 */
export const TRACKING_PARAMS = {
  /** Slug of the page the visitor actually landed on. */
  landingPage: "lp",
  /** Which kind of page it was, so the warehouse can group without a join. */
  pageKind: "wl_kind",
  /** Plan intent, when the page implies one. */
  plan: "plan",
  /** Google's click id, passed straight through from the ad click. */
  gclid: "gclid",
} as const;

export type SignupLinkInput = {
  /** Page slug, e.g. `p0420` or `find-your-plan`. */
  landingPage: string;
  pageKind: string;
  /** Only set when the page genuinely implies a tier. Never guessed. */
  plan?: string | null;
  /** Read off the landing page's own query string at click time. */
  gclid?: string | null;
};

/**
 * The signup URL a landing page CTA should point at.
 *
 * Deliberately omits empty values rather than emitting `gclid=`: an empty
 * parameter is indistinguishable from a captured empty click id downstream, and
 * organic visitors to these pages will outnumber paid ones.
 */
export function signupUrl(input: SignupLinkInput): string {
  const url = new URL("/signup", SIGNUP_ORIGIN);
  url.searchParams.set(TRACKING_PARAMS.landingPage, input.landingPage);
  url.searchParams.set(TRACKING_PARAMS.pageKind, input.pageKind);
  if (input.plan) url.searchParams.set(TRACKING_PARAMS.plan, input.plan);
  if (input.gclid) url.searchParams.set(TRACKING_PARAMS.gclid, input.gclid);
  return url.toString();
}

/** Convenience for the fault-code cluster, which is most of the programme. */
export function faultCodeSignupUrl(code: string, gclid?: string | null) {
  return signupUrl({
    landingPage: codeSlug(code),
    pageKind: "fault_code",
    // A code query is Problem stage. Someone mid-repair wants an answer, not a
    // pricing tier, so these pages carry no plan intent and hand off to Free.
    plan: "free",
    gclid,
  });
}

/**
 * The script a generated page runs to keep the click id attached.
 *
 * A gclid arrives on the landing page URL and is gone by the time the visitor
 * reaches signup, because the CTA is a plain link rendered at build time. This
 * reads it at click time and rewrites the outbound href.
 *
 * Kept as a string rather than a bundled module because the emitters put it
 * into static HTML on a different site, where there is no build step to import
 * through. It is small enough to read in full, which is the bar for anything
 * inlined this way.
 */
export const GCLID_FORWARD_SCRIPT = `(function () {
  var params = new URLSearchParams(window.location.search);
  var gclid = params.get('gclid') || params.get('wbraid') || params.get('gbraid');
  if (!gclid) return;
  var links = document.querySelectorAll('a[data-wl-signup]');
  for (var i = 0; i < links.length; i++) {
    try {
      var url = new URL(links[i].href);
      url.searchParams.set('gclid', gclid);
      links[i].href = url.toString();
    } catch (err) {
      /* a malformed href is not worth breaking the page over */
    }
  }
})();`;

export type ContractItem = {
  system: string;
  change: string;
  why: string;
  owner: string;
};

/**
 * What has to happen outside this repo before the programme is measurable.
 *
 * Written down as data rather than prose so the dashboard can show it as an
 * open checklist instead of it living in someone's head.
 */
export const CORE_APP_CONTRACT: readonly ContractItem[] = [
  {
    system: "app.wrenchlane.com signup",
    change:
      "Read lp, wl_kind, plan and gclid from the query string and persist them on the user record at creation.",
    why: "This is the whole of the attribution fix. Without it every page in the programme is unmeasurable, and the conversion imports stay stuck on the hashed-email route instead of the click-id one.",
    owner: "codeoc team",
  },
  {
    system: "app.wrenchlane.com signup",
    change:
      "Honour ?plan= by preselecting that tier instead of showing the generic form.",
    why: "All four plan pages currently hand off to the same generic signup, so the plan intent we paid for is discarded at the last step.",
    owner: "codeoc team",
  },
  {
    system: "core_app S3 export",
    change:
      "Carry the four new fields through to the warehouse export so dashboard_users gains landing_page and gclid.",
    why: "Capturing at signup and not exporting would move the blind spot rather than close it.",
    owner: "codeoc team",
  },
  {
    system: "Vercel production environment",
    change:
      "Add GOOGLE_ADS_DEVELOPER_TOKEN, the 22-character token from the manager account's API Center.",
    why: "GOOGLE_ADS_CUSTOMER_ID is already set and the API client is built, but both are required. This one variable is the difference between the competitor reconciler being a table on a page and something that can actually run, and it also unlocks real per-campaign conversions instead of GA4 first-touch proxies.",
    owner: "Jacob",
  },
  {
    system: "Google Ads",
    change:
      "Check the Expanded Final URL assets report and decide whether final URL expansion stays on.",
    why: "If expansion is on, Google is already choosing landing pages we did not pick, and no comparison between pages means anything until that is settled.",
    owner: "Marketing",
  },
];
