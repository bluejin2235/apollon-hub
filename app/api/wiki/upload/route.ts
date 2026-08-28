import { NextRequest, NextResponse } from "next/server";
import { requireWikiUser, wikiWriteForbiddenForWebsiteTester } from "@/lib/wiki/api";

export const runtime = "nodejs";

const BUCKET = "wiki-media";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function extFor(mime: string, filename: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  const fromName = filename.split(".").pop()?.toLowerCase();
  if (fromName === "png" || fromName === "webp" || fromName === "gif" || fromName === "jpg" || fromName === "jpeg") {
    return fromName === "jpeg" ? "jpg" : fromName;
  }
  return "jpg";
}

export async function POST(request: NextRequest) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;
  const writeBlocked = wikiWriteForbiddenForWebsiteTester(gate);
  if (writeBlocked) return writeBlocked;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const fileValue = formData.get("file");
  const slugRaw = formData.get("slug");
  const slug =
    typeof slugRaw === "string" && slugRaw.trim()
      ? slugRaw.trim().replace(/[^a-z0-9-]/gi, "_")
      : "misc";

  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
  }
  if (fileValue.size > MAX_BYTES) {
    return NextResponse.json({ error: "이미지는 10MB 이하여야 합니다." }, { status: 400 });
  }
  const mime = (fileValue.type || "").toLowerCase();
  if (!ALLOWED.has(mime)) {
    return NextResponse.json(
      { error: "jpg, png, webp, gif만 올릴 수 있습니다." },
      { status: 400 }
    );
  }

  const path = `${slug}/${crypto.randomUUID()}.${extFor(mime, fileValue.name)}`;
  const buf = Buffer.from(await fileValue.arrayBuffer());
  const { error } = await gate.admin.storage.from(BUCKET).upload(path, buf, {
    contentType: mime,
    upsert: false
  });
  if (error) {
    console.error("[wiki/upload]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data } = gate.admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, path });
}
