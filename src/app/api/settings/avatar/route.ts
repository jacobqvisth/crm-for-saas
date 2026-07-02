import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const BUCKET = "avatars";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

function isFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File;
}

async function ensureAvatarsBucket() {
  const serviceSupabase = createServiceClient();
  const { error: getError } = await serviceSupabase.storage.getBucket(BUCKET);
  if (!getError) return { serviceSupabase, error: null as string | null };

  const { error: createError } = await serviceSupabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_FILE_SIZE_BYTES,
    allowedMimeTypes: Array.from(ALLOWED_IMAGE_TYPES.keys()),
  });
  if (createError && !createError.message.toLowerCase().includes("already exists")) {
    return { serviceSupabase, error: createError.message };
  }
  return { serviceSupabase, error: null as string | null };
}

// Persist the avatar URL in two places: user_profiles.avatar_url (source of
// truth, and how other users' avatars are resolved e.g. on the call worklist)
// and auth user_metadata.avatar_url (so the sidebar, which reads the auth
// session directly, updates without an extra DB round-trip).
async function persistAvatarUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  url: string | null,
) {
  const { error: profileError } = await supabase
    .from("user_profiles")
    .upsert({ user_id: userId, avatar_url: url }, { onConflict: "user_id" });
  if (profileError) return profileError.message;

  const { error: metaError } = await supabase.auth.updateUser({
    data: { avatar_url: url },
  });
  if (metaError) return metaError.message;

  return null;
}

// POST /api/settings/avatar — multipart upload of the signed-in user's profile
// picture. Stores it in the public avatars bucket and returns the public URL.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");

  if (!isFile(file)) {
    return NextResponse.json({ error: "Image file required" }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Use a JPG, PNG, GIF, or WebP image." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "Images can be up to 5 MB." }, { status: 400 });
  }

  const { serviceSupabase, error: bucketError } = await ensureAvatarsBucket();
  if (bucketError) return NextResponse.json({ error: bucketError }, { status: 500 });

  const extension = ALLOWED_IMAGE_TYPES.get(file.type);
  const objectPath = `${user.id}/${Date.now()}-${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await serviceSupabase.storage
    .from(BUCKET)
    .upload(objectPath, buffer, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data } = serviceSupabase.storage.from(BUCKET).getPublicUrl(objectPath);
  const url = data.publicUrl;

  const persistError = await persistAvatarUrl(supabase, user.id, url);
  if (persistError) return NextResponse.json({ error: persistError }, { status: 500 });

  return NextResponse.json({ url });
}

// DELETE /api/settings/avatar — clear the signed-in user's profile picture.
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const persistError = await persistAvatarUrl(supabase, user.id, null);
  if (persistError) return NextResponse.json({ error: persistError }, { status: 500 });

  return NextResponse.json({ success: true });
}
