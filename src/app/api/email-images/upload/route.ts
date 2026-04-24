import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const BUCKET = "email-images";
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

async function ensureEmailImagesBucket() {
  const serviceSupabase = createServiceClient();
  const { error: getError } = await serviceSupabase.storage.getBucket(BUCKET);

  if (!getError) {
    return { serviceSupabase, error: null as string | null };
  }

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

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const workspaceId = formData.get("workspaceId");
  const file = formData.get("file");

  if (typeof workspaceId !== "string" || !workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  if (!isFile(file)) {
    return NextResponse.json({ error: "Image file required" }, { status: 400 });
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Use a JPG, PNG, GIF, or WebP image." },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Images can be up to 5 MB." },
      { status: 400 }
    );
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { serviceSupabase, error: bucketError } = await ensureEmailImagesBucket();
  if (bucketError) {
    return NextResponse.json({ error: bucketError }, { status: 500 });
  }

  const extension = ALLOWED_IMAGE_TYPES.get(file.type);
  const objectPath = `${workspaceId}/${user.id}/${Date.now()}-${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await serviceSupabase.storage
    .from(BUCKET)
    .upload(objectPath, buffer, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data } = serviceSupabase.storage.from(BUCKET).getPublicUrl(objectPath);

  return NextResponse.json({
    url: data.publicUrl,
    path: objectPath,
  });
}
