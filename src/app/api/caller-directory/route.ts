import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { pageAll } from "@/lib/supabase-paging";
import { normalizePhone } from "@/lib/calls/phone";

// Caller-ID directory feed for the WrenchLane caller-ID apps (iOS Call Directory
// extension; Android later). Returns every CRM contact/company phone number
// normalized to E.164 with a human label, deduped, and pre-sorted ascending by
// numeric value so the iOS extension can stream them straight into
// `addIdentificationEntry(withNextSequentialPhoneNumber:)` — which REQUIRES
// entries in strictly increasing numeric order.
//
// Auth: static bearer token (CALLER_DIRECTORY_TOKEN), same shape as the cron
// routes. The client is a native app on Jacob's phone, so there's no session to
// carry — a long random shared secret is the right fit. Service-role client
// bypasses RLS and returns the whole CRM (single-operator use).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_LABEL_LEN = 60;

type ContactRow = {
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  all_phones: string[] | null;
  country_code: string | null;
  companies: { name: string | null; phone: string | null } | null;
};

// A person label beats a company-only label when two contacts share a number
// (e.g. everyone at a workshop calling from the same reception line).
function labelRank(isPerson: boolean): number {
  return isPerson ? 2 : 1;
}

function truncate(s: string): string {
  const t = s.trim();
  return t.length > MAX_LABEL_LEN ? `${t.slice(0, MAX_LABEL_LEN - 1)}…` : t;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = process.env.CALLER_DIRECTORY_TOKEN;
  if (!token || authHeader !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data, error } = await pageAll<ContactRow>(({ from, to }) =>
    supabase
      .from("contacts")
      .select(
        "first_name, last_name, email, phone, all_phones, country_code, companies(name, phone)",
      )
      // Stable order so paged .range() slices are deterministic.
      .order("id", { ascending: true })
      .range(from, to),
  );

  if (error) {
    return NextResponse.json(
      { error: "Failed to load contacts", detail: error.message },
      { status: 500 },
    );
  }

  // number (E.164) -> { label, rank }. Higher rank wins on collision.
  const byNumber = new Map<string, { label: string; rank: number }>();

  const add = (raw: string | null, label: string, isPerson: boolean, cc: string | null) => {
    const e164 = normalizePhone(raw, cc);
    if (!e164 || !label.trim()) return;
    const rank = labelRank(isPerson);
    const existing = byNumber.get(e164);
    if (!existing || rank > existing.rank) {
      byNumber.set(e164, { label: truncate(label), rank });
    }
  };

  for (const c of data) {
    const personName = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
    const companyName = c.companies?.name?.trim() || "";
    // Prefer "Name · Company"; fall back to name, then company, then email local part.
    const personLabel =
      personName && companyName
        ? `${personName} · ${companyName}`
        : personName || companyName || c.email.split("@")[0];

    add(c.phone, personLabel, Boolean(personName), c.country_code);
    for (const extra of c.all_phones ?? []) {
      add(extra, personLabel, Boolean(personName), c.country_code);
    }
    // The company main line, labeled with the company name (no person).
    if (c.companies?.phone && companyName) {
      add(c.companies.phone, companyName, false, c.country_code);
    }
  }

  // iOS Call Directory requires strictly increasing numeric order. E.164 is at
  // most 15 digits → well within JS safe-integer range, so a numeric compare of
  // the digits (sans "+") is exact.
  const entries = Array.from(byNumber.entries())
    .map(([number, v]) => ({ number, label: v.label }))
    .sort((a, b) => Number(a.number.slice(1)) - Number(b.number.slice(1)));

  return NextResponse.json({
    count: entries.length,
    generatedAt: new Date().toISOString(),
    entries,
  });
}
