export const FUNNEL_STEPS = [
  {
    key: "ad_click",
    label: "Ad / Visit",
    metricKey: "sessions",
    sourceKey: "ga4",
  },
  {
    key: "signup",
    label: "Signup",
    metricKey: "signup",
    sourceKey: "ga4",
  },
  {
    key: "onboarding_completed",
    label: "Onboarding",
    metricKey: "onboarding_completed",
    sourceKey: "ga4",
  },
  {
    key: "first_diagnostic_started",
    label: "First Diagnostic",
    metricKey: "first_diagnostic_started",
    sourceKey: "ga4",
  },
  {
    key: "diagnostic_completed",
    label: "Diagnostic Done",
    metricKey: "diagnostic_completed",
    sourceKey: "ga4",
  },
  {
    key: "activated_workshop",
    label: "Activated",
    metricKey: "activated_workshop",
    sourceKey: "ga4",
  },
  {
    key: "paid_subscription",
    label: "Paid",
    metricKey: "new_paid_workshops",
    sourceKey: "stripe",
  },
] as const;

export const GA4_EVENT_MAP = {
  signup: ["sign_up", "signup", "user_signup"],
  onboarding_completed: ["onboarding_completed", "complete_onboarding"],
  first_diagnostic_started: [
    "first_diagnostic_started",
    "diagnostic_first_started",
  ],
  diagnostic_started: ["diagnostic_started", "diagnosis_started"],
  diagnostic_completed: ["diagnostic_completed", "diagnosis_completed"],
  activated_workshop: ["workshop_activated", "activated_workshop"],
} as const;

export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]["key"];
export type Ga4MappedEventKey = keyof typeof GA4_EVENT_MAP;
