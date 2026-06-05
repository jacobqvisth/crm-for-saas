"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { CEO_CACHE_TAG } from "@/lib/ceo/cache";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";

// All actions in this file mutate the dashboard internal-test exclusion list
// (dashboard_users.is_internal_test, dashboard_workshops.is_internal_test,
// dashboard_internal_test_patterns). They run as the service-role client so
// they bypass RLS — access is gated by the (ceo) layout's middleware.

const userIdSchema = z.string().trim().min(1).max(128);
const workshopIdSchema = z.string().trim().min(1).max(128);
const noteSchema = z.string().trim().max(280).optional().nullable();
const patternKindSchema = z.enum(["email", "username"]);
const patternValueSchema = z.string().trim().min(1).max(254);
const patternIdSchema = z.string().uuid();

function unwrap<T>(input: FormData, key: string, fallback: T): string | T {
  const value = input.get(key);
  if (typeof value === "string") return value;
  return fallback;
}

function refreshAffectedPaths() {
  // Every dashboard surface that filters by internal-test exclusions needs to
  // re-render after a flag flip. Bust the shared CEO data cache so the change
  // is reflected immediately rather than after the 5-minute TTL.
  updateTag(CEO_CACHE_TAG);
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/workshops");
  revalidatePath("/dashboard/new-users");
  revalidatePath("/dashboard/app-usage");
}

export async function setUserInternalAction(formData: FormData) {
  const userId = userIdSchema.parse(unwrap(formData, "userId", ""));
  const isInternalRaw = unwrap(formData, "isInternal", "false");
  const isInternal = isInternalRaw === "true" || isInternalRaw === "1";
  const noteRaw = unwrap(formData, "note", "");
  const parsedNote = noteSchema.parse(noteRaw === "" ? null : noteRaw);

  const supabase = createSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase not configured");

  // Upsert so we can flag a user that hasn't been synced through user_stats yet.
  const { error } = await supabase.from("dashboard_users").upsert(
    {
      internal_user_id: userId,
      is_internal_test: isInternal,
      internal_test_note: parsedNote,
      internal_test_set_at: new Date().toISOString(),
    },
    { onConflict: "internal_user_id" },
  );
  if (error) throw new Error(`Failed to update user flag: ${error.message}`);

  refreshAffectedPaths();
}

export async function setUserExemptAction(formData: FormData) {
  const userId = userIdSchema.parse(unwrap(formData, "userId", ""));
  const isExemptRaw = unwrap(formData, "isExempt", "false");
  const isExempt = isExemptRaw === "true" || isExemptRaw === "1";
  const noteRaw = unwrap(formData, "note", "");
  const parsedNote = noteSchema.parse(noteRaw === "" ? null : noteRaw);

  const supabase = createSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase not configured");

  const { error } = await supabase.from("dashboard_users").upsert(
    {
      internal_user_id: userId,
      is_internal_test_exempt: isExempt,
      internal_test_note: parsedNote,
      internal_test_set_at: new Date().toISOString(),
    },
    { onConflict: "internal_user_id" },
  );
  if (error) throw new Error(`Failed to update exempt flag: ${error.message}`);

  refreshAffectedPaths();
}

export async function setWorkshopInternalAction(formData: FormData) {
  const workshopId = workshopIdSchema.parse(
    unwrap(formData, "workshopId", ""),
  );
  const isInternalRaw = unwrap(formData, "isInternal", "false");
  const isInternal = isInternalRaw === "true" || isInternalRaw === "1";
  const noteRaw = unwrap(formData, "note", "");
  const parsedNote = noteSchema.parse(noteRaw === "" ? null : noteRaw);

  const supabase = createSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase not configured");

  const { error } = await supabase.from("dashboard_workshops").upsert(
    {
      workshop_id: workshopId,
      is_internal_test: isInternal,
      internal_test_note: parsedNote,
      internal_test_set_at: new Date().toISOString(),
    },
    { onConflict: "workshop_id" },
  );
  if (error) throw new Error(`Failed to update workshop flag: ${error.message}`);

  refreshAffectedPaths();
}

export async function addPatternAction(formData: FormData) {
  const kind = patternKindSchema.parse(unwrap(formData, "kind", ""));
  const value = patternValueSchema.parse(unwrap(formData, "value", ""));
  const noteRaw = unwrap(formData, "note", "");
  const parsedNote = noteSchema.parse(noteRaw === "" ? null : noteRaw);

  const supabase = createSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase not configured");

  // Patterns are case-insensitive — store lowercased so the unique index on
  // (kind, lower(value)) catches duplicates and the loader's lowercased
  // matching uses the same normal form.
  const { error } = await supabase
    .from("dashboard_internal_test_patterns")
    .insert({ kind, value: value.toLowerCase(), note: parsedNote });
  if (error && !error.message.includes("duplicate")) {
    throw new Error(`Failed to add pattern: ${error.message}`);
  }

  refreshAffectedPaths();
}

export async function removePatternAction(formData: FormData) {
  const id = patternIdSchema.parse(unwrap(formData, "id", ""));

  const supabase = createSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase not configured");

  const { error } = await supabase
    .from("dashboard_internal_test_patterns")
    .delete()
    .eq("id", id);
  if (error) throw new Error(`Failed to remove pattern: ${error.message}`);

  refreshAffectedPaths();
}
