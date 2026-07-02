import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geocodeAddress, MissingApiKeyError } from "@/lib/routes/geocode";
import { DEFAULT_WORKING_DAYS, parseWorkingDays, type WorkingDays } from "@/lib/routes/profile";
import type { Json } from "@/lib/database.types";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await supabase
    .from("user_profiles")
    .select(
      "full_name, title, avatar_url, signature_html, signature_updated_at, origin_address, origin_latitude, origin_longitude, origin_geocoded_at, working_days",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    email: user.email,
    full_name: data?.full_name ?? null,
    title: data?.title ?? null,
    avatar_url: data?.avatar_url ?? null,
    signature_html: data?.signature_html ?? null,
    signature_updated_at: data?.signature_updated_at ?? null,
    origin_address: data?.origin_address ?? null,
    origin_latitude: data?.origin_latitude ?? null,
    origin_longitude: data?.origin_longitude ?? null,
    origin_geocoded_at: data?.origin_geocoded_at ?? null,
    working_days: parseWorkingDays(data?.working_days ?? null),
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    full_name,
    title,
    signature_html,
    origin_address,
    working_days,
  } = body as {
    full_name?: string | null;
    title?: string | null;
    signature_html?: string | null;
    origin_address?: string | null;
    working_days?: Partial<WorkingDays>;
  };

  // Determine origin handling: only re-geocode if address changed (or was cleared).
  const { data: existing } = await supabase
    .from("user_profiles")
    .select("origin_address, origin_latitude, origin_longitude, working_days")
    .eq("user_id", user.id)
    .maybeSingle();

  const wantedAddress =
    typeof origin_address === "string" ? origin_address.trim() || null : origin_address ?? existing?.origin_address ?? null;

  let originLat: number | null = existing?.origin_latitude ?? null;
  let originLng: number | null = existing?.origin_longitude ?? null;
  let originGeocodedAt: string | null = null;
  let geocodeNote: string | null = null;

  const addressChanged = wantedAddress !== (existing?.origin_address ?? null);
  if (addressChanged) {
    if (!wantedAddress) {
      originLat = null;
      originLng = null;
      originGeocodedAt = null;
    } else {
      try {
        const result = await geocodeAddress(wantedAddress);
        if (result) {
          originLat = result.lat;
          originLng = result.lng;
          originGeocodedAt = new Date().toISOString();
        } else {
          originLat = null;
          originLng = null;
          originGeocodedAt = null;
          geocodeNote = "Address could not be geocoded — saved without coordinates.";
        }
      } catch (err) {
        if (err instanceof MissingApiKeyError) {
          geocodeNote = "GOOGLE_MAPS_API_KEY not configured — origin saved without geocoding.";
        } else {
          geocodeNote = err instanceof Error ? err.message : "Geocoding failed";
        }
      }
    }
  }

  // Working days — merge incoming partial onto existing or default.
  const baseWorkingDays =
    existing?.working_days != null ? parseWorkingDays(existing.working_days) : DEFAULT_WORKING_DAYS;
  const mergedWorkingDays: WorkingDays = { ...baseWorkingDays };
  if (working_days && typeof working_days === "object") {
    for (const key of Object.keys(mergedWorkingDays) as (keyof WorkingDays)[]) {
      const v = (working_days as Record<string, unknown>)[key];
      if (typeof v === "boolean") mergedWorkingDays[key] = v;
    }
  }

  const upsert = {
    user_id: user.id,
    full_name: full_name ?? null,
    title: title ?? null,
    signature_html: signature_html ?? null,
    signature_updated_at: signature_html ? new Date().toISOString() : null,
    origin_address: wantedAddress,
    origin_latitude: originLat,
    origin_longitude: originLng,
    origin_geocoded_at: addressChanged ? originGeocodedAt : (existing as { origin_geocoded_at?: string | null } | null)?.origin_geocoded_at ?? null,
    working_days: mergedWorkingDays as unknown as Json,
  };

  const { error } = await supabase
    .from("user_profiles")
    .upsert(upsert, { onConflict: "user_id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    geocode_note: geocodeNote,
    origin_address: wantedAddress,
    origin_latitude: originLat,
    origin_longitude: originLng,
    origin_geocoded_at: upsert.origin_geocoded_at,
    working_days: mergedWorkingDays,
  });
}
