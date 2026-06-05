"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { REVIEW_PLATFORM_SLUGS } from "@/lib/ceo/reviews/platforms";
import { TABLES } from "@/lib/ceo/tables";

const CEO_ALLOWED_EMAILS = (process.env.CEO_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

// Mirror of the /ceo/* gate in src/lib/supabase/middleware.ts: an entry
// starting with "@" matches any address on that domain; otherwise it's an
// exact-address match. Empty allowlist = locked (deny) for the action.
function isCeoEmail(email?: string | null): boolean {
  if (!email || CEO_ALLOWED_EMAILS.length === 0) return false;
  const normalized = email.toLowerCase();
  return CEO_ALLOWED_EMAILS.some((entry) =>
    entry.startsWith("@")
      ? normalized.endsWith(entry)
      : normalized === entry,
  );
}

async function requireCeo(): Promise<{ email: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isCeoEmail(user?.email)) {
    return { error: "Not authorized." };
  }
  return { email: user!.email! };
}

export type ReviewActionResult = { ok: boolean; error?: string };

const snapshotSchema = z.object({
  platformSlug: z.string().refine((v) => REVIEW_PLATFORM_SLUGS.includes(v), {
    message: "Unknown platform.",
  }),
  rating: z
    .union([z.coerce.number().min(0).max(5), z.literal("")])
    .optional(),
  reviewCount: z.coerce.number().int().min(0).default(0),
  capturedAt: z.string().min(1, "A date is required."),
  source: z.enum(["manual", "api", "widget"]).default("manual"),
  note: z.string().max(2000).optional(),
});

export async function addReviewSnapshotAction(
  _prev: ReviewActionResult | undefined,
  formData: FormData,
): Promise<ReviewActionResult> {
  const auth = await requireCeo();
  if ("error" in auth) return { ok: false, error: auth.error };

  const supabase = createSupabaseServiceClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const parsed = snapshotSchema.safeParse({
    platformSlug: formData.get("platformSlug"),
    rating: formData.get("rating") ?? "",
    reviewCount: formData.get("reviewCount") ?? 0,
    capturedAt: formData.get("capturedAt"),
    source: formData.get("source") ?? "manual",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { platformSlug, rating, reviewCount, capturedAt, source, note } =
    parsed.data;

  const { error } = await supabase.from(TABLES.reviewSnapshots).upsert(
    {
      platform_slug: platformSlug,
      captured_at: capturedAt,
      rating: rating === "" || rating == null ? null : rating,
      review_count: reviewCount,
      source,
      note: note?.trim() ? note.trim() : null,
      entered_by: auth.email,
    },
    { onConflict: "platform_slug,captured_at" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/reviews");
  return { ok: true };
}

const reviewSchema = z.object({
  platformSlug: z.string().refine((v) => REVIEW_PLATFORM_SLUGS.includes(v), {
    message: "Unknown platform.",
  }),
  rating: z.union([z.coerce.number().min(0).max(5), z.literal("")]).optional(),
  title: z.string().max(300).optional(),
  body: z.string().min(1, "Review text is required.").max(5000),
  authorName: z.string().max(200).optional(),
  authorCompany: z.string().max(200).optional(),
  reviewUrl: z.string().url().optional().or(z.literal("")),
  reviewedAt: z.string().optional(),
});

export async function addIndividualReviewAction(
  _prev: ReviewActionResult | undefined,
  formData: FormData,
): Promise<ReviewActionResult> {
  const auth = await requireCeo();
  if ("error" in auth) return { ok: false, error: auth.error };

  const supabase = createSupabaseServiceClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const parsed = reviewSchema.safeParse({
    platformSlug: formData.get("platformSlug"),
    rating: formData.get("rating") ?? "",
    title: formData.get("title") ?? "",
    body: formData.get("body"),
    authorName: formData.get("authorName") ?? "",
    authorCompany: formData.get("authorCompany") ?? "",
    reviewUrl: formData.get("reviewUrl") ?? "",
    reviewedAt: formData.get("reviewedAt") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const d = parsed.data;
  const { error } = await supabase.from(TABLES.reviews).upsert(
    {
      platform_slug: d.platformSlug,
      external_id: `manual:${randomUUID()}`,
      rating: d.rating === "" || d.rating == null ? null : d.rating,
      title: d.title?.trim() || null,
      body: d.body.trim(),
      author_name: d.authorName?.trim() || null,
      author_company: d.authorCompany?.trim() || null,
      review_url: d.reviewUrl?.trim() || null,
      reviewed_at: d.reviewedAt?.trim() ? d.reviewedAt : null,
      response_text: null,
      source: "manual",
    },
    { onConflict: "platform_slug,external_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/reviews");
  return { ok: true };
}
