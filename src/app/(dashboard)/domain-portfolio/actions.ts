"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import type { DomainPortfolioStatus } from "@/lib/ceo/data/domain-portfolio";

const ALLOWED_STATUSES: DomainPortfolioStatus[] = [
  "not_started",
  "planning",
  "bought",
  "installed",
  "skipped",
];

export type DomainPortfolioPatch = {
  status?: DomainPortfolioStatus;
  domain_name?: string | null;
  registrar?: string | null;
  annual_cost_eur?: number | null;
  notes?: string | null;
};

type DbPatch = {
  status?: DomainPortfolioStatus;
  domain_name?: string | null;
  registrar?: string | null;
  annual_cost_eur?: number | null;
  notes?: string | null;
  purchased_at?: string | null;
  installed_at?: string | null;
};

function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
  }
  return undefined;
}

export async function updateDomainPortfolioRowAction(
  id: string,
  patch: DomainPortfolioPatch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id || typeof id !== "string") {
    return { ok: false, error: "Missing row id" };
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return { ok: false, error: "Supabase not configured" };
  }

  const dbPatch: DbPatch = {};

  if (patch.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(patch.status)) {
      return { ok: false, error: `Invalid status: ${patch.status}` };
    }
    dbPatch.status = patch.status;
  }

  const domainName = nullableString(patch.domain_name);
  if (domainName !== undefined) dbPatch.domain_name = domainName;

  const registrar = nullableString(patch.registrar);
  if (registrar !== undefined) dbPatch.registrar = registrar;

  const notes = nullableString(patch.notes);
  if (notes !== undefined) dbPatch.notes = notes;

  const cost = nullableNumber(patch.annual_cost_eur);
  if (cost !== undefined) dbPatch.annual_cost_eur = cost;

  // Auto-stamp purchased_at / installed_at when status crosses the threshold.
  // We only stamp if the column is currently null so we don't clobber an
  // earlier value when toggling status back and forth.
  if (patch.status === "bought" || patch.status === "installed") {
    const { data: current } = await supabase
      .from("dashboard_domain_portfolio")
      .select("purchased_at, installed_at")
      .eq("id", id)
      .single();

    const now = new Date().toISOString();
    if (current && !current.purchased_at) {
      dbPatch.purchased_at = now;
    }
    if (patch.status === "installed" && current && !current.installed_at) {
      dbPatch.installed_at = now;
    }
  }

  if (Object.keys(dbPatch).length === 0) {
    return { ok: true };
  }

  const { error } = await supabase
    .from("dashboard_domain_portfolio")
    .update(dbPatch)
    .eq("id", id);

  if (error) {
    console.error("[domain-portfolio] update failed", error);
    return { ok: false, error: error.message };
  }

  revalidatePath("/domain-portfolio");
  return { ok: true };
}
