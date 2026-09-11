import { NextRequest, NextResponse } from "next/server";
import { requireIssueUser } from "@/lib/issues/access";

export const runtime = "nodejs";

const BUCKET = "wiki-media";
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 40 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);

function extFor(mime: string, filename: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/webm") return "webm";
  const fromName = filename.split(".").pop()?.toLowerCase();
  if (fromName) return fromName === "jpeg" ? "jpg" : fromName;
  return "jpg";
}

export async function POST(request: NextRequest) {
  const gate = await requireIssueUser(request);
  if ("error" in gate) return gate.error;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
  }

  const mime = (fileValue.type || "").toLowerCase();
  const isImage = IMAGE_TYPES.has(mime);
  const isVideo = VIDEO_TYPES.has(mime);
  if (!isImage && !isVideo) {
    return NextResponse.json({ error: "이미지 또는 영상만 올릴 수 있습니다." }, { status: 400 });
  }
  if (isImage && fileValue.size > MAX_IMAGE) {
    return NextResponse.json({ error: "이미지는 10MB 이하여야 합니다." }, { status: 400 });
  }
  if (isVideo && fileValue.size > MAX_VIDEO) {
    return NextResponse.json({ error: "영상은 40MB 이하여야 합니다." }, { status: 400 });
  }

  const path = `issues/${gate.user.id}/${crypto.randomUUID()}.${extFor(mime, fileValue.name)}`;
  const buf = Buffer.from(await fileValue.arrayBuffer());
  const { error } = await gate.admin.storage.from(BUCKET).upload(path, buf, {
    contentType: mime,
    upsert: false
  });
  if (error) {
    console.error("[issues/upload]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data } = gate.admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, path });
}
