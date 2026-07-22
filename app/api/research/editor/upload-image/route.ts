import { NextRequest, NextResponse } from "next/server";
import { isResearchManagerServer } from "@/lib/auth/check-research-manager";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";

const BUCKET = "trend-editor-images";

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim();
  const extMatch = trimmed.match(/(\.[a-zA-Z0-9]{1,8})$/);
  const ext = extMatch?.[1]?.toLowerCase() ?? "";
  const stem = (extMatch ? trimmed.slice(0, -ext.length) : trimmed)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const safeStem = stem.length > 0 ? stem.slice(0, 80) : "image";
  return `${safeStem}${ext || ".jpg"}`;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceSupabase();
    if (!admin) {
      return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
    }

    const canManage = await isResearchManagerServer(admin, user.id);
    if (!canManage) {
      return NextResponse.json({ error: "트렌드 레이더 관리 권한이 없습니다." }, { status: 403 });
    }

    const formData = await request.formData();
    const fileValue = formData.get("file");
    const candidateIdRaw = formData.get("candidateId");
    const candidateId = typeof candidateIdRaw === "string" ? candidateIdRaw.trim() : "";

    if (!candidateId) {
      return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
    }

    if (!(fileValue instanceof File) || fileValue.size === 0) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (fileValue.type && !allowedTypes.includes(fileValue.type)) {
      return NextResponse.json({ error: "jpg, png, gif, webp 이미지만 업로드할 수 있습니다." }, { status: 400 });
    }

    const filename = sanitizeFilename(fileValue.name || "image");
    const path = `${candidateId}/${Date.now()}-${filename}`;

    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, fileValue, {
      upsert: false,
      contentType: fileValue.type || undefined
    });

    if (uploadError) {
      console.error("[research/editor/upload-image] upload failed", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) {
      return NextResponse.json({ error: "Failed to resolve public URL" }, { status: 500 });
    }

    return NextResponse.json({ url: data.publicUrl });
  } catch (error) {
    console.error("[research/editor/upload-image]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
