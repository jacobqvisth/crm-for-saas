import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Json } from "@/lib/database.types";

// Prospeo API types
type ProspeoSearchResult = {
  person: {
    person_id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    linkedin_url?: string;
    current_job_title?: string;
    headline?: string;
    location?: {
      country?: string;
      country_code?: string;
      state?: string;
      city?: string;
    };
  };
  company: {
    company_id: string;
    name: string;
    website?: string;
    domain?: string;
    industry?: string;
    employee_count?: number;
    employee_range?: string;
    location?: {
      country?: string;
      city?: string;
    };
  };
};

type ProspeoSearchResponse = {
  error: boolean;
  error_code?: string;
  filter_error?: string;
  results?: ProspeoSearchResult[];
  pagination?: {
    current_page: number;
    per_page: number;
    total_page: number;
    total_count: number;
  };
};

type SearchRequestBody = {
  personCountries: string[];
  jobTitles: string[];
  seniorities: string[];
  industries: string[];
  companySizes: string[]; // already-flattened array of valid range strings
  keywords: string[]; // already split and trimmed
  verifiedEmailOnly: boolean;
  maxPerCompany: number;
  page: number;
  workspaceId: string;
};

function buildCacheHash(
  body: Omit<SearchRequestBody, "page" | "workspaceId">
): string {
  const normalized = {
    personCountries: [...body.personCountries].sort(),
    jobTitles: [...body.jobTitles].sort(),
    seniorities: [...body.seniorities].sort(),
    industries: [...body.industries].sort(),
    companySizes: [...body.companySizes].sort(),
    keywords: [...body.keywords].sort(),
    verifiedEmailOnly: body.verifiedEmailOnly,
    maxPerCompany: body.maxPerCompany,
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check API key
  if (!process.env.PROSPEO_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Prospeo API key not configured. Add PROSPEO_API_KEY to your environment variables.",
      },
      { status: 500 }
    );
  }

  const body: SearchRequestBody = await request.json();
  const {
    personCountries,
    jobTitles,
    seniorities,
    industries,
    companySizes,
    keywords,
    verifiedEmailOnly,
    maxPerCompany,
    page = 1,
    workspaceId,
  } = body;

  // Check cache for page 1 only
  if (page === 1 && workspaceId) {
    const hash = buildCacheHash(body);
    const { data: cached } = await supabase
      .from("prospector_search_cache")
      .select("results, pagination, searched_at")
      .eq("workspace_id", workspaceId)
      .eq("search_hash", hash)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached) {
      return NextResponse.json({
        results: cached.results,
        pagination: cached.pagination,
        cached: true,
        cachedAt: cached.searched_at,
      });
    }
  }

  // Build filters
  const filters: Record<string, unknown> = {};

  if (personCountries?.length > 0)
    filters.person_location_search = { include: personCountries };

  if (jobTitles?.length > 0)
    filters.person_job_title = { include: jobTitles };

  if (seniorities?.length > 0)
    filters.person_seniority = { include: seniorities };

  if (industries?.length > 0)
    filters.company_industry = { include: industries };

  if (companySizes?.length > 0)
    filters.company_headcount_range = companySizes; // plain array

  if (keywords?.length > 0)
    filters.company_keywords = {
      include: keywords,
      include_all: false,
      include_company_description: true,
    };

  if (verifiedEmailOnly)
    filters.person_contact_details = { email: ["VERIFIED"] };

  if (maxPerCompany && maxPerCompany >= 1 && maxPerCompany <= 100)
    filters.max_person_per_company = maxPerCompany;

  try {
    const response = await fetch("https://api.prospeo.io/search-person", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KEY": process.env.PROSPEO_API_KEY,
      },
      body: JSON.stringify({ page, filters }),
    });

    const data: ProspeoSearchResponse = await response.json();

    if (data.error) {
      const code = data.error_code;
      if (code === "INSUFFICIENT_CREDITS") {
        return NextResponse.json(
          {
            error:
              "Not enough Prospeo credits. Please add more credits at prospeo.io.",
          },
          { status: 402 }
        );
      }
      if (code === "RATE_LIMITED") {
        return NextResponse.json(
          { error: "Rate limit reached. Wait a moment and try again." },
          { status: 429 }
        );
      }
      if (code === "INVALID_FILTERS") {
        return NextResponse.json(
          {
            error: `Invalid filters: ${data.filter_error || "Unknown filter error"}`,
          },
          { status: 400 }
        );
      }
      if (code === "NO_RESULTS") {
        return NextResponse.json({
          results: [],
          pagination: {
            current_page: page,
            per_page: 25,
            total_page: 0,
            total_count: 0,
          },
          cached: false,
        });
      }
      return NextResponse.json(
        { error: data.filter_error || "Search failed" },
        { status: 400 }
      );
    }

    // Store results in cache for page 1
    if (page === 1 && workspaceId && data.results) {
      const hash = buildCacheHash(body);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from("prospector_search_cache")
        .upsert(
          {
            workspace_id: workspaceId,
            search_hash: hash,
            filters: body as unknown as Json,
            results: (data.results || []) as unknown as Json,
            pagination: (data.pagination || {}) as unknown as Json,
            expires_at: expiresAt,
          },
          { onConflict: "workspace_id,search_hash" }
        );
    }

    return NextResponse.json({
      results: data.results || [],
      pagination: data.pagination || {
        current_page: page,
        per_page: 25,
        total_page: 0,
        total_count: 0,
      },
      cached: false,
    });
  } catch (err) {
    console.error("Prospeo search error:", err);
    return NextResponse.json(
      { error: "Network error contacting Prospeo. Please try again." },
      { status: 500 }
    );
  }
}
