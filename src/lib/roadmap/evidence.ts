import { createSupabaseServiceClient } from "@/lib/ceo/supabase";

// Countries / languages we care about for the marketing plan. (code → label)
const COUNTRIES: Record<string, string> = {
  SE: "Sweden",
  NO: "Norway",
  FI: "Finland",
  DK: "Denmark",
  GB: "United Kingdom",
  EE: "Estonia",
  LV: "Latvia",
  LT: "Lithuania",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
};

const LANGUAGES: Record<string, string> = {
  sv: "Swedish",
  no: "Norwegian",
  fi: "Finnish",
  da: "Danish",
  en: "English",
  de: "German",
  fr: "French",
  it: "Italian",
  es: "Spanish",
};

export interface RoadmapEvidence {
  reviews: { platform: string; rating: number | null; reviewCount: number; lastCapturedAt: string | null }[];
  sequences: { name: string; status: string | null }[];
  emailsSentTotal: number;
  outreachByCountry: { code: string; label: string; contacted: number; total: number }[];
  outreachByLanguage: { code: string; label: string; contacted: number }[];
  appUsers: number;
  activatedUsers: number;
  sources: { key: string; status: string | null; lastSuccessAt: string | null }[];
}

const EMPTY: RoadmapEvidence = {
  reviews: [],
  sequences: [],
  emailsSentTotal: 0,
  outreachByCountry: [],
  outreachByLanguage: [],
  appUsers: 0,
  activatedUsers: 0,
  sources: [],
};

async function headCount(q: PromiseLike<{ count: number | null }>): Promise<number> {
  try {
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Read-only sweep of internal CRM data that signals real marketing progress.
 * Uses the service-role client (server-only, like the CEO dashboards) so it can
 * read the dashboard_* tables; workspace-scoped tables are still filtered by id.
 */
export async function gatherEvidence(workspaceId: string): Promise<RoadmapEvidence> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return EMPTY;

  const reviews = await (async () => {
    try {
      const { data } = await supabase
        .from("dashboard_review_snapshots")
        .select("platform_slug, rating, review_count, captured_at")
        .order("captured_at", { ascending: true });
      const latest = new Map<string, RoadmapEvidence["reviews"][number]>();
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        const platform = String(r.platform_slug ?? "");
        if (!platform) continue;
        latest.set(platform, {
          platform,
          rating: typeof r.rating === "number" ? r.rating : r.rating != null ? Number(r.rating) : null,
          reviewCount: typeof r.review_count === "number" ? r.review_count : 0,
          lastCapturedAt: r.captured_at ? String(r.captured_at) : null,
        });
      }
      return [...latest.values()];
    } catch {
      return [] as RoadmapEvidence["reviews"];
    }
  })();

  const sequences = await (async () => {
    try {
      const { data } = await supabase
        .from("sequences")
        .select("name, status")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true });
      return ((data ?? []) as Record<string, unknown>[]).map((s) => ({
        name: String(s.name ?? ""),
        status: s.status != null ? String(s.status) : null,
      }));
    } catch {
      return [] as RoadmapEvidence["sequences"];
    }
  })();

  const emailsSentTotal = await headCount(
    supabase
      .from("email_queue")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "sent")
  );

  const appUsers = await headCount(
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .not("wl_user_id", "is", null)
  );

  const activatedUsers = await headCount(
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .or("diagnostics_total.gt.0,last_login_at.not.is.null")
  );

  const sources = await (async () => {
    try {
      const { data } = await supabase
        .from("dashboard_source_accounts")
        .select("source_key, status, last_success_at");
      return ((data ?? []) as Record<string, unknown>[]).map((s) => ({
        key: String(s.source_key ?? ""),
        status: s.status != null ? String(s.status) : null,
        lastSuccessAt: s.last_success_at ? String(s.last_success_at) : null,
      }));
    } catch {
      return [] as RoadmapEvidence["sources"];
    }
  })();

  const outreachByCountry = await Promise.all(
    Object.entries(COUNTRIES).map(async ([code, label]) => {
      const [contacted, total] = await Promise.all([
        headCount(
          supabase
            .from("contacts")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .eq("country_code", code)
            .not("last_contacted_at", "is", null)
        ),
        headCount(
          supabase
            .from("contacts")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .eq("country_code", code)
        ),
      ]);
      return { code, label, contacted, total };
    })
  );

  const outreachByLanguage = await Promise.all(
    Object.entries(LANGUAGES).map(async ([code, label]) => {
      const contacted = await headCount(
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("language", code)
          .not("last_contacted_at", "is", null)
      );
      return { code, label, contacted };
    })
  );

  return {
    reviews,
    sequences,
    emailsSentTotal,
    outreachByCountry: outreachByCountry.filter((c) => c.total > 0 || c.contacted > 0),
    outreachByLanguage: outreachByLanguage.filter((l) => l.contacted > 0),
    appUsers,
    activatedUsers,
    sources,
  };
}

/** Render the evidence as compact, labelled text for the model prompt. */
export function formatEvidence(e: RoadmapEvidence): string {
  const lines: string[] = [];

  lines.push("## Review platforms (a row means a snapshot exists = setup has begun)");
  if (e.reviews.length === 0) lines.push("- none recorded");
  for (const r of e.reviews) {
    lines.push(
      `- ${r.platform}: ${r.reviewCount} reviews${r.rating != null ? `, rating ${r.rating}` : ""}${r.lastCapturedAt ? ` (last updated ${r.lastCapturedAt})` : ""}`
    );
  }

  lines.push("\n## Email sequences");
  if (e.sequences.length === 0) lines.push("- none");
  for (const s of e.sequences) lines.push(`- "${s.name}" (${s.status ?? "unknown"})`);
  lines.push(`\nTotal outbound emails actually sent: ${e.emailsSentTotal}`);

  lines.push("\n## Outreach by country (contacted = at least one email sent to them)");
  if (e.outreachByCountry.length === 0) lines.push("- no contacts by country");
  for (const c of e.outreachByCountry) {
    lines.push(`- ${c.label} (${c.code}): ${c.contacted} contacted of ${c.total} contacts`);
  }

  lines.push("\n## Outreach by contact language");
  if (e.outreachByLanguage.length === 0) lines.push("- no language-tagged outreach yet");
  for (const l of e.outreachByLanguage) {
    lines.push(`- ${l.label} (${l.code}): ${l.contacted} contacted`);
  }

  lines.push("\n## App users / activation");
  lines.push(`- App users (have an account): ${e.appUsers}`);
  lines.push(`- Activated (ran a diagnostic or logged in): ${e.activatedUsers}`);

  lines.push("\n## Connected data sources (integration status)");
  if (e.sources.length === 0) lines.push("- none");
  for (const s of e.sources) {
    lines.push(`- ${s.key}: ${s.status ?? "unknown"}${s.lastSuccessAt ? ` (last sync ${s.lastSuccessAt})` : ""}`);
  }

  return lines.join("\n");
}
