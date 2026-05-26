export type SourceInfo = {
  title: string;
  body: string;
  sources?: string[];
  logic?: string;
  fields?: string[];
  refresh?: string;
};

export const SOURCE_INFO = {
  overview:
    "Blends core app warehouse rows, Stripe billing, GA4/Firebase analytics, Google Ads, Search Console, Customer.io, and sync health for the selected UTC window.",
  coreApp:
    "Comes from the first-party core app export loaded from AWS/S3 into Supabase warehouse tables. It is canonical for users, workshops, diagnostics, chats, Motor usage, and AI cost.",
  stripe:
    "Comes from Stripe subscription and customer snapshots loaded into dashboard_subscriptions. Stripe wins for MRR, ARR, plan, paid status, trials, churn, and billing posture.",
  ga4:
    "Comes from GA4/Firebase event snapshots. GA4 is used for analytics behavior such as active users, platform split, funnel events, and linked ads reporting.",
  googleAds:
    "Comes from Google Ads metrics linked through GA4 when available. Spend, clicks, impressions, CTR, CPC, and campaign efficiency should be read as acquisition telemetry.",
  searchConsole:
    "Comes from Google Search Console search analytics. Clicks, impressions, CTR, average position, queries, pages, countries, and devices describe organic discovery only.",
  customerIo:
    "Comes from Customer.io campaign metrics. These numbers describe messaging delivery and engagement; they do not define product identity or paid state.",
  appStore:
    "Comes from App Store Connect discovery and app analytics where available. Use it as acquisition context, not the revenue source of truth.",
  sync:
    "Comes from dashboard sync run records. Health is based on recent successful runs, stale runs, failures, skipped jobs, and row counts written to the warehouse.",
  calculated:
    "Calculated inside the dashboard from synced warehouse rows after applying the selected UTC time range.",
  normalized:
    "The chart normalizes mixed units so direction is comparable. Use the nearby cards and tables for exact values.",
} as const;

const REFRESH = {
  metric:
    "Updated by the protected sync routes. Metric rows upsert into dashboard_metric_snapshots by source_key, metric_key, period_start, period_end, and dimension_key.",
  coreEntity:
    "Updated by the core_app sync. Rows are upserted by their stable primary key, such as internal_user_id, workshop_id, diagnostic_id, chat_id, or motor_usage_id.",
  stripe:
    "Updated by the stripe sync. Subscription rows upsert by stripe_subscription_id, and current billing status replaces the previous snapshot.",
  sync:
    "Updated every time a sync route runs. Each run writes a dashboard_sync_runs row and updates source freshness through dashboard_source_accounts.",
} as const;

function metricInfo({
  title,
  body,
  source,
  metricKey,
  logic,
}: {
  title: string;
  body: string;
  source: string;
  metricKey: string;
  logic?: string;
}): SourceInfo {
  return {
    title,
    body,
    sources: [source, "dashboard_metric_snapshots"],
    fields: [
      `source_key=${source}`,
      `metric_key=${metricKey}`,
      "period_start",
      "period_end",
      "value",
      "dimensions",
    ],
    logic,
    refresh: REFRESH.metric,
  };
}

export function sourceInfoFromLabel(label: string): SourceInfo {
  const normalized = label.toLowerCase();

  if (normalized.includes("active users")) {
    return metricInfo({
      title: "Active users",
      body:
        "Counts active users from GA4/Firebase analytics events in the selected UTC window. This is behavioral activity, not the canonical user table.",
      source: "ga4",
      metricKey: "active_users",
      logic:
        "The dashboard sums dashboard_metric_snapshots.value for source_key=ga4 and metric_key=active_users inside the selected range.",
    });
  }

  if (normalized.includes("activation rate")) {
    return {
      title: "Activation rate",
      body:
        "Calculated in the dashboard from synced funnel/product rows. It is meant to show the share of signups or workshops that reached the defined activation step.",
      sources: ["dashboard_funnel_snapshots", "core app warehouse", "GA4 / Firebase"],
      fields: [
        "step_key",
        "count",
        "period_start",
        "period_end",
        "metric_key=core_diagnostics_completed",
      ],
      logic:
        "The numerator is the activated/completed-value step and the denominator is the earlier signup/workshop step for the selected UTC window.",
      refresh: REFRESH.metric,
    };
  }

  if (normalized.includes("platform")) {
    return metricInfo({
      title: "Platform split",
      body:
        "Comes from GA4/Firebase active user metrics with platform/device dimensions. It describes where analytics activity happened, not where users were originally created.",
      source: "ga4",
      metricKey: "active_users",
      logic:
        "The chart groups dashboard_metric_snapshots rows by dimensions.platform and sums value in the selected range.",
    });
  }

  if (normalized.includes("new users")) {
    return metricInfo({
      title: "New users",
      body:
        "Counts new analytics users from GA4/Firebase. For canonical product users, use dashboard_users.internal_user_id.",
      source: "ga4",
      metricKey: "new_users",
    });
  }

  if (normalized.includes("tracked users") || normalized === "members") {
    return {
      title: "Canonical users",
      body:
        "Comes from the core app user export stored in dashboard_users. Each row represents one known product user keyed by internal_user_id.",
      sources: ["AWS/S3 core app export", "dashboard_users"],
      fields: [
        "internal_user_id",
        "workshop_id",
        "created_at",
        "last_seen_at",
        "customer_io_id",
        "metadata",
      ],
      logic:
        "Counts users after the core_app sync has normalized identities and linked each user to a workshop when workshop_id is present.",
      refresh: REFRESH.coreEntity,
    };
  }

  if (
    normalized.includes("diagnostics started") ||
    normalized.includes("diagnostics created")
  ) {
    return metricInfo({
      title: "Diagnostics created",
      body:
        "Comes from the core app diagnostics export. A diagnostic is counted when a dashboard_diagnostics row has a created_at timestamp in the selected range.",
      source: "core_app",
      metricKey: "core_diagnostics_created",
      logic:
        "The source sync also stores the underlying rows in dashboard_diagnostics, keyed by diagnostic_id.",
    });
  }

  if (
    normalized.includes("diagnostics completed") ||
    normalized.includes("last diagnostic") ||
    normalized.includes("diagnostics in 30d")
  ) {
    return metricInfo({
      title: "Diagnostics completed",
      body:
        "Comes from dashboard_diagnostics. Completion uses completed_at/status from the core app export and is aggregated into metric snapshots.",
      source: "core_app",
      metricKey: "core_diagnostics_completed",
      logic:
        "Workshop drilldowns read the raw dashboard_diagnostics rows; KPI cards read the aggregated core_diagnostics_completed metric.",
    });
  }

  if (normalized.includes("ai cost") || normalized.includes("cost / diagnostic")) {
    return metricInfo({
      title: "AI cost",
      body:
        "Comes from diagnostic and chat cost fields exported by the core app. The detailed rows live in dashboard_diagnostics.diag_cost and dashboard_diagnostic_chats.chat_cost.",
      source: "core_app",
      metricKey: "core_diagnostic_cost / core_chat_cost",
      logic:
        "Observed AI cost adds diagnostic cost plus chat cost for the selected window. Cost per diagnostic divides window AI cost by diagnostics created.",
    });
  }

  if (normalized.includes("chat")) {
    return metricInfo({
      title: "Diagnostic chats",
      body:
        "Comes from dashboard_diagnostic_chats. Each chat row is keyed by chat_id and may link back to diagnostic_id, workshop_id, and internal_user_id.",
      source: "core_app",
      metricKey: "core_diagnostic_chats",
      logic:
        "Message counts and chat cost come from message_count and chat_cost, then aggregate into metric snapshots.",
    });
  }

  if (normalized.includes("motor")) {
    return metricInfo({
      title: "Motor usage",
      body:
        "Comes from dashboard_motor_usage. Rows are grouped by month and database_name with total_accesses, unique_users, and unique_vehicles.",
      source: "core_app",
      metricKey: "core_motor_accesses",
      logic:
        "Database bars use dimensions.database from dashboard_metric_snapshots and the underlying dashboard_motor_usage export.",
    });
  }

  if (
    normalized.includes("live workshops") ||
    normalized.includes("tracked workshops") ||
    normalized.includes("visible workshops") ||
    normalized.includes("workshop")
  ) {
    return {
      title: "Workshop identity and status",
      body:
        "Workshop identity comes from dashboard_workshops. Billing state is joined from dashboard_subscriptions when Stripe linkage exists.",
      sources: ["dashboard_workshops", "dashboard_subscriptions"],
      fields: [
        "dashboard_workshops.workshop_id",
        "name",
        "country",
        "plan_key",
        "activated_at",
        "dashboard_subscriptions.status",
      ],
      logic:
        "Live workshops means active plus trialing subscription status. Unknown means the workshop exists but no reliable subscription status was linked.",
      refresh: REFRESH.coreEntity,
    };
  }

  if (
    normalized.includes("country") ||
    normalized.includes("markets") ||
    normalized.includes("where workshops")
  ) {
    return {
      title: "Workshop country",
      body:
        "Comes from dashboard_workshops.country, normalized from the core app export. Missing country means the source row did not provide canonical geography yet.",
      sources: ["AWS/S3 core app export", "dashboard_workshops"],
      fields: ["workshop_id", "country", "metadata"],
      refresh: REFRESH.coreEntity,
    };
  }

  if (
    normalized.includes("mrr") ||
    normalized.includes("arr") ||
    normalized.includes("subscription") ||
    normalized.includes("trial") ||
    normalized.includes("paid") ||
    normalized.includes("churn") ||
    normalized.includes("billing") ||
    normalized.includes("stripe") ||
    normalized.includes("plan")
  ) {
    return {
      title: "Stripe-backed billing",
      body: SOURCE_INFO.stripe,
      sources: ["Stripe", "dashboard_subscriptions", "dashboard_metric_snapshots"],
      fields: [
        "stripe_subscription_id",
        "workshop_id",
        "status",
        "plan_key",
        "mrr_amount_cents",
        "metric_key=mrr",
      ],
      logic:
        "MRR is the current subscription monthly recurring amount. ARR is calculated in the dashboard as MRR multiplied by 12.",
      refresh: REFRESH.stripe,
    };
  }

  if (
    normalized.includes("organic") ||
    normalized.includes("search") ||
    normalized.includes("query") ||
    normalized.includes("page") ||
    normalized.includes("position")
  ) {
    return {
      title: "Search Console metric",
      body: SOURCE_INFO.searchConsole,
      sources: ["Google Search Console", "dashboard_metric_snapshots", "dashboard_raw_metric_rows"],
      fields: [
        "metric_key=organic_search_clicks",
        "metric_key=organic_search_impressions",
        "metric_key=organic_search_ctr",
        "metric_key=organic_search_position",
        "dimensions.query/page/country/device",
      ],
      logic:
        "The sync stores raw Search Console rows, then writes daily metrics by dimension. CTR is clicks divided by impressions; position is impression-weighted average rank.",
      refresh: REFRESH.metric,
    };
  }

  if (
    normalized.includes("message") ||
    normalized.includes("open") ||
    normalized.includes("sent") ||
    normalized.includes("delivered") ||
    normalized.includes("bounce") ||
    normalized.includes("unsub") ||
    normalized.includes("human click") ||
    normalized.includes("human open")
  ) {
    return {
      title: "Customer.io messaging",
      body: SOURCE_INFO.customerIo,
      sources: ["Customer.io", "dashboard_metric_snapshots"],
      fields: [
        "metric_key=cio_sent",
        "metric_key=cio_delivered",
        "metric_key=cio_human_opened",
        "metric_key=cio_human_clicked",
        "metric_key=cio_converted",
        "dimensions.campaign",
      ],
      logic:
        "Rates are calculated from delivered messages. Human opens/clicks exclude machine activity where Customer.io reports that distinction.",
      refresh: REFRESH.metric,
    };
  }

  if (
    normalized.includes("campaign") ||
    normalized.includes("spend") ||
    normalized.includes("click") ||
    normalized.includes("impression") ||
    normalized.includes("cpc") ||
    normalized.includes("cac") ||
    normalized.includes("conversion") ||
    normalized.includes("signup")
  ) {
    return {
      title: "Acquisition telemetry",
      body: SOURCE_INFO.googleAds,
      sources: ["GA4 / Firebase", "Google Ads"],
      fields: [
        "metric_key=ad_spend",
        "metric_key=ad_clicks",
        "metric_key=ad_impressions",
        "metric_key=ad_signups (GA4 sign_up event, sessions with a Google Ads campaign)",
        "dimensions.campaign",
      ],
      logic:
        "Rates and cost metrics are calculated from synced spend, ad clicks, ad impressions, and ad-attributed signup rows in the selected window. Signups exclude sessions where sessionGoogleAdsCampaignId is '(not set)'.",
      refresh: REFRESH.metric,
    };
  }

  if (
    normalized.includes("diagnostic") ||
    normalized.includes("chat") ||
    normalized.includes("motor") ||
    normalized.includes("ai cost") ||
    normalized.includes("workshop") ||
    normalized.includes("member") ||
    normalized.includes("user") ||
    normalized.includes("activity") ||
    normalized.includes("country")
  ) {
    return {
      title: "Core app warehouse",
      body: SOURCE_INFO.coreApp,
      sources: ["AWS/S3 core app export", "dashboard warehouse"],
      fields: [
        "dashboard_users",
        "dashboard_workshops",
        "dashboard_diagnostics",
        "dashboard_diagnostic_chats",
        "dashboard_metric_snapshots",
      ],
      logic:
        "The core_app connector normalizes source exports into entity tables and also writes aggregate metric rows for dashboard cards and charts.",
      refresh: REFRESH.coreEntity,
    };
  }

  if (
    normalized.includes("healthy") ||
    normalized.includes("stale") ||
    normalized.includes("failing") ||
    normalized.includes("rows") ||
    normalized.includes("window")
  ) {
    return {
      title: "Sync health",
      body: SOURCE_INFO.sync,
      sources: ["dashboard_sync_runs", "dashboard_source_accounts"],
      fields: [
        "source_key",
        "status",
        "started_at",
        "completed_at",
        "rows_read",
        "rows_written",
        "error_message",
        "last_success_at",
      ],
      refresh: REFRESH.sync,
    };
  }

  return {
    title: "Dashboard calculation",
    body: SOURCE_INFO.calculated,
    sources: ["synced warehouse rows"],
  };
}
