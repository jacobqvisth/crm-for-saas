-- Provenance for activation touchpoints: where the information on each card
-- came from and how trustworthy it is (verified in app code / synced from
-- Customer.io / inferred backend behavior / Claude suggestion). Shown in the
-- touchpoint modal so the accuracy of every item is explicit.
--
-- The backfill below stamps the rows seeded from the 2026-06-10 audit,
-- matched by their seed titles (only where source_note is still NULL, so
-- user-written notes are never overwritten).

ALTER TABLE activation_plan_items
  ADD COLUMN IF NOT EXISTS source_note TEXT;

UPDATE activation_plan_items SET source_note = v.note
FROM (VALUES
  ('Verify your email', 'Inferred backend behavior: the app proxies /api/verify-email to the backend (codeoc-web-form), so Cognito sends a verification email at signup. That it exists is near-certain; its wording/timing is not visible in any code I can read.'),
  ('Welcome email', 'Assumed Customer.io journey: campaign metrics sync hourly into this CRM, but no specific welcome campaign has been verified. Link the campaign on this card to confirm it and see its content.'),
  ('Getting-started tips', 'Suggested by Claude (2026-06-10 audit) — no verified day-2 email exists. "Planned" was a proposal, not a fact; verify in Customer.io or build it.'),
  ('First-diagnosis nudge', 'Suggested by Claude (2026-06-10 audit) — does not exist today. Proposed to close the gap for signups that never run a diagnosis.'),
  ('Upgrade pitch (free → paid)', 'Suggested by Claude (2026-06-10 audit) — does not exist today. Proposed for active free users.'),
  ('Win-back: inactive 14 days', 'Suggested by Claude (2026-06-10 audit) — does not exist today. Proposed re-engagement for quiet signups.'),
  ('Onboarding carousel (5 steps)', 'Verified in app code: codeoc-web-form src/components/onboarding/ — 5-step inline tutorial on first login (welcome, vehicle selection, AI diagnostics, TSBs/docs, workshop data). Accurate as of 2026-06-10.'),
  ('Get Started dialog', 'Verified in app code: codeoc-web-form GetStartedDialog.tsx — help-menu guide with 6 sections. Accurate as of 2026-06-10.'),
  ('Upgrade prompts on gated features', 'Verified in app code: codeoc-web-form shared/UpgradePrompt.tsx — Motor, InfoPro, measurements and garage limits render an upgrade prompt for free-plan users (403 plan_feature_required).'),
  ('Daily quota banners (free plan)', 'Verified in app code: codeoc-web-form useSubscription.ts + quotaErrors.ts — Free plan: 3 diagnoses/day, 3 chat messages/day, 10 VRM lookups/day; 429 errors render a countdown banner.'),
  ('InfoPro trial feedback dialog', 'Verified in app code: codeoc-web-form InfoProTrialFeedbackDialog.tsx — star rating + comment on closing the InfoPro manual during the trial window; required for free users.'),
  ('First diagnosis run', 'Verified data milestone: every diagnosis lands in dashboard_diagnostics (hourly sync); cohort activation is charted on /dashboard/new-users. The "day 1" placement is a typical value, not a rule.'),
  ('First completed diagnostic + invoice', 'Verified in app code: codeoc-web-form diagnostics-v2 complete + invoice endpoints (work summary, parts, PDF invoice).'),
  ('Review ask after first success', 'Suggested by Claude (2026-06-10 audit) — no review prompt of any kind exists in the app today. Flagged as the biggest quick win.'),
  ('Checkout started (begin_checkout)', 'Verified in app code: codeoc-web-form PricingPage.tsx fires the GA4 begin_checkout event when a user clicks upgrade and is sent to Stripe Checkout.'),
  ('Abandoned-checkout recovery email', 'Suggested by Claude (2026-06-11) — does not exist today. begin_checkout fires to GA4 but nothing follows up a abandoned Stripe session.'),
  ('Checkout + purchase event', 'Verified in app code: codeoc-web-form VehicleFirstRouter.tsx confirms the Stripe session on return and fires the GA4 purchase event (deduplicated per session).'),
  ('Trial-ending reminder email', 'Suggested by Claude (2026-06-11) — does not exist today. The app only redirects at trial end; nothing warns the user beforehand.'),
  ('Trial-end redirect to pricing', 'Verified in app code: codeoc-web-form AuthInterceptor.tsx redirects paused/inactive subscriptions to the pricing page with a reason (trial_ended / subscription_cancelled).'),
  ('Personal check-in from founder', 'Suggested by Claude (2026-06-10 audit) — proposed manual touch; nothing automated or scheduled exists.')
) AS v(title, note)
WHERE activation_plan_items.title = v.title
  AND activation_plan_items.source_note IS NULL;
